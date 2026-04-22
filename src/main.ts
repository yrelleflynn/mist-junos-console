/**
 * main.ts — Application entry point
 *
 * Wires the SerialService, TerminalComponent, MistApiService,
 * CommandRunnerService, and TroubleshootService together
 * with the DOM controls.
 */

import { SerialService } from './services/serial.service';
import { TerminalComponent } from './components/terminal.component';
import { CommandRunnerService } from './services/command-runner.service';
import { MistApiService } from './services/mist-api.service';
import type { MistDeviceConfig, MistDeviceEvent, MistLaunchOverlay } from './services/mist-api.service';
import {
  TroubleshootService,
  CheckResult,
  CheckStatus,
  type RecommendedChecksOptions,
  type TroubleshootOptions,
} from './services/troubleshoot.service';
import { SwitchIdentityService } from './services/switch-identity.service';
import { ConfigSyncService, isConfigSyncStagingWarning } from './services/config-sync.service';
import type { CandidatePreviewInput, ConfigSyncActionResult, ConfigSyncPreviewResult } from './services/config-sync.service';
import { DhcpRefreshService } from './services/dhcp-refresh.service';
import type { DhcpRefreshResult, DhcpBindingChange, DhcpRefreshStep } from './services/dhcp-refresh.service';
import { MistAgentRestartService } from './services/mist-agent-restart.service';
import type { MistAgentRestartResult, MistAgentRestartStep, MistAgentProcessState } from './services/mist-agent-restart.service';
import { RemoteSessionController } from './controllers/remote-session.controller';
import { MistContextController } from './controllers/mist-context.controller';
import { DeviceContextController } from './controllers/device-context.controller';
import { CloudStatusController } from './controllers/cloud-status.controller';
import type { CloudStatusState } from './types/cloud-status.types';
import { ConsoleTaskGate, type ConsoleTaskKind } from './app/runtime/console-task-gate';
import { classifyPromptMode as detectPromptMode } from './app/runtime/prompt-mode';
import { MIST_CLOUDS, getCloudById } from './config/mist-clouds.config';
import type { MistCloud } from './config/mist-clouds.config';
import { getJmaRecommendation } from './config/jma-recommendations';
import {
  evaluateMistLaunchVerification,
  type MistLaunchVerificationState,
} from './features/mist-launch/verification';
import {
  buildGuidedAnalysisForRun,
  type GuidedAnalysisCard,
} from './features/troubleshoot/guided-analysis';
import {
  buildCatalogDetailHtml,
  catalogBadgeText,
  catalogBadgeTooltipText,
  catalogWorstStatus,
  formatMcdAnalysisDetailLines,
} from './features/troubleshoot/catalog-formatters';
import {
  canRunFullBaseline,
  getCatalogCheckAvailability,
  resolveCatalogRunOptions,
} from './features/troubleshoot/catalog-availability';
import {
  runRecommendedCatalogSuite,
  runTroubleshootWorkflow,
  type TroubleshootWorkflowDeps,
} from './features/troubleshoot/catalog-runner';
import {
  prepareAdoptionPlan,
} from './features/adoption/workflow';
import {
  CATALOG_GROUPS,
  ALL_CATALOG_CHECK_IDS,
  RUN_ALL_CATALOG_CHECK_IDS,
  getCatalogCheck,
  getCatalogGroupChecks,
  resultIdToCatalogId,
} from './config/check-catalog.config';
import './styles/main.css';

const SERIAL_PREFS_STORAGE_KEY = 'junos-console.serial-prefs';
const LAST_PORT_LABEL_STORAGE_KEY = 'junos-console.last-port-label';
const MIST_CLOUD_STORAGE_KEY = 'junos-console.mist-cloud-id';
const MIST_ORG_STORAGE_KEY = 'junos-console.mist-org-id';
const REMOTE_SESSION_ENABLED_STORAGE_KEY = 'junos-console.remote-session-enabled';
const EXTENSION_LAUNCH_CONTEXT_STORAGE_KEY = 'junos-console.extension-launch-context';
const BACKGROUND_CONSOLE_IDLE_MS = 5000;

type StoredSerialPrefs = {
  baudRate: string;
  dataBits: string;
  parity: string;
  stopBits: string;
  flowControl: string;
};

type ExtensionLaunchContext = MistLaunchOverlay & {
  source?: string | null;
  cloudHost?: string | null;
  apiHost?: string | null;
  capturedAt?: string | null;
};

// ---- Check Web Serial support ----
if (!SerialService.isSupported()) {
  const container = document.getElementById('terminal-container');
  if (container) {
    container.innerHTML =
      '<div style="padding:24px;color:#f97583;font-family:monospace;">' +
      'Web Serial API is not supported in this browser.<br>' +
      'Please use Google Chrome or Microsoft Edge.' +
      '</div>';
  }
  const btn = document.getElementById('btn-connect') as HTMLButtonElement | null;
  if (btn) btn.disabled = true;
} else {
  init();
}

