(function () {
  const MIST_HOST_MAP = {
    'manage.mist.com': { cloudName: 'Global 01', apiHost: 'api.mist.com' },
    'manage.gc1.mist.com': { cloudName: 'Global 02', apiHost: 'api.gc1.mist.com' },
    'manage.ac2.mist.com': { cloudName: 'Global 03', apiHost: 'api.ac2.mist.com' },
    'manage.gc2.mist.com': { cloudName: 'Global 04', apiHost: 'api.gc2.mist.com' },
    'manage.gc4.mist.com': { cloudName: 'Global 05', apiHost: 'api.gc4.mist.com' },
    'manage.eu.mist.com': { cloudName: 'EMEA 01', apiHost: 'api.eu.mist.com' },
    'manage.gc3.mist.com': { cloudName: 'EMEA 02', apiHost: 'api.gc3.mist.com' },
    'manage.ac6.mist.com': { cloudName: 'EMEA 03', apiHost: 'api.ac6.mist.com' },
    'manage.gc6.mist.com': { cloudName: 'EMEA 04', apiHost: 'api.gc6.mist.com' },
    'manage.ac5.mist.com': { cloudName: 'APAC 01', apiHost: 'api.ac5.mist.com' },
    'manage.gc5.mist.com': { cloudName: 'APAC 02', apiHost: 'api.gc5.mist.com' },
    'manage.gc7.mist.com': { cloudName: 'APAC 03', apiHost: 'api.gc7.mist.com' },
    'manage.us.mist-federal.com': { cloudName: 'GOV', apiHost: 'api.us.mist-federal.com' },
  };

  function parseDeviceNameFromTitle(title) {
    if (!title) return null;
    const match = title.match(/Switches:\s*([^|—-]+)/i);
    return match ? match[1].trim() : null;
  }

  function parseMistContextFromUrl(rawUrl, tabTitle) {
    if (!rawUrl) return null;

    let url;
    try {
      url = new URL(rawUrl);
    } catch {
      return null;
    }

    const hostConfig = MIST_HOST_MAP[url.hostname];
    if (!hostConfig) return null;

    let orgId = url.searchParams.get('org_id');

    let siteId = null;
    let deviceId = null;

    const rawHash = url.hash.startsWith('#!') ? url.hash.slice(2) : url.hash.replace(/^#/, '');
    const [hashPath, hashQuery = ''] = rawHash.split('?');
    const hashParams = new URLSearchParams(hashQuery);
    orgId = orgId || hashParams.get('org_id');

    const hashSegments = hashPath.split('/').filter(Boolean);
    const hashSwitchIndex = hashSegments.findIndex((segment) => segment === 'switches' || segment === 'switch');
    if (hashSwitchIndex > -1) {
      const hashSiteIndex = hashSegments.findIndex((segment) => segment === 'sites' || segment === 'site');
      const hashDetailIndex = hashSegments.findIndex((segment) => segment === 'detail');
      if (hashSiteIndex > -1 && hashSegments[hashSiteIndex + 1]) {
        siteId = siteId || hashSegments[hashSiteIndex + 1] || null;
      } else if (hashDetailIndex > -1 && hashSegments[hashDetailIndex + 2]) {
        // Real Mist switch route observed:
        // #!/switch/detail/<deviceId>/<siteId>?org_id=...
        deviceId = deviceId || hashSegments[hashDetailIndex + 1] || null;
        siteId = siteId || hashSegments[hashDetailIndex + 2] || null;
      } else {
        siteId = hashSegments[hashSwitchIndex - 1] || null;
      }
      deviceId = deviceId || hashSegments[hashSwitchIndex + 1] || null;
    }

    if (!siteId || !deviceId) {
      const pathSegments = url.pathname.split('/').filter(Boolean);
      const orgPathIndex = pathSegments.findIndex((segment) => segment === 'orgs');
      const switchPathIndex = pathSegments.findIndex((segment) => segment === 'switches' || segment === 'switch');
      if (orgPathIndex > -1 && pathSegments[orgPathIndex + 1]) {
        // Keep query-param org_id authoritative when present, but allow path-based routing too.
        orgId = orgId || pathSegments[orgPathIndex + 1] || null;
      }
      if (switchPathIndex > -1) {
        const sitesPathIndex = pathSegments.findIndex((segment) => segment === 'sites' || segment === 'site');
        if (sitesPathIndex > -1 && pathSegments[sitesPathIndex + 1]) {
          siteId = siteId || pathSegments[sitesPathIndex + 1] || null;
        } else {
          siteId = siteId || pathSegments[switchPathIndex - 1] || null;
        }
        deviceId = deviceId || pathSegments[switchPathIndex + 1] || null;
      }
    }

    if (!orgId) return null;
    if (!siteId || !deviceId) return null;

    return {
      source: 'mist-extension',
      cloudHost: url.hostname,
      apiHost: hostConfig.apiHost,
      orgId,
      siteId,
      deviceId,
      deviceType: 'switch',
      deviceName: parseDeviceNameFromTitle(tabTitle),
      capturedAt: new Date().toISOString(),
    };
  }

  function buildLaunchUrl(context) {
    const url = new URL('http://localhost:3000/index.html');
    url.searchParams.set('mistContext', JSON.stringify(context));
    return url.toString();
  }

  const root = typeof globalThis !== 'undefined' ? globalThis : window;

  root.JunosConsoleMistContext = {
    parseMistContextFromUrl,
    buildLaunchUrl,
  };
})();
