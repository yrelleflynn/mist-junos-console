(function () {
  const BUTTON_ID = 'junos-console-launcher';
  let lastHref = '';
  let cachedContextKey = '';
  let cachedContextValue = null;
  let pendingContextPromise = null;
  const GENERIC_TEXT = new Set([
    'Juniper Mist',
    'Monitor',
    'Marvis',
    'Clients',
    'Access Points',
    'Switches',
    'WAN Edges',
    'Mist Edges',
    'Location',
    'Analytics',
    'Site',
    'Organization',
    'Front Panel',
    'Port List',
    'Metrics',
    'Properties',
    'Statistics',
    'Save',
    'Close',
    'Open in Junos Console',
  ]);

  function parseFallbackMistContextFromUrl(rawUrl, tabTitle) {
    if (!rawUrl) return null;

    let url;
    try {
      url = new URL(rawUrl);
    } catch {
      return null;
    }

    const hostMap = {
      'manage.mist.com': 'api.mist.com',
      'manage.gc1.mist.com': 'api.gc1.mist.com',
      'manage.ac2.mist.com': 'api.ac2.mist.com',
      'manage.gc2.mist.com': 'api.gc2.mist.com',
      'manage.gc4.mist.com': 'api.gc4.mist.com',
      'manage.eu.mist.com': 'api.eu.mist.com',
      'manage.gc3.mist.com': 'api.gc3.mist.com',
      'manage.ac6.mist.com': 'api.ac6.mist.com',
      'manage.gc6.mist.com': 'api.gc6.mist.com',
      'manage.ac5.mist.com': 'api.ac5.mist.com',
      'manage.gc5.mist.com': 'api.gc5.mist.com',
      'manage.gc7.mist.com': 'api.gc7.mist.com',
      'manage.us.mist-federal.com': 'api.us.mist-federal.com',
    };

    const apiHost = hostMap[url.hostname];
    if (!apiHost) return null;

    let orgId = url.searchParams.get('org_id');
    const rawHash = url.hash.startsWith('#!') ? url.hash.slice(2) : url.hash.replace(/^#/, '');
    const [hashPath, hashQuery = ''] = rawHash.split('?');
    const hashParams = new URLSearchParams(hashQuery);
    orgId = orgId || hashParams.get('org_id');

    const match = hashPath.match(/^\/?switch\/detail\/([^/]+)\/([^/?#]+)/i);
    if (!orgId || !match) return null;

    const titleMatch = tabTitle ? tabTitle.match(/Switches:\s*([^|—-]+)/i) : null;

    return {
      source: 'mist-extension',
      cloudHost: url.hostname,
      apiHost,
      orgId,
      siteId: match[2],
      deviceId: match[1],
      deviceType: 'switch',
      deviceName: titleMatch ? titleMatch[1].trim() : null,
      capturedAt: new Date().toISOString(),
    };
  }

  function getContext() {
    const context = (
      window.JunosConsoleMistContext?.parseMistContextFromUrl(window.location.href, document.title) ??
      parseFallbackMistContextFromUrl(window.location.href, document.title) ??
      null
    );
    if (!context) return null;
    return enrichContextFromPage(context);
  }

  async function getContextAsync() {
    const parsed = getContext();
    if (!parsed) return null;

    const cacheKey = JSON.stringify([
      window.location.href,
      parsed.orgId || null,
      parsed.siteId || null,
      parsed.deviceId || null,
    ]);

    if (cachedContextKey === cacheKey && cachedContextValue) {
      return cachedContextValue;
    }

    if (pendingContextPromise && cachedContextKey === cacheKey) {
      return pendingContextPromise;
    }

    cachedContextKey = cacheKey;
    pendingContextPromise = (async () => {
      const response = await chrome.runtime.sendMessage({
        type: 'junos-console:resolve-context',
        url: window.location.href,
        title: document.title,
        pageContext: parsed,
      });
      const context = response?.context ?? parsed;
      cachedContextValue = context;
      pendingContextPromise = null;
      return context;
    })();

    return pendingContextPromise;
  }

  async function createLaunchUrl(context) {
    try {
      const response = await chrome.runtime.sendMessage({
        type: 'junos-console:create-launch',
        url: window.location.href,
        title: document.title,
        pageContext: context || null,
      });
      if (response?.ok && typeof response.launchUrl === 'string') {
        return response.launchUrl;
      }
      return response?.fallbackUrl || window.JunosConsoleMistContext.buildLaunchUrl(context);
    } catch {
      return window.JunosConsoleMistContext.buildLaunchUrl(context);
    }
  }

  function normalizeText(value) {
    return (value || '').replace(/\s+/g, ' ').trim();
  }

  function getBodyLines() {
    return (document.body?.innerText || '')
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean);
  }

  function getVisibleLeafTexts() {
    const elements = Array.from(document.body?.querySelectorAll('*') || []);
    return elements
      .filter((el) => isVisibleElement(el))
      .map((el) => normalizeText(el.textContent || ''))
      .filter((text, index, arr) => {
        if (!text) return false;
        if (text.length > 96) return false;
        return arr.indexOf(text) === index;
      });
  }

  function looksLikeOpaqueId(text) {
    return /^[0-9a-f-]{24,}$/i.test(text || '');
  }

  function isVisibleElement(el) {
    if (!(el instanceof HTMLElement)) return false;
    const style = window.getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return false;
    const rect = el.getBoundingClientRect();
    return rect.width > 8 && rect.height > 8 && rect.bottom > 0 && rect.right > 0;
  }

  function isSimpleLeafText(el, text) {
    return (
      el instanceof HTMLElement &&
      el.childElementCount === 0 &&
      text.length >= 2 &&
      text.length <= 48 &&
      !GENERIC_TEXT.has(text) &&
      !text.includes(':') &&
      !text.includes('/')
    );
  }

  function detectDeviceNameFromPage(existingDeviceName) {
    const leafTexts = getVisibleLeafTexts();
    for (let index = 0; index < leafTexts.length; index += 1) {
      if (!/^Switches:?$/i.test(leafTexts[index])) continue;
      const nextText = leafTexts[index + 1];
      if (nextText && !GENERIC_TEXT.has(nextText) && !looksLikeOpaqueId(nextText)) {
        return nextText;
      }
    }

    const lines = getBodyLines();
    const switchLine = lines.find((line) => /^Switches:\s*/i.test(line) && !looksLikeOpaqueId(line));
    if (switchLine) {
      const match = switchLine.match(/^Switches:\s*(.+)$/i);
      if (match?.[1]) return match[1].trim();
    }
    for (let index = 0; index < lines.length; index += 1) {
      if (!/^Switches:\s*$/i.test(lines[index])) continue;
      const nextLine = lines[index + 1];
      if (nextLine && !GENERIC_TEXT.has(nextLine) && !looksLikeOpaqueId(nextLine)) {
        return nextLine.trim();
      }
    }
    return existingDeviceName || null;
  }

  function detectLabeledValue(labelPattern, standaloneLabelPattern = null) {
    const leafTexts = getVisibleLeafTexts();
    for (let index = 0; index < leafTexts.length; index += 1) {
      const text = normalizeText(leafTexts[index]);
      if (!text) continue;

      const inlineMatch = text.match(labelPattern);
      if (inlineMatch?.[1]) {
        return inlineMatch[1].trim();
      }

      if ((standaloneLabelPattern && standaloneLabelPattern.test(text)) || labelPattern.test(text)) {
        const nextText = normalizeText(leafTexts[index + 1] || '');
        if (nextText && !GENERIC_TEXT.has(nextText) && nextText.length <= 64) {
          return nextText;
        }
      }
    }

    const lines = getBodyLines();
    for (let index = 0; index < lines.length; index += 1) {
      const line = normalizeText(lines[index]);
      if (!line) continue;

      const inlineMatch = line.match(labelPattern);
      if (inlineMatch?.[1]) {
        return inlineMatch[1].trim();
      }

      if ((standaloneLabelPattern && standaloneLabelPattern.test(line)) || labelPattern.test(line)) {
        const nextLine = normalizeText(lines[index + 1] || '');
        if (nextLine && !GENERIC_TEXT.has(nextLine) && nextLine.length <= 64) {
          return nextLine;
        }
      }
    }
    return null;
  }

  function detectOrgNameFromPage(deviceName) {
    const leafTexts = getVisibleLeafTexts();
    const leafSwitchIndex = leafTexts.findIndex((text) => /^Switches:?$/i.test(text));
    if (leafSwitchIndex > -1) {
      const searchTexts = leafTexts.slice(Math.max(0, leafSwitchIndex - 6), leafSwitchIndex);
      const candidate = searchTexts
        .map((text) => normalizeText(text))
        .filter((text) => {
          if (!text || text.length > 48) return false;
          if (GENERIC_TEXT.has(text)) return false;
          if (deviceName && text === deviceName) return false;
          if (text.includes(':') || text.includes('/') || text.includes('http')) return false;
          return true;
        })
        .pop();
      if (candidate) return candidate;
    }

    const lines = getBodyLines();
    const switchIndex = lines.findIndex((line) => /^Switches:\s*/i.test(line));
    const searchLines = switchIndex > -1 ? lines.slice(Math.max(0, switchIndex - 6), switchIndex) : lines.slice(0, 12);
    const candidates = searchLines.filter((line) => {
      const text = normalizeText(line);
      if (!text || text.length > 48) return false;
      if (GENERIC_TEXT.has(text)) return false;
      if (deviceName && text === deviceName) return false;
      if (text.includes(':') || text.includes('/') || text.includes('http')) return false;
      return true;
    });
    return candidates[candidates.length - 1] || null;
  }

  function enrichContextFromPage(context) {
    const deviceName = detectDeviceNameFromPage(context.deviceName || null);
    const orgName = detectOrgNameFromPage(deviceName);
    const deviceSerial =
      detectLabeledValue(/^serial(?:\s+number)?[:\s]+(.+)$/i, /^serial(?:\s+number)?$/i) || null;
    const deviceMac =
      detectLabeledValue(
        /^(?:mac(?:\s+address)?|base\s+mac(?:\s+address)?)[:\s]+(.+)$/i,
        /^(?:mac(?:\s+address)?|base\s+mac(?:\s+address)?)$/i,
      ) || null;
    return {
      ...context,
      deviceName,
      deviceSerial: context.deviceSerial || deviceSerial,
      deviceMac: context.deviceMac || deviceMac,
      orgName: context.orgName || orgName || null,
      siteName: context.siteName || null,
    };
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type === 'junos-console:get-context') {
      void getContextAsync().then((context) => {
        sendResponse({ context });
      });
      return true;
    }
    return false;
  });

  function removeButton() {
    document.getElementById(BUTTON_ID)?.remove();
  }

  function ensureButton(context) {
    let button = document.getElementById(BUTTON_ID);
    if (!button) {
      button = document.createElement('button');
      button.id = BUTTON_ID;
      button.type = 'button';
      button.textContent = 'Open in Junos Console';
      Object.assign(button.style, {
        position: 'fixed',
        right: '24px',
        bottom: '24px',
        zIndex: '2147483647',
        height: '40px',
        padding: '0 16px',
        border: '0',
        borderRadius: '999px',
        background: 'linear-gradient(180deg, #21d6df, #108391)',
        color: '#071015',
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
        fontSize: '12px',
        fontWeight: '700',
        letterSpacing: '0.04em',
        boxShadow: '0 12px 24px rgba(0, 0, 0, 0.32)',
        cursor: 'pointer',
      });
      document.body.appendChild(button);
    }

    button.onclick = async () => {
      const latestContext = (await getContextAsync()) || context;
      const launchUrl = await createLaunchUrl(latestContext);
      window.open(launchUrl, '_blank', 'noopener,noreferrer');
    };
  }

  async function refresh() {
    const context = await getContextAsync();
    if (!context) {
      removeButton();
      return;
    }
    ensureButton(context);
  }

  function watchSpaNavigation() {
    const update = () => {
      if (window.location.href === lastHref) return;
      lastHref = window.location.href;
      cachedContextKey = '';
      cachedContextValue = null;
      pendingContextPromise = null;
      void refresh();
    };

    const originalPushState = history.pushState;
    history.pushState = function (...args) {
      const result = originalPushState.apply(this, args);
      setTimeout(update, 0);
      return result;
    };

    const originalReplaceState = history.replaceState;
    history.replaceState = function (...args) {
      const result = originalReplaceState.apply(this, args);
      setTimeout(update, 0);
      return result;
    };

    window.addEventListener('hashchange', update);
    window.addEventListener('popstate', update);
    setInterval(update, 1000);
  }

  lastHref = window.location.href;
  void refresh();
  watchSpaNavigation();
})();