function init(): void {
  // ---- DOM refs ----
  const ui = {
    sidebar: document.getElementById('sidebar') as HTMLElement,
    workspace: document.getElementById('workspace') as HTMLElement,
    // Connection
    btnConnect: document.getElementById('btn-connect') as HTMLButtonElement,
    btnDisconnect: document.getElementById('btn-disconnect') as HTMLButtonElement,
    btnClearConnection: document.getElementById('btn-clear-connection') as HTMLButtonElement,
    btnClear: document.getElementById('btn-clear') as HTMLButtonElement,
    terminalContainer: document.getElementById('terminal-container') as HTMLElement,
    connectionBadge: document.getElementById('connection-badge') as HTMLElement,
    btnSessionToolsOpen: (document.getElementById('btn-session-tools-open')
      ?? document.getElementById('btn-header-session')) as HTMLButtonElement | null,
    btnSessionToolsClose: document.getElementById('btn-session-tools-close') as HTMLButtonElement | null,
    sessionToolsOverlay: document.getElementById('session-tools-overlay') as HTMLElement | null,
    btnHeaderMist: document.getElementById('btn-header-mist') as HTMLButtonElement | null,
    connectionStatePill: document.getElementById('connection-state-pill') as HTMLElement | null,
    serialPortSelect: document.getElementById('serial-port-select') as HTMLSelectElement,
    selectedPort: document.getElementById('selected-port') as HTMLElement,
    baudRate: document.getElementById('baud-rate') as HTMLSelectElement,
    dataBits: document.getElementById('data-bits') as HTMLSelectElement,
    parity: document.getElementById('parity') as HTMLSelectElement,
    stopBits: document.getElementById('stop-bits') as HTMLSelectElement,
    flowControl: document.getElementById('flow-control') as HTMLSelectElement,
    remoteSessionEnabled: document.getElementById('remote-session-enabled') as HTMLInputElement,
    remoteSessionPanel: document.getElementById('remote-session-panel') as HTMLElement,
    remoteSessionId: document.getElementById('remote-session-id') as HTMLInputElement,
    btnCopySession: document.getElementById('btn-copy-session') as HTMLButtonElement,

    // Mist API
    mistCloud: document.getElementById('mist-cloud') as HTMLSelectElement,
    mistApiToken: document.getElementById('mist-api-token') as HTMLInputElement,
    mistOrg: document.getElementById('mist-org') as HTMLSelectElement,
    mistSite: document.getElementById('mist-site') as HTMLSelectElement,
    btnLoadOrgs: document.getElementById('btn-load-orgs') as HTMLButtonElement,
    btnLoadSites: document.getElementById('btn-load-sites') as HTMLButtonElement,
    btnOpenMistModal: document.getElementById('btn-open-mist-modal') as HTMLButtonElement,
    drawerMistModalButtons: document.querySelectorAll<HTMLButtonElement>('[data-open-mist-modal]'),
    btnCloseMistModal: document.getElementById('btn-close-mist-modal') as HTMLButtonElement,
    btnCancelMistModal: document.getElementById('btn-cancel-mist-modal') as HTMLButtonElement,
    btnSaveMistModal: document.getElementById('btn-save-mist-modal') as HTMLButtonElement,
    mistModalOverlay: document.getElementById('mist-modal-overlay') as HTMLElement,
    mistModalTitle: document.getElementById('mist-modal-title') as HTMLElement | null,
    mistModalDescription: document.getElementById('mist-modal-description') as HTMLElement | null,
    mistApiStatus: document.getElementById('mist-api-status') as HTMLElement,
    mistModalStatus: document.getElementById('mist-modal-status') as HTMLElement,

    // Troubleshooting
    tsUplinkPort: document.getElementById('ts-uplink-port') as HTMLInputElement,
    btnDhcpRefresh: document.getElementById('btn-dhcp-refresh') as HTMLButtonElement,
    btnRestartMistAgent: document.getElementById('btn-restart-mist-agent') as HTMLButtonElement,
    tsResults: document.getElementById('ts-results') as HTMLElement,

    // Device Identity & Config
    btnLogin: document.getElementById('btn-login') as HTMLButtonElement,
    loginResult: document.getElementById('login-result') as HTMLElement,
    btnIdentify: document.getElementById('btn-identify') as HTMLButtonElement,
    deviceIdentity: document.getElementById('device-identity') as HTMLElement,
    cloudStatusPanel: document.getElementById('cloud-status-panel') as HTMLElement,
    cloudStatusLastUpdated: document.getElementById('cloud-status-last-updated') as HTMLElement,
    mistMonitorPill: document.getElementById('mist-monitor-pill') as HTMLElement,
    mistMonitorDetail: document.getElementById('mist-monitor-detail') as HTMLElement,
    mistMonitorWhy: document.getElementById('mist-monitor-why') as HTMLElement | null,
    jmaMonitorPill: document.getElementById('jma-monitor-pill') as HTMLElement,
    jmaMonitorDetail: document.getElementById('jma-monitor-detail') as HTMLElement,
    jmaMonitorWhy: document.getElementById('jma-monitor-why') as HTMLElement | null,
    mistLaunchCard: document.getElementById('mist-launch-card') as HTMLElement | null,
    mistLaunchPill: document.getElementById('mist-launch-pill') as HTMLElement | null,
    mistLaunchDetail: document.getElementById('mist-launch-detail') as HTMLElement | null,
    mistLaunchWhy: document.getElementById('mist-launch-why') as HTMLElement | null,
    jmaRecommendation: document.getElementById('jma-recommendation') as HTMLElement,
    btnRootPassword: document.getElementById('btn-root-password') as HTMLButtonElement,
    rootPasswordResult: document.getElementById('root-password-result') as HTMLElement,
    btnConfigSyncPreview: document.getElementById('btn-config-sync-preview') as HTMLButtonElement,
    // configSyncResults → dynamic content area inside the results pane
    configSyncResults: document.getElementById('config-sync-content') as HTMLElement,
    configSyncActionBar: document.getElementById('config-sync-action-bar') as HTMLElement,
    btnCommitSync: document.getElementById('btn-commit-sync') as HTMLButtonElement,
    btnRollbackSync: document.getElementById('btn-rollback-sync') as HTMLButtonElement,
    btnOfflineTimeline: document.getElementById('btn-offline-timeline') as HTMLButtonElement,
    timelineResults: document.getElementById('timeline-results') as HTMLElement,
    btnAdopt: document.getElementById('btn-adopt') as HTMLButtonElement,
    adoptRootPw: document.getElementById('adopt-root-pw') as HTMLInputElement,
    adoptResults: document.getElementById('adopt-results') as HTMLElement,

    // Device summary (workspace top strip)
    btnSessionConnect: document.getElementById('btn-session-connect') as HTMLButtonElement | null,
    btnSessionDisconnect: document.getElementById('btn-session-disconnect') as HTMLButtonElement | null,
    btnSessionLogin: document.getElementById('btn-session-login') as HTMLButtonElement | null,
    btnSessionIdentify: document.getElementById('btn-session-identify') as HTMLButtonElement | null,
    btnSessionRootPassword: (document.getElementById('btn-session-root-password')
      ?? document.getElementById('btn-session-root')) as HTMLButtonElement | null,
    deviceSummary: document.getElementById('device-summary') as HTMLElement,
    consoleTaskIndicator: document.getElementById('console-task-indicator') as HTMLElement,

    // Results panel (bottom horizontal panel)
    resultsPanel: document.getElementById('results-panel') as HTMLElement,
    resultsResizeHandle: document.getElementById('results-resize-handle') as HTMLElement,
    guidancePanel: document.getElementById('guidance-panel') as HTMLElement,
    guidanceResizeHandle: document.getElementById('guidance-resize-handle') as HTMLElement,
    btnQuickDhcpRefresh: (document.getElementById('btn-quick-dhcp-refresh')
      ?? document.getElementById('btn-guidance-dhcp-refresh')) as HTMLButtonElement | null,
    btnQuickRestartMistAgent: (document.getElementById('btn-quick-restart-mist-agent')
      ?? document.getElementById('btn-guidance-restart-mist-agent')) as HTMLButtonElement | null,
    btnQuickConfigSync: (document.getElementById('btn-quick-config-sync')
      ?? document.getElementById('btn-guidance-config-sync')) as HTMLButtonElement | null,
    btnQuickAdopt: (document.getElementById('btn-quick-adopt')
      ?? document.getElementById('btn-guidance-adopt')) as HTMLButtonElement | null,
    resultsTabs: document.querySelectorAll<HTMLButtonElement>('.results-tab'),
    resultsPanes: document.querySelectorAll<HTMLElement>('.results-pane'),
    actionsContent: document.getElementById('actions-content') as HTMLElement,
  };

  function openSessionToolsDrawer(): void {
    if (!ui.sidebar) return;
    ui.sessionToolsOverlay?.classList.remove('is-hidden');
    ui.sessionToolsOverlay?.setAttribute('aria-hidden', 'false');
    document.body.classList.add('session-tools-open');
    ui.sidebar.classList.add('is-open');
    ui.sidebar.setAttribute('aria-hidden', 'false');
  }

  function closeSessionToolsDrawer(): void {
    ui.sessionToolsOverlay?.classList.add('is-hidden');
    ui.sessionToolsOverlay?.setAttribute('aria-hidden', 'true');
    document.body.classList.remove('session-tools-open');
    ui.sidebar?.classList.remove('is-open');
    ui.sidebar?.setAttribute('aria-hidden', 'true');
  }

  function bindProxyButton(proxy: HTMLButtonElement | null, source: HTMLButtonElement): void {
    if (!proxy) return;
    const sync = (): void => {
      proxy.disabled = source.disabled;
      proxy.className = source.className;
      proxy.textContent = source.textContent;
    };
    proxy.addEventListener('click', () => source.click());
    new MutationObserver(sync).observe(source, {
      attributes: true,
      attributeFilter: ['disabled', 'class'],
      childList: true,
      characterData: true,
      subtree: true,
    });
    sync();
  }

  // ---- Populate Mist cloud dropdown ----
  const mistCloudPlaceholder = document.createElement('option');
  mistCloudPlaceholder.value = '';
  mistCloudPlaceholder.textContent = '— Select a Mist cloud region —';
  ui.mistCloud.appendChild(mistCloudPlaceholder);

  MIST_CLOUDS.forEach((cloud) => {
    const opt = document.createElement('option');
    opt.value = cloud.id;
    opt.textContent = `${cloud.name} (${cloud.apiHost})`;
    ui.mistCloud.appendChild(opt);
  });
  function loadStoredSerialPrefs(): StoredSerialPrefs | null {
    try {
      const raw = window.localStorage.getItem(SERIAL_PREFS_STORAGE_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw) as Partial<StoredSerialPrefs>;
      if (
        typeof parsed.baudRate !== 'string' ||
        typeof parsed.dataBits !== 'string' ||
        typeof parsed.parity !== 'string' ||
        typeof parsed.stopBits !== 'string' ||
        typeof parsed.flowControl !== 'string'
      ) {
        return null;
      }
      return parsed as StoredSerialPrefs;
    } catch {
      return null;
    }
  }

  function saveSerialPrefs(): void {
    const prefs: StoredSerialPrefs = {
      baudRate: ui.baudRate.value,
      dataBits: ui.dataBits.value,
      parity: ui.parity.value,
      stopBits: ui.stopBits.value,
      flowControl: ui.flowControl.value,
    };
    window.localStorage.setItem(SERIAL_PREFS_STORAGE_KEY, JSON.stringify(prefs));
  }

  function restoreSerialPrefs(): void {
    const prefs = loadStoredSerialPrefs();
    if (!prefs) return;
    ui.baudRate.value = prefs.baudRate;
    ui.dataBits.value = prefs.dataBits;
    ui.parity.value = prefs.parity;
    ui.stopBits.value = prefs.stopBits;
    ui.flowControl.value = prefs.flowControl;
  }

  function saveSelectedMistCloud(): void {
    if (ui.mistCloud.value) {
      window.localStorage.setItem(MIST_CLOUD_STORAGE_KEY, ui.mistCloud.value);
      return;
    }
    window.localStorage.removeItem(MIST_CLOUD_STORAGE_KEY);
  }

  type EffectiveCloudResolution = {
    cloud: MistCloud | null;
    source: 'outbound-ssh' | 'selected' | 'none';
    host: string | null;
  };

  function saveSelectedMistOrg(orgId: string): void {
    if (orgId) {
      window.localStorage.setItem(MIST_ORG_STORAGE_KEY, orgId);
    }
  }

  function getSavedMistOrgId(): string | null {
    return window.localStorage.getItem(MIST_ORG_STORAGE_KEY);
  }

  function restoreSelectedMistCloud(): void {
    const savedCloudId = window.localStorage.getItem(MIST_CLOUD_STORAGE_KEY);
    if (savedCloudId && getCloudById(savedCloudId)) {
      ui.mistCloud.value = savedCloudId;
      return;
    }
    ui.mistCloud.value = '';
  }

  async function resolveEffectiveMistCloud(): Promise<EffectiveCloudResolution> {
    const selectedCloud = getCloudById(ui.mistCloud.value) ?? null;
    const fallback: EffectiveCloudResolution = selectedCloud
      ? { cloud: selectedCloud, source: 'selected', host: null }
      : { cloud: null, source: 'none', host: null };

    if (!serial.isConnected || configSync.hasStagedCandidate() || !isOperationalPromptVisible()) {
      return fallback;
    }

    if (effectiveCloudCache && effectiveCloudCache.expiresAt > Date.now()) {
      const cachedCloud = effectiveCloudCache.cloudId ? getCloudById(effectiveCloudCache.cloudId) ?? null : null;
      return cachedCloud
        ? { cloud: cachedCloud, source: 'outbound-ssh', host: effectiveCloudCache.host }
        : fallback;
    }

    const cmd = await cmdRunner.execute('show configuration system services outbound-ssh', 10000, 1500, { silent: true });
    if (!cmd.success) {
      return fallback;
    }

    const host = cmd.output.match(/(oc-term[\w.-]+)/)?.[1] ?? null;
    if (!host) {
      return fallback;
    }

    const inferredCloud = MIST_CLOUDS.find((cloud) =>
      cloud.switchEndpoints.some((endpoint) => endpoint.host === host),
    ) ?? null;

    effectiveCloudCache = {
      cloudId: inferredCloud?.id ?? null,
      host,
      expiresAt: Date.now() + 30000,
    };

    return inferredCloud
      ? { cloud: inferredCloud, source: 'outbound-ssh', host }
      : fallback;
  }

  function describeEffectiveCloudResolution(resolution: EffectiveCloudResolution): string | null {
    if (resolution.source !== 'outbound-ssh' || !resolution.cloud || !resolution.host) return null;
    return `Using Mist cloud ${resolution.cloud.name} inferred from outbound-ssh host ${resolution.host}.`;
  }

  function saveLastPortLabel(label: string): void {
    window.localStorage.setItem(LAST_PORT_LABEL_STORAGE_KEY, label);
  }

  function getLastPortLabel(): string | null {
    return window.localStorage.getItem(LAST_PORT_LABEL_STORAGE_KEY);
  }

  function saveRemoteSessionEnabled(enabled: boolean): void {
    window.localStorage.setItem(REMOTE_SESSION_ENABLED_STORAGE_KEY, enabled ? 'true' : 'false');
  }

  function shouldAutoStartRemoteSession(): boolean {
    return window.localStorage.getItem(REMOTE_SESSION_ENABLED_STORAGE_KEY) === 'true';
  }

  restoreSerialPrefs();
  restoreSelectedMistCloud();
  ui.remoteSessionEnabled.checked = shouldAutoStartRemoteSession();

  // ---- Create instances ----
  const serial = new SerialService();
  const term = new TerminalComponent(ui.terminalContainer);
  const cmdRunner = new CommandRunnerService(serial);
  const mistApi = new MistApiService();
  const troubleshooter = new TroubleshootService(cmdRunner, mistApi);
  const switchIdentity = new SwitchIdentityService(cmdRunner, mistApi);
  const configSync = new ConfigSyncService(cmdRunner, mistApi);
  const dhcpRefresh = new DhcpRefreshService(cmdRunner);
  const mistAgentRestart = new MistAgentRestartService(cmdRunner);
  const promptDecoder = new TextDecoder();
  const terminalEncoder = new TextEncoder();
  let recentConsoleTail = '';
  let suppressedConsoleLineBuffer = '';
  let suppressingPvWarning = false;
  let cloudStatusLoopStarted = false;
  let localIdentifyInFlight = false;
  let effectiveCloudCache: { cloudId: string | null; host: string | null; expiresAt: number } | null = null;
  let localIdentifyPromise: Promise<void> | null = null;
  let loggedInBootstrapPromise: Promise<void> | null = null;
  let resolvedMatchedSiteName: string | null = null;
  let identifyInFlight = false;
  let cloudStatusRefreshInFlight = false;
  let latestJmaCode: number | null = null;
  let lastUserConsoleInputAt = 0;
  let pendingInitialShellToCli = false;
  let initialShellToCliInFlight = false;
  let latestCloudStatusState: CloudStatusState | null = null;
  let extensionLaunchContext: ExtensionLaunchContext | null = null;
  interface AgentCatalogCheckState {
    id: string;
    name: string;
    desc: string;
    requiresCloud: boolean;
    requiresMistApi: boolean;
    available: boolean;
    reason: string | null;
  }
  interface AgentCatalogGroupState {
    id: string;
    name: string;
    available: boolean;
    reason: string | null;
    checks: AgentCatalogCheckState[];
  }
  interface PendingAgentAction {
    id: string;
    type:
      | 'run_check'
      | 'run_check_group'
      | 'run_all_catalog_checks'
      | 'run_full_baseline'
      | 'run_recommended_checks'
      | 'run_dhcp_refresh'
      | 'run_restart_mist_agent'
      | 'run_config_sync_preview'
      | 'get_effective_config'
      | 'search_log_file'
      | 'list_log_files';
    params?: Record<string, unknown>;
  }
  let latestAgentCheckResults: {
    workflowStatus: 'running' | 'completed';
    runAt: string;
    checks: Array<{
      id: string;
      name: string;
      status: CheckStatus;
      summary: string;
      remediation: string | null;
      rawExcerpt: string | null;
    }>;
  } | null = null;
  let latestAgentGuidedAnalysis: GuidedAnalysisCard | null = null;
  const latestAgentCheckResultMap = new Map<string, CheckResult>();
  let lastAgentContextSessionId: string | null = null;
  let agentContextPushTimer: number | null = null;
  let agentActionPollTimer: number | null = null;
  let agentActionPollInFlight = false;
  let authorizedPortsCache: SerialPort[] = [];
  const consoleTaskGate = new ConsoleTaskGate((ownerId) => {
    if (configSync.hasStagedCandidate() && !ownerId?.startsWith('config-sync')) {
      return { kind: 'exclusive', label: 'staged config sync' };
    }
    return null;
  });

  // ---- Mist context controller ----
  const mistContext = new MistContextController(mistApi, {
    onStatusChange(text, type) {
      setMistStatus(text, type);
    },
    onSitesLoaded(sites) {
      ui.mistSite.innerHTML = '';
      if (sites.length === 0) {
        const opt = document.createElement('option');
        opt.value = '';
        opt.textContent = '— No sites found —';
        ui.mistSite.appendChild(opt);
      } else {
        sites.sort((a, b) => a.name.localeCompare(b.name));
        sites.forEach((site) => {
          const opt = document.createElement('option');
          opt.value = site.id;
          opt.textContent = site.name;
          ui.mistSite.appendChild(opt);
        });
        ui.mistSite.disabled = false;
      }
      const identity = deviceContext.matchResult?.identity ?? deviceContext.localIdentity;
      if (identity) renderDeviceSummary(identity);
    },
    onOrgsLoaded(orgs) {
      ui.mistOrg.innerHTML = '';
      if (orgs.length === 0) {
        const opt = document.createElement('option');
        opt.value = '';
        opt.textContent = '— No orgs found —';
        ui.mistOrg.appendChild(opt);
      } else {
        const sortedOrgs = [...orgs].sort((a, b) => a.name.localeCompare(b.name));
        sortedOrgs.forEach((org) => {
          const opt = document.createElement('option');
          opt.value = org.id;
          opt.textContent = org.name;
          ui.mistOrg.appendChild(opt);
        });
        const savedOrgId = getSavedMistOrgId();
        const selectedOrgId =
          (savedOrgId && sortedOrgs.some((org) => org.id === savedOrgId))
            ? savedOrgId
            : sortedOrgs[0].id;
        ui.mistOrg.value = selectedOrgId;
        mistContext.selectOrg(selectedOrgId);
        saveSelectedMistOrg(selectedOrgId);
        ui.mistOrg.disabled = false;
      }
      const identity = deviceContext.matchResult?.identity ?? deviceContext.localIdentity;
      if (identity) renderDeviceSummary(identity);
    },
    onLoadingChange(loading) {
      ui.btnLoadSites.disabled = loading;
      ui.btnLoadOrgs.disabled = loading;
    },
  });

  // ---- Device context controller ----
  const deviceContext = new DeviceContextController(switchIdentity, cmdRunner, {
    onIdentifyStarted(options) {
      identifyInFlight = true;
      renderJmaRecommendation(latestJmaCode);
      refreshCatalogRunButtons(false);
      const identity = deviceContext.matchResult?.identity ?? deviceContext.localIdentity;
      if (identity) {
        renderDeviceSummary(identity);
      } else {
        renderDeviceSummaryPlaceholder();
      }
      scheduleAgentContextPush();
      if (options?.silent) return;
      // loading state set by caller before runIdentify()
    },
    onIdentified(result, options) {
      identifyInFlight = false;
      renderJmaRecommendation(latestJmaCode);
      refreshCatalogRunButtons(false);
      const { identity, mistDevice, matchedBy } = result;
      resolvedMatchedSiteName = result.mistSiteName ?? null;
      // Update the top-strip summary with the freshest identity data.
      renderDeviceSummary(identity);

      const rows: [string, string | null][] = [
        ['Hostname', identity.hostname],
        ['Serial', identity.serial],
        ['MAC', identity.mac],
        ['Model', identity.model],
        ['Junos', identity.junosVersion],
      ];

      for (const [label, value] of rows) {
        if (value) {
          if (!options?.silent) {
            term.writeSystem(`  ${label}: ${value}`);
          }
        }
      }

      ui.btnConfigSyncPreview.disabled = true;
      ui.btnRootPassword.disabled = true;
      ui.btnOfflineTimeline.disabled = true;

      if (mistDevice) {
        const siteName = result.mistSiteName ?? (mistDevice.site_id ? 'assigned' : 'unassigned');
        if (!options?.silent) {
          term.writeSystem(`  Mist: Found (${matchedBy}) — ${mistDevice.name || mistDevice.id}`);
        }

        const cloudReachable = result.mistCloudReachableHint === true;
        const cloudDisconnected =
          !cloudReachable &&
          (result.mistInventoryConnected === false ||
            (result.mistStatsStatus != null &&
              /disconnect|offline|unreachable|down|lost/i.test(result.mistStatsStatus)));
        const pillClass = cloudReachable
          ? 'mist-status-pill mist-status-connected'
          : cloudDisconnected
            ? 'mist-status-pill mist-status-disconnected'
            : 'mist-status-pill mist-status-unknown';
        const pillLabel = cloudReachable ? 'Connected' : cloudDisconnected ? 'Disconnected' : 'Unknown';
        if (!options?.silent) {
          term.writeSystem(`  Mist cloud state: ${pillLabel}`);
        }

        if (result.mistLastSeenUtcIso && !options?.silent) {
          term.writeSystem(`  Last seen (UTC): ${result.mistLastSeenUtcIso}`);
        }
        if (result.mistLastConfigUtcIso && !options?.silent) {
          term.writeSystem(`  Last config (UTC): ${result.mistLastConfigUtcIso}`);
        }
        if (result.mistCloudStatusLine && !options?.silent) {
          term.writeSystem(`  Mist cloud: ${result.mistCloudStatusLine}`);
        }
        if (result.mistCloudReachableHint) {
          if (!options?.silent) {
            term.writeSystem('  Note: Mist reports switch as cloud-reachable — full cloud check may be optional.');
          }
        }

        const effectiveTarget = getEffectiveMistTarget();
        ui.btnConfigSyncPreview.disabled = !effectiveTarget.siteId || !effectiveTarget.deviceId;
        ui.btnRootPassword.disabled = !effectiveTarget.siteId;
        ui.btnOfflineTimeline.disabled = !effectiveTarget.siteId;
        // Re-apply staged constraint on top of identification-derived button state
        updateConfigSyncUIState();

        if (mistDevice.site_id && !result.mistSiteName) {
          void ensureMatchedSiteName(mistDevice.site_id, identity);
        }
      } else if (!mistApi.isConfigured && !extensionLaunchContext) {
        if (!options?.silent) term.writeSystem('  Mist: API not configured');
      } else {
        if (!options?.silent) term.writeSystem('  Mist: Not found in inventory');
      }

      ui.deviceIdentity.innerHTML = '';
      cloudStatusRefreshInFlight = true;
      renderJmaRecommendation(latestJmaCode);
      refreshCatalogRunButtons(false);
      renderDeviceSummary(identity);
      scheduleAgentContextPush();
      void startLoggedInCloudStatusLoop(true).finally(() => {
        cloudStatusRefreshInFlight = false;
        renderJmaRecommendation(latestJmaCode);
        refreshCatalogRunButtons(false);
        renderDeviceSummary(identity);
        scheduleAgentContextPush();
      });
    },
    onIdentifyFailed(error, options) {
      identifyInFlight = false;
      cloudStatusRefreshInFlight = false;
      renderJmaRecommendation(latestJmaCode);
      refreshCatalogRunButtons(false);
      if (!options?.silent) {
        term.writeError(`Identification failed: ${error.message}`);
      }
      ui.deviceIdentity.innerHTML = '';
      cloudStatus.reset();
      scheduleAgentContextPush();
    },
    onLocalIdentityAvailable(identity) {
      renderDeviceSummary(identity);
      scheduleAgentContextPush();
      if (mistContext.isConfigured) {
        maybeAutoMatchAfterMistSave();
      }
    },
  });

  const remoteSession = new RemoteSessionController(serial, {
    onSessionStarted(sessionId) {
      ui.remoteSessionId.value = sessionId;
      ui.remoteSessionPanel.classList.remove('is-hidden');
      lastAgentContextSessionId = sessionId;
      term.writeSystem('— Remote session active —');
      scheduleAgentContextPush({ sessionId, enabled: true });
      scheduleAgentActionPoll(250);
    },
    onSessionEnded(reason) {
      const endedSessionId = remoteSession.sessionId ?? lastAgentContextSessionId;
      term.writeSystem(`— Remote session ended (${reason}) —`);
      ui.remoteSessionEnabled.checked = false;
      ui.remoteSessionPanel.classList.add('is-hidden');
      ui.remoteSessionId.value = '';
      scheduleAgentContextPush({ sessionId: endedSessionId, enabled: false });
      clearAgentActionPoll();
    },
    onError(message) {
      const endedSessionId = remoteSession.sessionId ?? lastAgentContextSessionId;
      term.writeError(`Remote session: ${message}`);
      ui.remoteSessionEnabled.checked = false;
      ui.remoteSessionPanel.classList.add('is-hidden');
      ui.remoteSessionId.value = '';
      scheduleAgentContextPush({ sessionId: endedSessionId, enabled: false });
      clearAgentActionPoll();
    },
  });

  const cloudStatus = new CloudStatusController(switchIdentity, troubleshooter, {
    onStatusUpdated(state) {
      latestCloudStatusState = state;
      renderCloudStatus(state);
      scheduleAgentContextPush();
    },
    onRefreshStateChange(inFlight) {
      cloudStatusRefreshInFlight = inFlight;
      renderJmaRecommendation(latestJmaCode);
      refreshCatalogRunButtons(false);
    },
  });

  function sanitizeAgentRawExcerpt(raw: string | undefined): string | null {
    if (!raw) return null;
    const trimmed = raw.trim();
    if (!trimmed) return null;
    return trimmed.length > 400 ? `${trimmed.slice(0, 397)}...` : trimmed;
  }

  function setLatestAgentCheckResults(
    results: CheckResult[] | null,
    workflowStatus: 'running' | 'completed' = 'completed',
  ): void {
    latestAgentCheckResults = results
      ? {
          workflowStatus,
          runAt: new Date().toISOString(),
          checks: results.map((result) => ({
            id: result.id,
            name: result.name,
            status: result.status,
            summary: result.detail,
            remediation: result.remediation ?? null,
            rawExcerpt: sanitizeAgentRawExcerpt(result.raw),
          })),
        }
      : null;
    scheduleAgentContextPush();
  }

  function setLatestAgentGuidedAnalysis(card: GuidedAnalysisCard | null): void {
    latestAgentGuidedAnalysis = card
      ? {
          eyebrow: card.eyebrow,
          title: card.title,
          summary: card.summary,
          conclusion: card.conclusion,
          findings: card.findings ? [...card.findings] : [],
        }
      : null;
    scheduleAgentContextPush();
  }

  function beginLatestAgentCheckRun(): void {
    latestAgentCheckResultMap.clear();
    latestAgentCheckResults = {
      workflowStatus: 'running',
      runAt: new Date().toISOString(),
      checks: [],
    };
    scheduleAgentContextPush();
  }

  function getCatalogAvailabilityInput() {
    return {
      serialConnected: serial.isConnected,
      catalogRunning,
      selectedCloud: getCloudById(ui.mistCloud.value) ?? null,
      effectiveTarget: getEffectiveMistTarget(),
      getBlockingConsoleTask,
    };
  }

  function resolveCatalogRunOptionsForWorkflow(checkIds: string[], cloudOverride?: MistCloud | null) {
    return resolveCatalogRunOptions(checkIds, {
      selectedCloud: getCloudById(ui.mistCloud.value) ?? null,
      effectiveTarget: getEffectiveMistTarget(),
      uplinkPort: ui.tsUplinkPort.value.trim(),
      jmaStateCode: latestJmaCode,
      onProgress: handleProgressResult,
      cloudOverride,
    });
  }

  function applyCheckResultsWithGuidedAnalysis(
    results: CheckResult[],
    options: {
      title: string;
      jmaCode?: number | null;
    },
  ): void {
    setLatestAgentCheckResults(results);
    renderGuidedCheckAnalysis(buildGuidedAnalysisForRun(results, options));
  }

  function setCatalogRunningState(running: boolean): void {
    catalogRunning = running;
  }

  function getTroubleshootWorkflowDeps(): TroubleshootWorkflowDeps<EffectiveCloudResolution> {
    return {
      resolveEffectiveCloud: resolveEffectiveMistCloud,
      withCloudStatusPollingPaused,
      withConsoleTask,
      beginLatestAgentCheckRun,
      refreshCatalogRunButtons,
      activateResultsTab,
      describeEffectiveCloudResolution,
      setCatalogRunning: setCatalogRunningState,
      term,
    };
  }

  function canRunFullBaselineNow(): boolean {
    return canRunFullBaseline({
      serialConnected: serial.isConnected,
      catalogRunning,
      selectedCloud: getCloudById(ui.mistCloud.value) ?? null,
      getBlockingConsoleTask,
    });
  }

  function buildAgentContextPayload(sessionId: string, agentAccessEnabled: boolean): Record<string, unknown> {
    const identity = deviceContext.matchResult?.identity ?? deviceContext.localIdentity;
    const mistDevice = deviceContext.matchResult?.mistDevice ?? null;
    const cloudState = latestCloudStatusState ?? cloudStatus.state;
    const recommendation = getJmaRecommendation(latestJmaCode);
    const selectedCloud = getCloudById(ui.mistCloud.value);
    const selectedOrgName = getSelectedOrgName();
    const selectedSiteName = getSelectedSiteName();
    const effectiveTarget = getEffectiveMistTarget();
    const promptMode = getRecentPromptMode();
    // Strip ANSI escape sequences for plain-text MCP consumption
    const recentTail = recentConsoleTail.trim()
      .replace(/\x1b\[[0-9;?]*[a-zA-Z]/g, '').replace(/\x1b./g, '');
    const blockingConsoleTask = getBlockingConsoleTask();
    const catalogGroups: AgentCatalogGroupState[] = CATALOG_GROUPS.map((group) => {
      const checks = group.checks.map((check) => {
        const availability = getCatalogCheckAvailability(check.id, getCatalogAvailabilityInput());
        return {
          id: check.id,
          name: check.name,
          desc: check.desc,
          requiresCloud: check.requiresCloud,
          requiresMistApi: check.requiresMistApi,
          available: availability.available,
          reason: availability.reason,
        };
      });
      const unavailableChecks = checks.filter((check) => !check.available);
      return {
        id: group.id,
        name: group.name,
        available: unavailableChecks.length === 0,
        reason: unavailableChecks.length > 0 ? unavailableChecks[0].reason : null,
        checks,
      };
    });

    return {
      sessionId,
      agentAccessEnabled,
      serialConnected: serial.isConnected,
      deviceIdentified: Boolean(identity),
      mistStatus: cloudState.mist.label.toLowerCase(),
      configSyncState: configSync.sessionState,
      prompt: {
        mode: promptMode,
        operationalVisible: promptMode === 'operational',
        recentConsoleTail: recentTail || null,
      },
      consoleTask: blockingConsoleTask
        ? {
            kind: blockingConsoleTask.kind,
            label: blockingConsoleTask.label,
          }
        : null,
      mistContext: {
        configured: mistContext.isConfigured,
        cloudId: selectedCloud?.id ?? null,
        cloudName: selectedCloud?.name ?? null,
        apiHost: selectedCloud?.apiHost ?? null,
        orgId: effectiveTarget.orgId ?? null,
        orgName: selectedOrgName,
        siteId: effectiveTarget.siteId ?? null,
        siteName: selectedSiteName,
        orgCount: mistContext.state.orgs.length,
        siteCount: mistContext.state.sites.length,
      },
      troubleshooting: {
        uplinkPort: ui.tsUplinkPort.value.trim() || null,
      },
      guidance: {
        jmaRecommendation: recommendation
          ? {
              code: recommendation.code,
              label: recommendation.label,
              title: recommendation.title,
              summary: recommendation.summary,
              implication: recommendation.implication,
              severity: recommendation.severity,
              workflowRecommendation: recommendation.workflowRecommendation,
              workflowNote: recommendation.workflowNote,
              checks: recommendation.checks.map((check) => ({
                id: check.id,
                label: check.label,
                why: check.why,
              })),
              remediation: [...recommendation.remediation],
            }
          : null,
        guidedAnalysis: latestAgentGuidedAnalysis,
      },
      actions: {
        runRecommendedChecks: {
          available: Boolean(recommendation) && serial.isConnected && !Boolean(getBlockingConsoleTask('jma-recommended-checks')),
          reason: recommendation
            ? (serial.isConnected
              ? (getBlockingConsoleTask('jma-recommended-checks')?.label ?? null)
              : 'Serial session is not connected.')
            : 'No current JMA recommendation is available.',
        },
        runFullBaseline: {
          available: canRunFullBaselineNow(),
          reason: canRunFullBaselineNow() ? null : 'Full baseline is not currently available.',
        },
        dhcpRefresh: {
          available: !ui.btnDhcpRefresh.disabled,
          reason: ui.btnDhcpRefresh.disabled ? 'DHCP Refresh is not currently available.' : null,
        },
        restartMistAgent: {
          available: !ui.btnRestartMistAgent.disabled,
          reason: ui.btnRestartMistAgent.disabled ? 'Restart Mist Agent is not currently available.' : null,
        },
        configSync: {
          available: !ui.btnConfigSyncPreview.disabled,
          reason: ui.btnConfigSyncPreview.disabled ? 'Config Sync is not currently available.' : null,
        },
        adoptSwitch: {
          available: !ui.btnAdopt.disabled,
          reason: ui.btnAdopt.disabled ? 'Adopt Switch is not currently available.' : null,
        },
        offlineTimeline: {
          available: !ui.btnOfflineTimeline.disabled,
          reason: ui.btnOfflineTimeline.disabled ? 'Offline Timeline is not currently available.' : null,
        },
      },
      checkCatalog: {
        groups: catalogGroups,
        runAllCatalogChecks: {
          available: !document.getElementById('catalog-btn-run-all')?.hasAttribute('disabled'),
          reason: document.getElementById('catalog-btn-run-all')?.hasAttribute('disabled')
            ? 'Run All Catalog Checks is not currently available.'
            : null,
        },
        runFullBaseline: {
          available: canRunFullBaselineNow(),
          reason: canRunFullBaselineNow() ? null : 'Run Full Baseline is not currently available.',
        },
      },
      identity: identity
        ? {
            hostname: identity.hostname,
            serial: identity.serial,
            mac: identity.mac,
            model: identity.model,
            junosVersion: identity.junosVersion,
            mistMatch: mistDevice
              ? {
                  matched: true,
                  matchConfidence: deviceContext.matchResult?.matchedBy ?? null,
                  orgId: mistDevice.org_id ?? null,
                  siteId: mistDevice.site_id ?? null,
                  deviceId: mistDevice.id ?? null,
                  deviceName: mistDevice.name ?? null,
                }
              : {
                  matched: false,
                  matchConfidence: null,
                  orgId: null,
                  siteId: null,
                  deviceId: null,
                  deviceName: null,
                },
          }
        : null,
      jma: {
        stateCode: cloudState.jma.code,
        stateLabel: cloudState.jma.label,
        stateDescription: cloudState.jma.detail,
        rawValue: cloudState.jma.code != null ? String(cloudState.jma.code) : null,
        checkedAt: cloudState.lastUpdatedUtcIso,
      },
      checkResults: latestAgentCheckResults,
    };
  }

  async function pushAgentContextNow(sessionId: string, agentAccessEnabled: boolean): Promise<void> {
    try {
      await fetch('http://127.0.0.1:3333/mcp/agent-context', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(buildAgentContextPayload(sessionId, agentAccessEnabled)),
      });
      lastAgentContextSessionId = sessionId;
    } catch (err) {
      console.warn('Failed to push MCP agent context', err);
    }
  }

  function scheduleAgentContextPush(options?: { sessionId?: string | null; enabled?: boolean }): void {
    const sessionId = options?.sessionId ?? remoteSession.sessionId ?? lastAgentContextSessionId;
    if (!sessionId) return;
    const enabled = options?.enabled ?? (ui.remoteSessionEnabled.checked && remoteSession.isActive);
    if (agentContextPushTimer != null) {
      window.clearTimeout(agentContextPushTimer);
    }
    agentContextPushTimer = window.setTimeout(() => {
      agentContextPushTimer = null;
      void pushAgentContextNow(sessionId, enabled);
    }, 150);
  }

  function clearAgentActionPoll(): void {
    if (agentActionPollTimer != null) {
      window.clearTimeout(agentActionPollTimer);
      agentActionPollTimer = null;
    }
  }

  async function postAgentActionStatus(
    actionId: string,
    status: 'running' | 'completed' | 'failed',
    payload?: { result?: unknown; error?: string | null },
  ): Promise<void> {
    try {
      await fetch(`http://127.0.0.1:3333/mcp/actions/${actionId}/status`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          status,
          result: payload?.result,
          error: payload?.error ?? null,
        }),
      });
    } catch (err) {
      console.warn('Failed to post MCP action status', err);
    }
  }

  function buildAgentActionResultPayload(extra?: Record<string, unknown>): Record<string, unknown> {
    return {
      checkResults: latestAgentCheckResults,
      guidedAnalysis: latestAgentGuidedAnalysis,
      jmaStateCode: latestJmaCode,
      jmaStateLabel: cloudStatus.state.jma.label,
      mistStatus: cloudStatus.state.mist.label,
      completedAt: new Date().toISOString(),
      ...extra,
    };
  }

  async function executePendingAgentAction(action: PendingAgentAction): Promise<void> {
    await postAgentActionStatus(action.id, 'running');

    try {
      let actionResult: Record<string, unknown> | undefined;
      switch (action.type) {
        case 'run_check': {
          const checkId = typeof action.params?.checkId === 'string' ? action.params.checkId : '';
          if (!checkId || !getCatalogCheck(checkId)) {
            throw new Error('Unknown or missing checkId.');
          }
          const availability = getCatalogCheckAvailability(checkId, getCatalogAvailabilityInput());
          if (!availability.available) {
            throw new Error(availability.reason ?? 'Check is not currently available.');
          }
          await runSingleCheck(checkId);
          break;
        }
        case 'run_check_group': {
          const groupId = typeof action.params?.groupId === 'string' ? action.params.groupId : '';
          const checks = getCatalogGroupChecks(groupId);
          if (!groupId || checks.length === 0) {
            throw new Error('Unknown or missing groupId.');
          }
          const blocked = checks
            .map((check) => getCatalogCheckAvailability(check.id, getCatalogAvailabilityInput()))
            .find((item) => !item.available);
          if (blocked && !blocked.available) {
            throw new Error(blocked.reason ?? 'Check group is not currently available.');
          }
          await runCheckGroup(groupId);
          break;
        }
        case 'run_all_catalog_checks': {
          const runnableCheckIds = RUN_ALL_CATALOG_CHECK_IDS.filter((checkId) => canRunCatalogCheck(checkId));
          if (runnableCheckIds.length === 0) {
            throw new Error('No catalog checks are currently available.');
          }
          await withCloudStatusPollingPaused(async () => {
            await withConsoleTask('catalog-all-checks', 'user', 'all catalog checks', async () => {
              const effectiveCloud = await resolveEffectiveMistCloud();
              const resolved = resolveCatalogRunOptions(runnableCheckIds, {
                selectedCloud: getCloudById(ui.mistCloud.value) ?? null,
                effectiveTarget: getEffectiveMistTarget(),
                uplinkPort: ui.tsUplinkPort.value.trim(),
                onProgress: handleProgressResult,
                cloudOverride: effectiveCloud.cloud,
              });
              if ('error' in resolved) {
                throw new Error(resolved.error);
              }
              catalogRunning = true;
              beginLatestAgentCheckRun();
              refreshCatalogRunButtons(true);
              activateResultsTab('checks');

              resetCatalogRows(ALL_CATALOG_CHECK_IDS);
              runnableCheckIds.forEach((checkId) => {
                const dot = document.getElementById(`catalog-dot-${checkId}`);
                const badge = document.getElementById(`catalog-badge-${checkId}`);
                if (dot) dot.className = 'check-status-dot running';
                if (badge) setCatalogBadgeState(badge, 'running', '…', '');
              });

              term.writeSystem('— Agent requested action: run_all_catalog_checks —');
              const cloudMessage = describeEffectiveCloudResolution(effectiveCloud);
              if (cloudMessage) {
                term.writeSystem(`  ${cloudMessage}`);
              }
              try {
                const results = await troubleshooter.runRecommendedChecks(resolved.options);
                setLatestAgentCheckResults(results);
              } catch (err) {
                const msg = err instanceof Error ? err.message : String(err);
                term.writeError(`Check suite failed: ${msg}`);
                throw err;
              } finally {
                catalogRunning = false;
                refreshCatalogRunButtons(false);
                term.writeSystem('— All catalog checks complete —');
              }
            });
          });
          break;
        }
        case 'run_full_baseline': {
          if (!canRunFullBaselineNow()) {
            throw new Error('Run Full Baseline is not currently available.');
          }
          await runFullBaseline();
          break;
        }
        case 'run_recommended_checks': {
          const recommendation = getJmaRecommendation(latestJmaCode);
          if (!recommendation) {
            throw new Error('No current JMA recommendation is available.');
          }
          if (!serial.isConnected) {
            throw new Error('Serial session is not connected.');
          }
          const blocking = getBlockingConsoleTask('jma-recommended-checks');
          if (blocking) {
            throw new Error(`Recommended checks are unavailable while ${blocking.label} is using the console.`);
          }
          await runRecommendedChecksFromJma();
          break;
        }
        case 'run_dhcp_refresh': {
          if (ui.btnDhcpRefresh.disabled) {
            throw new Error('DHCP Refresh is not currently available.');
          }
          const refreshResult = await runDhcpRefresh();
          actionResult = buildAgentActionResultPayload({
            recoveryAction: 'run_dhcp_refresh',
            recoveryResult: refreshResult,
          });
          break;
        }
        case 'run_restart_mist_agent': {
          if (ui.btnRestartMistAgent.disabled) {
            throw new Error('Restart Mist Agent is not currently available.');
          }
          const restartResult = await runMistAgentRestart();
          actionResult = buildAgentActionResultPayload({
            recoveryAction: 'run_restart_mist_agent',
            recoveryResult: restartResult,
          });
          break;
        }
        case 'run_config_sync_preview': {
          if (ui.btnConfigSyncPreview.disabled) {
            throw new Error('Config Sync is not currently available.');
          }
          await previewConfigSync();
          actionResult = buildAgentActionResultPayload({
            recoveryAction: 'run_config_sync_preview',
            configSyncState: configSync.hasStagedCandidate() ? 'staged' : 'idle',
          });
          break;
        }
        case 'get_effective_config': {
          actionResult = await fetchEffectiveConfigForAgent();
          break;
        }
        case 'search_log_file': {
          const logFile = typeof action.params?.logFile === 'string' ? action.params.logFile : '';
          const findText = typeof action.params?.findText === 'string' ? action.params.findText : '';
          actionResult = await searchLogFileForAgent(logFile, findText, action.params?.maxLines);
          break;
        }
        case 'list_log_files': {
          const family = typeof action.params?.family === 'string' ? action.params.family : '';
          actionResult = await listLogFilesForAgent(family);
          break;
        }
        default:
          throw new Error(`Unsupported action type: ${action.type}`);
      }

      await postAgentActionStatus(action.id, 'completed', {
        result: actionResult ?? buildAgentActionResultPayload(),
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await postAgentActionStatus(action.id, 'failed', {
        error: message,
        result: buildAgentActionResultPayload(),
      });
    }
  }

  async function pollAgentActionsNow(): Promise<void> {
    if (agentActionPollInFlight) return;
    const sessionId = remoteSession.sessionId;
    if (!sessionId || !remoteSession.isActive || !ui.remoteSessionEnabled.checked) return;

    agentActionPollInFlight = true;
    try {
      const res = await fetch(`http://127.0.0.1:3333/mcp/actions/next?sessionId=${encodeURIComponent(sessionId)}`);
      if (!res.ok) return;
      const payload = await res.json() as { action?: PendingAgentAction | null };
      if (payload.action) {
        term.writeSystem(`— Agent requested action: ${payload.action.type} —`);
        await executePendingAgentAction(payload.action);
      }
    } catch (err) {
      console.warn('Failed to poll MCP agent actions', err);
    } finally {
      agentActionPollInFlight = false;
    }
  }

  function scheduleAgentActionPoll(delayMs = 1000): void {
    clearAgentActionPoll();
    if (!ui.remoteSessionEnabled.checked || !remoteSession.isActive) return;
    agentActionPollTimer = window.setTimeout(async () => {
      agentActionPollTimer = null;
      await pollAgentActionsNow();
      scheduleAgentActionPoll();
    }, delayMs);
  }

  // ---- Results panel tab switching ----
  /**
   * Activate a named results panel tab and show its pane.
   * `pane` must match the `data-pane` attribute on the corresponding tab button.
   */
  function activateResultsTab(pane: string): void {
    ui.resultsTabs.forEach((tab) => {
      tab.classList.toggle('active', tab.dataset.pane === pane);
    });
    ui.resultsPanes.forEach((p) => {
      const isTarget = p.id === `${pane}-results`;
      p.classList.toggle('results-pane-hidden', !isTarget);
    });
  }

  /**
   * Yield to the browser so recent DOM updates can paint before we continue
   * with heavier synchronous terminal rendering work.
   */
  async function waitForUiPaint(): Promise<void> {
    await new Promise<void>((resolve) => {
      window.requestAnimationFrame(() => {
        window.requestAnimationFrame(() => resolve());
      });
    });
  }

  // Wire up tab click handlers
  ui.resultsTabs.forEach((tab) => {
    tab.addEventListener('click', () => {
      const pane = tab.dataset.pane;
      if (pane) activateResultsTab(pane);
    });
  });

  // ---- Results panel vertical resizing ----
  const RESULTS_HEIGHT_STORAGE_KEY = 'junos-console.results-panel-height';
  const RESULTS_MIN_HEIGHT = 120;
  const RESULTS_MAX_RATIO = 0.55;

  function getMaxResultsHeight(): number {
    return Math.max(RESULTS_MIN_HEIGHT, Math.floor(window.innerHeight * RESULTS_MAX_RATIO));
  }

  function clampResultsHeight(height: number): number {
    return Math.max(RESULTS_MIN_HEIGHT, Math.min(getMaxResultsHeight(), Math.round(height)));
  }

  function applyResultsPanelHeight(height: number, persist = true): void {
    const clamped = clampResultsHeight(height);
    ui.resultsPanel.style.height = `${clamped}px`;
    document.documentElement.style.setProperty('--results-panel-height', `${clamped}px`);
    if (persist) {
      window.localStorage.setItem(RESULTS_HEIGHT_STORAGE_KEY, String(clamped));
    }
  }

  const savedResultsHeight = Number(window.localStorage.getItem(RESULTS_HEIGHT_STORAGE_KEY));
  if (Number.isFinite(savedResultsHeight) && savedResultsHeight > 0) {
    applyResultsPanelHeight(savedResultsHeight, false);
  }

  window.addEventListener('resize', () => {
    const current = ui.resultsPanel.getBoundingClientRect().height;
    applyResultsPanelHeight(current, false);
  });

  ui.resultsResizeHandle.addEventListener('pointerdown', (event) => {
    if (window.matchMedia('(max-width: 768px)').matches) return;

    event.preventDefault();
    const pointerId = event.pointerId;
    ui.resultsResizeHandle.classList.add('is-dragging');
    ui.resultsResizeHandle.setPointerCapture(pointerId);

    const move = (moveEvent: PointerEvent) => {
      const workspaceRect = ui.workspace.getBoundingClientRect();
      const handleRect = ui.resultsResizeHandle.getBoundingClientRect();
      const desiredHeight = workspaceRect.bottom - moveEvent.clientY - handleRect.height / 2;
      applyResultsPanelHeight(desiredHeight, false);
    };

    const release = () => {
      ui.resultsResizeHandle.classList.remove('is-dragging');
      const current = ui.resultsPanel.getBoundingClientRect().height;
      applyResultsPanelHeight(current, true);
      ui.resultsResizeHandle.removeEventListener('pointermove', move);
      ui.resultsResizeHandle.removeEventListener('pointerup', release);
      ui.resultsResizeHandle.removeEventListener('pointercancel', release);
    };

    ui.resultsResizeHandle.addEventListener('pointermove', move);
    ui.resultsResizeHandle.addEventListener('pointerup', release);
    ui.resultsResizeHandle.addEventListener('pointercancel', release);
  });

  // ---- Guidance panel horizontal resizing ----
  // The guidance panel is a grid column on #main. Resizing it means updating
  // the grid-template-columns inline style on #main, not the panel width directly.
  const GUIDANCE_WIDTH_STORAGE_KEY = 'junos-console.guidance-panel-width';
  const GUIDANCE_MIN_WIDTH = 220;
  const GUIDANCE_MAX_WIDTH = 520;

  function clampGuidanceWidth(width: number): number {
    return Math.max(GUIDANCE_MIN_WIDTH, Math.min(GUIDANCE_MAX_WIDTH, Math.round(width)));
  }

  function applyGuidanceWidth(width: number, persist = true): void {
    const clamped = clampGuidanceWidth(width);
    // Update the CSS variable used in the grid template
    document.documentElement.style.setProperty('--guidance-panel-width', `${clamped}px`);
    if (persist) {
      window.localStorage.setItem(GUIDANCE_WIDTH_STORAGE_KEY, String(clamped));
    }
  }

  const savedGuidanceWidth = Number(window.localStorage.getItem(GUIDANCE_WIDTH_STORAGE_KEY));
  if (Number.isFinite(savedGuidanceWidth) && savedGuidanceWidth > 0) {
    applyGuidanceWidth(savedGuidanceWidth, false);
  }

  ui.guidanceResizeHandle.addEventListener('pointerdown', (event) => {
    event.preventDefault();
    const pointerId = event.pointerId;
    ui.guidanceResizeHandle.classList.add('is-dragging');
    ui.guidanceResizeHandle.setPointerCapture(pointerId);

    const move = (moveEvent: PointerEvent) => {
      const mainRect = document.getElementById('main')!.getBoundingClientRect();
      // Width = distance from the pointer to the right edge of #main
      const desiredWidth = mainRect.right - moveEvent.clientX;
      applyGuidanceWidth(desiredWidth, false);
    };

    const release = () => {
      ui.guidanceResizeHandle.classList.remove('is-dragging');
      const current = ui.guidancePanel.getBoundingClientRect().width;
      applyGuidanceWidth(current, true);
      ui.guidanceResizeHandle.removeEventListener('pointermove', move);
      ui.guidanceResizeHandle.removeEventListener('pointerup', release);
      ui.guidanceResizeHandle.removeEventListener('pointercancel', release);
    };

    ui.guidanceResizeHandle.addEventListener('pointermove', move);
    ui.guidanceResizeHandle.addEventListener('pointerup', release);
    ui.guidanceResizeHandle.addEventListener('pointercancel', release);
  });

  // ---- Config sync staged-state UI management ----

  /**
   * Synchronise all UI controls with the current config sync session state.
   *
   * Call this after any operation that changes whether a candidate is staged
   * (previewSync completion, commit, rollback, reset on disconnect).
   */
  function updateConfigSyncUIState(): void {
    const staged = configSync.hasStagedCandidate();
    const sessionInfo = configSync.sessionInfo;
    const canCommit = staged && !!sessionInfo?.canCommit;
    const effectiveTarget = getEffectiveMistTarget();
    const hasSite = !!effectiveTarget.siteId;
    const hasDevice = hasSite && !!effectiveTarget.deviceId;

    // While a candidate config is staged, background Mist/JMA polling must stay
    // quiet so the app does not issue unrelated commands into the same session.
    cloudStatus.setStagedPause(staged);

    // Action bar: visible only while a candidate is staged
    if (staged) {
      ui.configSyncActionBar.classList.remove('is-hidden');
    } else {
      ui.configSyncActionBar.classList.add('is-hidden');
    }

    // Action buttons: commit only enabled after a clean, passing preview.
    ui.btnCommitSync.disabled = !canCommit;
    ui.btnRollbackSync.disabled = !staged;

    // Preview button: disabled while staged (can't start a new preview over an existing candidate)
    ui.btnConfigSyncPreview.disabled = staged || !hasDevice;

    // Workflows that would conflict with an open config-mode session.
    // Anything that mutates config must stay disabled for the full staged window.
    if (staged) {
      refreshCatalogRunButtons(true);
      ui.btnDhcpRefresh.disabled = true;
      ui.btnRestartMistAgent.disabled = true;
      ui.btnOfflineTimeline.disabled = true;
      ui.btnAdopt.disabled = true;
    } else if (serial.isConnected) {
      // Restore normal connected-state enabling; identification guards apply separately
      refreshCatalogRunButtons(false);
      ui.btnDhcpRefresh.disabled = false;
      ui.btnRestartMistAgent.disabled = false;
      // Offline timeline re-enabled only if device is identified with a site
      ui.btnOfflineTimeline.disabled = !hasSite;
      ui.btnAdopt.disabled = !serial.isConnected;
    }

    renderConsoleTaskIndicator();
    renderJmaRecommendation(latestJmaCode);
    scheduleAgentContextPush();
  }

  function ensureStagedCandidateActionAllowed(action: 'commit' | 'rollback'): boolean {
    updateConfigSyncUIState();

    if (!serial.isConnected) {
      const label = action === 'commit' ? 'Commit' : 'Rollback';
      const message = `${label} is unavailable because the switch is disconnected.`;
      ui.configSyncResults.innerHTML = `<div class="status-text error">${escapeHtml(message)}</div>`;
      term.writeError(message);
      return false;
    }

    if (!configSync.hasStagedCandidate()) {
      const label = action === 'commit' ? 'Commit' : 'Rollback';
      const message = `${label} is unavailable because there is no staged candidate configuration.`;
      ui.configSyncResults.innerHTML = `<div class="status-text error">${escapeHtml(message)}</div>`;
      term.writeError(message);
      return false;
    }

    if (action === 'commit' && !configSync.sessionInfo?.canCommit) {
      const message = 'Commit is unavailable because the staged candidate is not in a committable state.';
      ui.configSyncResults.innerHTML = `<div class="status-text error">${escapeHtml(message)}</div>`;
      term.writeError(message);
      return false;
    }

    return true;
  }

  // ---- UI state helpers ----
  function formatPortLabel(port: SerialPort): string {
    const info = port.getInfo?.();
    const vid = typeof info?.usbVendorId === 'number'
      ? info.usbVendorId.toString(16).padStart(4, '0')
      : null;
    const pid = typeof info?.usbProductId === 'number'
      ? info.usbProductId.toString(16).padStart(4, '0')
      : null;
    if (vid && pid) return `USB ${vid}:${pid}`;
    return 'Browser-selected serial port';
  }

  function getPreferredAuthorizedPort(ports = authorizedPortsCache): SerialPort | null {
    const lastPortLabel = getLastPortLabel();
    if (lastPortLabel) {
      const matched = ports.find((port) => formatPortLabel(port) === lastPortLabel);
      if (matched) return matched;
    }
    return ports.length === 1 ? ports[0] : null;
  }

  function getSelectedAuthorizedPort(ports = authorizedPortsCache): SerialPort | null {
    const selectedLabel = ui.serialPortSelect.value;
    if (!selectedLabel) return null;
    return ports.find((port) => formatPortLabel(port) === selectedLabel) ?? null;
  }

  function refreshAuthorizedPortSelector(): void {
    const currentValue = ui.serialPortSelect.value;
    const lastPortLabel = getLastPortLabel();
    const preferredPort = getPreferredAuthorizedPort();
    const preferredLabel = preferredPort ? formatPortLabel(preferredPort) : '';
    const nextValue =
      (currentValue && authorizedPortsCache.some((port) => formatPortLabel(port) === currentValue))
        ? currentValue
        : (lastPortLabel && authorizedPortsCache.some((port) => formatPortLabel(port) === lastPortLabel))
          ? lastPortLabel
          : preferredLabel;

    ui.serialPortSelect.innerHTML = '';
    const placeholder = document.createElement('option');
    placeholder.value = '';
    placeholder.textContent = authorizedPortsCache.length > 0
      ? 'Choose from authorized ports or open picker'
      : 'No authorized ports';
    ui.serialPortSelect.appendChild(placeholder);

    for (const port of authorizedPortsCache) {
      const label = formatPortLabel(port);
      const option = document.createElement('option');
      option.value = label;
      option.textContent = label;
      ui.serialPortSelect.appendChild(option);
    }

    ui.serialPortSelect.value = nextValue || '';
    ui.serialPortSelect.disabled = serial.isConnected || authorizedPortsCache.length === 0;
  }

  async function refreshAuthorizedPortsCache(): Promise<void> {
    if (!SerialService.isSupported()) return;
    try {
      authorizedPortsCache = await navigator.serial.getPorts();
    } catch {
      authorizedPortsCache = [];
    }

    refreshAuthorizedPortSelector();
    if (serial.isConnected) return;
    const selectedPort = getSelectedAuthorizedPort() ?? getPreferredAuthorizedPort();
    ui.btnConnect.textContent = authorizedPortsCache.length > 0 ? 'Connect Selected Port' : 'Choose Serial Port';
    if (selectedPort) {
      ui.selectedPort.textContent = `Selected Port: ${formatPortLabel(selectedPort)}`;
    } else {
      const lastPortLabel = getLastPortLabel();
      ui.selectedPort.textContent = `Selected Port: ${lastPortLabel ?? 'None selected'}`;
    }
  }

  async function openChosenPort(port: SerialPort): Promise<void> {
    const portLabel = formatPortLabel(port);
    ui.selectedPort.textContent = `Selected Port: ${portLabel}`;
    saveLastPortLabel(portLabel);
    saveSerialPrefs();

    ui.connectionBadge.textContent = 'Connecting…';
    ui.connectionBadge.className = 'badge badge-connecting';
    setConnectionStatePill('connecting');
    ui.btnConnect.disabled = true;

    await serial.openPort(port, {
      baudRate: parseInt(ui.baudRate.value, 10),
      dataBits: parseInt(ui.dataBits.value, 10) as 7 | 8,
      parity: ui.parity.value as ParityType,
      stopBits: parseInt(ui.stopBits.value, 10) as 1 | 2,
      flowControl: ui.flowControl.value as FlowControlType,
    });
  }

  async function tryAutoReconnectAuthorizedPort(): Promise<void> {
    const preferredPort = getPreferredAuthorizedPort();
    if (!preferredPort || serial.isConnected) return;

    term.writeSystem('Attempting to reconnect to previously authorized serial port…');
    try {
      await openChosenPort(preferredPort);
    } catch (err) {
      setConnectedState(false);
      term.writeError(`Auto-reconnect failed: ${err instanceof Error ? err.message : String(err)}`);
      void refreshAuthorizedPortsCache();
    }
  }

  function setConnectedState(connected: boolean): void {
    ui.btnConnect.disabled = connected;
    ui.btnDisconnect.disabled = !connected;
    ui.btnClearConnection.disabled = !connected;
    ui.serialPortSelect.disabled = connected || authorizedPortsCache.length === 0;
    ui.baudRate.disabled = connected;
    ui.dataBits.disabled = connected;
    ui.parity.disabled = connected;
    ui.stopBits.disabled = connected;
    ui.flowControl.disabled = connected;
    refreshCatalogRunButtons(!connected);
    ui.btnDhcpRefresh.disabled = !connected;
    ui.btnRestartMistAgent.disabled = !connected;
    ui.btnIdentify.disabled = !connected;
    ui.btnLogin.disabled = !connected;
    ui.btnAdopt.disabled = !connected;
    // Config sync only enabled after identification succeeds
    if (!connected) {
      ui.btnConfigSyncPreview.disabled = true;
      ui.btnRootPassword.disabled = true;
      ui.btnOfflineTimeline.disabled = true;
      clearCatalog();
      deviceContext.clear();
      cloudStatus.reset();
      // If the serial connection drops while a candidate is staged, the switch
      // will exit config mode on its own — reset our staged state to match.
      configSync.reset();
      updateConfigSyncUIState();
      cloudStatusLoopStarted = false;
      localIdentifyInFlight = false;
      localIdentifyPromise = null;
      loggedInBootstrapPromise = null;
      resolvedMatchedSiteName = null;
      recentConsoleTail = '';
      ui.remoteSessionEnabled.disabled = true;
      ui.remoteSessionEnabled.checked = false;
      remoteSession.tearDown();
      ui.remoteSessionPanel.classList.add('is-hidden');
      ui.remoteSessionId.value = '';
      // Reset device summary strip
      renderDeviceSummaryPlaceholder();
    } else {
      ui.remoteSessionEnabled.disabled = false;
    }

    if (connected) {
      ui.btnConnect.textContent = 'Reconnect';
      refreshAuthorizedPortSelector();
      ui.connectionBadge.textContent = 'Connected';
      ui.connectionBadge.className = 'badge badge-connected';
      setConnectionStatePill('connected');
      term.focus();
    } else {
      ui.btnConnect.textContent = authorizedPortsCache.length > 0 ? 'Connect Selected Port' : 'Choose Serial Port';
      ui.connectionBadge.textContent = 'Disconnected';
      ui.connectionBadge.className = 'badge badge-disconnected';
      setConnectionStatePill('disconnected');
      const selectedPort = getSelectedAuthorizedPort() ?? getPreferredAuthorizedPort();
      const lastPortLabel = selectedPort ? formatPortLabel(selectedPort) : getLastPortLabel();
      ui.selectedPort.textContent = `Selected Port: ${lastPortLabel ?? 'None selected'}`;
      refreshAuthorizedPortSelector();
    }
    renderConsoleTaskIndicator();
  }

  function setMistStatus(text: string, type: 'success' | 'error' | 'info' = 'info'): void {
    ui.mistApiStatus.textContent = text;
    ui.mistApiStatus.className = `status-text ${type}`;
    // Also update inline modal status so feedback is visible while the modal is open.
    ui.mistModalStatus.textContent = text;
    ui.mistModalStatus.className = `status-text mist-modal-status-area ${type}`;
  }

  function normalizeLooseId(value: string | null | undefined): string | null {
    if (!value) return null;
    const cleaned = value.trim().toLowerCase();
    return cleaned || null;
  }

  function normalizeHexId(value: string | null | undefined): string | null {
    if (!value) return null;
    const cleaned = value.toLowerCase().replace(/[^0-9a-f]/g, '');
    return cleaned || null;
  }

  function extractMistDeviceIdSuffix(deviceId: string | null | undefined): string | null {
    const normalized = normalizeHexId(deviceId);
    if (!normalized || normalized.length < 12) return null;
    return normalized.slice(-12);
  }

  function formatMacFromHex(value: string | null | undefined): string | null {
    const normalized = normalizeHexId(value);
    if (!normalized || normalized.length !== 12) return null;
    return normalized.match(/.{1,2}/g)?.join(':') ?? null;
  }

  function buildIdentityLabel(identity: {
    hostname: string | null;
    serial: string | null;
    mac: string | null;
    model: string | null;
    junosVersion: string | null;
  } | null | undefined): string {
    if (!identity) return 'the console-connected switch';
    const parts = [
      identity.hostname,
      identity.serial,
      identity.mac,
    ].filter(Boolean) as string[];
    return parts[0] ?? 'the console-connected switch';
  }

  function buildIdentityDetail(identity: {
    hostname: string | null;
    serial: string | null;
    mac: string | null;
    model: string | null;
    junosVersion: string | null;
  } | null | undefined): string {
    if (!identity) return 'Unknown console switch';
    const parts = [
      identity.hostname,
      identity.serial,
      identity.mac,
    ].filter(Boolean) as string[];
    return parts.join(' · ') || 'Unknown console switch';
  }

  function getMistLaunchExpectedLabel(): string {
    if (!extensionLaunchContext) return 'the Mist-launched switch';
    return extensionLaunchContext.deviceName
      ?? extensionLaunchContext.deviceSerial
      ?? extensionLaunchContext.deviceMac
      ?? extensionLaunchContext.deviceId
      ?? 'the Mist-launched switch';
  }

  function buildMistLaunchExpectedDetail(): string {
    if (!extensionLaunchContext) return 'Unknown Mist switch';
    const macFromDeviceId = formatMacFromHex(extractMistDeviceIdSuffix(extensionLaunchContext.deviceId));
    const parts = [
      extensionLaunchContext.deviceName,
      extensionLaunchContext.deviceSerial,
      extensionLaunchContext.deviceMac ?? macFromDeviceId,
    ].filter(Boolean) as string[];
    return parts.join(' · ') || 'Unknown Mist switch';
  }

  function buildMistLaunchSummaryText(): string {
    if (!extensionLaunchContext) {
      return 'Configure your Mist Cloud credentials to enable cloud-managed diagnostics and automated onboarding features.';
    }

    const cloudName = getCloudById(ui.mistCloud.value)?.name ?? extensionLaunchContext.cloudHost ?? 'Mist';
    const launchDetail = buildMistLaunchExpectedDetail();
    if (launchDetail !== 'Unknown Mist switch') {
      return `This session was launched from Mist for ${launchDetail} on ${cloudName}. Manual API token setup is optional fallback only.`;
    }
    return `This session was launched from Mist on ${cloudName}. Manual API token setup is optional fallback only.`;
  }

  function setElementVisibility(element: HTMLElement | null, visible: boolean): void {
    if (!element) return;
    element.hidden = !visible;
    element.style.display = visible ? '' : 'none';
    element.setAttribute('aria-hidden', visible ? 'false' : 'true');
  }

  function setMistLaunchButtonVisibility(forceMode?: boolean): void {
    const inMistLaunchMode = forceMode ?? !!extensionLaunchContext;
    document.body.classList.toggle('mist-launch-mode', inMistLaunchMode);

    setElementVisibility(ui.btnIdentify, !inMistLaunchMode);
    setElementVisibility(ui.btnRootPassword, !inMistLaunchMode);
    setElementVisibility(ui.btnIdentify.closest('.sidebar-actions') as HTMLElement | null, !inMistLaunchMode);
    setElementVisibility(ui.btnRootPassword.closest('.sidebar-actions') as HTMLElement | null, !inMistLaunchMode);

    if (ui.btnSessionIdentify) {
      setElementVisibility(ui.btnSessionIdentify, !inMistLaunchMode);
    }
    if (ui.btnSessionRootPassword) {
      setElementVisibility(ui.btnSessionRootPassword, !inMistLaunchMode);
    }
  }

  function getMistLaunchVerification(): {
    active: boolean;
    state: MistLaunchVerificationState;
    detail: string;
    why: string;
    unlocksWorkflow: boolean;
  } {
    const decision = evaluateMistLaunchVerification({
      launchContext: extensionLaunchContext,
      serialConnected: serial.isConnected,
      identity: deviceContext.matchResult?.identity ?? deviceContext.localIdentity ?? null,
      matchedMistDeviceId: deviceContext.matchResult?.mistDevice?.id ?? null,
    });

    if (!extensionLaunchContext) {
      return {
        active: false,
        state: 'inactive',
        detail: 'Open Junos Console from a Mist switch page to verify the console session against that launched switch.',
        why: 'Mist launch verification is not active for this session.',
        unlocksWorkflow: true,
      };
    }

    const expectedLabel = getMistLaunchExpectedLabel();
    const identity = deviceContext.matchResult?.identity ?? deviceContext.localIdentity ?? null;

    if (decision.reason === 'not_connected') {
      return {
        active: true,
        state: 'waiting',
        detail: `Launched from Mist for ${expectedLabel}. Connect the serial session and log in to begin verification.`,
        why: 'Checks, actions, config sync, and adoption stay locked until the console-connected switch is verified.',
        unlocksWorkflow: false,
      };
    }

    if (decision.reason === 'identity_missing') {
      return {
        active: true,
        state: 'waiting',
        detail: `Launched from Mist for ${expectedLabel}. Waiting to observe the console-connected switch identity.`,
        why: 'Checks, actions, config sync, and adoption stay locked until the console-connected switch is verified.',
        unlocksWorkflow: false,
      };
    }

    if (decision.reason === 'mist_device_id_mismatch') {
      return {
        active: true,
        state: 'mismatch',
        detail: `${buildIdentityLabel(identity)} does not match the switch launched from Mist (${expectedLabel}).`,
        why: 'Disconnect and move the console cable to the Mist-launched switch before running checks or actions.',
        unlocksWorkflow: false,
      };
    }

    if (decision.reason === 'identity_mismatch') {
      return {
        active: true,
        state: 'mismatch',
        detail: `${buildIdentityLabel(identity)} does not match the switch launched from Mist (${expectedLabel}).`,
        why: `Verification failed on ${decision.mismatchField}. Disconnect and move the console cable to the Mist-launched switch before continuing.`,
        unlocksWorkflow: false,
      };
    }

    if (decision.reason === 'mist_device_id_match') {
      return {
        active: true,
        state: 'matched',
        detail: `Matched ${expectedLabel}. The identified console session maps to the same Mist switch.`,
        why: 'Mist launch verification succeeded, so troubleshooting workflows are now available.',
        unlocksWorkflow: true,
      };
    }

    if (decision.reason === 'identity_match') {
      return {
        active: true,
        state: 'matched',
        detail: `Matched ${expectedLabel}. The console-connected switch aligns with the Mist launch context.`,
        why: 'Mist launch verification succeeded, so troubleshooting workflows are now available.',
        unlocksWorkflow: true,
      };
    }

    return {
      active: true,
      state: 'waiting',
      detail: `Launched from Mist for ${expectedLabel}. Waiting to complete automatic verification against the Mist launch context.`,
      why: 'This workflow remains locked until the app can compare the console identity to the Mist launch context.',
      unlocksWorkflow: false,
    };
  }

  function getMistLaunchBlockedReason(): string | null {
    const verification = getMistLaunchVerification();
    if (!verification.active || verification.unlocksWorkflow) return null;
    if (verification.state === 'mismatch') {
      return 'The console-connected switch does not match the switch launched from Mist.';
    }
    return 'Identify and verify the console-connected switch against the Mist launch context first.';
  }

  function isMistLaunchWorkflowUnlocked(): boolean {
    return getMistLaunchVerification().unlocksWorkflow;
  }

  function renderMistLaunchVerification(): void {
    if (!ui.mistLaunchCard || !ui.mistLaunchPill || !ui.mistLaunchDetail || !ui.mistLaunchWhy) {
      return;
    }

    const verification = getMistLaunchVerification();
    if (!verification.active) {
      ui.mistLaunchCard.classList.add('is-hidden');
      setCloudStatusPill(ui.mistLaunchPill, 'Not active', 'unknown');
      ui.mistLaunchDetail.textContent = verification.detail;
      ui.mistLaunchWhy.textContent = verification.why;
      return;
    }

    ui.mistLaunchCard.classList.remove('is-hidden');
    if (verification.state === 'matched') {
      setCloudStatusPill(ui.mistLaunchPill, 'Matched', 'pass');
    } else if (verification.state === 'mismatch') {
      setCloudStatusPill(ui.mistLaunchPill, 'Mismatch', 'fail');
    } else {
      setCloudStatusPill(ui.mistLaunchPill, 'Waiting for match', 'warn');
    }
    if (verification.state === 'mismatch' || verification.state === 'matched') {
      const identity = deviceContext.matchResult?.identity ?? deviceContext.localIdentity ?? null;
      ui.mistLaunchDetail.innerHTML = `
        <span class="mist-launch-compare-label">Console switch:</span> ${escapeHtml(buildIdentityDetail(identity))}<br>
        <span class="mist-launch-compare-label">Mist launch:</span> ${escapeHtml(buildMistLaunchExpectedDetail())}
      `;
    } else {
      ui.mistLaunchDetail.textContent = verification.detail;
    }
    ui.mistLaunchWhy.textContent = verification.why;
  }

  function applyMistLaunchWorkflowGates(): void {
    renderMistLaunchVerification();
    const workflowUnlocked = isMistLaunchWorkflowUnlocked();
    const blockedReason = getMistLaunchBlockedReason();
    const staged = configSync.hasStagedCandidate();
    const effectiveTarget = getEffectiveMistTarget();
    const hasSite = !!effectiveTarget.siteId;
    const hasDevice = hasSite && !!effectiveTarget.deviceId;

    const gatedButtons = [
      ui.btnDhcpRefresh,
      ui.btnRestartMistAgent,
      ui.btnConfigSyncPreview,
      ui.btnOfflineTimeline,
      ui.btnAdopt,
      ui.btnCommitSync,
    ];

    if (workflowUnlocked) {
      gatedButtons.forEach((button) => {
        button.removeAttribute('title');
      });
      ui.btnDhcpRefresh.disabled = !serial.isConnected || staged;
      ui.btnRestartMistAgent.disabled = !serial.isConnected || staged;
      ui.btnConfigSyncPreview.disabled = staged || !hasDevice;
      ui.btnOfflineTimeline.disabled = staged || !hasSite;
      ui.btnAdopt.disabled = staged || !serial.isConnected;
      ui.btnCommitSync.disabled = !staged || !configSync.sessionInfo?.canCommit;
      refreshCatalogRunButtons(staged || !serial.isConnected);
      return;
    }

    refreshCatalogRunButtons(true);
    gatedButtons.forEach((button) => {
      button.disabled = true;
      if (blockedReason) {
        button.title = blockedReason;
      }
    });
  }

  function getSelectedOrgName(): string | null {
    const state = mistContext.state;
    if (!state.orgId) return null;
    return state.orgs.find((org) => org.id === state.orgId)?.name ?? null;
  }

  function getSelectedSiteName(): string | null {
    if (extensionLaunchContext?.siteName) return extensionLaunchContext.siteName;
    const matchedSiteName = deviceContext.matchResult?.mistSiteName ?? resolvedMatchedSiteName ?? null;
    if (matchedSiteName) return matchedSiteName;

    const state = mistContext.state;
    const siteId = deviceContext.matchResult?.mistDevice?.site_id ?? state.siteId ?? null;
    if (!siteId) return null;
    return state.sites.find((site) => site.id === siteId)?.name ?? null;
  }

  function getEffectiveMistTarget(): { siteId: string | null; deviceId: string | null; orgId: string | null } {
    return {
      siteId: deviceContext.matchResult?.mistDevice?.site_id ?? extensionLaunchContext?.siteId ?? mistContext.state.siteId ?? null,
      deviceId: deviceContext.matchResult?.mistDevice?.id ?? extensionLaunchContext?.deviceId ?? null,
      orgId: deviceContext.matchResult?.mistDevice?.org_id ?? extensionLaunchContext?.orgId ?? mistContext.state.orgId ?? null,
    };
  }

  function applyExtensionLaunchContext(context: ExtensionLaunchContext | null): void {
    extensionLaunchContext = context;
    mistApi.setLaunchOverlay(context);
    setMistLaunchButtonVisibility();

    if (context) {
      sessionStorage.setItem(EXTENSION_LAUNCH_CONTEXT_STORAGE_KEY, JSON.stringify(context));
    } else {
      sessionStorage.removeItem(EXTENSION_LAUNCH_CONTEXT_STORAGE_KEY);
    }

    if (!context) return;

    if (context.apiHost) {
      const matchedCloud = MIST_CLOUDS.find((cloud) => cloud.apiHost === context.apiHost);
      if (matchedCloud) {
        ui.mistCloud.value = matchedCloud.id;
        saveSelectedMistCloud();
      }
    }

    const parts = [
      context.apiHost ? (MIST_CLOUDS.find((cloud) => cloud.apiHost === context.apiHost)?.name ?? context.apiHost) : null,
      context.deviceName ?? null,
      context.deviceSerial ?? null,
      context.deviceMac ?? null,
    ].filter(Boolean);
    if (parts.length > 0) {
      term.writeSystem(`Mist launch context imported: ${parts.join(' / ').replace(' / ', ' / ')}`);
    }

    renderMistLaunchVerification();
    renderJmaRecommendation(latestJmaCode);
    updateConfigSyncUIState();
    applyMistLaunchWorkflowGates();
    scheduleAgentContextPush();
  }

  async function consumeLaunchContextFromUrl(): Promise<void> {
    const url = new URL(window.location.href);
    let payload: ExtensionLaunchContext | null = null;
    let storedPayload: ExtensionLaunchContext | null = null;

    const launchToken = url.searchParams.get('mistLaunchToken');
    const rawContext = url.searchParams.get('mistContext');

    const storedContext = sessionStorage.getItem(EXTENSION_LAUNCH_CONTEXT_STORAGE_KEY);
    if (storedContext) {
      try {
        storedPayload = JSON.parse(storedContext) as ExtensionLaunchContext;
      } catch {
        sessionStorage.removeItem(EXTENSION_LAUNCH_CONTEXT_STORAGE_KEY);
      }
    }

    if (storedPayload) {
      applyExtensionLaunchContext(storedPayload);
    } else if (launchToken || rawContext) {
      // Secure launch tokens are resolved asynchronously. Hide the manual
      // identify/root-password controls immediately so Mist-launch sessions do
      // not briefly expose fallback actions during startup.
      setMistLaunchButtonVisibility(true);
    }

    if (launchToken) {
      try {
        const response = await fetch(`http://127.0.0.1:3333/extension-launch/${encodeURIComponent(launchToken)}`);
        if (response.ok) {
          payload = await response.json() as ExtensionLaunchContext;
        }
      } catch {
        // Fall through to any raw mistContext if present.
      }
      url.searchParams.delete('mistLaunchToken');
    }

    if (!payload && rawContext) {
      try {
        payload = JSON.parse(rawContext) as ExtensionLaunchContext;
      } catch {
        payload = null;
      }
      url.searchParams.delete('mistContext');
    }

    if (!payload) {
      payload = storedPayload;
    }

    if (payload) {
      applyExtensionLaunchContext(payload);
    }

    setMistLaunchButtonVisibility();

    const cleanedUrl = `${url.pathname}${url.search}${url.hash}`;
    window.history.replaceState({}, document.title, cleanedUrl);
  }

  function getDeviceSummaryLoadingMessage(): string | null {
    if (localIdentifyInFlight) {
      return 'Reading switch identity from the live console…';
    }
    if (identifyInFlight && mistContext.isConfigured) {
      return 'Matching the switch in Mist and refreshing cloud status…';
    }
    if (identifyInFlight) {
      return 'Refreshing switch identity…';
    }
    if (cloudStatusRefreshInFlight) {
      return 'Refreshing live cloud status…';
    }
    return null;
  }

  function buildDeviceSummaryLoadingMarkup(): string {
    const message = getDeviceSummaryLoadingMessage();
    if (!message) return '';
    // Inline: spinner + short status text, rendered as a chip-like element
    return `<span class="device-summary-loading-inline" role="status" aria-live="polite"><span class="device-summary-spinner" aria-hidden="true"></span><span class="device-summary-loading-text">${message}</span></span>`;
  }

  function renderDeviceSummaryPlaceholder(): void {
    const loadingMarkup = buildDeviceSummaryLoadingMarkup();
    const placeholder = serial.isConnected
      ? 'Connected — click Identify Switch to read device details.'
      : 'Log in to identify the switch.';
    ui.deviceSummary.innerHTML = loadingMarkup
      ? loadingMarkup
      : `<span class="device-summary-placeholder">${placeholder}</span>`;
    ui.deviceSummary.classList.add('device-summary-empty');
  }

  /**
   * Render the session bar device summary as inline chips.
   * Called when background identify completes.
   */
  function renderDeviceSummary(identity: { hostname: string | null; serial: string | null; mac: string | null; model: string | null; junosVersion: string | null }): void {
    const values = [
      identity.hostname,
      identity.model,
      identity.serial,
      identity.junosVersion,
      getSelectedSiteName(),
    ].filter(Boolean) as string[];

    if (values.length === 0) {
      renderDeviceSummaryPlaceholder();
      return;
    }

    const summaryLine = `<span class="device-summary-line">${values.map((v) => escapeHtml(v)).join(' · ')}</span>`;
    const sep = '<span class="device-summary-sep" aria-hidden="true">·</span>';
    const loading = buildDeviceSummaryLoadingMarkup();
    ui.deviceSummary.innerHTML = loading
      ? `${summaryLine}${sep}${loading}`
      : summaryLine;
    ui.deviceSummary.classList.remove('device-summary-empty');
  }

  async function ensureMatchedSiteName(siteId: string, identity: { hostname: string | null; serial: string | null; mac: string | null; model: string | null; junosVersion: string | null }): Promise<void> {
    try {
      const site = await mistApi.getSite(siteId);
      if (!site.name) return;
      resolvedMatchedSiteName = site.name;
      renderDeviceSummary(identity);
    } catch {
      // Keep the current summary if the direct site lookup fails.
    }
  }

  /**
   * Silently gather local device identity in the background after a CLI prompt is detected.
   * Does nothing if identity is already known or a gather is already in flight.
   */
  function backgroundIdentify(): Promise<void> {
    if (localIdentifyInFlight) return localIdentifyPromise ?? Promise.resolve();
    if (deviceContext.localIdentity !== null) return Promise.resolve();
    localIdentifyInFlight = true;
    renderJmaRecommendation(latestJmaCode);
    refreshCatalogRunButtons(false);
    const identity = deviceContext.matchResult?.identity ?? deviceContext.localIdentity;
    if (identity) {
      renderDeviceSummary(identity);
    } else {
      renderDeviceSummaryPlaceholder();
    }
    localIdentifyPromise = (async () => {
      await waitForConsoleIdle();
      if (!canRunBackgroundConsoleTask()) return;
      await withConsoleTask('background-identify', 'background', 'background identify', async () => {
        await deviceContext.runLocalIdentify();
      });
    })().finally(() => {
      localIdentifyInFlight = false;
      renderJmaRecommendation(latestJmaCode);
      refreshCatalogRunButtons(false);
      localIdentifyPromise = null;
      if (mistContext.isConfigured) {
        maybeAutoMatchAfterMistSave();
      }
      const latestIdentity = deviceContext.matchResult?.identity ?? deviceContext.localIdentity;
      if (latestIdentity) {
        renderDeviceSummary(latestIdentity);
      } else {
        renderDeviceSummaryPlaceholder();
      }
    });
    return localIdentifyPromise;
  }

  async function ensureLoggedInBootstrap(): Promise<void> {
    if (loggedInBootstrapPromise) {
      await loggedInBootstrapPromise;
      return;
    }

    loggedInBootstrapPromise = (async () => {
      renderJmaRecommendation(latestJmaCode);
      refreshCatalogRunButtons(false);
      if (!cloudStatusLoopStarted) {
        await startLoggedInCloudStatusLoop();
      }
      await backgroundIdentify();
    })().finally(() => {
      loggedInBootstrapPromise = null;
      renderJmaRecommendation(latestJmaCode);
      refreshCatalogRunButtons(false);
    });

    await loggedInBootstrapPromise;
  }

  function maybeAutoMatchAfterMistSave(): void {
    if (!serial.isConnected) return;
    if (localIdentifyInFlight) return;
    if (deviceContext.localIdentity === null) return;
    if (deviceContext.matchResult !== null) return;
    if (identifyInFlight) return;
    void waitForConsoleIdle()
      .then(() => {
        if (!serial.isConnected) return;
        if (configSync.hasStagedCandidate()) return;
        if (identifyInFlight) return;
        if (getBlockingConsoleTask('background-auto-match')) return;
        return withConsoleTask('background-auto-match', 'background', 'background Mist match', async () => {
          await deviceContext.runIdentify({ silent: true });
          await cloudStatus.refresh(deviceContext.matchResult, serial.isConnected);
        });
      })
      .catch(() => {});
  }

  async function refreshMistStatusAfterMistSave(): Promise<void> {
    if (!serial.isConnected) return;
    if (localIdentifyInFlight || identifyInFlight) {
      maybeAutoMatchAfterMistSave();
      return;
    }

    await waitForConsoleIdle();
    if (!serial.isConnected || configSync.hasStagedCandidate()) {
      maybeAutoMatchAfterMistSave();
      return;
    }
    if (getBlockingConsoleTask('mist-save-identify-refresh')) {
      maybeAutoMatchAfterMistSave();
      return;
    }

    const refreshed = await withConsoleTask(
      'mist-save-identify-refresh',
      'background',
      'Mist status refresh',
      async () => {
        await deviceContext.runIdentify({ silent: true });
        await cloudStatus.refresh(deviceContext.matchResult, serial.isConnected);
        return true;
      },
    );

    if (!refreshed) {
      maybeAutoMatchAfterMistSave();
    }
  }

  function msSinceLastUserConsoleInput(): number {
    if (!lastUserConsoleInputAt) return Number.POSITIVE_INFINITY;
    return Date.now() - lastUserConsoleInputAt;
  }

  function isConsoleIdle(minIdleMs = BACKGROUND_CONSOLE_IDLE_MS): boolean {
    return msSinceLastUserConsoleInput() >= minIdleMs;
  }

  function classifyPromptMode(output: string): 'operational' | 'config' | 'shell' | 'login' | 'password' | 'unknown' {
    return detectPromptMode(output);
  }

  function getRecentPromptMode(): 'operational' | 'config' | 'shell' | 'login' | 'password' | 'unknown' {
    return classifyPromptMode(recentConsoleTail);
  }

  function isOperationalPromptVisible(): boolean {
    return getRecentPromptMode() === 'operational';
  }

  const SUPPRESSED_CONSOLE_LINE =
    'Approaching the limit on PV entries, consider increasing either the vm.pmap.shpgperproc or the vm.pmap.pv_entries tunable.';
  const SUPPRESSED_CONSOLE_LINE_START = 'Approaching the limit on PV entries';
  const SUPPRESSED_CONSOLE_LINE_END = 'tunable.';

  function longestSuppressedPrefixSuffix(text: string): string {
    const maxLen = Math.min(text.length, SUPPRESSED_CONSOLE_LINE_START.length - 1);
    for (let len = maxLen; len > 0; len -= 1) {
      if (SUPPRESSED_CONSOLE_LINE_START.startsWith(text.slice(-len))) {
        return text.slice(-len);
      }
    }
    return '';
  }

  function filterSuppressedConsoleNoise(text: string): string {
    const normalized = text.replace(/\r/g, '');
    const combined = suppressedConsoleLineBuffer + normalized;
    suppressedConsoleLineBuffer = '';

    let output = '';
    let cursor = 0;

    while (cursor < combined.length) {
      if (suppressingPvWarning) {
        const endIdx = combined.indexOf(SUPPRESSED_CONSOLE_LINE_END, cursor);
        if (endIdx === -1) {
          return output;
        }
        cursor = endIdx + SUPPRESSED_CONSOLE_LINE_END.length;
        suppressingPvWarning = false;
        continue;
      }

      const fullLineIdx = combined.indexOf(SUPPRESSED_CONSOLE_LINE, cursor);
      const startIdx = combined.indexOf(SUPPRESSED_CONSOLE_LINE_START, cursor);
      const matchIdx = fullLineIdx === -1
        ? startIdx
        : (startIdx === -1 ? fullLineIdx : Math.min(fullLineIdx, startIdx));

      if (matchIdx === -1) {
        const remainder = combined.slice(cursor);
        const partial = longestSuppressedPrefixSuffix(remainder);
        if (partial) {
          output += remainder.slice(0, -partial.length);
          suppressedConsoleLineBuffer = partial;
        } else {
          output += remainder;
        }
        return output;
      }

      output += combined.slice(cursor, matchIdx);
      cursor = matchIdx;
      suppressingPvWarning = true;
    }

    return output;
  }

  function canRunBackgroundConsoleTask(): boolean {
    if (!serial.isConnected || configSync.hasStagedCandidate()) return false;
    if (!isConsoleIdle()) return false;
    if (getBlockingConsoleTask('background-task')) return false;
    return isOperationalPromptVisible();
  }

  async function waitForConsoleIdle(minIdleMs = BACKGROUND_CONSOLE_IDLE_MS, maxWaitMs = 15000): Promise<void> {
    const startedAt = Date.now();
    while (!isConsoleIdle(minIdleMs)) {
      if (Date.now() - startedAt >= maxWaitMs) return;
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }

  function formatUtcDisplay(iso: string | null): string | null {
    if (!iso) return null;
    return `${iso.replace('T', ' ').substring(0, 19)} UTC`;
  }

  function formatBrowserLocalDisplay(iso: string | null): string | null {
    if (!iso) return null;
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return formatUtcDisplay(iso);

    const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const formatted = new Intl.DateTimeFormat(undefined, {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
      timeZoneName: 'short',
    }).format(date);

    return timezone ? `${formatted} (${timezone})` : formatted;
  }

  function setCloudStatusPill(
    el: HTMLElement,
    label: string,
    state: 'connected' | 'disconnected' | 'degraded' | 'unknown' | 'pass' | 'warn' | 'fail' | 'info',
  ): void {
    el.textContent = label;
    el.className = `cloud-status-pill state-${state}`;
  }

  function getMistMonitorWhy(status: CloudStatusState['mist']): string {
    switch (status.pillState) {
      case 'connected':
        return 'Mist inventory and recent cloud telemetry agree that the switch is online.';
      case 'disconnected':
        return 'Mist stopped hearing from the switch, so cloud-side reachability is currently broken.';
      default:
        return 'Mist evidence is incomplete until the switch is matched and recent cloud data is available.';
    }
  }

  function getJmaMonitorWhy(status: CloudStatusState['jma']): string {
    if (status.code === 106) {
      return 'DNS is configured, but hostname lookups are failing before cloud recovery can happen.';
    }
    if (status.code === 108) {
      return 'Routing may exist, but the switch still cannot establish usable cloud connectivity.';
    }
    if (status.severity === 'pass') {
      return 'The switch itself believes cloud connectivity is healthy.';
    }
    if (status.severity === 'warn') {
      return 'The switch is reporting a degraded state that usually needs targeted investigation.';
    }
    if (status.severity === 'fail') {
      return 'The switch is reporting a hard cloud-connectivity failure from its own local perspective.';
    }
    return 'The switch has not yet reported enough state to explain the current cloud condition.';
  }

  function renderCloudStatus(state: CloudStatusState): void {
    if (extensionLaunchContext && !isMistLaunchWorkflowUnlocked()) {
      latestJmaCode = null;
      setCloudStatusPill(ui.mistMonitorPill, 'Unknown', 'unknown');
      setCloudStatusPill(ui.jmaMonitorPill, 'Unknown', 'unknown');
      ui.mistMonitorDetail.textContent = 'Identify and match the switch in Mist to enable Mist status monitoring.';
      ui.jmaMonitorDetail.textContent = 'Identify and verify the console-connected switch before trusting switch-reported cloud status.';
      if (ui.mistMonitorWhy) ui.mistMonitorWhy.textContent = 'Mist status is intentionally hidden until the console-connected switch is verified against the Mist launch context.';
      if (ui.jmaMonitorWhy) ui.jmaMonitorWhy.textContent = 'Switch cloud state is intentionally hidden until the console-connected switch is verified against the Mist launch context.';
      ui.cloudStatusLastUpdated.textContent = 'Waiting for verification';
      renderJmaRecommendation(null);
      renderMistLaunchVerification();
      applyMistLaunchWorkflowGates();
      return;
    }

    if (!state.matchResult && !state.lastUpdatedUtcIso) {
      latestJmaCode = null;
      setCloudStatusPill(ui.mistMonitorPill, 'Unknown', 'unknown');
      setCloudStatusPill(ui.jmaMonitorPill, 'Unknown', 'unknown');
      ui.mistMonitorDetail.textContent = 'Identify and match the switch in Mist to enable Mist status monitoring.';
      ui.jmaMonitorDetail.textContent = 'Log in or detect a Junos CLI prompt to start the switch-reported cloud status monitor.';
      if (ui.mistMonitorWhy) ui.mistMonitorWhy.textContent = 'Mist evidence is incomplete until the switch is matched and recent cloud data is available.';
      if (ui.jmaMonitorWhy) ui.jmaMonitorWhy.textContent = 'The switch has not yet reported enough state to explain the current cloud condition.';
      ui.cloudStatusLastUpdated.textContent = 'Not yet checked';
      renderJmaRecommendation(null);
      renderMistLaunchVerification();
      applyMistLaunchWorkflowGates();
      return;
    }

    setCloudStatusPill(ui.mistMonitorPill, state.mist.label, state.mist.pillState);
    setCloudStatusPill(ui.jmaMonitorPill, state.jma.label, state.jma.severity);
    latestJmaCode = state.jma.code;

    const mistParts = [state.mist.detail];
    const lastSeen = formatBrowserLocalDisplay(state.mist.lastSeenUtcIso);
    const lastConfig = formatBrowserLocalDisplay(state.mist.lastConfigUtcIso);
    if (lastSeen) mistParts.push(`Last seen: ${lastSeen}`);
    if (lastConfig) mistParts.push(`Last config: ${lastConfig}`);
    ui.mistMonitorDetail.textContent = mistParts.join(' · ');
    if (ui.mistMonitorWhy) ui.mistMonitorWhy.textContent = getMistMonitorWhy(state.mist);

    const jmaParts = [state.jma.detail];
    if (state.jma.message) jmaParts.push(`Message: ${state.jma.message}`);
    if (state.jma.errno != null) jmaParts.push(`Errno: ${state.jma.errno}`);
    ui.jmaMonitorDetail.textContent = jmaParts.join(' · ');
    if (ui.jmaMonitorWhy) ui.jmaMonitorWhy.textContent = getJmaMonitorWhy(state.jma);
    renderJmaRecommendation(state.jma.code);
    applyMistLaunchWorkflowGates();

    ui.cloudStatusLastUpdated.textContent = state.lastUpdatedUtcIso
      ? `Refreshed ${formatBrowserLocalDisplay(state.lastUpdatedUtcIso)}`
      : 'Not yet checked';
  }

  function workflowRecommendationLabel(kind: 'full' | 'targeted_then_full' | 'targeted' | 'optional' | 'skip'): string {
    switch (kind) {
      case 'full':
        return 'Run full workflow';
      case 'targeted_then_full':
        return 'Targeted, then full if needed';
      case 'targeted':
        return 'Targeted checks first';
      case 'optional':
        return 'Targeted checks usually enough';
      case 'skip':
        return 'No workflow usually needed';
      default:
        return 'Targeted guidance';
    }
  }

  function getBlockingConsoleTask(ownerId?: string): { kind: ConsoleTaskKind; label: string } | null {
    return consoleTaskGate.getBlockingTask(ownerId);
  }

  function renderConsoleTaskIndicator(): void {
    const blocking = getBlockingConsoleTask();
    if (!blocking) {
      ui.consoleTaskIndicator.textContent = '';
      ui.consoleTaskIndicator.className = 'console-task-indicator is-hidden';
      ui.consoleTaskIndicator.removeAttribute('title');
      return;
    }

    const prefix = blocking.kind === 'exclusive'
      ? 'Console locked'
      : blocking.kind === 'user'
        ? 'Console busy'
        : 'Background task';
    const text = `${prefix}: ${blocking.label}`;
    ui.consoleTaskIndicator.textContent = text;
    ui.consoleTaskIndicator.title = text;
    ui.consoleTaskIndicator.className = `console-task-indicator kind-${blocking.kind}`;
  }

  function tryAcquireConsoleTask(ownerId: string, kind: ConsoleTaskKind, label: string): boolean {
    return consoleTaskGate.tryAcquire(ownerId, kind, label);
  }

  function releaseConsoleTask(ownerId: string): void {
    consoleTaskGate.release(ownerId);
  }

  function onConsoleTaskOwnershipChanged(): void {
    renderConsoleTaskIndicator();
    renderJmaRecommendation(latestJmaCode);
    refreshCatalogRunButtons(false);
  }

  async function withConsoleTask<T>(
    ownerId: string,
    kind: ConsoleTaskKind,
    label: string,
    fn: () => Promise<T>,
  ): Promise<T | undefined> {
    if (!tryAcquireConsoleTask(ownerId, kind, label)) return undefined;
    onConsoleTaskOwnershipChanged();
    try {
      return await fn();
    } finally {
      releaseConsoleTask(ownerId);
      onConsoleTaskOwnershipChanged();
    }
  }

  function ensureConsoleTaskAvailable(actionLabel: string, ownerId: string): boolean {
    const blocking = getBlockingConsoleTask(ownerId);
    if (!blocking) return true;
    term.writeError(`${actionLabel} is unavailable while ${blocking.label} is using the console.`);
    refreshCatalogRunButtons(false);
    return false;
  }

  function isConsoleBackgroundWorkInFlight(): boolean {
    return localIdentifyInFlight
      || identifyInFlight
      || cloudStatusRefreshInFlight
      || Boolean(loggedInBootstrapPromise)
      || consoleTaskGate.getOwnerKind() === 'background';
  }

  function jmaSupportsMistAgentRestart(code: number | null): boolean {
    return code === 109 || code === 110 || code === 112;
  }

  function canRunMistAgentRestart(): boolean {
    return serial.isConnected && !Boolean(getBlockingConsoleTask('mist-agent-restart'));
  }

  function renderJmaRecommendation(code: number | null): void {
    const recommendation = getJmaRecommendation(code);
    if (!recommendation) {
      ui.jmaRecommendation.innerHTML = '';
      ui.jmaRecommendation.classList.add('jma-recommendation-hidden');
      return;
    }

    const buttonLabel = recommendation.workflowRecommendation === 'skip'
      ? 'Run Checks Anyway'
      : 'Run Recommended Checks';
    const buttonDisabled = !serial.isConnected || Boolean(getBlockingConsoleTask('jma-recommended-checks'));
    const showRestartMistAgent = jmaSupportsMistAgentRestart(code);
    const restartButtonDisabled = !canRunMistAgentRestart();

    ui.jmaRecommendation.className = `jma-recommendation-card severity-${recommendation.severity}`;
    ui.jmaRecommendation.innerHTML = `
      <div class="jma-recommendation-header">
        <div>
          <div class="jma-recommendation-eyebrow">Cloud Connectivity Guidance</div>
          <div class="jma-recommendation-title">${escapeHtml(recommendation.title)}</div>
        </div>
        <span class="jma-recommendation-workflow">${escapeHtml(workflowRecommendationLabel(recommendation.workflowRecommendation))}</span>
      </div>
      <div class="jma-recommendation-sections">
        <div class="jma-recommendation-section">
          <div class="jma-recommendation-section-title">What this state means</div>
          <div class="jma-recommendation-copy">${escapeHtml(recommendation.summary)}</div>
        </div>
        <div class="jma-recommendation-section">
          <div class="jma-recommendation-section-title">Why it matters</div>
          <div class="jma-recommendation-copy">${escapeHtml(recommendation.implication)}</div>
        </div>
        <div class="jma-recommendation-section">
          <div class="jma-recommendation-section-title">Recommended next steps</div>
          <div class="jma-recommendation-copy">${escapeHtml(recommendation.workflowNote)}</div>
          <div class="jma-recommendation-subtitle">${recommendation.workflowRecommendation === 'skip' ? 'Optional checks if symptoms persist' : 'Recommended first checks'}</div>
          <ul class="jma-recommendation-list">
            ${recommendation.checks
              .map(
                (check) => `
                  <li>
                    <strong>${escapeHtml(check.label)}</strong>
                    <span>${escapeHtml(check.why)}</span>
                  </li>`,
              )
              .join('')}
          </ul>
          <div class="jma-recommendation-subtitle">Potential actions</div>
          <ul class="jma-recommendation-list">
            ${recommendation.remediation
              .map((step) => `<li><span>${escapeHtml(step)}</span></li>`)
              .join('')}
          </ul>
        </div>
      </div>
      <div class="jma-recommendation-actions">
        <button
          type="button"
          class="btn ${recommendation.workflowRecommendation === 'skip' ? 'btn-secondary' : 'btn-primary'} btn-sm"
          data-action="run-recommended-checks"
          ${buttonDisabled ? 'disabled' : ''}
        >
          ${escapeHtml(buttonLabel)}
        </button>
        ${showRestartMistAgent ? `
          <button
            type="button"
            class="btn btn-secondary btn-sm"
            data-action="restart-mist-agent"
            ${restartButtonDisabled ? 'disabled' : ''}
          >
            Restart Mist Agent
          </button>
        ` : ''}
      </div>
    `;
    ui.jmaRecommendation.classList.remove('jma-recommendation-hidden');
  }

  function openAccordionSection(targetId: string): void {
    const trigger = document.querySelector<HTMLElement>(`.accordion-trigger[data-target="${targetId}"]`);
    const content = document.getElementById(`accordion-${targetId}`);
    if (!trigger || !content) return;
    trigger.classList.add('active');
    content.classList.add('open');
    setTimeout(() => term.fit(), 300);
  }

  async function withCloudStatusPollingPaused<T>(fn: () => Promise<T>): Promise<T> {
    cloudStatus.pausePolling();
    try {
      return await fn();
    } finally {
      cloudStatus.resumePolling();
    }
  }

  async function startLoggedInCloudStatusLoop(forceRestart = false): Promise<void> {
    if (forceRestart) {
      cloudStatusLoopStarted = false;
    }
    if (cloudStatusLoopStarted) return;
    await waitForConsoleIdle();
    if (!canRunBackgroundConsoleTask()) return;
    const refreshed = await withConsoleTask('cloud-status-initial-refresh', 'background', 'cloud status refresh', async () => {
      await cloudStatus.refresh(deviceContext.matchResult, serial.isConnected);
      return true;
    });
    if (!refreshed) return;
    cloudStatusLoopStarted = true;
    cloudStatus.startPolling(
      () => deviceContext.matchResult,
      () => serial.isConnected,
      () => canRunBackgroundConsoleTask(),
      30000,
    );
  }

  function maybeStartCloudStatusFromPrompt(): void {
    if (!serial.isConnected || serial.isUiDataSuppressed) return;
    const trimmed = recentConsoleTail.trimEnd();
    const cliPromptDetected = /(?:\{[^}\n]+\}\s*\n)?[\w\-@.:]+[>#]$/.test(trimmed);
    if (!cliPromptDetected) return;
    void ensureLoggedInBootstrap();
  }

  function maybeEnterCliOnInitialShellPrompt(): void {
    if (!pendingInitialShellToCli || initialShellToCliInFlight) return;
    if (!serial.isConnected || serial.isUiDataSuppressed) return;

    const mode = getRecentPromptMode();
    if (mode === 'unknown' || mode === 'password') return;

    if (mode === 'shell') {
      pendingInitialShellToCli = false;
      initialShellToCliInFlight = true;
      term.writeSystem('Detected shell prompt on connect — entering Junos CLI…');
      void withConsoleTask('initial-shell-to-cli', 'background', 'enter Junos CLI', async () => {
        const result = await cmdRunner.sendAndWaitFor('cli\n', />\s*$|#\s*$|login:/i, 5000);
        if (result.matched) {
          term.writeSystem('Entered Junos CLI.');
        } else {
          term.writeError('Could not enter Junos CLI automatically from shell prompt.');
        }
      }).finally(() => {
        initialShellToCliInFlight = false;
      });
      return;
    }

    if (mode === 'operational' || mode === 'config' || mode === 'login') {
      pendingInitialShellToCli = false;
    }
  }

  function setConnectionStatePill(state: 'connected' | 'connecting' | 'disconnected'): void {
    if (!ui.connectionStatePill) return;
    if (state === 'connected') {
      ui.connectionStatePill.textContent = 'Connected';
      ui.connectionStatePill.className = 'connection-state-pill state-connected';
      return;
    }
    if (state === 'connecting') {
      ui.connectionStatePill.textContent = 'Connecting';
      ui.connectionStatePill.className = 'connection-state-pill state-connecting';
      return;
    }
    ui.connectionStatePill.textContent = 'Disconnected';
    ui.connectionStatePill.className = 'connection-state-pill state-disconnected';
  }

  function openMistModal(): void {
    ui.mistModalOverlay.classList.remove('is-hidden');
    ui.mistModalOverlay.setAttribute('aria-hidden', 'false');
  }

  function closeMistModal(): void {
    ui.mistModalOverlay.classList.add('is-hidden');
    ui.mistModalOverlay.setAttribute('aria-hidden', 'true');
  }

  // ---- Serial events ----
  serial.on('data', (data: Uint8Array) => {
    if (!serial.isUiDataSuppressed) {
      const filteredText = filterSuppressedConsoleNoise(promptDecoder.decode(data, { stream: true }));
      if (filteredText.length === 0) return;
      term.write(filteredText);
      remoteSession.mirrorSerialRx(terminalEncoder.encode(filteredText));
      recentConsoleTail = (recentConsoleTail + filteredText).slice(-512);
      maybeEnterCliOnInitialShellPrompt();
      maybeStartCloudStatusFromPrompt();
    }
  });

  serial.on('tx', (data: Uint8Array) => {
    remoteSession.mirrorSerialTx(data);
  });

  serial.on('connect', () => {
    setConnectedState(true);
    pendingInitialShellToCli = true;
    initialShellToCliInFlight = false;
    const baudRate = ui.baudRate.value;
    const dataBits = ui.dataBits.value;
    const parity = ui.parity.value[0].toUpperCase();
    const stopBits = ui.stopBits.value;
    term.writeSystem(`— Connected (${baudRate} baud, ${dataBits}${parity}${stopBits}) —`);
    void serial.writeString('\r').catch(() => {});
    if (ui.remoteSessionEnabled.checked && !remoteSession.isActive) {
      remoteSession.startAsOperator();
    }
    scheduleAgentContextPush();
  });

  serial.on('disconnect', () => {
    effectiveCloudCache = null;
    pendingInitialShellToCli = false;
    initialShellToCliInFlight = false;
    setConnectedState(false);
    term.writeSystem('— Disconnected —');
    void refreshAuthorizedPortsCache();
    scheduleAgentContextPush();
  });

  serial.on('error', (err: Error) => {
    term.writeError(`Error: ${err.message}`);
  });

  // ---- Terminal user input → serial ----
  term.onInput = async (data: string) => {
    if (serial.isConnected) {
      lastUserConsoleInputAt = Date.now();
      try {
        await serial.writeString(data);
      } catch (err) {
        term.writeError(`Send error: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  };

  ui.remoteSessionEnabled.addEventListener('change', () => {
    if (!serial.isConnected) return;
    saveRemoteSessionEnabled(ui.remoteSessionEnabled.checked);
    if (ui.remoteSessionEnabled.checked) {
      remoteSession.startAsOperator();
    } else {
      clearAgentActionPoll();
      scheduleAgentContextPush({ enabled: false });
      remoteSession.tearDown();
      ui.remoteSessionPanel.classList.add('is-hidden');
      ui.remoteSessionId.value = '';
      term.writeSystem('— Remote session stopped —');
    }
  });

  ui.btnCopySession.addEventListener('click', async () => {
    const id = ui.remoteSessionId.value.trim();
    if (!id) return;
    try {
      await navigator.clipboard.writeText(id);
      term.writeSystem('— Session ID copied —');
    } catch {
      term.writeError('Could not copy to clipboard');
    }
  });

  // ---- Connect ----
  async function connect(): Promise<void> {
    await withCloudStatusPollingPaused(async () => {
      if (!SerialService.isSupported()) {
        term.writeError('Web Serial API is not available in this browser shell. Open the app in Chrome or Edge.');
        return;
      }

      try {
        const authorizedPort = getSelectedAuthorizedPort() ?? getPreferredAuthorizedPort();
        if (authorizedPort) {
          await openChosenPort(authorizedPort);
          return;
        }

        let port: SerialPort;
        try {
          // First await after click must be requestPort() — required for user-gesture / some embedded browsers.
          port = await navigator.serial.requestPort();
        } catch (err) {
          if (err instanceof DOMException && err.name === 'NotFoundError') {
            return;
          }
          term.writeError(`Serial picker failed: ${err instanceof Error ? err.message : String(err)}`);
          return;
        }
        await openChosenPort(port);
      } catch (err) {
        setConnectedState(false);
        term.writeError(`Connection failed: ${err instanceof Error ? err.message : String(err)}`);
      } finally {
        void refreshAuthorizedPortsCache();
      }
    });
  }

  // ---- Disconnect ----
  async function disconnect(): Promise<void> {
    await withCloudStatusPollingPaused(async () => {
      try {
        await serial.disconnect();
      } catch (err) {
        term.writeError(`Disconnect error: ${err instanceof Error ? err.message : String(err)}`);
      }
    });
  }

  // ---- Mist API: Load sites ----
  async function loadSites(): Promise<void> {
    await mistContext.loadSites(
      ui.mistApiToken.value.trim(),
      ui.mistOrg.value,
      ui.mistCloud.value,
    );
  }

  // ---- Troubleshoot: status icons ----
  function statusIcon(status: CheckStatus): string {
    switch (status) {
      case 'pass': return '✓';
      case 'fail': return '✗';
      case 'warn': return '⚠';
      case 'info': return 'ℹ';
      case 'skip': return '—';
      case 'running': return '⟳';
      case 'pending': return '○';
      default: return '?';
    }
  }

  // Accumulated check results for context-aware remediation
  let accumulatedResults: CheckResult[] = [];

  // ---- Check catalog state ----
  const catalogResults = new Map<string, CheckResult[]>();
  const catalogExpanded = new Set<string>();
  let catalogRunning = false;

  // ---- Check Catalog --------------------------------------------------------

  const CHEVRON_SVG = `<svg width="10" height="10" viewBox="0 0 10 10"><path d="M3 2l4 3-4 3" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

  function setCatalogBadgeState(badge: HTMLElement, status: string, text: string, title = ''): void {
    badge.className = status ? `check-result-badge ${status}` : 'check-result-badge';
    badge.textContent = text;
    badge.title = title;
    if (title) {
      badge.setAttribute('aria-label', title);
    } else {
      badge.removeAttribute('aria-label');
    }
  }

  function renderGuidedCheckAnalysis(card: GuidedAnalysisCard | null): void {
    const container = document.getElementById('guided-check-analysis') as HTMLElement | null;
    if (!container) return;
    if (!card) {
      container.innerHTML = '';
      container.classList.add('is-hidden');
      setLatestAgentGuidedAnalysis(null);
      return;
    }

    const findingsHtml = card.findings && card.findings.length > 0
      ? `
        <div class="guided-analysis-findings">
          ${card.findings.map((finding) => `<div class="guided-analysis-finding">${escapeHtml(finding)}</div>`).join('')}
        </div>
      `
      : '';

    const conclusionHtml = card.conclusion
      ? `
        <div class="guided-analysis-conclusion">
          <div class="guided-analysis-section-title">Conclusion</div>
          <div class="guided-analysis-conclusion-copy">${escapeHtml(card.conclusion)}</div>
        </div>
      `
      : '';

    container.innerHTML = `
      <div class="guided-analysis-card">
        <div class="guided-analysis-eyebrow">${escapeHtml(card.eyebrow)}</div>
        <div class="guided-analysis-title">${escapeHtml(card.title)}</div>
        <div class="guided-analysis-summary">${escapeHtml(card.summary)}</div>
        ${findingsHtml}
        ${conclusionHtml}
      </div>
    `;
    container.classList.remove('is-hidden');
    setLatestAgentGuidedAnalysis(card);
  }

  function updateCatalogRow(catalogId: string, results: CheckResult[]): void {
    const dot = document.getElementById(`catalog-dot-${catalogId}`);
    const badge = document.getElementById(`catalog-badge-${catalogId}`);
    const detail = document.getElementById(`catalog-detail-${catalogId}`);
    const item = document.getElementById(`catalog-item-${catalogId}`);
    if (!dot || !badge || !detail || !item) return;

    const isRunning = results.some(r => r.status === 'running' || r.status === 'pending');
    const status = isRunning ? 'running' : catalogWorstStatus(results);
    const badgeText = isRunning ? '…' : catalogBadgeText(catalogId, results);
    const badgeTitle = isRunning ? '' : catalogBadgeTooltipText(catalogId, results);

    dot.className = `check-status-dot ${status}`;
    setCatalogBadgeState(badge, status, badgeText, badgeTitle);

    item.classList.remove('no-detail');
    detail.innerHTML = buildCatalogDetailHtml(results, escapeHtml);

    // Auto-expand on failure/warning if not manually closed
    if (!catalogExpanded.has(catalogId) && (status === 'fail' || status === 'warn') && !isRunning) {
      item.classList.add('is-open');
      catalogExpanded.add(catalogId);
    }
  }

  function handleProgressResult(result: CheckResult): void {
    const catalogId = resultIdToCatalogId(result.id);
    const existing = catalogResults.get(catalogId) ?? [];
    const updated = [...existing, result];
    catalogResults.set(catalogId, updated);
    updateCatalogRow(catalogId, updated);
    latestAgentCheckResultMap.set(result.id, result);
    setLatestAgentCheckResults([...latestAgentCheckResultMap.values()], 'running');
    const detailLines = result.id === 'mcd-log-analysis'
      ? formatMcdAnalysisDetailLines(result.detail)
      : result.detail
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean);
    if (detailLines.length <= 1) {
      term.writeSystem(`  [${statusIcon(result.status)}] ${result.name}: ${result.detail}`);
      return;
    }

    term.writeSystem(`  [${statusIcon(result.status)}] ${result.name}`);
    for (const line of detailLines) {
      term.writeSystem(`      ${line}`);
    }
  }

  function resetCatalogRows(catalogIds: string[]): void {
    [...new Set(catalogIds)].forEach((catalogId) => {
      catalogResults.delete(catalogId);
      updateCatalogRow(catalogId, []);
    });
  }

  function markCatalogRowsRunning(catalogIds: string[]): void {
    [...new Set(catalogIds)].forEach((catalogId) => {
      const dot = document.getElementById(`catalog-dot-${catalogId}`);
      const badge = document.getElementById(`catalog-badge-${catalogId}`);
      if (dot) dot.className = 'check-status-dot running';
      if (badge) setCatalogBadgeState(badge, 'running', '…', '');
    });
  }

  function canRunCatalogCheck(checkId: string): boolean {
    return getCatalogCheckAvailability(checkId, getCatalogAvailabilityInput()).available;
  }

  function refreshCatalogRunButtons(forceDisabled = false): void {
    ui.tsResults.querySelectorAll<HTMLButtonElement>('.check-run-btn').forEach((btn) => {
      const checkId = btn.dataset.catalogId || '';
      btn.disabled = forceDisabled || !canRunCatalogCheck(checkId);
    });

    ui.tsResults.querySelectorAll<HTMLButtonElement>('.check-group-run-btn').forEach((btn) => {
      const groupId = btn.dataset.groupId || '';
      const checks = getCatalogGroupChecks(groupId);
      btn.disabled = forceDisabled || checks.length === 0 || checks.some((check) => !canRunCatalogCheck(check.id));
    });

    const runAllBtn = document.getElementById('catalog-btn-run-all') as HTMLButtonElement | null;
    if (runAllBtn) {
      runAllBtn.disabled = forceDisabled || RUN_ALL_CATALOG_CHECK_IDS.some((checkId) => !canRunCatalogCheck(checkId));
    }

    const runBaselineBtn = document.getElementById('catalog-btn-run-baseline') as HTMLButtonElement | null;
    if (runBaselineBtn) {
      runBaselineBtn.disabled = forceDisabled || !canRunFullBaselineNow();
    }
  }

  function clearCatalog(): void {
    catalogResults.clear();
    catalogExpanded.clear();
    latestAgentCheckResultMap.clear();
    setLatestAgentCheckResults(null);
    renderGuidedCheckAnalysis(null);
    // Reset each row to idle state
    CATALOG_GROUPS.forEach(group => {
      group.checks.forEach(check => {
        const dot = document.getElementById(`catalog-dot-${check.id}`);
        const badge = document.getElementById(`catalog-badge-${check.id}`);
        const detail = document.getElementById(`catalog-detail-${check.id}`);
        const item = document.getElementById(`catalog-item-${check.id}`);
        if (dot) dot.className = 'check-status-dot idle';
        if (badge) setCatalogBadgeState(badge, '', '—', '');
        if (detail) detail.innerHTML = '';
        if (item) { item.classList.add('no-detail'); item.classList.remove('is-open'); }
      });
    });
  }

  function ensureCatalogCanRun(actionLabel: string): boolean {
    const blocking = getBlockingConsoleTask('catalog-checks');
    if (blocking) {
      term.writeError(`${actionLabel} is unavailable while ${blocking.label} is using the console.`);
      refreshCatalogRunButtons(false);
      return false;
    }
    return true;
  }

  function handleCatalogClick(event: Event): void {
    const target = event.target as HTMLElement;

    if ((target as HTMLButtonElement).id === 'catalog-btn-run-all') {
      void runAllChecks();
      return;
    }
    if ((target as HTMLButtonElement).id === 'catalog-btn-run-baseline') {
      void runFullBaseline();
      return;
    }
    if ((target as HTMLButtonElement).id === 'catalog-btn-clear') {
      clearCatalog();
      return;
    }

    const groupBtn = target.closest<HTMLButtonElement>('.check-group-run-btn');
    if (groupBtn) {
      const groupId = groupBtn.dataset.groupId;
      if (groupId) void runCheckGroup(groupId);
      return;
    }

    const runBtn = target.closest<HTMLButtonElement>('[data-action="run-check"]');
    if (runBtn) {
      event.stopPropagation();
      const catalogId = runBtn.dataset.catalogId;
      if (catalogId) void runSingleCheck(catalogId);
      return;
    }

    const row = target.closest<HTMLElement>('.check-row');
    if (row) {
      const item = row.closest<HTMLElement>('.check-item');
      if (!item || item.classList.contains('no-detail')) return;
      const catalogId = item.dataset.catalogId;
      if (!catalogId) return;
      item.classList.toggle('is-open');
      if (item.classList.contains('is-open')) {
        catalogExpanded.add(catalogId);
      } else {
        catalogExpanded.delete(catalogId);
      }
    }
  }

  function renderCheckCatalog(): void {
    ui.tsResults.innerHTML = '';

    const toolbar = document.createElement('div');
    toolbar.className = 'catalog-toolbar';
    toolbar.innerHTML = `
      <span class="catalog-toolbar-title">Run recommended checks from JMA, run individual catalog checks, or run a broader baseline when needed.</span>
      <button class="btn btn-primary btn-sm" id="catalog-btn-run-all" disabled>&#9654; Run All Catalog Checks</button>
      <button class="btn btn-secondary btn-sm" id="catalog-btn-run-baseline" disabled>&#9654; Run Full Baseline</button>
      <button class="btn btn-secondary btn-sm" id="catalog-btn-clear">&#x2715; Clear</button>
    `;
    ui.tsResults.appendChild(toolbar);

    const analysis = document.createElement('div');
    analysis.id = 'guided-check-analysis';
    analysis.className = 'guided-check-analysis is-hidden';
    ui.tsResults.appendChild(analysis);

    for (const group of CATALOG_GROUPS) {
      const groupEl = document.createElement('div');
      groupEl.className = 'check-group';
      groupEl.dataset.groupId = group.id;

      const header = document.createElement('div');
      header.className = 'check-group-header';
      header.innerHTML = `
        <span class="check-group-name">${group.name}</span>
        <button class="check-group-run-btn" data-group-id="${group.id}" disabled>Run group</button>
      `;
      groupEl.appendChild(header);

      for (const check of group.checks) {
        const item = document.createElement('div');
        item.className = 'check-item no-detail';
        item.id = `catalog-item-${check.id}`;
        item.dataset.catalogId = check.id;

        item.innerHTML = `
          <div class="check-row">
            <span class="check-chevron">${CHEVRON_SVG}</span>
            <div class="check-status-dot idle" id="catalog-dot-${check.id}"></div>
            <div class="check-info">
              <span class="check-name">${check.name}</span>
              <span class="check-desc" title="${check.desc}">${check.desc}</span>
            </div>
            <span class="check-result-badge" id="catalog-badge-${check.id}">—</span>
            ${check.requiresMistApi ? '<span class="mist-badge">Mist + site</span>' : ''}
            <button class="check-run-btn" data-action="run-check" data-catalog-id="${check.id}" disabled>Run</button>
          </div>
          <div class="check-detail" id="catalog-detail-${check.id}"></div>
        `;
        groupEl.appendChild(item);
      }

      ui.tsResults.appendChild(groupEl);
    }

    ui.tsResults.addEventListener('click', handleCatalogClick);
  }

  async function runSingleCheck(catalogId: string): Promise<void> {
    if (catalogRunning) return;
    if (!ensureCatalogCanRun('This check')) return;
    renderGuidedCheckAnalysis(null);
    const isMcdAnalysis = catalogId === 'mcd-log-analysis';
    await runRecommendedCatalogSuite({
      ownerId: 'catalog-single-check',
      ownerLabel: 'catalog check',
      checkIds: [catalogId],
      rowIdsToReset: [catalogId],
      rowIdsToMarkRunning: [catalogId],
      startMessage: `— Running check: ${getCatalogCheck(catalogId)?.name ?? catalogId} —`,
      startNotes: isMcdAnalysis
        ? [
            'Using retained mcd log evidence rather than rerunning duplicate agent-side tests.',
            'If Mist last_seen is available, anchor the most recent disconnect cycle from rotated logs before reading the live mcd.log window.',
          ]
        : undefined,
      summaryTitle: `${getCatalogCheck(catalogId)?.name ?? 'Check'} summary`,
      failureMessage: 'Check failed',
    }, {
      ...getTroubleshootWorkflowDeps(),
      resolveRunOptions: resolveCatalogRunOptionsForWorkflow,
      resetCatalogRows,
      markCatalogRowsRunning,
      runRecommendedChecks: (options) => troubleshooter.runRecommendedChecks(options),
      handleResults: (results, summaryTitle) => applyCheckResultsWithGuidedAnalysis(results, { title: summaryTitle }),
    });
  }

  async function runCheckGroup(groupId: string): Promise<void> {
    if (catalogRunning) return;
    if (!ensureCatalogCanRun('This check group')) return;
    renderGuidedCheckAnalysis(null);
    const checks = getCatalogGroupChecks(groupId);
    if (checks.length === 0) return;
    const groupName = CATALOG_GROUPS.find(g => g.id === groupId)?.name ?? groupId;
    await runRecommendedCatalogSuite({
      ownerId: 'catalog-group-checks',
      ownerLabel: 'catalog check group',
      checkIds: checks.map((check) => check.id),
      rowIdsToReset: checks.map((check) => check.id),
      rowIdsToMarkRunning: checks.map((check) => check.id),
      startMessage: `— Running group: ${groupName} —`,
      summaryTitle: `${groupName} summary`,
      failureMessage: 'Group checks failed',
    }, {
      ...getTroubleshootWorkflowDeps(),
      resolveRunOptions: resolveCatalogRunOptionsForWorkflow,
      resetCatalogRows,
      markCatalogRowsRunning,
      runRecommendedChecks: (options) => troubleshooter.runRecommendedChecks(options),
      handleResults: (results, summaryTitle) => applyCheckResultsWithGuidedAnalysis(results, { title: summaryTitle }),
    });
  }

  async function runAllChecks(): Promise<void> {
    if (catalogRunning) return;
    if (!ensureCatalogCanRun('All catalog checks')) return;
    renderGuidedCheckAnalysis(null);
    await runRecommendedCatalogSuite({
      ownerId: 'catalog-all-checks',
      ownerLabel: 'all catalog checks',
      checkIds: RUN_ALL_CATALOG_CHECK_IDS,
      rowIdsToReset: ALL_CATALOG_CHECK_IDS,
      rowIdsToMarkRunning: ALL_CATALOG_CHECK_IDS,
      startMessage: '— Running all catalog checks —',
      summaryTitle: 'Catalog checks summary',
      failureMessage: 'Check suite failed',
      completionMessage: '— All catalog checks complete —',
    }, {
      ...getTroubleshootWorkflowDeps(),
      resolveRunOptions: resolveCatalogRunOptionsForWorkflow,
      resetCatalogRows,
      markCatalogRowsRunning,
      runRecommendedChecks: (options) => troubleshooter.runRecommendedChecks(options),
      handleResults: (results, summaryTitle) => applyCheckResultsWithGuidedAnalysis(results, { title: summaryTitle }),
    });
  }

  async function runFullBaseline(): Promise<void> {
    if (catalogRunning) return;
    if (!ensureCatalogCanRun('The full baseline')) return;
    renderGuidedCheckAnalysis(null);
    await runTroubleshootWorkflow<TroubleshootOptions, EffectiveCloudResolution>({
      ownerId: 'full-baseline',
      ownerLabel: 'full baseline troubleshooting',
      startMessage: '— Running full baseline troubleshooting workflow —',
      failureMessage: 'Full baseline failed',
      completionMessage: '— Full baseline complete —',
      beforeRun: () => {
        resetCatalogRows(ALL_CATALOG_CHECK_IDS);
      },
      resolveExecution: (effectiveCloud) => {
        const cloud = effectiveCloud.cloud;
        if (!cloud) {
          return { error: 'Select a Mist cloud region before running the full baseline.' };
        }
        const effectiveTarget = getEffectiveMistTarget();
        return {
          options: {
            cloud,
            uplinkPort: ui.tsUplinkPort.value.trim(),
            siteId: effectiveTarget.siteId || undefined,
            deviceId: effectiveTarget.deviceId || undefined,
            jmaStateCode: latestJmaCode,
            onProgress: handleProgressResult,
          },
        };
      },
      execute: (options) => troubleshooter.runAll(options),
      handleResults: (results) => applyCheckResultsWithGuidedAnalysis(results, {
        jmaCode: latestJmaCode,
        title: 'Full baseline summary',
      }),
    }, getTroubleshootWorkflowDeps());
  }

  function renderCheckResult(result: CheckResult, allResults?: CheckResult[]): HTMLElement {
    const el = document.createElement('div');
    el.className = `ts-check ${result.status}`;
    el.id = `ts-check-${result.id}`;

    // Track results for context-aware remediation
    if (allResults) {
      accumulatedResults = allResults;
    }

    // Auto-populate remediation from the troubleshooter if not already set
    if (!result.remediation && (result.status === 'fail' || result.status === 'warn')) {
      const rem = troubleshooter.getRemediation(result, accumulatedResults);
      result.remediation = rem.text;
      result.commands = rem.commands;
    }

    const hasContent = result.raw || result.remediation || result.commands;

    el.innerHTML = `
      <span class="ts-check-icon">${statusIcon(result.status)}</span>
      <div class="ts-check-body">
        <div class="ts-check-name">${result.name}${hasContent ? '<span class="ts-expand-hint">ⓘ</span>' : ''}</div>
        <div class="ts-check-detail">${result.detail}</div>
      </div>
    `;

    if (hasContent) {
      el.style.cursor = 'pointer';
      el.addEventListener('click', () => {
        showCheckModal(result);
      });
    }

    return el;
  }

  function renderActionResult(
    title: string,
    status: 'info' | 'success' | 'warn' | 'error',
    summary: string,
    bodyHtml = '',
  ): void {
    const statusLabel = {
      info: 'Info',
      success: 'Completed',
      warn: 'Attention',
      error: 'Error',
    }[status];

    ui.actionsContent.innerHTML = `
      <div class="action-result-card">
        <div class="action-result-header">
          <span class="action-result-title">${escapeHtml(title)}</span>
          <span class="action-result-pill ${status}">${statusLabel}</span>
        </div>
        <div class="action-result-summary">${summary}</div>
        ${bodyHtml}
      </div>
    `;
  }

  function renderActionProgress(
    title: string,
    summary: string,
    steps: DhcpRefreshStep[],
  ): void {
    const stepsHtml = steps.length > 0
      ? `
        <div class="action-steps">
          <div class="action-steps-title">Current Steps</div>
          <div class="action-steps-list">
            ${steps.map((step) => `
              <div class="action-step-item ${step.status}">
                <span class="action-step-icon">${step.status === 'completed' ? '✓' : '…'}</span>
                <span class="action-step-label">${escapeHtml(step.label)}</span>
              </div>
            `).join('')}
          </div>
        </div>
      `
      : '';

    renderActionResult(title, 'info', summary, stepsHtml);
  }

  function renderAgentCommandResult(
    title: string,
    summary: string,
    command: string,
    output: string,
    status: 'info' | 'success' | 'warn' | 'error' = 'success',
    note?: string,
  ): void {
    let bodyHtml = '<div class="action-steps">';
    bodyHtml += '<div class="action-steps-title">Command</div>';
    bodyHtml += `<pre class="check-modal-raw">${escapeHtml(command)}</pre>`;
    bodyHtml += '</div>';
    if (note) {
      bodyHtml += `<div class="check-result-remediation">${escapeHtml(note)}</div>`;
    }
    bodyHtml += '<div class="action-steps">';
    bodyHtml += '<div class="action-steps-title">Output</div>';
    bodyHtml += `<pre class="check-modal-raw">${escapeHtml(output || '(no output)')}</pre>`;
    bodyHtml += '</div>';
    renderActionResult(title, status, summary, bodyHtml);
  }

  function sanitizeAgentLogFindText(value: string): string {
    const trimmed = value.trim();
    if (!trimmed) throw new Error('Missing log search text.');
    if (/[\r\n]/.test(trimmed)) throw new Error('Log search text must be a single line.');
    if (trimmed.length > 80) throw new Error('Log search text is too long.');
    return trimmed.replace(/"/g, '\\"');
  }

  function escapeForShellDoubleQuotes(value: string): string {
    return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\$/g, '\\$').replace(/`/g, '\\`');
  }

  function sanitizeAgentLogFile(value: string): string {
    const trimmed = value.trim();
    if (/^(?:mcd|jmd)(?:-[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9.\-]+)?\.log(?:\.gz)?$/.test(trimmed)) return trimmed;
    if (/^messages(?:\.[0-9]+)?(?:\.gz)?$/.test(trimmed)) return trimmed;
    throw new Error('Unsupported log file. Use a current or rotated mcd, jmd, or messages log filename.');
  }

  function sanitizeAgentLogFamily(value: string): 'mcd' | 'jmd' | 'messages' {
    const trimmed = value.trim();
    if (trimmed === 'mcd' || trimmed === 'jmd' || trimmed === 'messages') return trimmed;
    throw new Error('Unsupported log family. Use mcd, jmd, or messages.');
  }

  function sanitizeAgentLogLineCount(value: unknown): number {
    if (typeof value !== 'number' || !Number.isFinite(value)) return 20;
    const rounded = Math.trunc(value);
    return Math.max(1, Math.min(100, rounded));
  }

  async function fetchEffectiveConfigForAgent(): Promise<Record<string, unknown>> {
    const command = 'show configuration | display set | display inheritance';
    if (!ensureConsoleTaskAvailable('Effective config fetch', 'agent-effective-config')) {
      throw new Error('Effective config fetch is not currently available.');
    }

    const actionResult = await withCloudStatusPollingPaused(async () => withConsoleTask(
      'agent-effective-config',
      'user',
      'effective config fetch',
      async () => {
        activateResultsTab('actions');
        renderActionResult('Effective Config', 'info', 'Fetching effective running config from the switch…');

        const result = await cmdRunner.execute(command, 60000, 5000, { silent: true });
        if (!result.success) {
          const errorMessage = result.error || 'Command failed.';
          renderAgentCommandResult('Effective Config', 'Failed to fetch effective config.', command, result.output, 'error', errorMessage);
          throw new Error(errorMessage);
        }

        const lineCount = result.output ? result.output.split('\n').length : 0;
        const summary = lineCount > 0
          ? `Fetched effective config (${lineCount} line${lineCount === 1 ? '' : 's'}).`
          : 'Fetched effective config.';
        renderAgentCommandResult('Effective Config', summary, command, result.output);
        term.writeSystem('— Agent fetched effective config —');
        return {
          command,
          output: result.output,
          lineCount,
          fetchedAt: new Date().toISOString(),
        };
      },
    ));
    if (!actionResult) {
      throw new Error('Effective config fetch did not start.');
    }
    return actionResult;
  }

  async function listLogFilesForAgent(family: string): Promise<Record<string, unknown>> {
    const safeFamily = sanitizeAgentLogFamily(family);
    const command = `/bin/sh -c "ls -1t /var/log/${safeFamily}* 2>/dev/null | sed 's#.*/##'"`;
    if (!ensureConsoleTaskAvailable(`${safeFamily} log listing`, `agent-list-log-files-${safeFamily}`)) {
      throw new Error(`${safeFamily} log listing is not currently available.`);
    }

    const actionResult = await withCloudStatusPollingPaused(async () => withConsoleTask(
      `agent-list-log-files-${safeFamily}`,
      'user',
      `${safeFamily} log listing`,
      async () => {
        activateResultsTab('actions');
        renderActionResult(
          `${safeFamily} Log Files`,
          'info',
          `Listing available ${safeFamily} log files…`,
        );

        try {
          await cmdRunner.ensureShellMode({ silent: true });
        } catch (err) {
          const errorMessage = err instanceof Error ? err.message : String(err);
          renderAgentCommandResult(`${safeFamily} Log Files`, `Failed to list ${safeFamily} log files.`, command, '', 'error', errorMessage);
          throw new Error(errorMessage);
        }

        const result = await cmdRunner.execute(command, 30000, 3000, { silent: true });
        await cmdRunner.ensureOperationalMode({ silent: true });

        if (!result.success) {
          const errorMessage = result.error || 'Command failed.';
          renderAgentCommandResult(`${safeFamily} Log Files`, `Failed to list ${safeFamily} log files.`, command, result.output, 'error', errorMessage);
          throw new Error(errorMessage);
        }

        const files = result.output
          .split('\n')
          .map((line) => line.trim())
          .filter((line) => line.length > 0)
          .filter((line) => {
            try {
              return sanitizeAgentLogFile(line).length > 0;
            } catch {
              return false;
            }
          })
          .map((file) => ({
            name: file,
            current: safeFamily === 'messages' ? file === 'messages' : file === `${safeFamily}.log`,
            compressed: file.endsWith('.gz'),
          }));

        const summary = files.length > 0
          ? `Found ${files.length} ${safeFamily} log file${files.length === 1 ? '' : 's'}.`
          : `No ${safeFamily} log files found.`;
        const body = files.length > 0
          ? `<div class="action-steps"><div class="action-steps-title">Files</div><pre class="check-modal-raw">${escapeHtml(files.map((file) => file.name).join('\n'))}</pre></div>`
          : '';
        renderActionResult(`${safeFamily} Log Files`, files.length > 0 ? 'success' : 'warn', summary, body);
        term.writeSystem(`— Agent listed ${safeFamily} log files —`);
        return {
          family: safeFamily,
          files,
          listedAt: new Date().toISOString(),
        };
      },
    ));
    if (!actionResult) {
      throw new Error(`${safeFamily} log listing did not start.`);
    }
    return actionResult;
  }

  async function searchLogFileForAgent(logFile: string, findText?: string, requestedLineCount?: unknown): Promise<Record<string, unknown>> {
    const safeLogFile = sanitizeAgentLogFile(logFile);
    const trimmedFindText = (findText ?? '').trim();
    const hasFindText = trimmedFindText.length > 0;
    const safeFindText = hasFindText ? sanitizeAgentLogFindText(trimmedFindText) : '';
    const lineWindow = sanitizeAgentLogLineCount(requestedLineCount);
    const timeoutMs = safeLogFile === 'mcd.log' ? 90000 : 60000;
    if (!ensureConsoleTaskAvailable(`${safeLogFile} search`, `agent-log-search-${safeLogFile}`)) {
      throw new Error(`${safeLogFile} search is not currently available.`);
    }

    const actionResult = await withCloudStatusPollingPaused(async () => withConsoleTask(
      `agent-log-search-${safeLogFile}`,
      'user',
      `${safeLogFile} search`,
      async () => {
        activateResultsTab('actions');
        renderActionResult(
          `${safeLogFile} Search`,
          'info',
          hasFindText
            ? `Searching ${safeLogFile} for "${trimmedFindText}" and returning the next ${lineWindow} lines…`
            : `Returning the last ${lineWindow} lines from ${safeLogFile}…`,
        );
        let executedCommand = '';
        let output = '';
        let matched = false;
        let lineCount = 0;

        try {
          await cmdRunner.ensureShellMode({ silent: true });
        } catch (err) {
          const errorMessage = err instanceof Error ? err.message : String(err);
          renderAgentCommandResult(`${safeLogFile} Search`, `Failed to search ${safeLogFile}.`, hasFindText ? `show log ${safeLogFile} | find "${safeFindText}"` : `show log ${safeLogFile} | last ${lineWindow}`, '', 'error', errorMessage);
          throw new Error(errorMessage);
        }

        if (hasFindText) {
          const shellPattern = escapeForShellDoubleQuotes(trimmedFindText);
          executedCommand = `zcat -f /var/log/${safeLogFile} | awk -v pat="${shellPattern}" -v limit=${lineWindow} 'BEGIN{found=0;count=0} { if (found==0 && index($0, pat)) found=1; if (found==1 && count < limit) { print; count++ } } END{ if (found==0) print "Pattern not found" }'; echo "__CODEX_LOG_SEARCH_DONE__"`;
        } else {
          executedCommand = `zcat -f /var/log/${safeLogFile} | tail -n ${lineWindow}`;
        }

        const shellResult = await cmdRunner.execute(executedCommand, timeoutMs, 3000, { silent: true });
        await cmdRunner.ensureOperationalMode({ silent: true });

        if (!shellResult.success) {
          const errorMessage = shellResult.error || 'Command failed.';
          renderAgentCommandResult(`${safeLogFile} Search`, `Failed to search ${safeLogFile}.`, executedCommand, shellResult.output, 'error', errorMessage);
          throw new Error(errorMessage);
        }

        output = shellResult.output;
        if (hasFindText) {
          output = output
            .split('\n')
            .filter((line) => !line.includes('__CODEX_LOG_SEARCH_DONE__'))
            .join('\n')
            .trim();
          matched = output.length > 0;
        } else {
          matched = output.trim().length > 0;
        }
        lineCount = output
          ? output
              .split('\n')
              .map((line) => line.trimEnd())
              .filter((line) => line.trim().length > 0).length
          : 0;

        const summary = hasFindText
          ? matched
            ? `Found the first match in ${safeLogFile} and returned ${lineCount} line${lineCount === 1 ? '' : 's'} from that point.`
            : `No matching lines found in ${safeLogFile}.`
          : lineCount > 0
            ? `Returned the last ${lineCount} line${lineCount === 1 ? '' : 's'} from ${safeLogFile}.`
            : `No recent lines were returned from ${safeLogFile}.`;
        renderAgentCommandResult(`${safeLogFile} Search`, summary, executedCommand, output, matched ? 'success' : 'warn');
        term.writeSystem(
          hasFindText
            ? `— Agent searched ${safeLogFile} for "${trimmedFindText}" —`
            : `— Agent fetched the last ${lineWindow} lines from ${safeLogFile} —`,
        );
        return {
          command: executedCommand,
          logFile: safeLogFile,
          findText: hasFindText ? trimmedFindText : null,
          requestedLineCount: lineWindow,
          output,
          lineCount,
          matched,
          mode: hasFindText ? 'window-from-match' : 'tail',
          searchedAt: new Date().toISOString(),
        };
      },
    ));
    if (!actionResult) {
      throw new Error(`${safeLogFile} search did not start.`);
    }
    return actionResult;
  }

  /** Show a floating modal with check details, remediation, run fix, and raw output */
  function showCheckModal(result: CheckResult): void {
    // Remove any existing modal
    const existing = document.getElementById('check-modal-overlay');
    if (existing) existing.remove();

    const overlay = document.createElement('div');
    overlay.id = 'check-modal-overlay';
    overlay.className = 'check-modal-overlay';

    const modal = document.createElement('div');
    modal.className = 'check-modal';

    // Header
    let html = `<div class="check-modal-header">`;
    html += `<span class="check-modal-status ts-check-icon ${result.status}">${statusIcon(result.status)}</span>`;
    html += `<span class="check-modal-title">${result.name}</span>`;
    html += `<button class="check-modal-close" id="check-modal-close-btn">&times;</button>`;
    html += `</div>`;

    // Detail
    html += `<div class="check-modal-detail">${result.detail}</div>`;

    // Remediation text
    if (result.remediation) {
      html += `<div class="check-modal-section">`;
      html += `<div class="check-modal-section-title">Remediation</div>`;
      html += `<pre class="check-modal-remediation">${escapeHtml(result.remediation)}</pre>`;
      html += `</div>`;
    }

    // Executable commands
    if (result.commands && result.commands.length > 0) {
      html += `<div class="check-modal-section">`;
      html += `<div class="check-modal-section-title">Commands</div>`;
      html += `<pre class="check-modal-raw">`;
      for (const cmd of result.commands) {
        html += escapeHtml(cmd) + '\n';
      }
      html += `</pre>`;
      // Check if any commands contain placeholders like <ip>
      const hasPlaceholders = result.commands.some((c) => /<\w+>/.test(c));
      if (hasPlaceholders) {
        html += `<div class="check-modal-placeholder-warn">⚠ Commands contain placeholders (e.g. &lt;ip&gt;) that must be edited before running.</div>`;
      } else {
        html += `<div class="check-modal-actions">`;
        html += `<button class="btn btn-primary" id="check-modal-run-fix">Run Fix</button>`;
        html += `</div>`;
      }
      html += `<div id="check-modal-output"></div>`;
      html += `</div>`;
    }

    // Raw output
    if (result.raw) {
      html += `<div class="check-modal-section">`;
      html += `<div class="check-modal-section-title">Raw Output</div>`;
      html += `<pre class="check-modal-raw">${escapeHtml(result.raw)}</pre>`;
      html += `</div>`;
    }

    modal.innerHTML = html;
    overlay.appendChild(modal);
    document.body.appendChild(overlay);

    // Close handlers
    let escHandler: ((e: KeyboardEvent) => void) | null = null;
    const closeModal = () => {
      if (escHandler) {
        document.removeEventListener('keydown', escHandler);
        escHandler = null;
      }
      overlay.remove();
    };
    document.getElementById('check-modal-close-btn')?.addEventListener('click', closeModal);
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) closeModal();
    });
    escHandler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        closeModal();
      }
    };
    document.addEventListener('keydown', escHandler);

    // Run Fix button handler
    const runFixBtn = document.getElementById('check-modal-run-fix');
    if (runFixBtn && result.commands) {
      const commands = result.commands;
      runFixBtn.addEventListener('click', async () => {
        runFixBtn.setAttribute('disabled', 'true');
        runFixBtn.textContent = 'Running…';
        const outputEl = document.getElementById('check-modal-output')!;
        outputEl.innerHTML = '';

        const promptForFixInput = async (
          message: string,
          options?: { allowEmpty?: boolean; masked?: boolean; okLabel?: string },
        ): Promise<string | null> =>
          new Promise((resolve) => {
            const existingPrompt = document.getElementById('check-modal-inline-prompt');
            existingPrompt?.remove();

            const promptWrap = document.createElement('div');
            promptWrap.id = 'check-modal-inline-prompt';
            promptWrap.className = 'check-modal-section';
            promptWrap.innerHTML = `
              <div class="check-modal-section-title">${escapeHtml(options?.okLabel || 'Input Required')}</div>
              <div class="check-modal-detail">${escapeHtml(message).replace(/\n/g, '<br>')}</div>
              <div class="check-modal-actions" style="margin-top:10px; align-items:center; gap:8px;">
                <input id="check-modal-inline-input" type="${options?.masked ? 'password' : 'text'}" class="input" style="flex:1; min-width:220px;" />
                <button class="btn btn-primary" id="check-modal-inline-ok">${escapeHtml(options?.okLabel || 'Continue')}</button>
                <button class="btn btn-secondary" id="check-modal-inline-cancel">Cancel</button>
              </div>
            `;
            outputEl.appendChild(promptWrap);

            const input = document.getElementById('check-modal-inline-input') as HTMLInputElement | null;
            const okBtn = document.getElementById('check-modal-inline-ok') as HTMLButtonElement | null;
            const cancelBtn = document.getElementById('check-modal-inline-cancel') as HTMLButtonElement | null;

            const cleanup = () => promptWrap.remove();
            const submit = () => {
              const value = input?.value ?? '';
              if (!options?.allowEmpty && value.length === 0) {
                input?.focus();
                return;
              }
              cleanup();
              resolve(value);
            };
            const cancel = () => {
              cleanup();
              resolve(null);
            };

            okBtn?.addEventListener('click', submit);
            cancelBtn?.addEventListener('click', cancel);
            input?.addEventListener('keydown', (event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                submit();
              } else if (event.key === 'Escape') {
                event.preventDefault();
                cancel();
              }
            });
            input?.focus();
          });

        try {
          // Determine if commands need config mode (set/delete/activate/deactivate)
          const cliCommands = commands.filter((c) => !c.startsWith('__mist_api_update__'));
          const needsConfigMode = cliCommands.some((c) =>
            /^(set |delete |activate |deactivate )/.test(c)
          );
          const isOperational = cliCommands.some((c) =>
            /^(restart |request |clear )/.test(c)
          );
          const isMistApiOnly = cliCommands.length === 0;

          // Step 0: Detect current mode and get to the right place
          if (!isMistApiOnly) {
            outputEl.innerHTML += `<div class="check-modal-cmd-line">Detecting CLI mode…</div>`;
            let currentMode = await cmdRunner.detectMode();
            outputEl.innerHTML += `<div class="check-modal-cmd-line">Current mode: ${currentMode}</div>`;

          if (currentMode === 'login') {
            outputEl.innerHTML += `<div class="check-modal-cmd-line">Switch requires login. Attempting to log in…</div>`;

            // Try to get root password from Mist
            let rootPw: string | null = null;
            const siteId = getEffectiveMistTarget().siteId ?? ui.mistSite.value;
            if (siteId) {
              rootPw = await mistApi.getRootPassword(siteId);
            }

            // Send username 'root'
            const userResult = await cmdRunner.sendAndWaitFor('root\n', /[Pp]assword:|>|#|%/, 5000);

            if (/[Pp]assword:/i.test(userResult.output)) {
              // Password required
              if (rootPw) {
                outputEl.innerHTML += `<div class="check-modal-cmd-line">Using root password from Mist site settings…</div>`;
                const passResult = await cmdRunner.sendAndWaitFor(rootPw + '\n', />|#|%|login:/i, 10000);

                if (await passwordLoginWasRejected(passResult.output)) {
                  // Mist password rejected — ask user
                  outputEl.innerHTML += `<div class="check-modal-cmd-error">Mist root password was rejected.</div>`;
                  const userPw = await promptForFixInput(
                    'Mist root password was rejected.\nEnter the root password for this switch:',
                    { masked: true, okLabel: 'Login' },
                  );
                  if (!userPw) {
                    outputEl.innerHTML += `<div class="check-modal-cmd-error">Cannot proceed without login.</div>`;
                    runFixBtn.textContent = 'Run Fix';
                    runFixBtn.removeAttribute('disabled');
                    return;
                  }
                  // Try again with user-provided password
                  await cmdRunner.sendAndWaitFor('root\n', /[Pp]assword:/i, 5000);
                  const retry = await cmdRunner.sendAndWaitFor(userPw + '\n', />|#|%|login:/i, 10000);
                  if (await passwordLoginWasRejected(retry.output)) {
                    outputEl.innerHTML += `<div class="check-modal-cmd-error">Login failed. Check credentials.</div>`;
                    runFixBtn.textContent = 'Run Fix';
                    runFixBtn.removeAttribute('disabled');
                    return;
                  }
                }
              } else {
                // No Mist password — prompt user with guidance
                const userPw = await promptForFixInput(
                  'The switch requires a password to log in.\n\n' +
                  'No root password was found in Mist site settings.\n\n' +
                  'Default credentials:\n' +
                  '  Username: root\n' +
                  '  Password: (blank — press OK with empty field for factory default)\n\n' +
                  'Enter root password (or leave empty for factory default):',
                  { allowEmpty: true, masked: true, okLabel: 'Login' },
                );

                if (userPw === null) {
                  // User cancelled
                  outputEl.innerHTML += `<div class="check-modal-cmd-error">Cannot proceed without login.</div>`;
                  runFixBtn.textContent = 'Run Fix';
                  runFixBtn.removeAttribute('disabled');
                  return;
                }

                if (userPw === '') {
                  // Try empty password (factory default shouldn't ask, but just in case)
                  await cmdRunner.send('\n');
                } else {
                  await cmdRunner.send(userPw + '\n');
                }
                await new Promise((r) => setTimeout(r, 3000));
              }

              const reachedCli = await ensureJunosCliAfterLogin((message) => {
                outputEl.innerHTML += `<div class="check-modal-cmd-line">${escapeHtml(message.trim())}</div>`;
              });
              if (!reachedCli) {
                outputEl.innerHTML += `<div class="check-modal-cmd-error">Login did not return to a usable Junos CLI prompt.</div>`;
                runFixBtn.textContent = 'Run Fix';
                runFixBtn.removeAttribute('disabled');
                return;
              }
            } else if (/%\s*$/.test(userResult.output)) {
              // Factory default — went straight to shell
              outputEl.innerHTML += `<div class="check-modal-cmd-line">Factory default switch (no password). Entering CLI…</div>`;
              const reachedCli = await ensureJunosCliAfterLogin((message) => {
                outputEl.innerHTML += `<div class="check-modal-cmd-line">${escapeHtml(message.trim())}</div>`;
              });
              if (!reachedCli) {
                outputEl.innerHTML += `<div class="check-modal-cmd-error">Login did not return to a usable Junos CLI prompt.</div>`;
                runFixBtn.textContent = 'Run Fix';
                runFixBtn.removeAttribute('disabled');
                return;
              }
            } else if (/>\s*$/.test(userResult.output)) {
              // Factory default — went to operational mode
              outputEl.innerHTML += `<div class="check-modal-cmd-line">Factory default switch (no password). Logged in.</div>`;
            }

            // Verify we're now logged in
            currentMode = await cmdRunner.detectMode();
            if (currentMode === 'login' || currentMode === 'unknown') {
              outputEl.innerHTML += `<div class="check-modal-cmd-error">Login failed. Check credentials and try the Login button.</div>`;
              runFixBtn.textContent = 'Run Fix';
              runFixBtn.removeAttribute('disabled');
              return;
            }

            outputEl.innerHTML += `<div class="check-modal-cmd-success">Logged in successfully.</div>`;
          }

          // For operational commands, ensure we're in operational mode
          if (isOperational && !needsConfigMode) {
            await cmdRunner.ensureOperationalMode();
          }

          // Pre-check: root authentication must exist before committing config
          if (needsConfigMode) {
            // Make sure we're in operational mode first to check root auth
            if (currentMode !== 'operational') {
              await cmdRunner.ensureOperationalMode();
            }

            outputEl.innerHTML += `<div class="check-modal-cmd-line">Checking root authentication…</div>`;
            const rootAuthCmd = await cmdRunner.execute('show configuration system root-authentication', 10000);
            const hasRootAuth = rootAuthCmd.success &&
              (rootAuthCmd.output.includes('encrypted-password') || rootAuthCmd.output.includes('ssh-'));

            if (!hasRootAuth) {
              outputEl.innerHTML += `<div class="check-modal-cmd-error">Root authentication is not configured — required before commit.</div>`;

              // Try to get password from Mist API
              let rootPw: string | null = null;
              const siteId = getEffectiveMistTarget().siteId ?? ui.mistSite.value;
              if (siteId) {
                rootPw = await mistApi.getRootPassword(siteId);
                if (rootPw) {
                  outputEl.innerHTML += `<div class="check-modal-cmd-line">Setting root password from Mist site settings…</div>`;
                }
              }

              // If no Mist password, prompt the user
              if (!rootPw) {
                rootPw = await promptForFixInput(
                  'Root password is not set on this switch.\nEnter a root password to configure:',
                  { masked: true, okLabel: 'Set Password' },
                );
              }

              if (!rootPw) {
                outputEl.innerHTML += `<div class="check-modal-cmd-error">Cannot proceed without a root password. Set one manually:\n  set system root-authentication plain-text-password</div>`;
                runFixBtn.textContent = 'Run Fix';
                runFixBtn.removeAttribute('disabled');
                return;
              }

              // Set the root password — enter config mode, set password, exit
              outputEl.innerHTML += `<div class="check-modal-cmd-line"><span class="check-modal-cmd-prompt">&gt;</span> set system root-authentication plain-text-password ••••••••</div>`;
              await cmdRunner.ensureConfigMode();
              await cmdRunner.send('set system root-authentication plain-text-password\n');
              await new Promise((r) => setTimeout(r, 1500));
              const pw1 = await cmdRunner.sendAndWaitFor(rootPw + '\n', /[Pp]assword:|secret:|#/, 5000);
              if (pw1.matched) {
                await cmdRunner.sendAndWaitFor(rootPw + '\n', /#/, 5000);
              }
              // Stay in config mode — we need it for the fix commands
              outputEl.innerHTML += `<div class="check-modal-cmd-success">Root password set.</div>`;
            } else {
              // Enter config mode
              await cmdRunner.ensureConfigMode();
            }

            outputEl.innerHTML += `<div class="check-modal-cmd-line">In configuration mode.</div>`;
          }
          } // end if (!isMistApiOnly)

          // Execute each command
          for (const cmd of commands) {
            // Special command: Mist API update
            if (cmd.startsWith('__mist_api_update__')) {
              const parts = cmd.split('__');
              // Format: __mist_api_update__{siteId}__{deviceId}__{jsonPayload}
              const apiSiteId = parts[3];
              const apiDeviceId = parts[4];
              const payload = JSON.parse(parts.slice(5).join('__'));

              outputEl.innerHTML += `<div class="check-modal-cmd-line"><span class="check-modal-cmd-prompt">API</span> Updating Mist device config…</div>`;

              try {
                await mistApi.updateDeviceConfig(apiSiteId, apiDeviceId, payload);
                outputEl.innerHTML += `<div class="check-modal-cmd-success">✓ Mist device config updated successfully. Config will be pushed on next sync.</div>`;
              } catch (apiErr) {
                const apiMsg = apiErr instanceof Error ? apiErr.message : String(apiErr);
                outputEl.innerHTML += `<div class="check-modal-cmd-error">Mist API update failed: ${escapeHtml(apiMsg)}</div>`;
              }
              continue;
            }

            outputEl.innerHTML += `<div class="check-modal-cmd-line"><span class="check-modal-cmd-prompt">&gt;</span> ${escapeHtml(cmd)}</div>`;
            const cmdResult = await cmdRunner.execute(cmd, 15000, 2000);
            const cmdOutput = cmdResult.output.trim();
            if (cmdOutput) {
              outputEl.innerHTML += `<pre class="check-modal-cmd-output">${escapeHtml(cmdOutput)}</pre>`;
            }
            if (cmdResult.error) {
              outputEl.innerHTML += `<div class="check-modal-cmd-error">${escapeHtml(cmdResult.error)}</div>`;
            }
          }

          // If we entered config mode, offer to commit
          if (needsConfigMode) {
            outputEl.innerHTML += `<div class="check-modal-actions" style="margin-top:10px;">`;
            outputEl.innerHTML += `<button class="btn btn-primary" id="check-modal-commit">Commit</button>`;
            outputEl.innerHTML += `<button class="btn btn-secondary" id="check-modal-rollback">Rollback</button>`;
            outputEl.innerHTML += `</div>`;

            document.getElementById('check-modal-commit')?.addEventListener('click', async () => {
              const commitBtn = document.getElementById('check-modal-commit') as HTMLButtonElement;
              const rollbackBtn = document.getElementById('check-modal-rollback') as HTMLButtonElement;
              commitBtn.disabled = true;
              rollbackBtn.disabled = true;
              commitBtn.textContent = 'Committing…';

              const checkResult = await cmdRunner.execute('commit check', 60000, 5000);
              const checkOutput = checkResult.output.trim();
              const checkPassed = checkResult.success
                && (checkOutput.includes('configuration check succeeds') || !/error:/i.test(checkOutput));

              if (!checkPassed) {
                outputEl.innerHTML += `<div class="check-modal-cmd-error">Commit check failed — fix the candidate or roll it back.</div>`;
                if (checkOutput) {
                  outputEl.innerHTML += `<pre class="check-modal-cmd-output">${escapeHtml(checkOutput)}</pre>`;
                }
                commitBtn.disabled = false;
                rollbackBtn.disabled = false;
                commitBtn.textContent = 'Commit';
                return;
              }

              const commitResult = await cmdRunner.execute('commit and-quit', 60000, 5000);
              const commitOutput = commitResult.output.trim();

              if (commitOutput.includes('commit complete') || commitOutput.includes('configuration check succeeds')) {
                outputEl.innerHTML += `<div class="check-modal-cmd-success">✓ Commit successful</div>`;
              } else if (commitOutput.includes('error')) {
                outputEl.innerHTML += `<div class="check-modal-cmd-error">Commit failed — check output below</div>`;
                outputEl.innerHTML += `<pre class="check-modal-cmd-output">${escapeHtml(commitOutput)}</pre>`;
              } else {
                outputEl.innerHTML += `<pre class="check-modal-cmd-output">${escapeHtml(commitOutput)}</pre>`;
              }
            });

            document.getElementById('check-modal-rollback')?.addEventListener('click', async () => {
              const commitBtn = document.getElementById('check-modal-commit') as HTMLButtonElement;
              const rollbackBtn = document.getElementById('check-modal-rollback') as HTMLButtonElement;
              commitBtn.disabled = true;
              rollbackBtn.disabled = true;
              rollbackBtn.textContent = 'Rolling back…';

              await cmdRunner.execute('rollback 0', 10000);
              await cmdRunner.execute('exit', 5000);
              outputEl.innerHTML += `<div class="check-modal-cmd-line">Changes rolled back.</div>`;
            });
          } else if (isOperational) {
            outputEl.innerHTML += `<div class="check-modal-cmd-success">✓ Commands executed</div>`;
          }

        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          outputEl.innerHTML += `<div class="check-modal-cmd-error">Error: ${escapeHtml(msg)}</div>`;
        }

        runFixBtn.textContent = 'Done';
      });
    }
  }

  function renderSummary(results: CheckResult[]): HTMLElement {
    const counts = { pass: 0, fail: 0, warn: 0, skip: 0 };
    results.forEach((r) => {
      if (r.status in counts) counts[r.status as keyof typeof counts]++;
    });
    const el = document.createElement('div');
    el.className = 'ts-summary';
    el.innerHTML = `
      <span class="ts-summary-pass">✓ ${counts.pass} pass</span>
      <span class="ts-summary-fail">✗ ${counts.fail} fail</span>
      <span class="ts-summary-warn">⚠ ${counts.warn} warn</span>
      <span class="ts-summary-skip">— ${counts.skip} skip</span>
    `;
    return el;
  }



  async function runRecommendedChecksFromJma(): Promise<void> {
    const recommendation = getJmaRecommendation(latestJmaCode);
    if (!recommendation) return;
    if (!ensureCatalogCanRun('Recommended checks')) return;
    await runTroubleshootWorkflow<RecommendedChecksOptions, EffectiveCloudResolution>({
      ownerId: 'jma-recommended-checks',
      ownerLabel: 'recommended checks',
      startMessage: `— Running recommended checks for JMA ${recommendation.code} ${recommendation.label} —`,
      failureMessage: 'Recommended checks failed',
      completionMessage: '— Recommended checks complete —',
      afterRun: () => {
        updateConfigSyncUIState();
      },
      resolveExecution: (effectiveCloud) => {
        const cloud = effectiveCloud.cloud;
        if (!cloud) {
          return { error: 'Please select a Mist cloud region.' };
        }
        const effectiveTarget = getEffectiveMistTarget();
        return {
          options: {
            cloud,
            uplinkPort: ui.tsUplinkPort.value.trim(),
            siteId: effectiveTarget.siteId || undefined,
            deviceId: effectiveTarget.deviceId || undefined,
            jmaStateCode: latestJmaCode,
            checkIds: recommendation.checks.map((check) => check.id),
            onProgress: handleProgressResult,
          },
        };
      },
      execute: (options) => troubleshooter.runRecommendedChecks(options),
      handleResults: (results) => applyCheckResultsWithGuidedAnalysis(results, {
        jmaCode: recommendation.code,
        title: 'Recommended checks summary',
      }),
    }, getTroubleshootWorkflowDeps());
  }

  // ---- DHCP Refresh ----
  async function runDhcpRefresh(): Promise<DhcpRefreshResult | null> {
    let completedResult: DhcpRefreshResult | null = null;
    if (!ensureConsoleTaskAvailable('DHCP refresh', 'dhcp-refresh')) return null;
    await withCloudStatusPollingPaused(async () => {
      await withConsoleTask('dhcp-refresh', 'user', 'DHCP refresh', async () => {
        activateResultsTab('actions');
        const steps: DhcpRefreshStep[] = [];
        renderActionProgress('DHCP Refresh', 'Refreshing DHCP leases and comparing before/after bindings…', steps);
        ui.btnDhcpRefresh.disabled = true;

        term.writeSystem('— Starting DHCP refresh (disable → commit → rollback → commit) —');

        let result: DhcpRefreshResult;
        try {
          result = await dhcpRefresh.refresh((step) => {
            const existingIndex = steps.findIndex((entry) => entry.key === step.key);
            if (existingIndex >= 0) {
              steps[existingIndex] = step;
            } else {
              steps.push(step);
            }
            renderActionProgress('DHCP Refresh', 'Refreshing DHCP leases and comparing before/after bindings…', steps);
          });
        } catch (err) {
          renderActionResult(
            'DHCP Refresh',
            'error',
            err instanceof Error ? err.message : String(err),
          );
          ui.btnDhcpRefresh.disabled = false;
          throw err;
        }

        const summary = result.errors.length > 0
          ? `completed with errors: ${result.errors[0]}`
          : `completed — ${result.changes.filter((c) => c.outcome === 'renewed' || c.outcome === 'acquired').length}/${result.targetInterfaces.length} interface(s) refreshed`;
        const status: 'success' | 'warn' | 'error' =
          result.errors.length > 0 ? 'warn' : 'success';
        renderActionResult(
          'DHCP Refresh',
          status,
          summary,
          renderDhcpRefreshResult(result),
        );
        term.writeSystem(`— DHCP refresh ${summary} —`);
        ui.btnDhcpRefresh.disabled = false;
        completedResult = result;
      });
    });
    return completedResult;
  }

  function renderDhcpRefreshResult(result: DhcpRefreshResult): string {
    if (result.errors.length > 0 && result.targetInterfaces.length === 0) {
      return `<div class="check-result-item check-status-info"><span class="check-result-name">DHCP Refresh</span><span class="check-result-detail">${result.errors[0]}</span></div>`;
    }

    const outcomeLabel: Record<string, { label: string; status: string }> = {
      renewed:     { label: 'Renewed',      status: 'pass' },
      acquired:    { label: 'Acquired',      status: 'pass' },
      unchanged:   { label: 'No change',     status: 'warn' },
      'no-response': { label: 'No response', status: 'fail' },
      lost:        { label: 'Lost',          status: 'fail' },
      unknown:     { label: 'Unknown',       status: 'info' },
    };

    let html = '<div class="dhcp-refresh-result">';

    // Commit status pills
    html += '<div class="dhcp-refresh-commits">';
    html += `<span class="dhcp-commit-pill ${result.commitDisableSuccess ? 'pill-pass' : 'pill-fail'}">Disable commit ${result.commitDisableSuccess ? '✓' : '✗'}</span>`;
    html += `<span class="dhcp-commit-pill ${result.commitRestoreSuccess ? 'pill-pass' : 'pill-fail'}">Restore commit ${result.commitRestoreSuccess ? '✓' : '✗'}</span>`;
    html += '</div>';

    // Per-interface comparison table
    html += '<table class="dhcp-refresh-table">';
    html += '<thead><tr><th>Interface</th><th>Before</th><th>After</th><th class="dhcp-result-col">Result</th></tr></thead>';
    html += '<tbody>';

    for (const change of result.changes) {
      const oc = outcomeLabel[change.outcome] ?? { label: change.outcome, status: 'info' };
      const beforeIp = change.before?.ipAddress ?? '—';
      const afterIp = change.after?.ipAddress ?? '—';
      const beforeState = change.before?.state ?? '—';
      const afterState = change.after?.state ?? '—';
      const beforeLease = change.before?.leaseStart ? formatDhcpTime(change.before.leaseStart) : '—';
      const afterLease = change.after?.leaseStart ? formatDhcpTime(change.after.leaseStart) : '—';
      const beforeDns = formatDhcpDnsServers(change.before?.dnsServers ?? []);
      const afterDns = formatDhcpDnsServers(change.after?.dnsServers ?? []);

      html += `<tr>
        <td class="dhcp-iface"><code>${change.interface}</code></td>
        <td>
          <div class="dhcp-binding-cell">
            <span class="dhcp-ip">${beforeIp}</span>
            <span class="dhcp-state ${beforeState.toLowerCase()}">${beforeState}</span>
            ${change.before?.leaseStart ? `<span class="dhcp-lease-time">lease ${beforeLease}</span>` : ''}
            <span class="dhcp-dns">DNS ${beforeDns}</span>
          </div>
        </td>
        <td>
          <div class="dhcp-binding-cell">
            <span class="dhcp-ip">${afterIp}</span>
            <span class="dhcp-state ${afterState.toLowerCase()}">${afterState}</span>
            ${change.after?.leaseStart ? `<span class="dhcp-lease-time">lease ${afterLease}</span>` : ''}
            <span class="dhcp-dns">DNS ${afterDns}</span>
          </div>
        </td>
        <td class="dhcp-result-cell"><span class="dhcp-outcome dhcp-outcome-${oc.status}">${oc.label}</span></td>
      </tr>`;
    }

    html += '</tbody></table>';

    // Errors
    for (const err of result.errors) {
      html += `<div class="check-result-remediation">${err}</div>`;
    }

    html += '</div>';
    return html;
  }

  function formatMistAgentProcessState(state: MistAgentProcessState): string {
    return state.detail;
  }

  function classifyMistAgentRestartOutcome(result: MistAgentRestartResult): { label: string; status: 'pass' | 'warn' | 'fail' | 'info' } {
    const beforeHealthy = result.before.hasMcd && result.before.hasJmd;
    const afterHealthy = result.after.hasMcd && result.after.hasJmd;

    if (afterHealthy && !beforeHealthy) {
      return { label: 'Recovered', status: 'pass' };
    }
    if (afterHealthy && beforeHealthy) {
      return { label: 'Restarted', status: 'pass' };
    }
    if (result.after.hasMcd && !result.after.hasJmd) {
      return { label: 'Partial', status: 'warn' };
    }
    if (result.restartAccepted) {
      return { label: 'No change', status: 'warn' };
    }
    return { label: 'Failed', status: 'fail' };
  }

  function renderMistAgentRestartResult(result: MistAgentRestartResult): string {
    const outcome = classifyMistAgentRestartOutcome(result);
    let html = '<div class="dhcp-refresh-result">';
    html += '<table class="dhcp-refresh-table">';
    html += '<thead><tr><th>Before</th><th>After</th><th class="dhcp-result-col">Result</th></tr></thead>';
    html += '<tbody>';
    html += `<tr>
      <td><div class="dhcp-binding-cell">${escapeHtml(formatMistAgentProcessState(result.before))}</div></td>
      <td><div class="dhcp-binding-cell">${escapeHtml(formatMistAgentProcessState(result.after))}</div></td>
      <td class="dhcp-result-cell"><span class="dhcp-outcome dhcp-outcome-${outcome.status}">${outcome.label}</span></td>
    </tr>`;
    html += '</tbody></table>';
    html += '<div class="action-steps">';
    html += '<div class="action-steps-title">Restart Command</div>';
    html += `<pre class="check-modal-raw">${escapeHtml(result.restartCommand)}</pre>`;
    html += '</div>';
    html += '<div class="action-steps">';
    html += '<div class="action-steps-title">Restart Output</div>';
    html += `<pre class="check-modal-raw">${escapeHtml(result.restartOutput || '(no output)')}</pre>`;
    html += '</div>';
    for (const err of result.errors) {
      html += `<div class="check-result-remediation">${escapeHtml(err)}</div>`;
    }
    html += '</div>';
    return html;
  }

  async function runMistAgentRestart(): Promise<MistAgentRestartResult | null> {
    let completedResult: MistAgentRestartResult | null = null;
    if (!ensureConsoleTaskAvailable('Restart Mist Agent', 'mist-agent-restart')) return null;
    await withCloudStatusPollingPaused(async () => {
      await withConsoleTask('mist-agent-restart', 'user', 'Mist agent restart', async () => {
        activateResultsTab('actions');
        ui.btnRestartMistAgent.disabled = true;
        try {
          const steps: MistAgentRestartStep[] = [];
          const renderProgress = () => renderActionProgress(
            'Restart Mist Agent',
            'Checking Mist agent state, restarting mcd, and verifying process state…',
            steps.map((step) => ({
              key: step.key as DhcpRefreshStep['key'],
              label: step.label,
              status: step.status,
            })),
          );
          renderProgress();

          term.writeSystem('— Restarting Mist agent daemon (mcd) —');

          let result: MistAgentRestartResult;
          try {
            result = await mistAgentRestart.restart((step) => {
              const existingIndex = steps.findIndex((entry) => entry.key === step.key);
              if (existingIndex >= 0) {
                steps[existingIndex] = step;
              } else {
                steps.push(step);
              }
              renderProgress();
            });
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            renderActionResult(
              'Restart Mist Agent',
              'error',
              'Mist agent restart failed.',
              `<div class="check-result-remediation">${escapeHtml(message)}</div>`,
            );
            term.writeError(`Mist agent restart failed: ${message}`);
            return;
          }

          const summary = result.errors.length === 0
            ? 'completed — mcd is running after restart'
            : `completed with warnings: ${result.errors[0]}`;
          const status: 'success' | 'warn' | 'error' =
            result.errors.length === 0 ? 'success' : (result.restartAccepted ? 'warn' : 'error');
          renderActionResult(
            'Restart Mist Agent',
            status,
            summary,
            renderMistAgentRestartResult(result),
          );

          if (result.errors.length > 0) {
            term.writeError(`Mist agent restart ${summary}`);
          } else {
            term.writeSystem(`— Mist agent restart ${summary} —`);
          }

          if (serial.isConnected && isOperationalPromptVisible() && !configSync.hasStagedCandidate()) {
            await cloudStatus.refresh(deviceContext.matchResult, serial.isConnected);
          }
          completedResult = result;
        } finally {
          ui.btnRestartMistAgent.disabled = !serial.isConnected || configSync.hasStagedCandidate();
        }
      });
    });
    return completedResult;
  }

  function formatDhcpTime(utcString: string): string {
    // Input: "2026-04-18 11:17:13 UTC" — convert to browser local timezone
    // Normalise to an ISO-8601 string the Date constructor understands
    const normalized = utcString.replace(/\s+UTC\s*$/, 'Z').replace(' ', 'T');
    const date = new Date(normalized);
    if (Number.isNaN(date.getTime())) return utcString;
    return new Intl.DateTimeFormat(undefined, {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      timeZoneName: 'short',
    }).format(date);
  }

  function formatDhcpDnsServers(servers: string[]): string {
    if (servers.length === 0) return '—';
    return servers.join(', ');
  }

  async function ensureJunosCliAfterLogin(
    log: (message: string) => void,
    options: { successMessage?: string } = {},
  ): Promise<boolean> {
    const mode = await cmdRunner.detectMode();
    if (mode !== 'shell') {
      return mode === 'operational' || mode === 'config';
    }

    log('  Shell prompt detected — entering Junos CLI…');
    const cliResult = await cmdRunner.sendAndWaitFor('cli\n', />\s*$|#\s*$|login:/i, 5000);
    if (/login:/i.test(cliResult.output)) {
      return false;
    }
    if (/[>#]\s*$/.test(cliResult.output)) {
      log(options.successMessage ?? '  Entered Junos CLI.');
      return true;
    }

    const settleResult = await cmdRunner.sendAndWaitFor('\n', />\s*$|#\s*$|login:/i, 4000);
    if (/login:/i.test(settleResult.output)) {
      return false;
    }
    if (/[>#]\s*$/.test(settleResult.output)) {
      log(options.successMessage ?? '  Entered Junos CLI.');
      return true;
    }

    const finalMode = await cmdRunner.detectMode();
    if (finalMode === 'operational' || finalMode === 'config') {
      log(options.successMessage ?? '  Entered Junos CLI.');
      return true;
    }
    return false;
  }

  async function sendLoginFieldAndWaitFor(
    value: string,
    pattern: RegExp,
    timeoutMs = 10000,
  ): Promise<{ output: string; matched: boolean }> {
    await new Promise((resolve) => setTimeout(resolve, 150));
    return cmdRunner.sendAndWaitFor(`${value}\r`, pattern, timeoutMs);
  }

  async function observeCurrentPrompt(preferVisiblePrompt = false): Promise<{
    mode: 'operational' | 'config' | 'shell' | 'login' | 'password' | 'unknown';
    output: string;
    matched: boolean;
  }> {
    const visibleOutput = recentConsoleTail.trimEnd();
    const visibleMode = classifyPromptMode(visibleOutput);
    if (preferVisiblePrompt && (visibleMode === 'operational' || visibleMode === 'config' || visibleMode === 'shell')) {
      return { mode: visibleMode, output: visibleOutput, matched: true };
    }

    await new Promise((resolve) => setTimeout(resolve, 150));
    const observed = await cmdRunner.sendAndWaitFor('\r', /login:\s*$|[Pp]assword:\s*$|[>#%]\s*$/im, 3000);
    const output = observed.output.trimEnd() || visibleOutput;
    return {
      mode: classifyPromptMode(output),
      output,
      matched: observed.matched,
    };
  }

  async function passwordLoginWasRejected(passResultOutput: string): Promise<boolean> {
    const mode = await cmdRunner.detectMode();
    if (mode === 'shell' || mode === 'operational' || mode === 'config') {
      return false;
    }
    if (mode === 'login') {
      return true;
    }
    return /(?:^|\n)\s*login:/i.test(passResultOutput);
  }

  // ---- Login to Switch ----
  async function loginToSwitch(): Promise<void> {
    await withCloudStatusPollingPaused(async () => {
      ui.btnLogin.disabled = true;
      ui.loginResult.innerHTML = '<div class="status-text info">Detecting switch state…</div>';
      term.writeSystem('— Attempting to log in to switch —');

      try {
        const prompt = await observeCurrentPrompt(true);
        const output = prompt.output;
        let promptMode = prompt.mode;

        // Case 1: Already at a CLI prompt (already logged in)
        if (promptMode === 'operational' || promptMode === 'config') {
          ui.loginResult.innerHTML = '<div class="device-mist-match found">Already logged in to Junos CLI.</div>';
          term.writeSystem('  Already logged in.');
          await ensureLoggedInBootstrap();
          ui.btnIdentify.disabled = false;
          ui.btnLogin.disabled = false;
          return;
        }

        // Case 2: Shell prompt (root@switch%)
        if (promptMode === 'shell') {
          term.writeSystem('  At shell prompt — entering Junos CLI…');
          await cmdRunner.send('cli\n');
          await new Promise((r) => setTimeout(r, 1500));
          ui.loginResult.innerHTML = '<div class="device-mist-match found">Logged in (was at shell prompt, entered CLI).</div>';
          term.writeSystem('  Entered Junos CLI.');
          await ensureLoggedInBootstrap();
          ui.btnIdentify.disabled = false;
          ui.btnLogin.disabled = false;
          return;
        }

        // Case 3: Login or password prompt
        if (promptMode === 'login' || promptMode === 'password') {
        const inMistLaunchMode = !!extensionLaunchContext;
        const siteId = getEffectiveMistTarget().siteId ?? ui.mistSite.value;
        const mistRootPassword = extensionLaunchContext?.deviceRootPassword
          ?? (siteId ? await mistApi.getRootPassword(siteId) : null);

        if (inMistLaunchMode) {
          if (!mistRootPassword) {
            ui.loginResult.innerHTML = '<div class="device-mist-match not-found">' +
              '<strong>Login unavailable</strong> — this Mist launch did not include a usable root password.<br><br>' +
              'Relaunch from the Mist extension after the backend is running so the secure launch token can include the site root password.' +
              '</div>';
            term.writeError('  Mist Launch login unavailable — no root password was present in the launch context.');
            ui.btnLogin.disabled = false;
            return;
          }

          const freshPrompt = await observeCurrentPrompt(true);
          promptMode = freshPrompt.mode;
          let loginResultOutput = freshPrompt.output;

          if (promptMode === 'password') {
            term.writeSystem('  Password prompt detected. Using root password from Mist launch context…');
            const passResult = await sendLoginFieldAndWaitFor(
              mistRootPassword,
              /login:\s*$|[>#%]\s*$/i,
              10000,
            );
            loginResultOutput = passResult.output;
          } else if (promptMode === 'login') {
            term.writeSystem('  Login prompt detected. Using Mist Launch root password…');

            const userResult = await sendLoginFieldAndWaitFor(
              'root',
              /login:\s*$|[Pp]assword:\s*$|[>#%]\s*$/im,
              5000,
            );
            if (!userResult.matched) {
              ui.loginResult.innerHTML = '<div class="device-mist-match not-found">' +
                '<strong>Login failed</strong> — did not receive a usable prompt after sending the root username.' +
                '</div>';
              term.writeError('  Login failed — expected the login exchange to continue, but no prompt arrived.');
              ui.btnLogin.disabled = false;
              return;
            }

            const nextPromptMode = classifyPromptMode(userResult.output);
            if (nextPromptMode === 'password') {
              term.writeSystem('  Password required. Using root password from Mist launch context…');
              const passResult = await sendLoginFieldAndWaitFor(
                mistRootPassword,
                /login:\s*$|[>#%]\s*$/i,
                10000,
              );
              loginResultOutput = passResult.output;
            } else if (nextPromptMode === 'operational' || nextPromptMode === 'config' || nextPromptMode === 'shell') {
              loginResultOutput = userResult.output;
            } else {
              ui.loginResult.innerHTML = '<div class="device-mist-match not-found">' +
                '<strong>Login failed</strong> — the switch did not advance to a password prompt or CLI prompt after sending the root username.' +
                '</div>';
              term.writeError('  Login failed — login exchange did not advance after sending the root username.');
              ui.btnLogin.disabled = false;
              return;
            }
          } else {
            ui.loginResult.innerHTML = '<div class="device-mist-match not-found">' +
              '<strong>Login failed</strong> — no login or password prompt was visible when the Mist launch login began.' +
              '</div>';
            term.writeError('  Login failed — no active login exchange prompt was visible.');
            ui.btnLogin.disabled = false;
            return;
          }

          if (await passwordLoginWasRejected(loginResultOutput)) {
            ui.loginResult.innerHTML = '<div class="device-mist-match not-found">' +
              '<strong>Login failed</strong> — Mist site root password was rejected.<br><br>' +
              'The switch may have a different password than what is configured in the Mist site settings.' +
              '</div>';
            term.writeError('  Login failed — Mist password rejected.');
            ui.btnLogin.disabled = false;
            return;
          }

          const reachedCli = await ensureJunosCliAfterLogin((message) => term.writeSystem(message));
          if (!reachedCli) {
            ui.loginResult.innerHTML = '<div class="device-mist-match not-found">' +
              '<strong>Login state unclear</strong> — the switch did not return to a usable Junos CLI prompt.<br><br>' +
              'Check the console session manually and try again.' +
              '</div>';
            term.writeError('  Login did not reach a usable Junos CLI prompt.');
            ui.btnLogin.disabled = false;
            return;
          }

          ui.loginResult.innerHTML = '<div class="device-mist-match found">Logged in as root using Mist launch password.</div>';
          term.writeSystem('  Login successful.');
          await ensureLoggedInBootstrap();
          ui.btnIdentify.disabled = false;
          ui.btnLogin.disabled = false;
          return;
        }

        term.writeSystem('  Login prompt detected. Trying root with no password (factory default)…');

        let userResult: { output: string; matched: boolean };
        if (promptMode === 'password') {
          userResult = { output, matched: true };
        } else {
          userResult = await sendLoginFieldAndWaitFor(
            'root',
            /login:\s*$|[Pp]assword:\s*$|[>#%]\s*$/im,
            5000,
          );
        }
        const nextPromptMode = classifyPromptMode(userResult.output);

        // Factory default: root with no password goes straight to shell/CLI
        if (nextPromptMode === 'operational' || nextPromptMode === 'config') {
          // Went straight to Junos CLI — factory default, no password
          ui.loginResult.innerHTML = '<div class="device-mist-match found">' +
            '<strong>Factory default switch — logged in as root (no password).</strong><br><br>' +
            'A root password must be set before any configuration can be committed.' +
            '</div>';
          term.writeSystem('  Factory default — logged in with no password. Root password required.');
          await ensureLoggedInBootstrap();
          ui.btnIdentify.disabled = false;
          ui.btnLogin.disabled = false;
          return;
        }

        if (nextPromptMode === 'shell') {
          // Went to shell — factory default, enter CLI
          term.writeSystem('  Factory default — at shell prompt, entering CLI…');
          await cmdRunner.send('cli\n');
          await new Promise((r) => setTimeout(r, 1500));
          ui.loginResult.innerHTML = '<div class="device-mist-match found">' +
            '<strong>Factory default switch — logged in as root (no password).</strong><br><br>' +
            'A root password must be set before any configuration can be committed.' +
            '</div>';
          term.writeSystem('  Entered Junos CLI. Root password required.');
          await ensureLoggedInBootstrap();
          ui.btnIdentify.disabled = false;
          ui.btnLogin.disabled = false;
          return;
        }

        // Got a password prompt — switch has a password set.
        // The initial mistRootPassword lookup returned null, but try once more now
        // that we know we actually need it (the lookup may have raced with the
        // extension context loading, or the siteId became available only after
        // the switch identified itself).
        if (nextPromptMode === 'password') {
          term.writeSystem('  Password required. Attempting to retrieve from Mist…');

          const retryPassword = extensionLaunchContext?.deviceRootPassword
            ?? (siteId ? await mistApi.getRootPassword(siteId) : null);

          if (retryPassword) {
            term.writeSystem('  Retrieved root password. Attempting login…');
            const passResult = await sendLoginFieldAndWaitFor(
              retryPassword,
              /(?:login:\s*$|[>#%]\s*$)/im,
              10000,
            );

            if (await passwordLoginWasRejected(passResult.output)) {
              ui.loginResult.innerHTML = '<div class="device-mist-match not-found">' +
                '<strong>Login failed</strong> — Mist site root password was rejected.<br><br>' +
                'The switch may have a different password than what is configured in the Mist site settings.' +
                '</div>';
              term.writeError('  Login failed — Mist password rejected.');
              ui.btnLogin.disabled = false;
              return;
            }

            const reachedCli = await ensureJunosCliAfterLogin((message) => term.writeSystem(message));
            if (!reachedCli) {
              ui.loginResult.innerHTML = '<div class="device-mist-match not-found">' +
                '<strong>Login state unclear</strong> — the switch did not return to a usable Junos CLI prompt.<br><br>' +
                'Check the console session manually and try again.' +
                '</div>';
              term.writeError('  Login did not reach a usable Junos CLI prompt.');
              ui.btnLogin.disabled = false;
              return;
            }

            ui.loginResult.innerHTML = '<div class="device-mist-match found">Logged in as root using Mist site password.</div>';
            term.writeSystem('  Login successful.');
            await ensureLoggedInBootstrap();
            ui.btnIdentify.disabled = false;
            ui.btnLogin.disabled = false;
            return;
          }

          // No password available — abort the hanging password prompt cleanly.
          await cmdRunner.send('\x03\n');
          await new Promise((r) => setTimeout(r, 1500));

          let html = '<div class="device-mist-match not-found">';
          html += '<strong>Password required but not available.</strong><br><br>';
          if (!siteId) {
            html += 'Launch from a Mist switch page or select a site in Mist integration mode to auto-retrieve the root password.<br><br>';
          } else if (!mistApi.isConfigured && !extensionLaunchContext) {
            html += 'Configure the Mist API (cloud, token, org ID) and select a site to auto-retrieve the root password.<br><br>';
          } else if (mistApi.isConfigured) {
            html += 'Select a site in the Mist API section to retrieve the root password.<br><br>';
          } else {
            html += 'No root password is set in the Mist site settings for this site.<br><br>';
          }
          html += 'You can also log in manually in the terminal below.';
          html += '</div>';

          ui.loginResult.innerHTML = html;
          term.writeSystem('  Password required — could not retrieve from Mist.');
          ui.btnLogin.disabled = false;
          return;
        }
      }

      // Unknown state
      ui.loginResult.innerHTML = '<div class="status-text warn">Could not determine switch state. Try pressing Enter in the terminal and then click Login again.</div>';
      term.writeSystem('  Could not determine switch state.');
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        ui.loginResult.innerHTML = `<div class="status-text error">Error: ${msg}</div>`;
        term.writeError(`Login error: ${msg}`);
      }

      ui.btnLogin.disabled = false;
    });
  }

  // ---- Device Identification ----
  async function identifySwitch(): Promise<void> {
    if (localIdentifyPromise) {
      await localIdentifyPromise;
    }
    if (!ensureConsoleTaskAvailable('Switch identification', 'identify-switch')) return;
    await withCloudStatusPollingPaused(async () => {
      await withConsoleTask('identify-switch', 'user', 'switch identification', async () => {
        ui.btnIdentify.disabled = true;
        ui.deviceIdentity.innerHTML = '';
        term.writeSystem('— Identifying connected switch —');
        await deviceContext.runIdentify({ silent: false });
        // Apply verification gating immediately once we have a fresh identity/match result,
        // even if the subsequent Mist/JMA refresh takes a moment or fails.
        renderMistLaunchVerification();
        applyMistLaunchWorkflowGates();
        await cloudStatus.refresh(deviceContext.matchResult, serial.isConnected);
        ui.btnIdentify.disabled = false;
        term.writeSystem('— Identification complete —');
      });
    });
  }

  // ---- Config Sync Preview ----
  function renderStagedCandidatePreview(
    result: ConfigSyncPreviewResult,
    options: {
      title: string;
      summary: string;
      commandPreviewLines?: string[];
      diffEmptySummary: string;
      decisionSummary: string;
    },
  ): void {
    let html = '';

    html += `<div class="config-sync-section-title">${escapeHtml(options.title)}</div>`;
    html += `<div class="config-sync-summary">${options.summary}</div>`;

    if (options.commandPreviewLines && options.commandPreviewLines.length > 0) {
      html += `<pre class="config-sync-pre">${escapeHtml(options.commandPreviewLines.join('\n'))}</pre>`;
    }

    const stagingWarnings = result.stagingErrors.filter(isConfigSyncStagingWarning);
    const stagingErrors = result.stagingErrors.filter((e) => !isConfigSyncStagingWarning(e));

    if (stagingWarnings.length > 0) {
      html += `<div class="config-sync-section-title">Load Warnings (${stagingWarnings.length})</div>`;
      for (const w of stagingWarnings) {
        html +=
          `<div class="config-sync-warning">` +
          `<span class="config-sync-warning-cmd">${escapeHtml(w.command)}</span>` +
          `<span class="config-sync-warning-msg">${escapeHtml(w.error)}</span>` +
          `</div>`;
      }
    }

    if (stagingErrors.length > 0) {
      html += `<div class="config-sync-section-title">Load Errors (${stagingErrors.length})</div>`;
      for (const err of stagingErrors) {
        html +=
          `<div class="config-sync-error">` +
          `<span class="config-sync-error-cmd">${escapeHtml(err.command)}</span>` +
          `<span class="config-sync-error-msg">${escapeHtml(err.error)}</span>` +
          `</div>`;
      }
    }

    const checkLabel = result.commitCheckPassed
      ? '<span class="config-sync-check-status pass">✓ Passed</span>'
      : '<span class="config-sync-check-status fail">✗ Failed</span>';
    if (result.compareOutput.trim()) {
      html +=
        '<div class="config-sync-section-title">Diff Review</div>' +
        '<div class="config-sync-summary">Review the highlighted <code>show | compare</code> output in the main console above.</div>';
    } else {
      html +=
        '<div class="config-sync-section-title">Diff Review</div>' +
        `<div class="config-sync-summary">${options.diffEmptySummary}</div>`;
    }

    html += `<div class="config-sync-section-title">Pre-commit Validation ${checkLabel}</div>`;
    if (result.commitCheckOutput.trim()) {
      html += `<pre class="config-sync-pre">${escapeHtml(result.commitCheckOutput)}</pre>`;
    }

    if (result.staged) {
      html +=
        '<div class="config-sync-section-title" style="margin-top:12px;">Decision Required</div>' +
        `<div class="config-sync-summary">${options.decisionSummary}</div>`;
    } else {
      html +=
        '<div class="config-sync-error" style="margin-top:8px;">⚠ Staging did not complete — candidate was not left on the switch.</div>';
    }

    ui.configSyncResults.innerHTML = html;
    ui.configSyncResults.scrollTop = 0;
  }

  async function previewCandidateWorkflow(
    input: CandidatePreviewInput,
    options: {
      title: string;
      summary: (result: ConfigSyncPreviewResult) => string;
      commandPreviewLines?: string[];
      diffEmptySummary: string;
      decisionSummary: string;
      startTerminalMessage: string;
      successTerminalMessage: string;
      noDiffTerminalMessage: string;
      stagedTerminalMessage: string;
      incompleteTerminalMessage: string;
      candidateTerminalSummary: (result: ConfigSyncPreviewResult) => string;
    },
  ): Promise<ConfigSyncPreviewResult> {
    term.writeSystem(options.startTerminalMessage);
    const result = await configSync.previewCandidate(input);
    renderStagedCandidatePreview(result, {
      title: options.title,
      summary: options.summary(result),
      commandPreviewLines: options.commandPreviewLines,
      diffEmptySummary: options.diffEmptySummary,
      decisionSummary: options.decisionSummary,
    });
    updateConfigSyncUIState();
    await waitForUiPaint();

    const stagingWarnings = result.stagingErrors.filter(isConfigSyncStagingWarning);
    const stagingErrors = result.stagingErrors.filter((e) => !isConfigSyncStagingWarning(e));
    term.writeSystem(options.candidateTerminalSummary(result));
    for (const w of stagingWarnings) {
      term.writeSystem(`  Staging warning: ${w.command} — ${w.error}`);
    }
    for (const err of stagingErrors) {
      term.writeError(`  Staging error: ${err.command} — ${err.error}`);
    }
    if (result.compareOutput.trim()) {
      term.writeSystem('  ── Diff (show | compare) ──');
      term.writeJunosHighlighted(result.compareOutput);
    } else {
      term.writeSystem(`  ${options.noDiffTerminalMessage}`);
    }
    term.writeSystem(`  Commit check: ${result.commitCheckPassed ? 'passed' : 'FAILED'}`);
    if (result.staged) {
      term.writeSystem(`  ${options.stagedTerminalMessage}`);
    } else {
      term.writeError(`  ${options.incompleteTerminalMessage}`);
    }
    term.writeSystem(options.successTerminalMessage);
    return result;
  }

  async function previewConfigSync(): Promise<void> {
    if (!ensureConsoleTaskAvailable('Config sync', 'config-sync-preview')) return;
    await withCloudStatusPollingPaused(async () => {
      await withConsoleTask('config-sync-preview', 'exclusive', 'config sync preview', async () => {
        const effectiveTarget = getEffectiveMistTarget();
        if (!effectiveTarget.siteId || !effectiveTarget.deviceId) {
          ui.configSyncResults.innerHTML =
            '<div class="status-text error">Identify the switch first and ensure it is found in Mist with a site assignment.</div>';
          return;
        }

        ui.btnConfigSyncPreview.disabled = true;
        activateResultsTab('config-sync');
        ui.configSyncResults.innerHTML = '<div class="status-text info">Fetching Mist intended config…</div>';

        const siteId = effectiveTarget.siteId;
        const deviceId = effectiveTarget.deviceId;

        try {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const configCmd = await mistApi.getDeviceConfig(siteId, deviceId) as any;
          const cliLines: string[] = Array.isArray(configCmd?.cli) ? configCmd.cli : [];
          await previewCandidateWorkflow({
            cli: cliLines,
            stagedCandidateErrorMessage: 'A candidate configuration is already staged on the switch. Commit or roll back before starting a new preview.',
          }, {
            title: 'Config to Apply',
            summary: (result) => `${result.candidateCommandCount} total commands — ${result.cleanupCommandCount} cleanup deletes + ${result.mistCliCommandCount} from Mist intent`,
            diffEmptySummary: 'No changes detected — config is already aligned with Mist intent.',
            decisionSummary: 'Candidate config is staged on the switch. Review the diff above, then choose an action in the panel below.',
            startTerminalMessage: '— Starting config sync —',
            successTerminalMessage: '— Config sync complete —',
            noDiffTerminalMessage: 'No diff detected — config already aligned with Mist intent.',
            stagedTerminalMessage: 'Candidate staged — choose Commit or Rollback below.',
            incompleteTerminalMessage: 'Warning: staging did not complete cleanly.',
            candidateTerminalSummary: (result) => `  Candidate: ${result.candidateCommandCount} commands (${result.cleanupCommandCount} cleanup + ${result.mistCliCommandCount} from Mist intent)`,
          });
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          ui.configSyncResults.innerHTML = `<div class="status-text error">Error: ${escapeHtml(msg)}</div>`;
          term.writeError(`Config sync error: ${msg}`);
        } finally {
          updateConfigSyncUIState();
        }
      });
    });
  }

  // ---- Config Sync: Commit ----
  async function doCommitSync(): Promise<void> {
    if (!ensureConsoleTaskAvailable('Commit candidate', 'config-sync-commit')) return;
    if (!ensureStagedCandidateActionAllowed('commit')) return;
    await withCloudStatusPollingPaused(async () => {
      await withConsoleTask('config-sync-commit', 'exclusive', 'candidate commit', async () => {
        if (!ensureStagedCandidateActionAllowed('commit')) return;
        ui.btnCommitSync.disabled = true;
        ui.btnRollbackSync.disabled = true;

        term.writeSystem('— Committing staged candidate —');
        ui.configSyncResults.innerHTML = '<div class="status-text info">Running commit…</div>';

        try {
          const result = await configSync.commitSync();
          renderCandidateActionOutcome(result, 'commit');
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          ui.configSyncResults.innerHTML = `<div class="status-text error">Error: ${escapeHtml(msg)}</div>`;
          term.writeError(`Commit error: ${msg}`);
        } finally {
          updateConfigSyncUIState();
        }
      });
    });
  }

  // ---- Config Sync: Rollback ----
  async function doRollbackSync(): Promise<void> {
    if (!ensureConsoleTaskAvailable('Rollback candidate', 'config-sync-rollback')) return;
    if (!ensureStagedCandidateActionAllowed('rollback')) return;
    await withCloudStatusPollingPaused(async () => {
      await withConsoleTask('config-sync-rollback', 'exclusive', 'candidate rollback', async () => {
        if (!ensureStagedCandidateActionAllowed('rollback')) return;
        ui.btnCommitSync.disabled = true;
        ui.btnRollbackSync.disabled = true;

        term.writeSystem('— Rolling back staged candidate —');
        ui.configSyncResults.innerHTML = '<div class="status-text info">Running rollback 0…</div>';

        try {
          const result = await configSync.rollbackSync();
          renderCandidateActionOutcome(result, 'rollback');
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          ui.configSyncResults.innerHTML = `<div class="status-text error">Error: ${escapeHtml(msg)}</div>`;
          term.writeError(`Rollback error: ${msg}`);
        } finally {
          updateConfigSyncUIState();
        }
      });
    });
  }

  /** Render the final outcome of a commit or rollback action in the results pane. */
  function renderCandidateActionOutcome(
    result: ConfigSyncActionResult,
    action: 'commit' | 'rollback',
  ): void {
    let html = '';

    if (result.success) {
      if (action === 'commit') {
        html += '<div class="config-sync-rollback-notice">✓ Committed — candidate configuration is now active and permanent.</div>';
      } else {
        html += '<div class="config-sync-rollback-notice">✓ Rolled back — running configuration is unchanged.</div>';
      }

      if (result.output.trim()) {
        html += `<pre class="config-sync-pre" style="margin-top:8px;">${escapeHtml(result.output)}</pre>`;
      }
    } else {
      const msg = result.error ?? 'Unknown error';
      html += `<div class="config-sync-error" style="margin-top:8px;">⚠ ${escapeHtml(msg)}</div>`;
      if (result.output.trim()) {
        html += `<pre class="config-sync-pre">${escapeHtml(result.output)}</pre>`;
      }
      term.writeError(`  ${action} failed: ${msg}`);
    }

    ui.configSyncResults.innerHTML = html;
  }

  // ---- Get Root Password ----
  async function getRootPassword(): Promise<void> {
    await withCloudStatusPollingPaused(async () => {
      const effectiveTarget = getEffectiveMistTarget();
      if (!effectiveTarget.siteId) {
        activateResultsTab('actions');
        renderActionResult(
          'Get Root Password',
          'error',
          'Identify the switch first and ensure it is assigned to a site in Mist.',
        );
        ui.rootPasswordResult.innerHTML = '<div class="status-text error">Identify the switch first and ensure it is assigned to a site in Mist.</div>';
        return;
      }

      ui.btnRootPassword.disabled = true;
      activateResultsTab('actions');
      renderActionResult('Get Root Password', 'info', 'Fetching root password from Mist…');
      ui.rootPasswordResult.innerHTML = '<div class="status-text info">Fetching root password from Mist…</div>';

      try {
        const siteId = effectiveTarget.siteId;
        const rootPw = await mistApi.getRootPassword(siteId);

        let html = '';
        if (rootPw) {
          html += '<div class="device-info-panel">';
          html += '<div class="device-info-row"><span class="device-info-label">Root Password</span><span class="device-info-value">' + escapeHtml(rootPw) + '</span></div>';
          html += '</div>';
          html += '<div class="device-mist-match found" style="margin-top:6px;">';
          html += '<strong>To log in:</strong><br>';
          html += 'Username: <code>root</code><br>';
          html += 'Password: <code>' + escapeHtml(rootPw) + '</code>';
          html += '</div>';
          term.writeSystem(`  Root password retrieved for site.`);
          renderActionResult('Get Root Password', 'success', 'Retrieved root password from Mist site settings.', html);
          ui.rootPasswordResult.innerHTML = '<div class="status-text success">Root password loaded — see Actions tab.</div>';
        } else {
          html += '<div class="device-mist-match not-found" style="margin-top:6px;">';
          html += '<strong>No root password set in Mist site settings.</strong><br><br>';
          html += 'The switch may be using the Mist default random password set during adoption. Try these options:<br><br>';
          html += '1. <strong>Default factory credentials:</strong> Username <code>root</code> with no password (only works on factory-default or zeroized switches)<br><br>';
          html += '2. <strong>Set a password in Mist:</strong> Go to <em>Organization → Site Configuration → select the site → Switch Management → Root Password</em>, set a password, and wait for the config to push<br><br>';
          html += '3. <strong>Mist user account:</strong> If the switch was adopted via CLI, try username <code>mist</code> with the device claim code as the password';
          html += '</div>';
          term.writeSystem('  Root password not set in Mist site settings.');
          renderActionResult('Get Root Password', 'warn', 'No root password is set in Mist site settings for this site.', html);
          ui.rootPasswordResult.innerHTML = '<div class="status-text warn">No root password found — see Actions tab.</div>';
        }

      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        renderActionResult('Get Root Password', 'error', msg);
        ui.rootPasswordResult.innerHTML = `<div class="status-text error">Error: ${msg}</div>`;
        term.writeError(`Failed to fetch root password: ${msg}`);
      } finally {
        ui.btnRootPassword.disabled = false;
      }
    });
  }

  // ---- Adopt Switch ----
  async function adoptSwitch(): Promise<void> {
    if (!ensureConsoleTaskAvailable('Adopt Switch', 'adopt-switch-preview')) return;
    await withCloudStatusPollingPaused(async () => {
      await withConsoleTask('adopt-switch-preview', 'exclusive', 'switch adoption preview', async () => {
        activateResultsTab('config-sync');

        if (configSync.hasStagedCandidate()) {
          const message = 'Rollback or commit the staged candidate configuration before starting switch adoption.';
          ui.adoptResults.innerHTML = `<div class="status-text error">${message}</div>`;
          ui.configSyncResults.innerHTML = `<div class="status-text error">${message}</div>`;
          term.writeError('Adopt Switch is blocked while another candidate configuration is staged.');
          return;
        }

        if (!mistApi.isConfigured && !mistApi.hasLaunchOverlay) {
          const message = 'Configure Mist API first (cloud, token, org ID), or launch from Mist.';
          ui.adoptResults.innerHTML = `<div class="status-text error">${message}</div>`;
          ui.configSyncResults.innerHTML = `<div class="status-text error">${message}</div>`;
          return;
        }

        ui.btnAdopt.disabled = true;
        ui.adoptResults.innerHTML = '<div class="status-text info">Fetching adoption commands from Mist…</div>';
        ui.configSyncResults.innerHTML = '<div class="status-text info">Fetching adoption commands from Mist…</div>';

        try {
          const prepared = await prepareAdoptionPlan({
            getAdoptionCommands: () => mistApi.getAdoptionCommands(),
            getSiteId: () => (getEffectiveMistTarget().siteId ?? ui.mistSite.value) || null,
            getRootPassword: (siteId) => mistApi.getRootPassword(siteId),
            getUserProvidedRootPassword: () => ui.adoptRootPw.value,
            term,
          });

          const { plan } = prepared;
          await previewCandidateWorkflow({
            cli: plan.commandLines,
            cleanupDeletes: [],
            stagedCandidateErrorMessage: 'A config candidate is already staged on the switch. Commit or roll back before starting a new preview.',
          }, {
            title: 'Adoption Commands',
            summary: (result) => `${result.mistCliCommandCount} total commands from Mist adoption intent.`,
            commandPreviewLines: plan.commandLines,
            diffEmptySummary: 'No changes detected — adoption config already appears to be present on the switch.',
            decisionSummary: 'Adoption candidate is staged on the switch. Review the diff above, then choose Commit or Rollback in the panel below.',
            startTerminalMessage: '— Starting switch adoption preview —',
            successTerminalMessage: '— Adoption preview complete —',
            noDiffTerminalMessage: 'No diff detected — adoption config already appears to be present.',
            stagedTerminalMessage: 'Adoption candidate staged — choose Commit or Rollback below.',
            incompleteTerminalMessage: 'Warning: adoption staging did not complete cleanly.',
            candidateTerminalSummary: (result) => `  Candidate: ${result.candidateCommandCount} adoption commands from Mist intent`,
          });
          ui.adoptResults.innerHTML = '<div class="status-text info">Adoption candidate staged — see Config Sync tab and choose Commit or Rollback.</div>';
          term.writeSystem(`— Retrieved ${plan.commandLines.length} adoption commands from Mist —`);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          ui.adoptResults.innerHTML = `<div class="status-text error">Failed to fetch adoption commands: ${escapeHtml(msg)}</div>`;
          ui.configSyncResults.innerHTML = `<div class="status-text error">Failed to fetch adoption commands: ${escapeHtml(msg)}</div>`;
          term.writeError(`Adoption fetch error: ${msg}`);
          updateConfigSyncUIState();
        }
      });
    });
  }

  // ---- Offline Timeline (standalone) ----
  async function checkOfflineTimeline(): Promise<void> {
    await withCloudStatusPollingPaused(async () => {
      const effectiveTarget = getEffectiveMistTarget();
      if (!effectiveTarget.siteId || !effectiveTarget.deviceId) {
        ui.timelineResults.innerHTML = '<div class="status-text error">Identify the switch first and ensure it is found in Mist with a site.</div>';
        return;
      }

      ui.btnOfflineTimeline.disabled = true;
      activateResultsTab('timeline');
      ui.timelineResults.innerHTML = '<div class="status-text info">Checking Mist events and switch logs…</div>';
      term.writeSystem('— Checking offline timeline —');

      try {
        const results = await troubleshooter.checkOfflineTimeline(
          effectiveTarget.siteId,
          effectiveTarget.deviceId,
        );

        ui.timelineResults.innerHTML = '';
        for (const result of results) {
          const rendered = renderCheckResult(result);
          ui.timelineResults.appendChild(rendered);
          term.writeSystem(`  [${statusIcon(result.status)}] ${result.name}: ${result.detail}`);
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        ui.timelineResults.innerHTML = `<div class="status-text error">Error: ${msg}</div>`;
        term.writeError(`Timeline check failed: ${msg}`);
      } finally {
        ui.btnOfflineTimeline.disabled = false;
      }

      term.writeSystem('— Offline timeline check complete —');
    });
  }

  function escapeHtml(text: string): string {
    return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  // ---- Event listeners ----
  bindProxyButton(ui.btnSessionConnect, ui.btnConnect);
  bindProxyButton(ui.btnSessionDisconnect, ui.btnDisconnect);
  bindProxyButton(ui.btnSessionLogin, ui.btnLogin);
  bindProxyButton(ui.btnSessionIdentify, ui.btnIdentify);
  bindProxyButton(ui.btnSessionRootPassword, ui.btnRootPassword);
  bindProxyButton(ui.btnQuickDhcpRefresh, ui.btnDhcpRefresh);
  bindProxyButton(ui.btnQuickRestartMistAgent, ui.btnRestartMistAgent);
  bindProxyButton(ui.btnQuickConfigSync, ui.btnConfigSyncPreview);
  bindProxyButton(ui.btnQuickAdopt, ui.btnAdopt);

  ui.btnConnect.addEventListener('click', connect);
  ui.btnDisconnect.addEventListener('click', disconnect);
  ui.btnClearConnection.addEventListener('click', () => term.clear());
  ui.btnClear.addEventListener('click', () => term.clear());
  ui.btnSessionToolsOpen?.addEventListener('click', () => {
    if (ui.sidebar.classList.contains('is-open')) {
      closeSessionToolsDrawer();
    } else {
      openSessionToolsDrawer();
    }
  });
  ui.btnSessionToolsClose?.addEventListener('click', closeSessionToolsDrawer);
  ui.sessionToolsOverlay?.addEventListener('click', closeSessionToolsDrawer);
  ui.btnHeaderMist?.addEventListener('click', openMistModal);
  document.addEventListener('click', (event) => {
    const target = event.target;
    if (!(target instanceof Node)) return;
    if (!ui.sidebar.classList.contains('is-open')) return;
    if (ui.sidebar.contains(target)) return;
    if (ui.btnSessionToolsOpen?.contains(target as Node)) return;
    closeSessionToolsDrawer();
  });
  ui.serialPortSelect.addEventListener('change', () => {
    const selectedPort = getSelectedAuthorizedPort();
    if (selectedPort) {
      const label = formatPortLabel(selectedPort);
      ui.selectedPort.textContent = `Selected Port: ${label}`;
      saveLastPortLabel(label);
    } else {
      const lastPortLabel = getLastPortLabel();
      ui.selectedPort.textContent = `Selected Port: ${lastPortLabel ?? 'None selected'}`;
    }
  });
  ui.btnOpenMistModal.addEventListener('click', openMistModal);
  ui.drawerMistModalButtons.forEach((button) => button.addEventListener('click', openMistModal));
  ui.btnCloseMistModal.addEventListener('click', closeMistModal);
  ui.btnCancelMistModal.addEventListener('click', closeMistModal);
  ui.btnLoadOrgs.addEventListener('click', () => {
    void mistContext.loadOrgs(ui.mistApiToken.value.trim(), ui.mistCloud.value);
  });
  ui.mistCloud.addEventListener('change', () => {
    saveSelectedMistCloud();
    refreshCatalogRunButtons(false);
  });
  [ui.baudRate, ui.dataBits, ui.parity, ui.stopBits, ui.flowControl].forEach((el) => {
    el.addEventListener('change', saveSerialPrefs);
  });
  ui.mistOrg.addEventListener('change', () => {
    mistContext.selectOrg(ui.mistOrg.value);
    saveSelectedMistOrg(ui.mistOrg.value);
    refreshCatalogRunButtons(false);
    const identity = deviceContext.matchResult?.identity ?? deviceContext.localIdentity;
    if (identity) renderDeviceSummary(identity);
  });
  ui.btnSaveMistModal.addEventListener('click', async () => {
    const token = ui.mistApiToken.value.trim();
    const orgId = ui.mistOrg.value;
    const cloud = getCloudById(ui.mistCloud.value);
    const saved = mistContext.save(token, cloud?.apiHost ?? '', orgId, cloud ?? null);
    if (saved) {
      saveSelectedMistCloud();
      closeMistModal();
      try {
        await mistContext.loadSites(token, orgId, ui.mistCloud.value);
      } finally {
        void refreshMistStatusAfterMistSave();
      }
    }
  });
  ui.mistModalOverlay.addEventListener('click', (e) => {
    if (e.target === ui.mistModalOverlay) closeMistModal();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !ui.mistModalOverlay.classList.contains('is-hidden')) {
      closeMistModal();
      return;
    }
    if (e.key === 'Escape') {
      closeSessionToolsDrawer();
    }
  });
  ui.btnLoadSites.addEventListener('click', loadSites);
  ui.mistSite.addEventListener('change', () => {
    mistContext.selectSite(ui.mistSite.value);
    const identity = deviceContext.matchResult?.identity ?? deviceContext.localIdentity;
    if (identity) renderDeviceSummary(identity);
  });
  ui.btnDhcpRefresh.addEventListener('click', runDhcpRefresh);
  ui.btnRestartMistAgent.addEventListener('click', runMistAgentRestart);
  ui.btnIdentify.addEventListener('click', identifySwitch);
  ui.btnLogin.addEventListener('click', loginToSwitch);
  ui.btnRootPassword.addEventListener('click', getRootPassword);
  ui.btnConfigSyncPreview.addEventListener('click', previewConfigSync);
  ui.btnCommitSync.addEventListener('click', doCommitSync);
  ui.btnRollbackSync.addEventListener('click', doRollbackSync);
  ui.btnOfflineTimeline.addEventListener('click', checkOfflineTimeline);
  ui.btnAdopt.addEventListener('click', adoptSwitch);
  ui.jmaRecommendation.addEventListener('click', (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    const restartButton = target.closest<HTMLButtonElement>('[data-action="restart-mist-agent"]');
    if (restartButton && !restartButton.disabled) {
      void runMistAgentRestart();
      return;
    }
    const button = target.closest<HTMLButtonElement>('[data-action="run-recommended-checks"]');
    if (!button || button.disabled) return;
    void runRecommendedChecksFromJma();
  });

  // ---- Accordion logic ----
  document.querySelectorAll('.accordion-trigger').forEach((trigger) => {
    trigger.addEventListener('click', () => {
      const isActive = trigger.classList.contains('active');
      const targetId = trigger.getAttribute('data-target');
      const content = document.getElementById(`accordion-${targetId}`);
      if (!content) return;

      if (isActive) {
        trigger.classList.remove('active');
        content.classList.remove('open');
      } else {
        trigger.classList.add('active');
        content.classList.add('open');
      }

      setTimeout(() => term.fit(), 300);
    });
  });

  // Handle unexpected port disconnect
  navigator.serial.addEventListener('disconnect', () => {
    if (serial.isConnected) {
      setConnectedState(false);
      term.writeError('— Port disconnected (cable removed?) —');
    }
    void refreshAuthorizedPortsCache();
  });

  navigator.serial.addEventListener('connect', () => {
    void refreshAuthorizedPortsCache();
  });

  // ---- Initial state ----
  renderCheckCatalog();
  activateResultsTab('checks');
  setConnectedState(false);
  void consumeLaunchContextFromUrl();
  term.writeSystem('Junos Console ready. Click "Connect" to select a serial port.');
  term.focus();
  void refreshAuthorizedPortsCache().then(() => tryAutoReconnectAuthorizedPort());
}
