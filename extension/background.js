importScripts('mist-context.js');

function normalizeText(value) {
  return (value || '').replace(/\s+/g, ' ').trim();
}

function normalizeHex(value) {
  return normalizeText(value).toLowerCase().replace(/[^0-9a-f]/g, '');
}

function pickDeviceField(device, keys) {
  for (const key of keys) {
    const value = normalizeText(device?.[key]);
    if (value) return value;
  }
  return null;
}

function pickSwitchRootPassword(device) {
  const direct = normalizeText(device?.root_password);
  if (direct) return direct;
  const nested = normalizeText(device?.switch_mgmt?.root_password);
  return nested || null;
}

function computeMistReachableHint(mistInventoryConnected, mistStatsStatus, mistRecentlySeen) {
  const explicitlyDisconnected =
    mistInventoryConnected === false ||
    (typeof mistStatsStatus === 'string' && /disconnect|offline|unreachable|down|lost/i.test(mistStatsStatus));

  if (explicitlyDisconnected) return false;

  return (
    mistInventoryConnected === true ||
    (typeof mistStatsStatus === 'string' && /connected/i.test(mistStatsStatus)) ||
    mistRecentlySeen === true
  );
}

function deriveMacCandidates(context) {
  const candidates = new Set();
  const explicitMac = normalizeHex(context?.deviceMac);
  if (explicitMac) candidates.add(explicitMac);

  const deviceIdHex = normalizeHex(context?.deviceId);
  if (deviceIdHex) {
    if (deviceIdHex.length >= 12) {
      candidates.add(deviceIdHex.slice(-12));
    }
    candidates.add(deviceIdHex);
  }

  return [...candidates];
}

function matchSiteDevice(devices, context) {
  const expectedName = normalizeText(context?.deviceName).toLowerCase();
  const macCandidates = deriveMacCandidates(context);

  const scored = (devices || []).map((device) => {
    let score = 0;
    const mac = normalizeHex(device?.mac || device?.mac_address);
    const id = normalizeHex(device?.id || device?.device_id);
    const serial = normalizeText(device?.serial || device?.serial_number).toLowerCase();
    const name = normalizeText(device?.name || device?.device_name).toLowerCase();

    if (mac && macCandidates.includes(mac)) score += 100;
    if (id && macCandidates.includes(id)) score += 80;
    if (id && macCandidates.some((candidate) => candidate.length >= 12 && id.endsWith(candidate))) score += 60;
    if (expectedName && name && name === expectedName) score += 50;
    if (expectedName && serial && serial === expectedName) score += 20;

    return { device, score };
  });

  scored.sort((a, b) => b.score - a.score);
  return {
    matchedDevice: scored[0]?.score > 0 ? scored[0].device : null,
    topCandidate: scored[0]?.device || null,
    topScore: scored[0]?.score || 0,
  };
}

