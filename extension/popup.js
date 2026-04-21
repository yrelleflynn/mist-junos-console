const ui = {
  pill: document.getElementById('page-status-pill'),
  cloud: document.getElementById('cloud-value'),
  org: document.getElementById('org-value'),
  site: document.getElementById('site-value'),
  device: document.getElementById('device-value'),
  status: document.getElementById('status-message'),
  debugUrl: document.getElementById('debug-url'),
  openConsole: document.getElementById('open-console'),
};

function setPill(text, tone) {
  ui.pill.textContent = text;
  ui.pill.className = `pill ${tone}`;
}

function setStatus(text) {
  ui.status.textContent = text;
}

async function getActiveTab() {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  return tabs[0] ?? null;
}

async function getContextFromContentScript(tabId) {
  if (!tabId) return null;
  try {
    const response = await chrome.tabs.sendMessage(tabId, { type: 'junos-console:get-context' });
    return response?.context ?? null;
  } catch {
    return null;
  }
}

async function getContextFromBackground(tab) {
  if (!tab?.url) return null;
  try {
    const response = await chrome.runtime.sendMessage({
      type: 'junos-console:resolve-context',
      url: tab.url,
      title: tab.title || '',
    });
    return response?.context ?? null;
  } catch {
    return null;
  }
}

async function createLaunchFromBackground(tab, pageContext) {
  if (!tab?.url) return null;
  try {
    return await chrome.runtime.sendMessage({
      type: 'junos-console:create-launch',
      url: tab.url,
      title: tab.title || '',
      pageContext: pageContext || null,
    });
  } catch {
    return null;
  }
}

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

async function init() {
  const tab = await getActiveTab();
  const backgroundContext = await getContextFromBackground(tab);
  const contentContext = await getContextFromContentScript(tab?.id);
  const context =
    backgroundContext ??
    contentContext ??
    window.JunosConsoleMistContext?.parseMistContextFromUrl(tab?.url || '', tab?.title || '') ??
    parseFallbackMistContextFromUrl(tab?.url || '', tab?.title || '') ??
    null;

  if (!context) {
    setPill('Unsupported page', 'bad');
    setStatus('Open a Mist switch details page, then launch Junos Console from here.');
    ui.debugUrl.textContent = tab?.url || 'No active tab URL available';
    ui.debugUrl.classList.remove('is-hidden');
    ui.cloud.textContent = '—';
    ui.org.textContent = '—';
    ui.site.textContent = '—';
    ui.device.textContent = '—';
    return;
  }

  setPill('Switch page detected', 'good');
  setStatus('This Mist switch page can launch Junos Console with scoped context.');
  ui.debugUrl.classList.add('is-hidden');
  ui.cloud.textContent = context.apiHost || context.cloudHost || '—';
  ui.org.textContent = context.orgName || context.orgId || '—';
  ui.site.textContent = context.siteName || context.siteId || '—';
  ui.device.textContent = context.deviceName || context.deviceSerial || context.deviceMac || context.deviceId || '—';
  ui.openConsole.disabled = false;
  ui.openConsole.addEventListener('click', async () => {
    const launch = await createLaunchFromBackground(tab, context);
    const url =
      launch?.ok && typeof launch.launchUrl === 'string'
        ? launch.launchUrl
        : launch?.fallbackUrl || window.JunosConsoleMistContext.buildLaunchUrl(context);
    await chrome.tabs.create({ url });
    window.close();
  });
}

void init();