async function fetchMistSiteDevices(context) {
  if (!context?.apiHost || !context?.siteId) {
    return { ok: false, message: 'Missing apiHost/site context.' };
  }

  const attemptMessages = [];

  async function fetchJson(path, label) {
    const url = `https://${context.apiHost}${path}`;
    const response = await fetch(url, {
      method: 'GET',
      credentials: 'include',
      headers: {
        Accept: 'application/json',
      },
    });

    if (!response.ok) {
      attemptMessages.push(`${label}: HTTP ${response.status} ${response.statusText}`);
      return null;
    }

    const payload = await response.json();
    if (Array.isArray(payload)) return payload;
    if (Array.isArray(payload?.results)) return payload.results;
    if (Array.isArray(payload?.items)) return payload.items;
    attemptMessages.push(`${label}: non-array payload`);
    return null;
  }

  async function fetchObject(path, label) {
    const url = `https://${context.apiHost}${path}`;
    const response = await fetch(url, {
      method: 'GET',
      credentials: 'include',
      headers: {
        Accept: 'application/json',
      },
    });

    if (!response.ok) {
      attemptMessages.push(`${label}: HTTP ${response.status} ${response.statusText}`);
      return null;
    }

    const payload = await response.json();
    if (payload && typeof payload === 'object' && !Array.isArray(payload)) {
      return payload;
    }
    attemptMessages.push(`${label}: non-object payload`);
    return null;
  }

  try {
    const directDevice =
      context.deviceId
        ? await fetchObject(
            `/api/v1/sites/${encodeURIComponent(context.siteId)}/devices/${encodeURIComponent(context.deviceId)}`,
            'site-device-direct',
          )
        : null;

    let matchedDevice = directDevice;
    let matchedFrom = directDevice ? 'direct-device' : '';

    if (!matchedDevice) {
      const candidates = [];

      const siteDevices =
        (await fetchJson(`/api/v1/sites/${encodeURIComponent(context.siteId)}/devices?type=switch`, 'site-devices-switch')) || [];
      candidates.push(...siteDevices);

      const siteDeviceStats =
        (await fetchJson(`/api/v1/sites/${encodeURIComponent(context.siteId)}/stats/devices?limit=1000`, 'site-device-stats')) || [];
      candidates.push(...siteDeviceStats);

      const orgInventory =
        context.orgId
          ? (await fetchJson(`/api/v1/orgs/${encodeURIComponent(context.orgId)}/inventory?limit=1000`, 'org-inventory')) || []
          : [];
      candidates.push(...orgInventory);

      const deduped = [];
      const seen = new Set();
      for (const candidate of candidates) {
        const key =
          normalizeHex(candidate?.mac || candidate?.mac_address) ||
          normalizeHex(candidate?.id || candidate?.device_id) ||
          normalizeText(candidate?.serial || candidate?.serial_number).toLowerCase() ||
          normalizeText(candidate?.name || candidate?.device_name).toLowerCase();
        if (!key || seen.has(key)) continue;
        seen.add(key);
        deduped.push(candidate);
      }

      const { matchedDevice: fallbackMatchedDevice, topCandidate, topScore } = matchSiteDevice(deduped, context);
      matchedDevice = fallbackMatchedDevice;
      matchedFrom = fallbackMatchedDevice ? 'candidate-list' : '';

      if (!matchedDevice) {
        const candidateSummary = topCandidate
          ? ` top candidate name=${pickDeviceField(topCandidate, ['name', 'device_name']) || '—'} serial=${pickDeviceField(topCandidate, ['serial', 'serial_number']) || '—'} mac=${pickDeviceField(topCandidate, ['mac', 'mac_address']) || '—'} score=${topScore}.`
          : '';
        return {
          ok: false,
          message: `Mist API returned ${deduped.length} candidate device(s), but none matched the launch context. ${attemptMessages.join('; ')}.${candidateSummary}`,
        };
      }
    }

    const deviceName = pickDeviceField(matchedDevice, ['name', 'device_name']);
    const deviceSerial = pickDeviceField(matchedDevice, ['serial', 'serial_number']);
    const deviceMac = pickDeviceField(matchedDevice, ['mac', 'mac_address']);
    const siteName = pickDeviceField(matchedDevice, ['site_name']);
    const orgName = pickDeviceField(matchedDevice, ['org_name']);

    let deviceRootPassword = pickSwitchRootPassword(matchedDevice);

    // If no device-specific password, fall back to the site-level switch_mgmt password
    if (!deviceRootPassword && context.siteId) {
      const siteSetting = await fetchObject(
        `/api/v1/sites/${encodeURIComponent(context.siteId)}/setting`,
        'site-setting',
      );
      if (siteSetting) {
        deviceRootPassword = normalizeText(siteSetting?.switch_mgmt?.root_password) || null;
      }
    }

    // If still no password, fall back to the site's assigned network template
    if (!deviceRootPassword && context.siteId && context.orgId) {
      const siteDetail = await fetchObject(
        `/api/v1/sites/${encodeURIComponent(context.siteId)}`,
        'site-detail',
      );
      const templateId = siteDetail?.network_template_id;
      if (templateId) {
        const networkTemplate = await fetchObject(
          `/api/v1/orgs/${encodeURIComponent(context.orgId)}/networktemplates/${encodeURIComponent(templateId)}`,
          'network-template',
        );
        if (networkTemplate) {
          deviceRootPassword = normalizeText(networkTemplate?.switch_mgmt?.root_password) || null;
        }
      }
    }

    if (!deviceName && !deviceSerial && !deviceMac) {
      return { ok: false, message: 'Matched Mist device returned no usable name/serial/mac fields.', payload: matchedDevice };
    }

    return {
      ok: true,
      message: `Matched Mist device via ${matchedFrom || 'unknown-path'}.`,
      payload: matchedDevice,
      deviceName,
      deviceSerial,
      deviceMac,
      deviceRootPassword,
      siteName,
      orgName,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown fetch error';
    return { ok: false, message };
  }
}

async function fetchMistDeviceConfig(context) {
  if (!context?.apiHost || !context?.siteId || !context?.deviceId) {
    return { ok: false, message: 'Missing apiHost/site/device context.' };
  }

  try {
    const url = `https://${context.apiHost}/api/v1/sites/${encodeURIComponent(context.siteId)}/devices/${encodeURIComponent(context.deviceId)}/config_cmd`;
    const response = await fetch(url, {
      method: 'GET',
      credentials: 'include',
      headers: {
        Accept: 'application/json',
      },
    });

    if (!response.ok) {
      return {
        ok: false,
        message: `HTTP ${response.status} ${response.statusText}`,
      };
    }

    const payload = await response.json();
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      return { ok: false, message: 'Device config endpoint returned a non-object payload.' };
    }

    return {
      ok: true,
      payload,
    };
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : 'Unknown config fetch error',
    };
  }
}

async function fetchMistDeviceMonitor(context) {
  if (!context?.apiHost || !context?.siteId || !context?.deviceId) {
    return { ok: false, message: 'Missing apiHost/site/device context.' };
  }

  async function fetchObject(path, label) {
    const url = `https://${context.apiHost}${path}`;
    const response = await fetch(url, {
      method: 'GET',
      credentials: 'include',
      headers: {
        Accept: 'application/json',
      },
    });

    if (!response.ok) {
      return { ok: false, message: `${label}: HTTP ${response.status} ${response.statusText}` };
    }

    const payload = await response.json();
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      return { ok: false, message: `${label}: non-object payload` };
    }
    return { ok: true, payload };
  }

  try {
    const [deviceResult, statsResult] = await Promise.all([
      fetchObject(
        `/api/v1/sites/${encodeURIComponent(context.siteId)}/devices/${encodeURIComponent(context.deviceId)}`,
        'device',
      ),
      fetchObject(
        `/api/v1/sites/${encodeURIComponent(context.siteId)}/stats/devices/${encodeURIComponent(context.deviceId)}`,
        'stats',
      ),
    ]);

    const device = deviceResult.ok ? deviceResult.payload : null;
    const stats = statsResult.ok ? statsResult.payload : null;

    const mistInventoryConnected =
      typeof device?.connected === 'boolean' ? device.connected : null;
    const mistStatsStatus = typeof stats?.status === 'string' ? stats.status : null;

    let mistLastSeenUtcIso = null;
    if (typeof stats?.last_seen === 'number') {
      mistLastSeenUtcIso = new Date(stats.last_seen * 1000).toISOString();
    }

    let mistLastConfigUtcIso = null;
    if (typeof stats?.last_config === 'number') {
      mistLastConfigUtcIso = new Date(stats.last_config * 1000).toISOString();
    } else if (typeof device?.last_config === 'number') {
      mistLastConfigUtcIso = new Date(device.last_config * 1000).toISOString();
    }

    let mistRecentlySeen = null;
    if (typeof stats?.last_seen === 'number') {
      const ageSec = Date.now() / 1000 - stats.last_seen;
      mistRecentlySeen = ageSec >= 0 && ageSec < 600;
    }

    const mistCloudReachableHint = computeMistReachableHint(
      mistInventoryConnected,
      mistStatsStatus,
      mistRecentlySeen,
    );

    const parts = [];
    if (mistInventoryConnected === true) parts.push('inventory: connected');
    else if (mistInventoryConnected === false) parts.push('inventory: not connected');
    else parts.push('inventory: unknown');
    if (mistStatsStatus) parts.push(`stats: ${mistStatsStatus}`);
    if (mistRecentlySeen === true) parts.push('recent last_seen (<10m)');

    return {
      ok: true,
      payload: {
        mistInventoryConnected,
        mistStatsStatus,
        mistRecentlySeen,
        mistCloudReachableHint,
        mistCloudStatusLine: parts.join(' · '),
        mistLastSeenUtcIso,
        mistLastConfigUtcIso,
      },
    };
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : 'Unknown monitor fetch error',
    };
  }
}

async function fetchMistDeviceEvents(context, limit = 20) {
  if (!context?.apiHost || !context?.siteId || !context?.deviceId) {
    return { ok: false, message: 'Missing apiHost/site/device context.' };
  }

  async function fetchEvents(path, method = 'GET', body) {
    const url = `https://${context.apiHost}${path}`;
    const response = await fetch(url, {
      method,
      credentials: 'include',
      headers: {
        Accept: 'application/json',
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });

    if (!response.ok) {
      return { ok: false, message: `HTTP ${response.status} ${response.statusText}` };
    }

    const payload = await response.json();
    if (Array.isArray(payload)) {
      return { ok: true, payload };
    }
    if (payload && Array.isArray(payload.results)) {
      return { ok: true, payload: payload.results };
    }
    return { ok: false, message: 'Events endpoint returned a non-array payload.' };
  }

  try {
    let result = await fetchEvents(
      `/api/v1/sites/${encodeURIComponent(context.siteId)}/devices/events/search?device_id=${encodeURIComponent(context.deviceId)}&limit=${limit}`,
    );
    if (!result.ok) {
      result = await fetchEvents(
        `/api/v1/sites/${encodeURIComponent(context.siteId)}/devices/events/search`,
        'POST',
        { device_id: context.deviceId, limit },
      );
    }
    if (!result.ok) {
      result = await fetchEvents(
        `/api/v1/sites/${encodeURIComponent(context.siteId)}/devices/events?device_id=${encodeURIComponent(context.deviceId)}&limit=${limit}`,
      );
    }
    return result.ok ? result : { ok: false, message: result.message };
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : 'Unknown events fetch error',
    };
  }
}

async function resolveContextInternal({ url, title, pageContext } = {}) {
  const parsed =
    (pageContext && typeof pageContext === 'object' ? pageContext : null) ??
    globalThis.JunosConsoleMistContext?.parseMistContextFromUrl(url || '', title || '') ??
    null;

  if (!parsed) return null;

  let context = { ...parsed };
  const debug = {
    apiStatus: 'not-attempted',
    apiMessage: 'Device API enrichment was not needed.',
    apiName: null,
    apiSerial: null,
    apiMac: null,
    rootPasswordAvailable: false,
  };

  const needsApiEnrichment =
    !context.deviceName ||
    !context.deviceSerial ||
    !context.deviceMac ||
    !context.deviceRootPassword;
  if (needsApiEnrichment) {
    debug.apiStatus = 'attempted';
    debug.apiMessage = 'Site devices API enrichment attempted.';

    const result = await fetchMistSiteDevices(context);
    if (result.ok) {
      debug.apiStatus = 'success';
      debug.apiMessage = result.message;
      debug.apiName = result.deviceName;
      debug.apiSerial = result.deviceSerial;
      debug.apiMac = result.deviceMac;
      debug.rootPasswordAvailable = Boolean(result.deviceRootPassword);
      context = {
        ...context,
        deviceName: context.deviceName || result.deviceName || null,
        deviceSerial: context.deviceSerial || result.deviceSerial || null,
        deviceMac: context.deviceMac || result.deviceMac || null,
        siteName: context.siteName || result.siteName || null,
        orgName: context.orgName || result.orgName || null,
        deviceRootPassword: result.deviceRootPassword || null,
      };
    } else {
      debug.apiStatus = 'failed';
      debug.apiMessage = result.message;
    }
  }

  return {
    context,
    debug,
  };
}

async function resolveContext({ url, title, pageContext } = {}) {
  const resolved = await resolveContextInternal({ url, title, pageContext });
  if (!resolved) return null;

  const { context, debug } = resolved;
  const { deviceRootPassword: _deviceRootPassword, ...publicContext } = context;

  return {
    ...publicContext,
    _debugSource: 'background-site-devices-v2',
    _debugApiStatus: debug.apiStatus,
    _debugApiMessage: debug.apiMessage,
    _debugApiName: debug.apiName,
    _debugApiSerial: debug.apiSerial,
    _debugApiMac: debug.apiMac,
    _debugHasRootPassword: debug.rootPasswordAvailable,
  };
}

async function createLaunchUrl({ url, title, pageContext } = {}) {
  const resolved = await resolveContextInternal({ url, title, pageContext });
  if (!resolved) {
    return {
      ok: false,
      error: 'Unable to resolve Mist launch context.',
      fallbackUrl: globalThis.JunosConsoleMistContext?.buildLaunchUrl(pageContext || {}) ?? null,
    };
  }

  const { context } = resolved;
  try {
    const configResult = await fetchMistDeviceConfig(context);
    const monitorResult = await fetchMistDeviceMonitor(context);
    const eventsResult = await fetchMistDeviceEvents(context);
    const payload = {
      ...context,
      source: 'mist-extension',
      capturedAt: context.capturedAt || new Date().toISOString(),
      deviceConfig: configResult.ok ? configResult.payload : null,
      mistMonitor: monitorResult.ok ? monitorResult.payload : null,
      deviceEvents: eventsResult.ok ? eventsResult.payload : [],
    };
    const response = await fetch('http://127.0.0.1:3333/extension-launch', {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      return {
        ok: false,
        error: `Launch cache request failed: HTTP ${response.status} ${response.statusText}`,
        fallbackUrl: globalThis.JunosConsoleMistContext?.buildLaunchUrl(context) ?? null,
      };
    }

    const result = await response.json();
    const launchUrl = typeof result?.launchUrl === 'string' ? result.launchUrl : null;
    if (!launchUrl) {
      return {
        ok: false,
        error: 'Launch cache did not return a launch URL.',
        fallbackUrl: globalThis.JunosConsoleMistContext?.buildLaunchUrl(context) ?? null,
      };
    }

    return {
      ok: true,
      launchUrl,
    };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : 'Unknown launch cache error',
      fallbackUrl: globalThis.JunosConsoleMistContext?.buildLaunchUrl(context) ?? null,
    };
  }
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === 'junos-console:resolve-context') {
    void resolveContext(message).then((context) => {
      sendResponse({ context });
    });
    return true;
  }
  if (message?.type === 'junos-console:create-launch') {
    void createLaunchUrl(message).then((result) => {
      sendResponse(result);
    });
    return true;
  }
  return false;
});
