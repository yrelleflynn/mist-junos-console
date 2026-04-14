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
import { MistApiService, MistPortStat } from './services/mist-api.service';
import { TroubleshootService, CheckResult, CheckStatus, LldpNeighbor, UpstreamPortConfig } from './services/troubleshoot.service';
import { SwitchIdentityService, MistMatchResult } from './services/switch-identity.service';
import { ConfigDriftService, ConfigDiffLine } from './services/config-drift.service';
import { MistCloud, MIST_CLOUDS, getCloudById } from './config/mist-clouds.config';
import './styles/main.css';

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
    // Connection
    btnConnect: document.getElementById('btn-connect') as HTMLButtonElement,
    btnDisconnect: document.getElementById('btn-disconnect') as HTMLButtonElement,
    btnClear: document.getElementById('btn-clear') as HTMLButtonElement,
    terminalContainer: document.getElementById('terminal-container') as HTMLElement,
    connectionBadge: document.getElementById('connection-badge') as HTMLElement,
    baudRate: document.getElementById('baud-rate') as HTMLSelectElement,
    dataBits: document.getElementById('data-bits') as HTMLSelectElement,
    parity: document.getElementById('parity') as HTMLSelectElement,
    stopBits: document.getElementById('stop-bits') as HTMLSelectElement,
    flowControl: document.getElementById('flow-control') as HTMLSelectElement,

    // Mist API
    mistCloud: document.getElementById('mist-cloud') as HTMLSelectElement,
    mistApiToken: document.getElementById('mist-api-token') as HTMLInputElement,
    mistOrgId: document.getElementById('mist-org-id') as HTMLInputElement,
    mistSite: document.getElementById('mist-site') as HTMLSelectElement,
    btnLoadSites: document.getElementById('btn-load-sites') as HTMLButtonElement,
    mistApiStatus: document.getElementById('mist-api-status') as HTMLElement,

    // Troubleshooting
    tsUplinkPort: document.getElementById('ts-uplink-port') as HTMLInputElement,
    btnRunTroubleshoot: document.getElementById('btn-run-troubleshoot') as HTMLButtonElement,
    btnMistStatus: document.getElementById('btn-mist-status') as HTMLButtonElement,
    btnSslCheck: document.getElementById('btn-ssl-check') as HTMLButtonElement,
    tsResults: document.getElementById('ts-results') as HTMLElement,

    // Device Identity & Config
    btnExamine: document.getElementById('btn-examine') as HTMLButtonElement,
    examineResult: document.getElementById('examine-result') as HTMLElement,
    btnDisableAiu: document.getElementById('btn-disable-aiu') as HTMLButtonElement,
    aiuResult: document.getElementById('aiu-result') as HTMLElement,
    deviceIdentity: document.getElementById('device-identity') as HTMLElement,
    btnConfigDrift: document.getElementById('btn-config-drift') as HTMLButtonElement,
    configDriftResults: document.getElementById('config-drift-results') as HTMLElement,
    btnOfflineTimeline: document.getElementById('btn-offline-timeline') as HTMLButtonElement,
    timelineResults: document.getElementById('timeline-results') as HTMLElement,
    btnAdopt: document.getElementById('btn-adopt') as HTMLButtonElement,
    adoptRootPw: document.getElementById('adopt-root-pw') as HTMLInputElement,
    adoptResults: document.getElementById('adopt-results') as HTMLElement,
  };

  // ---- Populate Mist cloud dropdown ----
  MIST_CLOUDS.forEach((cloud) => {
    const opt = document.createElement('option');
    opt.value = cloud.id;
    opt.textContent = `${cloud.name} (${cloud.apiHost})`;
    ui.mistCloud.appendChild(opt);
  });
  // Default to APAC 01
  const apac01 = MIST_CLOUDS.find((c) => c.id === 'apac01');
  if (apac01) ui.mistCloud.value = apac01.id;

  // ---- Create instances ----
  const serial = new SerialService();
  const term = new TerminalComponent(ui.terminalContainer);
  const cmdRunner = new CommandRunnerService(serial);
  const mistApi = new MistApiService();
  const troubleshooter = new TroubleshootService(cmdRunner, mistApi);
  const switchIdentity = new SwitchIdentityService(cmdRunner, mistApi);
  const configDrift = new ConfigDriftService();

  // Store the last match result for use in config drift
  let lastMatchResult: MistMatchResult | null = null;

  // ---- Configuration change log ----
  interface ConfigChange {
    timestamp: Date;
    source: string;
    description: string;
    commands: string[];
  }
  const configChanges: ConfigChange[] = [];

  function recordChange(source: string, description: string, commands: string[]): void {
    configChanges.push({ timestamp: new Date(), source, description, commands });
    updateChangeBadge();
  }

  function updateChangeBadge(): void {
    const btn = document.getElementById('btn-show-changes') as HTMLButtonElement | null;
    if (!btn) return;
    const count = configChanges.length;
    btn.textContent = count > 0 ? `Config Changes (${count})` : 'Config Changes';
    btn.classList.toggle('btn-changes-active', count > 0);
  }

  function showConfigChangesModal(): void {
    const existing = document.getElementById('config-changes-overlay');
    if (existing) existing.remove();

    const overlay = document.createElement('div');
    overlay.id = 'config-changes-overlay';
    overlay.className = 'check-modal-overlay';

    const modal = document.createElement('div');
    modal.className = 'check-modal';
    modal.style.maxWidth = '700px';

    const header = document.createElement('div');
    header.className = 'check-modal-header';
    header.innerHTML = `
      <span class="check-modal-title">Configuration Changes Made This Session</span>
      <button class="check-modal-close" id="config-changes-close">&times;</button>
    `;
    modal.appendChild(header);

    const body = document.createElement('div');
    body.style.padding = '16px';

    if (configChanges.length === 0) {
      body.innerHTML = '<div class="check-modal-detail" style="border:none;">No configuration changes have been made this session.</div>';
    } else {
      const warning = document.createElement('div');
      warning.style.cssText = 'background:rgba(210,153,34,0.12);border:1px solid rgba(210,153,34,0.4);border-radius:6px;padding:10px 14px;margin-bottom:16px;font-size:12px;line-height:1.6;color:var(--text-secondary);';
      warning.innerHTML = `<strong style="color:#d2993a;">⚠ Important — Mist Configuration Warning</strong><br>
The changes below were applied directly to the switch. Mist manages this switch and will push its own configuration on the next sync. If these changes are not reflected in the Mist device or site configuration, they <strong>will be overwritten</strong> and the switch may lose connectivity or revert to a broken state.<br><br>
<strong>Review each change in Mist and update the Mist configuration if required before the next sync.</strong>`;
      body.appendChild(warning);

      configChanges.forEach((change, i) => {
        const entry = document.createElement('div');
        entry.style.cssText = 'margin-bottom:14px;padding-bottom:14px;border-bottom:1px solid var(--border-color);';
        const ts = change.timestamp.toLocaleTimeString();
        const cmds = change.commands.length > 0
          ? `<pre style="margin:6px 0 0;background:var(--bg-secondary);border-radius:4px;padding:8px 10px;font-size:11px;overflow-x:auto;white-space:pre-wrap;">${escapeHtml(change.commands.join('\n'))}</pre>`
          : '';
        entry.innerHTML = `
          <div style="display:flex;align-items:baseline;gap:8px;margin-bottom:4px;">
            <span style="font-size:11px;font-weight:600;color:var(--text-primary);">${i + 1}. ${escapeHtml(change.source)}</span>
            <span style="font-size:10px;color:var(--text-muted);">${ts}</span>
          </div>
          <div style="font-size:12px;color:var(--text-secondary);line-height:1.5;">${escapeHtml(change.description)}</div>
          ${cmds}
        `;
        body.appendChild(entry);
      });
    }

    modal.appendChild(body);
    overlay.appendChild(modal);
    document.body.appendChild(overlay);

    const close = (): void => overlay.remove();
    document.getElementById('config-changes-close')?.addEventListener('click', close);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
  }

  // ---- UI state helpers ----
  function setConnectedState(connected: boolean): void {
    ui.btnConnect.disabled = connected;
    ui.btnDisconnect.disabled = !connected;
    ui.baudRate.disabled = connected;
    ui.dataBits.disabled = connected;
    ui.parity.disabled = connected;
    ui.stopBits.disabled = connected;
    ui.flowControl.disabled = connected;
    ui.btnRunTroubleshoot.disabled = !connected;
    ui.btnMistStatus.disabled = !connected;
    ui.btnSslCheck.disabled = !connected;
    document.querySelectorAll<HTMLButtonElement>('.ts-layer-run-btn').forEach(b => { b.disabled = !connected; });
    ui.btnExamine.disabled = !connected;
    ui.btnDisableAiu.disabled = !connected;
    ui.btnAdopt.disabled = !connected;
    // Config drift only enabled after identification succeeds
    if (!connected) {
      ui.btnConfigDrift.disabled = true;
      ui.btnOfflineTimeline.disabled = true;
      lastMatchResult = null;
      cmdRunner.resetSessionState();
    }

    if (connected) {
      ui.connectionBadge.textContent = 'Connected';
      ui.connectionBadge.className = 'badge badge-connected';
      term.focus();
    } else {
      ui.connectionBadge.textContent = 'Disconnected';
      ui.connectionBadge.className = 'badge badge-disconnected';
    }
  }

  function setMistStatus(text: string, type: 'success' | 'error' | 'info' = 'info'): void {
    ui.mistApiStatus.textContent = text;
    ui.mistApiStatus.className = `status-text ${type}`;
  }

  // ---- Serial events ----
  serial.on('data', (data: Uint8Array) => {
    term.write(data);
  });

  serial.on('connect', () => {
    setConnectedState(true);
    const baudRate = ui.baudRate.value;
    const dataBits = ui.dataBits.value;
    const parity = ui.parity.value[0].toUpperCase();
    const stopBits = ui.stopBits.value;
    term.writeSystem(`— Connected (${baudRate} baud, ${dataBits}${parity}${stopBits}) —`);
    showCliModeModal();
  });

  serial.on('disconnect', () => {
    setConnectedState(false);
    term.writeSystem('— Disconnected —');
  });

  serial.on('error', (err: Error) => {
    term.writeError(`Error: ${err.message}`);
  });

  // ---- Terminal user input → serial ----
  term.onInput = async (data: string) => {
    if (serial.isConnected) {
      try {
        await serial.writeString(data);
      } catch (err) {
        term.writeError(`Send error: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  };

  // ---- Connect ----
  async function connect(): Promise<void> {
    ui.connectionBadge.textContent = 'Connecting…';
    ui.connectionBadge.className = 'badge badge-connecting';
    ui.btnConnect.disabled = true;

    try {
      await serial.connect({
        baudRate: parseInt(ui.baudRate.value, 10),
        dataBits: parseInt(ui.dataBits.value, 10) as 7 | 8,
        parity: ui.parity.value as ParityType,
        stopBits: parseInt(ui.stopBits.value, 10) as 1 | 2,
        flowControl: ui.flowControl.value as FlowControlType,
      });
    } catch (err) {
      setConnectedState(false);
      if (err instanceof DOMException && err.name === 'NotFoundError') {
        // User cancelled
      } else {
        term.writeError(`Connection failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }

  // ---- Disconnect ----
  async function disconnect(): Promise<void> {
    try {
      await serial.disconnect();
    } catch (err) {
      term.writeError(`Disconnect error: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // ---- Mist API: Load sites ----
  async function loadSites(): Promise<void> {
    const token = ui.mistApiToken.value.trim();
    const orgId = ui.mistOrgId.value.trim();
    const cloudId = ui.mistCloud.value;
    const cloud = getCloudById(cloudId);

    if (!token || !orgId || !cloud) {
      setMistStatus('Please fill in API token, Org ID, and select a cloud.', 'error');
      return;
    }

    mistApi.configure(token, cloud.apiHost, orgId);
    setMistStatus('Loading sites…', 'info');
    ui.btnLoadSites.disabled = true;

    try {
      const sites = await mistApi.listSites();
      ui.mistSite.innerHTML = '';

      if (sites.length === 0) {
        const opt = document.createElement('option');
        opt.value = '';
        opt.textContent = '— No sites found —';
        ui.mistSite.appendChild(opt);
        setMistStatus('No sites found in this org.', 'error');
      } else {
        sites.sort((a, b) => a.name.localeCompare(b.name));
        sites.forEach((site) => {
          const opt = document.createElement('option');
          opt.value = site.id;
          opt.textContent = site.name;
          ui.mistSite.appendChild(opt);
        });
        ui.mistSite.disabled = false;
        setMistStatus(`${sites.length} site(s) loaded.`, 'success');
      }
    } catch (err) {
      setMistStatus(`Failed: ${err instanceof Error ? err.message : String(err)}`, 'error');
    } finally {
      ui.btnLoadSites.disabled = false;
    }
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

  // Context captured during the last troubleshoot run — used for per-test reruns
  let currentCloud: ReturnType<typeof getCloudById> = undefined;
  let currentUplinkPort = '';
  let currentMgmtIp: string | null = null;
  let currentLldpNeighbor: LldpNeighbor | null = null;
  let currentUpstreamPortConfig: UpstreamPortConfig | null = null;
  let abortTroubleshoot = false;

  interface CheckGroup {
    key: string;
    label: string;
    badge: string;
    checks: Array<{ id: string; name: string }>;
  }

  const LAYERED_CHECKS: CheckGroup[] = [
    {
      key: 'preflight',
      label: 'Pre-flight',
      badge: 'Pre-flight',
      checks: [
        { id: 'root-password', name: 'Root Password' },
        { id: 'junos-version', name: 'Junos Version' },
      ],
    },
    {
      key: 'l1',
      label: 'L1 — Physical',
      badge: 'L1 Physical',
      checks: [
        { id: 'lldp',                  name: 'LLDP Neighbors' },
        { id: 'upstream-port-config',  name: 'Upstream Switch Port Config' },
        { id: 'uplink-config-compare', name: 'Uplink Config Match' },
        { id: 'upstream-empty-trunk',  name: 'Upstream Trunk VLAN Config' },
        { id: 'port-status',           name: 'Port Status' },
        { id: 'interface-errors',      name: 'Interface Errors' },
      ],
    },
    {
      key: 'l2',
      label: 'L2 — Data Link',
      badge: 'L2 Data Link',
      checks: [
        { id: 'vlan-config',       name: 'VLAN Config' },
        { id: 'stp-status',        name: 'STP Port State' },
        { id: 'stp-upstream-edge', name: 'Upstream STP Edge Config' },
      ],
    },
    {
      key: 'l3',
      label: 'L3 — Network',
      badge: 'L3 Network',
      checks: [
        { id: 'mgmt-ip',       name: 'Management IP' },
        { id: 'dhcp-lease',    name: 'DHCP Lease' },
        { id: 'arp',           name: 'ARP Table' },
        { id: 'default-route', name: 'Default Route' },
      ],
    },
    {
      key: 'dns',
      label: 'DNS & Routing',
      badge: 'DNS',
      checks: [
        { id: 'dns-config',     name: 'DNS Config' },
        { id: 'dns-resolution', name: 'DNS Resolution' },
        { id: 'route-to-mist',  name: 'Route to Mist' },
      ],
    },
    {
      key: 'agent',
      label: 'Mist Agent',
      badge: 'Agent',
      checks: [
        { id: 'mist-agent',          name: 'Mist Agent Version' },
        { id: 'mist-processes',      name: 'Mist Agent Processes' },
        { id: 'outbound-ssh-config', name: 'Outbound SSH Config' },
        { id: 'cloud-connections',   name: 'Active Cloud Connections' },
      ],
    },
  ];

  // Flat list for code that needs all checks in order
  const STATIC_CHECKS = LAYERED_CHECKS.flatMap(g => g.checks);

  // Sequential number for each static check (1-based), used for display
  const CHECK_NUMBER_MAP = new Map<string, number>(
    STATIC_CHECKS.map((c, i) => [c.id, i + 1])
  );

  // CLI commands each check runs (used for preview modal before/without a connection)
  const STATIC_CHECK_COMMANDS: Record<string, string[]> = {
    'root-password':       ['show configuration system root-authentication'],
    'junos-version':       ['show version | match "Junos:"'],
    'lldp':                ['show lldp neighbors'],
    'upstream-port-config':  [],  // Mist API lookup — no CLI commands
    'uplink-config-compare': ['show configuration interfaces <uplink-port> | display set', 'show configuration vlans | display set'],
    'upstream-empty-trunk':  [],  // Mist API check — no CLI commands
    'port-status':         ['show interfaces <uplink-port> terse', 'show interfaces <uplink-port>'],
    'interface-errors':    ['show interfaces <uplink-port> extensive | match error'],
    'vlan-config':         ['show vlans interface <uplink-port>'],
    'stp-status':          ['show spanning-tree interface <uplink-port>'],
    'stp-upstream-edge':   [],  // Mist API check — no CLI commands
    'mgmt-ip':             ['show interfaces terse | match "inet "'],
    'dhcp-lease':          ['show dhcp client binding', 'show dhcp client binding detail'],
    'arp':                 ['show arp no-resolve'],
    'default-route':       ['show route 0.0.0.0/0'],
    'dns-config':          ['show configuration system name-server', 'show system name-server'],
    'dns-resolution':      ['ping inet <mist-endpoint> count 3 rapid'],
    'route-to-mist':       ['show host <mist-endpoint>', 'show route <ip>'],
    'mist-agent':          ['show version | match mist'],
    'mist-processes':      ["/bin/sh -c 'ps aux | grep -E \"mcd|jmd\" | grep -v grep'"],
    'outbound-ssh-config': ['show configuration system services outbound-ssh'],
    'cloud-connections':   ['show system connections | grep <mgmt-ip>'],
  };

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
    const num = CHECK_NUMBER_MAP.get(result.id);
    const numBadge = num !== undefined ? `<span class="ts-check-num">${num}</span>` : '';

    el.innerHTML = `
      <span class="ts-check-icon">${statusIcon(result.status)}</span>
      <div class="ts-check-body">
        <div class="ts-check-name">${numBadge}${result.name}${hasContent ? '<span class="ts-expand-hint">ⓘ</span>' : ''}</div>
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

  function renderPendingCard(id: string, name: string): HTMLElement {
    const el = document.createElement('div');
    el.className = 'ts-check pending';
    el.id = `ts-check-${id}`;
    el.style.cursor = 'pointer';
    el.title = 'Click to preview commands';
    const num = CHECK_NUMBER_MAP.get(id);
    const numBadge = num !== undefined ? `<span class="ts-check-num">${num}</span>` : '';
    el.innerHTML = `
      <span class="ts-check-icon">${statusIcon('pending')}</span>
      <div class="ts-check-body">
        <div class="ts-check-name">${numBadge}${name}<span class="ts-expand-hint">ⓘ</span></div>
        <div class="ts-check-detail ts-pending-detail">Click to preview</div>
      </div>`;
    el.addEventListener('click', () => showCheckPreviewModal(id, name));
    return el;
  }

  function showCheckPreviewModal(id: string, name: string): void {
    const existing = document.getElementById('check-modal-overlay');
    if (existing) existing.remove();

    const commands = STATIC_CHECK_COMMANDS[id] ?? [];

    const overlay = document.createElement('div');
    overlay.id = 'check-modal-overlay';
    overlay.className = 'check-modal-overlay';

    const modal = document.createElement('div');
    modal.className = 'check-modal';

    const headerDiv = document.createElement('div');
    headerDiv.className = 'check-modal-header';
    headerDiv.innerHTML = `
      <span class="check-modal-status ts-check-icon pending" id="check-modal-status-icon">${statusIcon('pending')}</span>
      <span class="check-modal-title">${name}</span>
      <div class="check-modal-header-actions">
        <button class="btn btn-primary btn-sm" id="check-modal-run-test">Run Test Now</button>
        <button class="check-modal-close" id="check-modal-close-btn">&times;</button>
      </div>`;

    const bodyDiv = document.createElement('div');
    bodyDiv.id = 'check-modal-body';

    let html = `<div class="check-modal-detail">This check has not been run yet.</div>`;

    if (commands.length > 0) {
      html += `<div class="check-modal-section">`;
      html += `<div class="check-modal-section-title">Commands Run by This Check</div>`;
      html += `<pre class="check-modal-raw">`;
      for (const cmd of commands) {
        html += escapeHtml(cmd) + '\n';
      }
      html += `</pre>`;
      const hasPlaceholders = commands.some((c) => /<[\w-]+>/.test(c));
      if (hasPlaceholders) {
        html += `<div class="check-modal-placeholder-warn">⚠ Some commands use runtime values (e.g. &lt;uplink-port&gt;, &lt;mgmt-ip&gt;) resolved when the check runs.</div>`;
      }
      html += `</div>`;
    }

    bodyDiv.innerHTML = html;

    modal.appendChild(headerDiv);
    modal.appendChild(bodyDiv);
    overlay.appendChild(modal);
    document.body.appendChild(overlay);

    const closeModal = () => overlay.remove();
    headerDiv.querySelector<HTMLButtonElement>('#check-modal-close-btn')!
      .addEventListener('click', closeModal);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) closeModal(); });

    headerDiv.querySelector<HTMLButtonElement>('#check-modal-run-test')!
      .addEventListener('click', async () => {
        if (!serial.isConnected) {
          bodyDiv.innerHTML = `<div class="check-modal-detail" style="color:var(--text-warn);">Not connected to a switch. Connect via serial first, then run this test.</div>`;
          return;
        }
        overlay.remove();
        await runSingleCheck(id, name);
      });
  }

  async function runSingleCheck(id: string, name: string): Promise<void> {
    if (!serial.isConnected) {
      term.writeError('Not connected to a switch. Connect via serial first.');
      return;
    }
    const inOpMode = await requireOperationalMode();
    if (!inOpMode) return;

    // Clear any stored result for this check before running
    accumulatedResults = accumulatedResults.filter(r => r.id !== id);

    const runningEl = renderCheckResult({ id, name, status: 'running', detail: 'Running…' });
    document.getElementById(`ts-check-${id}`)?.replaceWith(runningEl);

    try {
      const raw = await rerunCheck({ id, name, status: 'pending', detail: '' });
      const results = Array.isArray(raw) ? raw : [raw];
      for (const result of results) {
        // Remove any stale entry for this result ID, then record the fresh result
        accumulatedResults = accumulatedResults.filter(r => r.id !== result.id);
        accumulatedResults.push(result);

        const newEl = renderCheckResult(result);
        const existing = document.getElementById(`ts-check-${result.id}`);
        if (existing) {
          existing.replaceWith(newEl);
        } else {
          runningEl.parentElement?.appendChild(newEl);
        }
      }
    } catch (err) {
      const errEl = renderCheckResult({
        id, name, status: 'fail',
        detail: err instanceof Error ? err.message : 'Check failed',
      });
      document.getElementById(`ts-check-${id}`)?.replaceWith(errEl);
    }
  }

  function initTsCheckList(): void {
    ui.tsResults.innerHTML = '';
    for (const group of LAYERED_CHECKS) {
      const groupEl = document.createElement('div');
      groupEl.className = 'ts-layer-group';
      groupEl.dataset.layer = group.key;

      const header = document.createElement('div');
      header.className = 'ts-layer-header';
      header.innerHTML = `<span class="ts-layer-label">${group.label}</span>`;
      groupEl.appendChild(header);

      for (const check of group.checks) {
        groupEl.appendChild(renderPendingCard(check.id, check.name));
      }
      ui.tsResults.appendChild(groupEl);
    }
  }

  /** Inject per-layer run buttons into the sidebar row. */
  function initLayerButtons(): void {
    const row = document.getElementById('ts-layer-btn-row');
    if (!row) return;
    for (const group of LAYERED_CHECKS) {
      const btn = document.createElement('button');
      btn.className = 'btn btn-secondary btn-sm ts-layer-run-btn';
      btn.textContent = group.badge;
      btn.title = `Run ${group.label} checks`;
      btn.disabled = true;
      btn.addEventListener('click', () => runLayerGroup(group.key));
      row.appendChild(btn);
    }
  }

  /** Run only the checks in one OSI layer group. */
  async function runLayerGroup(layerKey: string): Promise<void> {
    if (!serial.isConnected) {
      term.writeError('Not connected to a switch. Connect via serial first.');
      return;
    }
    const inOpMode = await requireOperationalMode();
    if (!inOpMode) return;

    const group = LAYERED_CHECKS.find(g => g.key === layerKey);
    if (!group) return;

    document.querySelectorAll<HTMLButtonElement>('.ts-layer-run-btn').forEach(b => { b.disabled = true; });
    ui.btnRunTroubleshoot.disabled = true;

    term.writeSystem(`— Running ${group.label} —`);
    try {
      for (const check of group.checks) {
        await runSingleCheck(check.id, check.name);
      }
      term.writeSystem(`— ${group.label} complete —`);
    } finally {
      document.querySelectorAll<HTMLButtonElement>('.ts-layer-run-btn').forEach(b => { b.disabled = false; });
      ui.btnRunTroubleshoot.disabled = false;
    }
  }

  /**
   * Re-run a single check by its result ID, using the context from the last full run.
   * Returns the new result (or array of results for multi-result checks).
   */
  async function rerunCheck(result: CheckResult): Promise<CheckResult | CheckResult[]> {
    await cmdRunner.ensureOperationalMode();
    const id = result.id;

    // Pre-flight checks
    if (id === 'root-password') {
      const { rootPasswordCheck } = await import('./checks/root-password.check');
      return rootPasswordCheck.run({
        runner: cmdRunner,
        mistApi,
        siteId: ui.mistSite.value || undefined,
        promptPassword: (message) => promptForRootPassword(message),
      }) as Promise<CheckResult>;
    }

    // Simple checks — no extra context needed
    if (id === 'junos-version') return troubleshooter.checkJunosVersion();
    if (id === 'mgmt-ip') {
      currentMgmtIp = null;  // clear stale value so subsequent checks don't use it
      const r = await troubleshooter.checkInterfaceIp();
      if (r.mgmtIp) currentMgmtIp = r.mgmtIp;
      return r.result;
    }
    if (id === 'dhcp-lease') return troubleshooter.checkDhcpLease();
    if (id === 'arp') return troubleshooter.checkArp();
    if (id === 'default-route') return troubleshooter.checkDefaultRoute();
    if (id === 'dns-config') return troubleshooter.checkDnsConfig();
    if (id === 'mist-agent') return troubleshooter.checkMistAgentVersion();
    if (id === 'mist-processes') return troubleshooter.checkMistAgentProcesses();
    if (id === 'outbound-ssh-config') return (await troubleshooter.checkOutboundSshConfig()).result;

    // Checks needing uplinkPort
    if (id === 'lldp') {
      const r = await troubleshooter.checkLldp(currentUplinkPort);
      if (r.detectedPort) currentUplinkPort = r.detectedPort;
      if (r.uplinkNeighbor) {
        currentLldpNeighbor = r.uplinkNeighbor;
        // Re-run upstream port config lookup (async, result stored for mgmt-ip remediation)
        currentUpstreamPortConfig = null;
        troubleshooter.lookupUpstreamPortConfig(r.uplinkNeighbor).then(res => {
          currentUpstreamPortConfig = res.config;
        });
      }
      if (r.needsUpstreamSelection) r.result.needsUpstreamSelection = true;
      return r.result;
    }
    if (id === 'upstream-port-config') {
      if (!currentLldpNeighbor) {
        return { id, name: 'Upstream Switch Port Config', status: 'skip' as CheckStatus,
          detail: 'No LLDP neighbor — run LLDP check first' };
      }
      const r = await troubleshooter.lookupUpstreamPortConfig(currentLldpNeighbor);
      currentUpstreamPortConfig = r.config;
      return r.result;
    }
    if (id === 'uplink-config-compare') {
      if (!currentLldpNeighbor || !currentUpstreamPortConfig || !currentUplinkPort) {
        return { id, name: 'Uplink Config Match', status: 'skip' as CheckStatus,
          detail: 'Requires upstream port config — run LLDP check first' };
      }
      const siteId = ui.mistSite.value || undefined;
      const deviceId = lastMatchResult?.mistDevice?.id || undefined;
      const results = await troubleshooter.compareUplinkConfig(
        currentUplinkPort, currentUpstreamPortConfig, siteId, deviceId,
      );
      return results[0] ?? { id, name: 'Uplink Config Match', status: 'skip' as CheckStatus,
        detail: 'No comparison results' };
    }
    if (id === 'upstream-empty-trunk') {
      if (!currentLldpNeighbor || !currentUpstreamPortConfig || !currentUplinkPort) {
        return { id, name: 'Upstream Trunk VLAN Config', status: 'skip' as CheckStatus,
          detail: 'Requires upstream port config — run LLDP check first' };
      }
      const siteId = ui.mistSite.value || undefined;
      const deviceId = lastMatchResult?.mistDevice?.id || undefined;
      const results = await troubleshooter.compareUplinkConfig(
        currentUplinkPort, currentUpstreamPortConfig, siteId, deviceId,
      );
      const emtResult = results.find((r) => r.id === 'upstream-empty-trunk');
      return emtResult ?? { id, name: 'Upstream Trunk VLAN Config', status: 'pass' as CheckStatus,
        detail: 'Upstream trunk port has VLANs configured' };
    }
    if (id === 'port-status') return troubleshooter.checkPortStatus(currentUplinkPort);
    if (id === 'interface-errors') return troubleshooter.checkInterfaceErrors(currentUplinkPort);
    if (id === 'vlan-config') return troubleshooter.checkVlanConfig(currentUplinkPort);
    if (id === 'stp-status' || id === 'stp-upstream-edge') {
      const stpResults = await troubleshooter.checkStpStatus(currentUplinkPort, currentLldpNeighbor);
      const match = stpResults.find((r) => r.id === id);
      if (match) return match;
      // stp-upstream-edge is not emitted when the port is Root — return a skip
      if (id === 'stp-upstream-edge') {
        return { id, name: 'Upstream STP Edge Config', status: 'skip' as CheckStatus,
          detail: 'Skipped — port is Root or STP check has not run yet' };
      }
      throw new Error(`STP check did not return result for ${id}`);
    }

    // Checks needing cloud
    if (currentCloud) {
      if (id === 'dns-resolution') return troubleshooter.checkDnsResolution(currentCloud);
      if (id === 'route-to-mist') return troubleshooter.checkRouteToMistEndpoints(currentCloud);

      // Endpoint-based: reach-*, cert-*, trace-*, fw-policy-*, fw-inspect-*
      if (id.startsWith('reach-') || id.startsWith('fw-policy-')) {
        const colonIdx = result.name.lastIndexOf(':');
        const host = result.name.substring(0, colonIdx).trim();
        const port = parseInt(result.name.substring(colonIdx + 1).trim(), 10);
        const endpoint = currentCloud.switchEndpoints.find((e) => e.host === host && e.port === port);
        if (endpoint) return troubleshooter.checkEndpointReachability(endpoint);
      }
      if (id.startsWith('cert-') || id.startsWith('fw-inspect-')) {
        const host = result.name.replace(/^(SSL Cert: |Inspection: )/, '').trim();
        const endpoint = currentCloud.switchEndpoints.find((e) => e.host === host);
        if (endpoint) return troubleshooter.checkSslCertificate(endpoint);
      }
      if (id.startsWith('trace-')) {
        const host = result.name.replace(/^Traceroute /, '').trim();
        const endpoint = currentCloud.switchEndpoints.find((e) => e.host === host);
        if (endpoint) return troubleshooter.checkTraceroute(endpoint);
      }
    }

    // Cloud + mgmtIp
    if (id === 'cloud-connections') {
      return troubleshooter.checkActiveCloudConnections(currentMgmtIp, currentCloud);
    }

    throw new Error(`Re-run not supported for check: ${id}`);
  }

  /**
   * Step 1 — Fetch site inventory and render a switch list.
   * Clicking a switch advances to step 2 (port selection).
   */
  async function showUpstreamSwitchSelector(container: HTMLElement): Promise<void> {
    const siteId = ui.mistSite.value;
    container.innerHTML = '<div class="check-modal-cmd-line">Loading switches from Mist inventory…</div>';

    try {
      const inventory = await mistApi.getInventory();
      const siteDevices = siteId
        ? inventory.filter((d) => d.site_id === siteId)
        : inventory;

      if (siteDevices.length === 0) {
        container.innerHTML = '<div class="check-modal-cmd-error">No switches found in the selected Mist site.</div>';
        return;
      }

      container.innerHTML = `
        <p class="upstream-step-label">Step 1 of 2 — Select the upstream switch this device is connected to:</p>
        <div class="upstream-switch-list" id="upstream-switch-list"></div>
      `;
      const listEl = container.querySelector<HTMLElement>('#upstream-switch-list')!;

      for (const dev of siteDevices) {
        const item = document.createElement('div');
        item.className = 'upstream-switch-item';
        const connectedDot = dev.connected === false
          ? '<span class="upstream-switch-status offline">●</span>'
          : '<span class="upstream-switch-status online">●</span>';
        item.innerHTML = `
          <div class="upstream-switch-item-top">
            ${connectedDot}
            <span class="upstream-switch-name">${escapeHtml(dev.name || dev.mac || dev.id)}</span>
          </div>
          <span class="upstream-switch-meta">${escapeHtml(dev.model || '')}  ·  ${escapeHtml(dev.mac || '')}</span>
        `;
        item.addEventListener('click', async () => {
          // Replace the whole container with step 2
          container.innerHTML = `<div class="check-modal-cmd-line">Loading ports for ${escapeHtml(dev.name || dev.mac)}…</div>`;
          await showUpstreamPortSelector(container, dev.id, dev.site_id || siteId, dev.mac || '', dev.name || dev.mac || dev.id);
        });
        listEl.appendChild(item);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      container.innerHTML = `<div class="check-modal-cmd-error">Failed to load inventory: ${escapeHtml(msg)}</div>`;
    }
  }

  /**
   * Step 2 — Show all ports of the selected switch using the org port-search endpoint.
   * User picks the port the console-connected switch is plugged into.
   * Falls back to manual entry if the API returns no data.
   */
  async function showUpstreamPortSelector(
    container: HTMLElement,
    deviceId: string,
    siteId: string,
    switchMac: string,
    switchName: string,
  ): Promise<void> {
    const backBtn = `<button class="btn btn-secondary btn-sm" id="upstream-back-btn" style="margin-bottom:10px;">← Back to switch list</button>`;

    const wireBack = () => {
      container.querySelector<HTMLButtonElement>('#upstream-back-btn')?.addEventListener('click', () => {
        showUpstreamSwitchSelector(container);
      });
    };

    const renderGrid = (ports: MistPortStat[]) => {
      container.innerHTML = `
        ${backBtn}
        <p class="upstream-step-label">Step 2 of 2 — Select the port on <strong>${escapeHtml(switchName)}</strong> that this switch is connected to:</p>
        <div class="upstream-port-grid" id="upstream-port-grid"></div>
        <div id="upstream-port-analysis"></div>
      `;
      wireBack();

      const grid = container.querySelector<HTMLElement>('#upstream-port-grid')!;

      for (const p of ports) {
        const iface = p.port_id;
        const stpState = p.stp_state ?? '';
        const isDisabled = p.port_disabled === true;
        const isUp = p.up === true;

        const item = document.createElement('div');
        item.className = 'upstream-port-grid-item';

        let stateCls = 'neutral';
        let stateLabel = 'Down';
        if (isDisabled)                       { stateCls = 'error'; stateLabel = 'Err-dis'; }
        else if (/blocking/i.test(stpState))  { stateCls = 'warn';  stateLabel = 'Blocked'; }
        else if (isUp)                        { stateCls = 'ok';    stateLabel = 'Up'; }

        item.innerHTML = `
          <span class="upstream-port-grid-iface">${escapeHtml(iface)}</span>
          <span class="upstream-port-grid-state ${stateCls}">${stateLabel}</span>
        `;
        item.dataset.iface = iface;

        item.addEventListener('click', () => {
          grid.querySelectorAll('.upstream-port-grid-item').forEach((el) => el.classList.remove('selected'));
          item.classList.add('selected');
          const analysisEl = container.querySelector<HTMLElement>('#upstream-port-analysis')!;

          // Proactive alert for STP blocking
          if (/blocking/i.test(stpState)) {
            analysisEl.innerHTML = `
              <div class="upstream-analysis-box" style="margin-top:10px;">
                <div class="upstream-analysis-title">Port ${escapeHtml(iface)} — ${escapeHtml(switchName)}</div>
                <div class="check-modal-cmd-error">
                  <strong>STP state: Blocking</strong> — BPDU Guard is active on this port.
                  The upstream switch is dropping spanning-tree BPDUs from the downstream switch,
                  which is preventing LLDP and connectivity from being established.
                </div>
              </div>`;
            // Then load the full analysis below the alert
            showPortAnalysis(analysisEl, deviceId, siteId, iface, switchName, isDisabled, stpState);
          } else {
            showPortAnalysis(analysisEl, deviceId, siteId, iface, switchName, isDisabled, stpState);
          }
        });

        grid.appendChild(item);
      }
    };

    /** Manual port-entry fallback when the API returns nothing */
    const renderManualEntry = (reason: string) => {
      container.innerHTML = `
        ${backBtn}
        <p class="upstream-step-label">Step 2 of 2 — Port on <strong>${escapeHtml(switchName)}</strong></p>
        <div class="check-modal-cmd-line" style="color:var(--text-secondary);margin-bottom:8px;">${escapeHtml(reason)} Enter the port name manually to continue.</div>
        <div style="display:flex;gap:8px;align-items:center;">
          <input type="text" id="upstream-manual-port" class="input-field" placeholder="e.g. ge-0/0/1 or xe-0/0/0" style="flex:1;" autocomplete="off">
          <button class="btn btn-primary btn-sm" id="upstream-manual-ok">Inspect Port</button>
        </div>
        <div id="upstream-port-analysis" style="margin-top:10px;"></div>
      `;
      wireBack();
      const input = container.querySelector<HTMLInputElement>('#upstream-manual-port')!;
      const ok = container.querySelector<HTMLButtonElement>('#upstream-manual-ok')!;
      const analysisEl = container.querySelector<HTMLElement>('#upstream-port-analysis')!;
      const go = () => {
        const iface = input.value.trim();
        if (!iface) return;
        showPortAnalysis(analysisEl, deviceId, siteId, iface, switchName, false, '');
      };
      ok.addEventListener('click', go);
      input.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); });
      setTimeout(() => input.focus(), 50);
    };

    try {
      const portStats = await mistApi.getPortStats(siteId, switchMac);

      // Filter to physical switch ports only
      const ports = portStats
        .filter((p) => /^(ge-|xe-|et-|mge-)/i.test(p.port_id))
        .sort((a, b) => a.port_id.localeCompare(b.port_id, undefined, { numeric: true }));

      if (ports.length === 0) {
        renderManualEntry('No port data was returned from Mist for this switch (it may be offline).');
        return;
      }

      renderGrid(ports);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      renderManualEntry(`Could not load port stats: ${msg}.`);
    }
  }

  /**
   * Step 3 — Analyse the selected port and offer remediation.
   */
  async function showPortAnalysis(
    container: HTMLElement,
    deviceId: string,
    siteId: string,
    iface: string,
    switchName: string,
    isErrorDisabled: boolean,
    stpState: string,
  ): Promise<void> {
    container.innerHTML = `<div class="check-modal-cmd-line" style="margin-top:10px;">Checking port ${escapeHtml(iface)} configuration…</div>`;

    const isBlocked = /blocking/i.test(stpState);

    if (!isErrorDisabled && !isBlocked) {
      // Port looks normal — still show info and bounce option
      container.innerHTML = `
        <div class="upstream-analysis-box" style="margin-top:10px;">
          <div class="upstream-analysis-title">Port ${escapeHtml(iface)} — ${escapeHtml(switchName)}</div>
          <div class="check-modal-cmd-success">This port appears healthy (Up, STP forwarding).</div>
          <div class="check-modal-cmd-line" style="color:var(--text-secondary);font-size:12px;margin-top:4px;">
            LLDP may be disabled on the upstream device, or the link may have a layer-1 issue.
            You can still bounce the port to clear any transient state.
          </div>
          <div class="check-modal-actions" style="margin-top:8px;">
            <button class="btn btn-secondary btn-sm" id="bounce-btn">Bounce Port</button>
          </div>
          <div id="analysis-output"></div>
        </div>`;
      container.querySelector<HTMLButtonElement>('#bounce-btn')?.addEventListener('click', async () => {
        await bounceUpstreamPort(container.querySelector<HTMLElement>('#analysis-output')!, deviceId, siteId, iface);
      });
      return;
    }

    try {
      const config = await mistApi.getDeviceConfig(siteId, deviceId);
      const portConfig: Record<string, Record<string, unknown>> = config.port_config ?? {};
      const portEntry = portConfig[iface] ?? {};
      const stpEdge = portEntry.stp_edge === true;

      let html = `<div class="upstream-analysis-box" style="margin-top:10px;">`;
      html += `<div class="upstream-analysis-title">Port ${escapeHtml(iface)} — ${escapeHtml(switchName)}</div>`;

      if (isErrorDisabled) {
        html += `<div class="check-modal-cmd-error">This port is <strong>error-disabled</strong>. This typically means BPDU Guard triggered when the downstream switch sent spanning-tree BPDUs.</div>`;
      } else if (isBlocked) {
        html += `<div class="check-modal-cmd-error">This port is in STP <strong>${escapeHtml(stpState)}</strong> state — traffic is being blocked.</div>`;
      }

      if (stpEdge) {
        html += `<div class="check-modal-cmd-error" style="margin-top:6px;"><strong>STP Edge (rstp-edge) is enabled</strong> on this port in Mist. This activates BPDU Guard, which error-disables the port when it receives BPDUs from a downstream switch.</div>`;
        html += `<div class="check-modal-actions" style="margin-top:8px;">`;
        html += `<button class="btn btn-primary btn-sm" id="stp-edge-fix-btn">Disable STP Edge on This Port</button>`;
        html += `<button class="btn btn-secondary btn-sm" id="bounce-btn" style="margin-left:6px;">Bounce Port</button>`;
        html += `</div>`;
      } else {
        html += `<div class="check-modal-cmd-line" style="margin-top:6px;">STP Edge is <strong>not</strong> set at the device level for port ${escapeHtml(iface)}`;
        if (portEntry.usage) html += ` (profile: <em>${escapeHtml(String(portEntry.usage))}</em>)`;
        html += `. The BPDU Guard setting may be coming from the site or org template — check the port profile in Mist.</div>`;
        html += `<div class="check-modal-actions" style="margin-top:8px;">`;
        html += `<button class="btn btn-secondary btn-sm" id="bounce-btn">Bounce Port</button>`;
        html += `</div>`;
      }

      html += `<div id="analysis-output"></div>`;
      html += `</div>`;
      container.innerHTML = html;

      const outputEl = container.querySelector<HTMLElement>('#analysis-output')!;

      if (stpEdge) {
        container.querySelector<HTMLButtonElement>('#stp-edge-fix-btn')?.addEventListener('click', async () => {
          const btn = container.querySelector<HTMLButtonElement>('#stp-edge-fix-btn')!;
          btn.disabled = true;
          btn.textContent = 'Applying…';
          try {
            const updated = { ...portConfig, [iface]: { ...portEntry, stp_edge: false } };
            await mistApi.updateDeviceConfig(siteId, deviceId, { port_config: updated });
            outputEl.innerHTML = `
              <div class="check-modal-cmd-success" style="margin-top:8px;">✓ STP Edge disabled on ${escapeHtml(iface)} via Mist API.</div>
              <div class="check-modal-cmd-line">Mist will push the updated config to ${escapeHtml(switchName)}. The port should recover within 30–60 seconds — then re-run the LLDP check.</div>`;
            btn.textContent = 'Done';
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            outputEl.innerHTML = `<div class="check-modal-cmd-error" style="margin-top:8px;">Failed: ${escapeHtml(msg)}</div>`;
            btn.disabled = false;
            btn.textContent = 'Retry';
          }
        });
      }

      container.querySelector<HTMLButtonElement>('#bounce-btn')?.addEventListener('click', async () => {
        await bounceUpstreamPort(outputEl, deviceId, siteId, iface);
      });

    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      container.innerHTML = `<div class="check-modal-cmd-error" style="margin-top:10px;">Failed to fetch port config: ${escapeHtml(msg)}</div>`;
    }
  }

  /**
   * Bounce (disable then re-enable) an upstream switch port via the Mist API.
   */
  async function bounceUpstreamPort(
    container: HTMLElement,
    deviceId: string,
    siteId: string,
    iface: string,
  ): Promise<void> {
    container.innerHTML = `<div class="check-modal-cmd-line">Bouncing port ${escapeHtml(iface)}…</div>`;

    try {
      const config = await mistApi.getDeviceConfig(siteId, deviceId);
      const portConfig: Record<string, Record<string, unknown>> = config.port_config ?? {};
      const portEntry = portConfig[iface] ?? {};

      // Disable the port
      const disabledConfig = { ...portConfig, [iface]: { ...portEntry, disabled: true } };
      await mistApi.updateDeviceConfig(siteId, deviceId, { port_config: disabledConfig });
      container.innerHTML += `<div class="check-modal-cmd-line">Port disabled. Waiting 3 seconds…</div>`;

      await new Promise((r) => setTimeout(r, 3000));

      // Re-enable the port
      const enabledConfig = { ...portConfig, [iface]: { ...portEntry, disabled: false } };
      await mistApi.updateDeviceConfig(siteId, deviceId, { port_config: enabledConfig });

      container.innerHTML = `
        <div class="check-modal-cmd-success">✓ Port ${escapeHtml(iface)} bounced successfully.</div>
        <div class="check-modal-cmd-line">Mist is pushing the updated config. Wait 30–60 seconds, then re-run the LLDP check.</div>`;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      container.innerHTML = `<div class="check-modal-cmd-error">Failed to bounce port: ${escapeHtml(msg)}</div>`;
    }
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

    // ---- Header (persistent — survives reruns) ----
    const headerDiv = document.createElement('div');
    headerDiv.className = 'check-modal-header';
    headerDiv.innerHTML = `
      <span class="check-modal-status ts-check-icon ${result.status}" id="check-modal-status-icon">${statusIcon(result.status)}</span>
      <span class="check-modal-title" id="check-modal-title">${CHECK_NUMBER_MAP.has(result.id) ? `<span class="ts-check-num">${CHECK_NUMBER_MAP.get(result.id)}</span>` : ''}${result.name}</span>
      <div class="check-modal-header-actions">
        <button class="btn btn-secondary btn-sm" id="check-modal-run-test">Run Test Now</button>
        <button class="check-modal-close" id="check-modal-close-btn">&times;</button>
      </div>`;

    // ---- Body (rebuilt on each rerun) ----
    const bodyDiv = document.createElement('div');
    bodyDiv.id = 'check-modal-body';

    /** Build body HTML and wire Run Fix listener inside bodyDiv */
    const populateBody = (r: CheckResult) => {
      // Auto-populate remediation from troubleshooter if not already set
      if (!r.remediation && (r.status === 'fail' || r.status === 'warn')) {
        const rem = troubleshooter.getRemediation(r, accumulatedResults);
        r.remediation = rem.text;
        r.commands = rem.commands;
      }

      let html = `<div class="check-modal-detail">${r.detail}</div>`;

      // Remediation text
      if (r.remediation) {
        html += `<div class="check-modal-section">`;
        html += `<div class="check-modal-section-title">Remediation</div>`;
        html += `<pre class="check-modal-remediation">${escapeHtml(r.remediation)}</pre>`;
        html += `</div>`;
      }

      // Executable commands
      if (r.commands && r.commands.length > 0) {
        html += `<div class="check-modal-section">`;
        html += `<div class="check-modal-section-title">Commands</div>`;
        html += `<pre class="check-modal-raw">`;
        for (const cmd of r.commands) {
          html += escapeHtml(cmd) + '\n';
        }
        html += `</pre>`;
        const hasPlaceholders = r.commands.some((c) => /<\w+>/.test(c));
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

      // Adopt Switch option — shown for agent/connectivity check failures
      const adoptCheckIds = ['mist-processes', 'outbound-ssh-config', 'cloud-connections'];
      if (adoptCheckIds.includes(r.id) && (r.status === 'fail' || r.status === 'warn')) {
        const sectionTitle = r.commands && r.commands.length > 0
          ? 'Option 2 — Re-adopt Switch'
          : 'Automatic Remediation — Re-adopt Switch';
        let adoptBlurb = '';
        if (r.id === 'mist-processes') {
          adoptBlurb = 'The Mist agent processes are not running. Re-applying the adoption commands will reinstall the agent configuration from scratch.';
        } else if (r.id === 'outbound-ssh-config') {
          adoptBlurb = 'The outbound-SSH configuration that connects this switch to Mist is missing or incorrect. Re-adopting will push the correct settings from Mist.';
        } else {
          adoptBlurb = 'No active connections to the Mist cloud were detected. Re-adopting will re-apply the Mist agent and outbound-SSH configuration.';
        }
        html += `<div class="check-modal-section">`;
        html += `<div class="check-modal-section-title">${sectionTitle}</div>`;
        html += `<div class="check-modal-remediation" style="white-space:normal;">${adoptBlurb}</div>`;
        html += `<div class="check-modal-actions" style="margin-top:8px;">`;
        html += `<button class="btn btn-secondary" id="check-modal-adopt-btn">Adopt Switch</button>`;
        html += `</div>`;
        html += `</div>`;
      }

      // Upstream switch selection — shown when LLDP finds no neighbors
      if (r.needsUpstreamSelection) {
        html += `<div class="check-modal-section" id="upstream-select-section">`;
        html += `<div class="check-modal-section-title">Upstream Switch Recovery</div>`;
        if (mistApi.isConfigured) {
          html += `<div class="check-modal-remediation" style="white-space:normal;">No LLDP neighbors were detected. Select the upstream switch this device is connected to — the tool will inspect its ports for blocking or error-disabled conditions and offer remediation.</div>`;
          html += `<div class="check-modal-actions" style="margin-top:8px;">`;
          html += `<button class="btn btn-secondary" id="upstream-select-btn">Select Upstream Switch</button>`;
          html += `</div>`;
        } else {
          html += `<div class="check-modal-remediation" style="white-space:normal;">No LLDP neighbors were detected. Configure Mist API credentials to identify the upstream switch and diagnose blocked or error-disabled ports automatically.</div>`;
        }
        html += `<div id="upstream-select-result"></div>`;
        html += `</div>`;
      }

      // Raw output
      if (r.raw) {
        html += `<div class="check-modal-section">`;
        html += `<div class="check-modal-section-title">Raw Output</div>`;
        html += `<pre class="check-modal-raw">${escapeHtml(r.raw)}</pre>`;
        html += `</div>`;
      }

      bodyDiv.innerHTML = html;

      // Update header status icon to match current result
      const iconEl = document.getElementById('check-modal-status-icon');
      if (iconEl) {
        iconEl.textContent = statusIcon(r.status);
        iconEl.className = `check-modal-status ts-check-icon ${r.status}`;
      }

      // Wire Run Fix listener
      attachRunFixListener(r, bodyDiv);

      // Wire Adopt Switch button — delegate to shared confirmation dialog
      bodyDiv.querySelector<HTMLButtonElement>('#check-modal-adopt-btn')?.addEventListener('click', () => {
        confirmAndAdopt();
      });

      // Wire upstream switch selection
      if (r.needsUpstreamSelection && mistApi.isConfigured) {
        bodyDiv.querySelector<HTMLButtonElement>('#upstream-select-btn')?.addEventListener('click', () => {
          showUpstreamSwitchSelector(bodyDiv.querySelector<HTMLElement>('#upstream-select-result')!);
        });
      }

      // When mgmt-ip fails, check whether the upstream switch port is a trunk
      // with no native (untagged) VLAN — a common cause of no management IP.
      if (r.id === 'mgmt-ip' && r.status === 'fail') {
        const cfg = currentUpstreamPortConfig;
        console.log('[mgmt-ip] upstream port config:', cfg
          ? `portMode=${cfg.portMode} nativeVlan=${cfg.nativeVlan} remoteInterface=${cfg.remoteInterface} usageProfile=${cfg.usageProfile}`
          : 'null (upstream port config not resolved)');

        // All three conditions must be met:
        //  1. Upstream port found and is a trunk
        //  2. No native (untagged) VLAN on that trunk port
        //  3. mgmt-ip already failed (this block only runs when status === 'fail')
        const isTrunkWithNoNativeVlan =
          cfg !== null &&
          cfg.portMode === 'trunk' &&
          cfg.nativeVlan === null &&
          cfg.remoteInterface !== null;

        if (isTrunkWithNoNativeVlan) {
          const portLabel = cfg!.remoteInterface!;
          const extraStep =
            `\n\nUpstream switch port has no untagged VLAN available, please configure.\n` +
            `  Switch: ${cfg!.neighborName}\n` +
            `  Port:   ${portLabel}\n` +
            `  Mode:   trunk (no native/untagged VLAN set)\n` +
            `  Fix: In Mist, open the port profile for ${cfg!.neighborName} → ${portLabel}\n` +
            `  and set the management VLAN as the Native Network (untagged VLAN).`;

          const remPre = bodyDiv.querySelector<HTMLElement>('pre.check-modal-remediation');
          if (remPre) {
            remPre.textContent += extraStep;
          } else {
            const rawSection = Array.from(bodyDiv.querySelectorAll<HTMLElement>('.check-modal-section'))
              .find((el) => el.querySelector('.check-modal-section-title')?.textContent === 'Raw Output');
            const newSection = document.createElement('div');
            newSection.className = 'check-modal-section';
            newSection.innerHTML = `<div class="check-modal-section-title">Remediation</div><pre class="check-modal-remediation"></pre>`;
            newSection.querySelector('pre')!.textContent = extraStep.trimStart();
            rawSection ? bodyDiv.insertBefore(newSection, rawSection) : bodyDiv.appendChild(newSection);
          }
        }
      }
    };

    modal.appendChild(headerDiv);
    modal.appendChild(bodyDiv);
    overlay.appendChild(modal);
    document.body.appendChild(overlay);

    populateBody(result);

    // ---- Close handlers ----
    const closeModal = () => overlay.remove();
    document.getElementById('check-modal-close-btn')?.addEventListener('click', closeModal);
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) closeModal();
    });
    document.addEventListener('keydown', function escHandler(e) {
      if (e.key === 'Escape') {
        closeModal();
        document.removeEventListener('keydown', escHandler);
      }
    });

    // ---- Run Test Now handler ----
    document.getElementById('check-modal-run-test')?.addEventListener('click', async () => {
      const btn = document.getElementById('check-modal-run-test') as HTMLButtonElement;
      btn.disabled = true;
      btn.textContent = 'Running…';
      bodyDiv.innerHTML = '<div class="check-modal-detail"><span class="cli-mode-spinner">⟳</span> Running test…</div>';

      // Clear the stored result for this check before running
      accumulatedResults = accumulatedResults.filter((r) => r.id !== result.id);

      try {
        const newResults = await rerunCheck(result);
        const newResult = Array.isArray(newResults) ? newResults[0] : newResults;

        // Update result object in-place so the sidebar card click re-opens with fresh data
        Object.assign(result, { status: newResult.status, detail: newResult.detail, raw: newResult.raw,
          remediation: newResult.remediation, commands: newResult.commands });

        populateBody(result);

        // Replace or append updated result in accumulated results
        accumulatedResults = accumulatedResults.filter((r) => r.id !== result.id);
        accumulatedResults.push(result);

        // Replace sidebar card
        const oldCard = document.getElementById(`ts-check-${result.id}`);
        if (oldCard) {
          const newCard = renderCheckResult(result, accumulatedResults);
          oldCard.replaceWith(newCard);
        }

        // Re-inject upstream prompt if LLDP still finding no neighbors
        if (result.id === 'lldp' && result.needsUpstreamSelection) {
          insertUpstreamSwitchPrompt();
        }
        // Re-inject adopt prompt if mist-processes still failing
        if (result.id === 'mist-processes' && (result.status === 'fail' || result.status === 'warn')) {
          insertAdoptPrompt();
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        bodyDiv.innerHTML = `<div class="check-modal-detail" style="color:var(--text-error);">Error: ${escapeHtml(msg)}</div>`;
      } finally {
        btn.disabled = false;
        btn.textContent = 'Run Test Now';
      }
    });
  }

  /** Wire the Run Fix button listener inside a modal body element */
  function attachRunFixListener(result: CheckResult, bodyEl: HTMLElement): void {
    const runFixBtn = bodyEl.querySelector<HTMLButtonElement>('#check-modal-run-fix');
    if (!runFixBtn || !result.commands) return;
    const commands = result.commands;
    runFixBtn.addEventListener('click', async () => {
      runFixBtn.setAttribute('disabled', 'true');
      runFixBtn.textContent = 'Running…';
      const outputEl = bodyEl.querySelector<HTMLElement>('#check-modal-output')!;
      outputEl.innerHTML = '';

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
            const siteId = ui.mistSite.value;
            if (siteId && mistApi.isConfigured) {
              rootPw = await mistApi.getRootPassword(siteId);
            }

            // Send username 'root'
            const userResult = await cmdRunner.sendAndWaitFor('root\n', /[Pp]assword:|>|#|%/, 5000);

            if (/[Pp]assword:/i.test(userResult.output)) {
              // Password required
              if (rootPw) {
                outputEl.innerHTML += `<div class="check-modal-cmd-line">Using root password from Mist site settings…</div>`;
                const passResult = await cmdRunner.sendAndWaitFor(rootPw + '\n', />|#|%|login:/i, 10000);

                if (/login:/i.test(passResult.output)) {
                  // Mist password rejected — ask user
                  outputEl.innerHTML += `<div class="check-modal-cmd-error">Mist root password was rejected.</div>`;
                  const userPw = prompt('Mist root password was rejected.\nEnter the root password for this switch:');
                  if (!userPw) {
                    outputEl.innerHTML += `<div class="check-modal-cmd-error">Cannot proceed without login.</div>`;
                    runFixBtn.textContent = 'Run Fix';
                    runFixBtn.removeAttribute('disabled');
                    return;
                  }
                  // Try again with user-provided password
                  await cmdRunner.sendAndWaitFor('root\n', /[Pp]assword:/i, 5000);
                  const retry = await cmdRunner.sendAndWaitFor(userPw + '\n', />|#|%|login:/i, 10000);
                  if (/login:/i.test(retry.output)) {
                    outputEl.innerHTML += `<div class="check-modal-cmd-error">Login failed. Check credentials.</div>`;
                    runFixBtn.textContent = 'Run Fix';
                    runFixBtn.removeAttribute('disabled');
                    return;
                  }
                }
              } else {
                // No Mist password — prompt user with guidance
                const userPw = prompt(
                  'The switch requires a password to log in.\n\n' +
                  'No root password was found in Mist site settings.\n\n' +
                  'Default credentials:\n' +
                  '  Username: root\n' +
                  '  Password: (blank — press OK with empty field for factory default)\n\n' +
                  'Enter root password (or leave empty for factory default):'
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

              // Check if we got past login
              if (/%\s*$/.test(userResult.output) || /%/.test(await (async () => { const m = await cmdRunner.detectMode(); return m; })())) {
                await cmdRunner.send('cli\n');
                await new Promise((r) => setTimeout(r, 1500));
              }
            } else if (/%\s*$/.test(userResult.output)) {
              // Factory default — went straight to shell
              outputEl.innerHTML += `<div class="check-modal-cmd-line">Factory default switch (no password). Entering CLI…</div>`;
              await cmdRunner.send('cli\n');
              await new Promise((r) => setTimeout(r, 1500));
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
              const siteId = ui.mistSite.value;
              if (siteId && mistApi.isConfigured) {
                rootPw = await mistApi.getRootPassword(siteId);
                if (rootPw) {
                  outputEl.innerHTML += `<div class="check-modal-cmd-line">Setting root password from Mist site settings…</div>`;
                }
              }

              // If no Mist password, prompt the user
              if (!rootPw) {
                rootPw = prompt('Root password is not set on this switch.\nEnter a root password to configure:');
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

              const commitResult = await cmdRunner.execute('commit and-quit', 60000, 5000);
              const commitOutput = commitResult.output.trim();

              if (commitOutput.includes('commit complete') || commitOutput.includes('configuration check succeeds')) {
                outputEl.innerHTML += `<div class="check-modal-cmd-success">✓ Commit successful</div>`;
                recordChange(
                  `Run Fix — ${result.name}`,
                  `Fix commands for "${result.name}" were applied and committed to the switch. ` +
                  (result.remediation ? result.remediation.split('\n')[0] : '') +
                  ' Verify that the Mist device or site configuration reflects these changes, otherwise Mist may overwrite them on the next config push.',
                  cliCommands,
                );
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
              const quitResult = await cmdRunner.execute('exit', 5000);
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

  /**
   * Create a results container with a live-updating summary header.
   * Returns helpers to add results and finalise.
   */
  function createResultsContainer(title: string): {
    container: HTMLElement;
    addResult: (result: CheckResult) => void;
    finalise: (results: CheckResult[]) => void;
    allResults: CheckResult[];
  } {
    const allResults: CheckResult[] = [];

    // Summary bar at the top
    const summaryEl = document.createElement('div');
    summaryEl.className = 'ts-results-summary-header';
    summaryEl.innerHTML = `<span class="ts-results-title">${title}</span><span class="ts-results-running">Running…</span>`;

    // Consolidated log box — all result lines in one place
    const logBox = document.createElement('pre');
    logBox.className = 'ts-results-log-box';
    logBox.style.cursor = 'pointer';
    logBox.title = 'Click to expand';

    logBox.addEventListener('click', () => {
      // Build all result lines for the modal
      const lines = allResults.map((r) =>
        `[${statusIcon(r.status)}] ${r.name}: ${r.detail}`
      );

      const summaryResult: CheckResult = {
        id: 'summary-log',
        name: title,
        status: 'info',
        detail: `${allResults.length} checks completed`,
        raw: lines.join('\n'),
      };

      showCheckModal(summaryResult);
    });

    // Individual results container (clickable items with detail modals)
    const resultsEl = document.createElement('div');
    resultsEl.className = 'ts-results-list';

    // Wrapper
    const container = document.createElement('div');
    container.className = 'ts-results-container';
    container.appendChild(summaryEl);
    container.appendChild(logBox);
    container.appendChild(resultsEl);

    const updateSummary = () => {
      const counts = { pass: 0, fail: 0, warn: 0, skip: 0, info: 0 };
      allResults.forEach((r) => {
        if (r.status in counts) counts[r.status as keyof typeof counts]++;
      });
      summaryEl.innerHTML = `
        <span class="ts-results-title">${title}</span>
        <span class="ts-summary-pass">✓${counts.pass}</span>
        <span class="ts-summary-fail">✗${counts.fail}</span>
        <span class="ts-summary-warn">⚠${counts.warn}</span>
        <span class="ts-summary-skip">—${counts.skip}</span>
      `;
    };

    const addResult = (result: CheckResult) => {
      allResults.push(result);

      // Add to the consolidated log box
      const line = document.createElement('div');
      line.className = `ts-log-line ${result.status}`;
      line.textContent = `[${statusIcon(result.status)}] ${result.name}: ${result.detail}`;
      logBox.appendChild(line);
      logBox.scrollTop = logBox.scrollHeight;

      // Add to the clickable results list
      const existing = document.getElementById(`ts-check-${result.id}`);
      const rendered = renderCheckResult(result, allResults);
      if (existing) {
        existing.replaceWith(rendered);
      } else {
        resultsEl.appendChild(rendered);
      }
      updateSummary();
    };

    const finalise = (results: CheckResult[]) => {
      const counts = { pass: 0, fail: 0, warn: 0, skip: 0, info: 0 };
      results.forEach((r) => {
        if (r.status in counts) counts[r.status as keyof typeof counts]++;
      });
      const total = results.length;
      summaryEl.innerHTML = `
        <span class="ts-results-title">${title} — ${total} checks</span>
        <span class="ts-summary-pass">✓${counts.pass}</span>
        <span class="ts-summary-fail">✗${counts.fail}</span>
        <span class="ts-summary-warn">⚠${counts.warn}</span>
        <span class="ts-summary-skip">—${counts.skip}</span>
      `;
      if (counts.fail === 0 && counts.warn === 0) {
        summaryEl.classList.add('all-pass');
      } else if (counts.fail > 0) {
        summaryEl.classList.add('has-fail');
      }
    };

    return { container, addResult, finalise, allResults };
  }

  // ---- Root password prompt modal ----
  function promptForRootPassword(message: string): Promise<string | null> {
    return new Promise((resolve) => {
      document.getElementById('root-pw-prompt-overlay')?.remove();

      const overlay = document.createElement('div');
      overlay.className = 'check-modal-overlay';
      overlay.id = 'root-pw-prompt-overlay';
      overlay.innerHTML = `
        <div class="check-modal" style="max-width:420px;">
          <div class="check-modal-header">
            <span class="check-modal-status ts-check-icon warn">⚠</span>
            <span class="check-modal-title">Root Password Required</span>
          </div>
          <div style="padding:16px 16px 12px;">
            <p style="color:var(--text-secondary);font-size:13px;margin-bottom:12px;">${message}</p>
            <label style="font-size:11px;color:var(--text-secondary);display:block;margin-bottom:4px;">Password</label>
            <input type="password" id="root-pw-prompt-input" class="input-field" autocomplete="new-password" style="width:100%;">
            <div style="display:flex;justify-content:flex-end;gap:8px;margin-top:14px;">
              <button class="btn btn-secondary btn-sm" id="root-pw-prompt-cancel">Cancel</button>
              <button class="btn btn-primary btn-sm" id="root-pw-prompt-ok">Set Password</button>
            </div>
          </div>
        </div>
      `;
      document.body.appendChild(overlay);

      const input = overlay.querySelector<HTMLInputElement>('#root-pw-prompt-input')!;
      setTimeout(() => input.focus(), 50);

      const close = (value: string | null) => {
        overlay.remove();
        resolve(value);
      };

      overlay.querySelector('#root-pw-prompt-cancel')?.addEventListener('click', () => close(null));
      overlay.querySelector('#root-pw-prompt-ok')?.addEventListener('click', () => {
        const val = input.value.trim();
        close(val || null);
      });
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { const val = input.value.trim(); close(val || null); }
        if (e.key === 'Escape') close(null);
      });
    });
  }

  // ---- Cloud region confirmation (shown when API credentials are not configured) ----
  function confirmCloudRegion(cloud: MistCloud): Promise<boolean> {
    return new Promise((resolve) => {
      document.getElementById('cloud-verify-overlay')?.remove();

      const overlay = document.createElement('div');
      overlay.id = 'cloud-verify-overlay';
      overlay.className = 'check-modal-overlay';

      const modal = document.createElement('div');
      modal.className = 'check-modal';
      modal.style.maxWidth = '520px';

      const endpointLines = cloud.switchEndpoints
        .map((e) => `${e.host}  :${e.port}  ${e.description}`)
        .join('\n');

      modal.innerHTML = `
        <div class="check-modal-header">
          <span class="check-modal-status ts-check-icon warn">⚠</span>
          <span class="check-modal-title">Verify Cloud Region Before Testing</span>
        </div>
        <div class="check-modal-detail">
          <strong>Mist API credentials are not configured.</strong><br><br>
          Tests will run against <strong>${cloud.name}</strong>
          (<code>${cloud.apiHost}</code>).<br><br>
          Because no API token or Org ID has been provided, the tool cannot
          automatically verify this matches your Mist organization.
          Please confirm the selected cloud region is correct before proceeding.
          <br><br>
          To avoid this prompt, configure your Mist API credentials in the
          <strong>Mist API</strong> panel and load your sites — the cloud region
          will then be confirmed automatically.
        </div>
        <div class="check-modal-section">
          <div class="check-modal-section-title">
            Endpoints that will be tested (${cloud.name})
          </div>
          <pre class="check-modal-raw">${endpointLines}</pre>
        </div>
        <div class="check-modal-actions" style="gap:8px;">
          <button class="btn btn-primary" id="cloud-verify-confirm">
            Confirm — Run Tests
          </button>
          <button class="btn btn-secondary" id="cloud-verify-cancel">
            Cancel — Change Cloud
          </button>
        </div>`;

      overlay.appendChild(modal);
      document.body.appendChild(overlay);

      const accept = () => { overlay.remove(); resolve(true); };
      const reject = () => { overlay.remove(); resolve(false); };

      document.getElementById('cloud-verify-confirm')?.addEventListener('click', accept);
      document.getElementById('cloud-verify-cancel')?.addEventListener('click', reject);
      overlay.addEventListener('click', (e) => { if (e.target === overlay) reject(); });
      document.addEventListener('keydown', function esc(e) {
        if (e.key === 'Escape') { document.removeEventListener('keydown', esc); reject(); }
      });
    });
  }

  /** Build the cloud-info result card shown at the top of every endpoint test suite */
  function cloudInfoResult(cloud: MistCloud): CheckResult {
    const endpointSummary = cloud.switchEndpoints
      .map((e) => `${e.host}:${e.port}  ${e.description}`)
      .join('\n');
    const verified = mistApi.isConfigured
      ? 'Cloud region confirmed via Mist API credentials.'
      : 'Mist API not configured — cloud region selected manually. Verify it matches your org.';
    return {
      id: 'cloud-region',
      name: `Cloud Region: ${cloud.name}`,
      status: mistApi.isConfigured ? 'info' as CheckStatus : 'warn',
      detail: `${cloud.apiHost} — ${verified}`,
      raw: endpointSummary,
    };
  }

  // ---- Troubleshoot: Run ----
  async function runTroubleshoot(): Promise<void> {
    const cloudId = ui.mistCloud.value;
    const cloud = getCloudById(cloudId);
    if (!cloud) {
      term.writeError('Please select a Mist cloud region.');
      return;
    }

    // If API not configured, ask user to confirm the cloud region is correct
    if (!mistApi.isConfigured) {
      const confirmed = await confirmCloudRegion(cloud);
      if (!confirmed) return;
    }

    // Verify the CLI is in operational mode before running any tests
    if (!serial.isConnected) {
      term.writeError('Not connected to a switch. Connect via serial first.');
      return;
    }
    const inOperationalMode = await requireOperationalMode();
    if (!inOperationalMode) return;

    const siteId = ui.mistSite.value;
    const uplinkPort = ui.tsUplinkPort.value.trim();

    currentCloud = cloud;
    currentUplinkPort = uplinkPort;
    currentMgmtIp = null;
    currentLldpNeighbor = null;
    currentUpstreamPortConfig = null;
    abortTroubleshoot = false;

    ui.btnRunTroubleshoot.disabled = true;

    ui.tsResults.innerHTML = '';
    const rc = createResultsContainer(`Cloud Connectivity Check — ${cloud.name}`);
    ui.tsResults.appendChild(rc.container);

    // Pre-populate all checks as pending (grouped by OSI layer) so cards update in place as tests run
    const resultsList = rc.container.querySelector('.ts-results-list');
    if (resultsList) {
      for (const group of LAYERED_CHECKS) {
        const header = document.createElement('div');
        header.className = 'ts-layer-header ts-layer-header--embedded';
        header.innerHTML = `<span class="ts-layer-label">${group.label}</span>`;
        resultsList.appendChild(header);
        for (const check of group.checks) {
          resultsList.appendChild(renderPendingCard(check.id, check.name));
        }
      }
    }

    try {
      term.writeSystem('— Starting cloud connectivity check —');

      // Attempt login via Mist API root password
      if (siteId && mistApi.isConfigured) {
        term.writeSystem('Fetching root password from Mist API…');
        const rootPw = await mistApi.getRootPassword(siteId);
        if (rootPw) {
          term.writeSystem('Root password retrieved. Attempting login…');
          const loginResult = await cmdRunner.login('root', rootPw);
          if (loginResult.success) {
            term.writeSystem('Login successful.');
          } else {
            term.writeError(`Login failed: ${loginResult.error}. You may need to log in manually.`);
          }
        } else {
          term.writeSystem('Root password not available from API. Assuming already logged in.');
        }
      } else {
        term.writeSystem('Mist API not configured or no site selected. Assuming already logged in.');
      }

      // Run checks — prepend cloud-info card so users always see which region is tested
      accumulatedResults = [];
      rc.addResult(cloudInfoResult(cloud));

      const results = await troubleshooter.runAll({
        cloud,
        uplinkPort,
        siteId: siteId || undefined,
        deviceId: lastMatchResult?.mistDevice?.id || undefined,
        promptPassword: (message) => promptForRootPassword(message),
        onLldpNeighbor: (n) => { currentLldpNeighbor = n; },
        onUpstreamPortConfig: (cfg) => { currentUpstreamPortConfig = cfg; },
        onContextUpdate: (key, value) => {
          if (key === 'uplinkPort') currentUplinkPort = value;
          if (key === 'mgmtIp') currentMgmtIp = value;
        },
        onProgress: (result: CheckResult) => {
          accumulatedResults.push(result);
          rc.addResult(result);
          term.writeSystem(`  [${statusIcon(result.status)}] ${result.name}: ${result.detail}`);
          if (result.id === 'lldp' && result.needsUpstreamSelection) {
            insertUpstreamSwitchPrompt();
          }
          if (result.id === 'mist-processes' && (result.status === 'fail' || result.status === 'warn')) {
            insertAdoptPrompt();
            // Abort remaining checks and automatically prompt for adoption
            abortTroubleshoot = true;
            confirmAndAdopt();
          }
        },
        shouldAbort: () => abortTroubleshoot,
      });

      rc.finalise(results);
      term.writeSystem('— Cloud connectivity check complete —');
    } finally {
      ui.btnRunTroubleshoot.disabled = false;
    }
  }

  // ---- Mist Status (standalone) ----
  async function runMistStatus(): Promise<void> {
    ui.tsResults.innerHTML = '';
    ui.btnMistStatus.disabled = true;
    // Keep currentCloud if already set; update mgmtIp if possible
    if (!currentCloud) currentCloud = getCloudById(ui.mistCloud.value);

    const rc = createResultsContainer('Mist Cloud Status');
    ui.tsResults.appendChild(rc.container);

    term.writeSystem('— Checking Mist cloud status —');

    const results = await troubleshooter.checkMistCloudStatus(
      null, null,
      ui.mistSite.value || undefined,
      lastMatchResult?.mistDevice?.id || undefined,
    );
    for (const result of results) {
      rc.addResult(result);
      term.writeSystem(`  [${statusIcon(result.status)}] ${result.name}: ${result.detail}`);
    }

    rc.finalise(results);
    term.writeSystem('— Mist status check complete —');
    ui.btnMistStatus.disabled = false;
  }

  // ---- Firewall Policy Check (standalone) ----
  async function runSslCheck(): Promise<void> {
    const cloudId = ui.mistCloud.value;
    const cloud = getCloudById(cloudId);
    if (!cloud) {
      ui.tsResults.innerHTML = '<div class="status-text error">Select a Mist cloud region first.</div>';
      return;
    }

    // If API not configured, ask user to confirm the cloud region is correct
    if (!mistApi.isConfigured) {
      const confirmed = await confirmCloudRegion(cloud);
      if (!confirmed) return;
    }

    currentCloud = cloud;
    ui.tsResults.innerHTML = '';
    ui.btnSslCheck.disabled = true;

    const rc = createResultsContainer(`Firewall Policy Check — ${cloud.name}`);
    ui.tsResults.appendChild(rc.container);

    term.writeSystem('— Running firewall policy check —');

    // Prepend cloud-info card
    rc.addResult(cloudInfoResult(cloud));

    const results = await troubleshooter.checkFirewallPolicy(cloud);
    for (const result of results) {
      rc.addResult(result);
      term.writeSystem(`  [${statusIcon(result.status)}] ${result.name}: ${result.detail}`);
    }

    rc.finalise(results);
    term.writeSystem('— Firewall policy check complete —');
    ui.btnSslCheck.disabled = false;
  }

  // ---- Mist root password lookup (shared by examineSwitch and adoptSwitch) ----
  async function fetchMistRootPassword(siteId: string): Promise<string | null> {
    if (!mistApi.isConfigured || !siteId) return null;
    try {
      const derived = await mistApi.getSiteDerivedSettings(siteId);
      const templateId = derived.networktemplate_id;
      if (templateId) {
        try {
          const template = await mistApi.getNetworkTemplate(templateId);
          const pw = template.root_password ?? template.switch_mgmt?.root_password ?? null;
          if (pw) return pw;
        } catch { /* fall through */ }
      }
      return derived.switch_mgmt?.root_password ?? null;
    } catch {
      return null;
    }
  }

  // ---- Examine Switch (login + identify + root-password check) ----
  async function examineSwitch(): Promise<void> {
    ui.btnExamine.disabled = true;
    ui.examineResult.innerHTML = '<div class="status-text info">Examining switch…</div>';
    ui.deviceIdentity.innerHTML = '';
    term.writeSystem('— Examining switch —');

    try {
      // Step 1: Detect current mode
      const initial = await cmdRunner.sendAndWaitFor('\n', /login:|>|#|%/, 5000);
      const output = initial.output;

      // Step 2: Navigate to operational mode
      if (/login:/i.test(output)) {
        term.writeSystem('  Login prompt detected. Trying root with no password (factory default)…');
        const userResult = await cmdRunner.sendAndWaitFor('root\n', /[Pp]assword:|>|#|%/, 5000);

        if (/[Pp]assword:/i.test(userResult.output)) {
          // Switch has a password — try Mist API first
          term.writeSystem('  Password required. Checking Mist API…');
          const rootPw = await fetchMistRootPassword(ui.mistSite.value);

          if (rootPw) {
            term.writeSystem('  Got root password from Mist. Logging in…');
            const passResult = await cmdRunner.sendAndWaitFor(rootPw + '\n', />|#|%|login:/, 10000);
            if (/login:/i.test(passResult.output)) {
              ui.examineResult.innerHTML = '<div class="device-mist-match not-found"><strong>Login failed</strong> — Mist site root password was rejected.</div>';
              term.writeError('  Login failed — Mist password rejected.');
              return;
            }
            if (/%\s*$/.test(passResult.output)) {
              await cmdRunner.send('cli\n');
              await new Promise((r) => setTimeout(r, 1500));
            }
          } else {
            // No Mist password — prompt user
            await cmdRunner.send('\x03\n');
            await new Promise((r) => setTimeout(r, 1000));
            const entered = await promptForRootPassword('Enter the switch root password to log in:');
            if (!entered) {
              ui.examineResult.innerHTML = '<div class="device-mist-match not-found">Login cancelled — no password provided. You can log in manually in the terminal.</div>';
              return;
            }
            // Re-trigger login prompt, then authenticate
            await cmdRunner.sendAndWaitFor('\n', /login:/i, 3000);
            await cmdRunner.sendAndWaitFor('root\n', /[Pp]assword:/i, 5000);
            const passResult = await cmdRunner.sendAndWaitFor(entered + '\n', />|#|%|login:/, 10000);
            if (/login:/i.test(passResult.output)) {
              ui.examineResult.innerHTML = '<div class="device-mist-match not-found"><strong>Login failed</strong> — password rejected.</div>';
              return;
            }
            if (/%\s*$/.test(passResult.output)) {
              await cmdRunner.send('cli\n');
              await new Promise((r) => setTimeout(r, 1500));
            }
          }
        } else if (/%\s*$/.test(userResult.output)) {
          // Factory default — root went straight to shell
          term.writeSystem('  Factory default — at shell prompt, entering CLI…');
          await cmdRunner.send('cli\n');
          await new Promise((r) => setTimeout(r, 1500));
        }
        // else: went straight to > or # (factory default, no password)
      } else if (/%\s*$/.test(output)) {
        term.writeSystem('  At shell prompt — entering Junos CLI…');
        await cmdRunner.send('cli\n');
        await new Promise((r) => setTimeout(r, 1500));
      }
      // else: already at > or # — nothing to do

      // Step 3: Ensure operational mode (runs set cli screen-length 0 once)
      await cmdRunner.ensureOperationalMode();

      // Step 4: Identify the switch
      await identifySwitch();

      // Step 5: Check root password; configure if missing
      term.writeSystem('  Checking root authentication…');
      const rootAuthCmd = await cmdRunner.execute('show configuration system root-authentication', 10000);
      const hasRootAuth = rootAuthCmd.success && rootAuthCmd.output.includes('encrypted-password');

      let examineHtml = '';

      if (hasRootAuth) {
        examineHtml += '<div class="device-mist-match found">Root password is configured.</div>';
      } else {
        const siteId = ui.mistSite.value;
        const mistPw = await fetchMistRootPassword(siteId);
        const pwPrompt = mistPw === null && mistApi.isConfigured
          ? 'No root password found in Mist for this site. Enter a password to set on the switch:'
          : 'No root password is configured on this switch. Enter a password to set:';
        const pwToSet = mistPw ?? await promptForRootPassword(pwPrompt);

        if (pwToSet) {
          const { rootPasswordCheck } = await import('./checks/root-password.check');
          const pwResult = await rootPasswordCheck.run({
            runner: cmdRunner,
            mistApi,
            siteId,
            promptPassword: async () => pwToSet,
          }) as CheckResult;
          const cls = pwResult.status === 'pass' ? 'found' : pwResult.status === 'warn' ? 'warn' : 'not-found';
          examineHtml += `<div class="device-mist-match ${cls}">${pwResult.detail}</div>`;
          if (pwResult.status === 'pass') {
            recordChange(
              'Examine Switch — Root Password',
              'Root password was not configured on the switch. A password was set and committed. ' +
              'Ensure the Mist site or network template switch_mgmt.root_password matches, otherwise Mist may overwrite it with an empty or different password on the next config push.',
              ['set system root-authentication plain-text-password', 'commit'],
            );
          }
        } else {
          examineHtml += '<div class="device-mist-match not-found">No root password configured. Set one before committing configuration.</div>';
        }
      }

      ui.examineResult.innerHTML = examineHtml;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      ui.examineResult.innerHTML = `<div class="status-text error">Error: ${msg}</div>`;
      term.writeError(`Examine switch error: ${msg}`);
    } finally {
      ui.btnExamine.disabled = false;
    }

    term.writeSystem('— Examine complete —');
  }

  // ---- Disable Auto-Image-Upgrade ----
  async function disableAutoImageUpgrade(): Promise<void> {
    ui.btnDisableAiu.disabled = true;
    ui.aiuResult.innerHTML = '<div class="status-text info">Checking Auto-Image-Upgrade…</div>';
    term.writeSystem('— Disable Auto-Image-Upgrade —');

    try {
      await cmdRunner.ensureOperationalMode();

      // Root password must be set before a commit can succeed — check first
      term.writeSystem('  Checking root authentication…');
      const rootAuthCmd = await cmdRunner.execute('show configuration system root-authentication', 10000);
      const hasRootAuth = rootAuthCmd.success && rootAuthCmd.output.includes('encrypted-password');

      if (!hasRootAuth) {
        term.writeSystem('  No root password — attempting to configure one…');
        const siteId = ui.mistSite.value;
        const mistPw = await fetchMistRootPassword(siteId);
        const pwPrompt = mistPw === null && mistApi.isConfigured
          ? 'No root password found in Mist for this site. Enter a password to set on the switch:'
          : 'No root password is configured on this switch. Enter a password to set:';
        const pwToSet = mistPw ?? await promptForRootPassword(pwPrompt);

        if (!pwToSet) {
          ui.aiuResult.innerHTML = '<div class="device-mist-match not-found">No root password configured — cannot commit. Set a root password first.</div>';
          return;
        }

        const { rootPasswordCheck } = await import('./checks/root-password.check');
        const pwResult = await rootPasswordCheck.run({
          runner: cmdRunner,
          mistApi,
          siteId,
          promptPassword: async () => pwToSet,
        }) as CheckResult;

        if (pwResult.status !== 'pass') {
          const cls = pwResult.status === 'warn' ? 'warn' : 'not-found';
          ui.aiuResult.innerHTML = `<div class="device-mist-match ${cls}">Root password setup failed: ${pwResult.detail}</div>`;
          return;
        }

        term.writeSystem(`  Root password configured: ${pwResult.detail}`);
        recordChange(
          'Disable Auto-Image-Upgrade — Root Password',
          'Root password was not configured on the switch. A password was set and committed before the Auto-Image-Upgrade change could be applied. ' +
          'Ensure the Mist site or network template switch_mgmt.root_password matches, otherwise Mist may overwrite it.',
          ['set system root-authentication plain-text-password', 'commit'],
        );
      }

      // Root password is now confirmed — run the Auto-Image-Upgrade check
      const { autoImageUpgradeCheck } = await import('./checks/auto-image-upgrade.check');
      const aiuResult = await autoImageUpgradeCheck.run({ runner: cmdRunner }) as CheckResult;
      const cls = aiuResult.status === 'pass' ? 'found' : 'warn';
      ui.aiuResult.innerHTML = `<div class="device-mist-match ${cls}">${aiuResult.detail}</div>`;
      term.writeSystem(`  [auto-image-upgrade] ${aiuResult.detail}`);
      if (aiuResult.detail.includes('deleted and committed')) {
        recordChange(
          'Disable Auto-Image-Upgrade',
          'The "chassis auto-image-upgrade" (ZTP/phone-home) feature was active on the switch. ' +
          'It was deleted and committed to prevent console noise that interferes with troubleshooting. ' +
          'Mist does not manage this setting directly, so it should not be re-applied by a config push — ' +
          'but verify the Mist network template does not include an auto-image-upgrade stanza.',
          ['configure', 'delete chassis auto-image-upgrade', 'commit'],
        );
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      ui.aiuResult.innerHTML = `<div class="status-text error">Error: ${msg}</div>`;
      term.writeError(`Auto-Image-Upgrade check failed: ${msg}`);
    } finally {
      ui.btnDisableAiu.disabled = false;
    }

    term.writeSystem('— Auto-Image-Upgrade complete —');
  }

  // ---- Device Identification ----
  async function identifySwitch(): Promise<void> {
    ui.deviceIdentity.innerHTML = '<div class="status-text info">Identifying switch…</div>';

    term.writeSystem('— Identifying connected switch —');

    try {
      await cmdRunner.ensureOperationalMode();
      const result = await switchIdentity.identifyAndMatch();
      lastMatchResult = result;

      // Render identity info
      const { identity, mistDevice, matchedBy } = result;
      let html = '';

      const rows: [string, string | null][] = [
        ['Hostname', identity.hostname],
        ['Serial', identity.serial],
        ['MAC', identity.mac],
        ['Model', identity.model],
        ['Junos', identity.junosVersion],
      ];

      for (const [label, value] of rows) {
        if (value) {
          html += `<div class="device-info-row"><span class="device-info-label">${label}</span><span class="device-info-value">${value}</span></div>`;
          term.writeSystem(`  ${label}: ${value}`);
        }
      }

      // Mist match result
      if (mistDevice) {
        const assignSiteId = ui.mistSite.value;
        const assignSiteName = ui.mistSite.selectedOptions[0]?.text || '';

        if (mistDevice.site_id) {
          const assignedSiteName = ui.mistSite.querySelector(`option[value="${mistDevice.site_id}"]`)?.textContent
            || mistDevice.site_id;
          html += `<div class="device-mist-match found">Found in Mist (matched by ${matchedBy}) — ${mistDevice.name || mistDevice.id}<br>Site: ${assignedSiteName}</div>`;
        } else {
          const assignBtn = assignSiteId
            ? `<div style="margin-top:8px;"><button class="btn btn-primary btn-sm" id="btn-assign-to-site">Assign to ${assignSiteName}</button></div>`
            : '<div style="margin-top:4px;font-size:11px;color:var(--text-muted);">Select a site in the Mist API section to assign this switch.</div>';
          html += `<div class="device-mist-match found">Found in Mist (matched by ${matchedBy}) — ${mistDevice.name || mistDevice.id}<br>Site: <span style="color:var(--text-muted)">unassigned</span>${assignBtn}</div>`;
        }

        term.writeSystem(`  Mist: Found (${matchedBy}) — ${mistDevice.name || mistDevice.id}`);
        ui.btnConfigDrift.disabled = false;
        ui.btnOfflineTimeline.disabled = !mistDevice.site_id;
      } else if (!mistApi.isConfigured) {
        html += '<div class="device-mist-match no-api">Mist API not configured — cannot search inventory</div>';
        term.writeSystem('  Mist: API not configured');
      } else {
        html += `<div class="device-mist-match not-found">
          <strong>Switch not found in Mist inventory.</strong><br><br>
          To connect this switch to Mist, choose one of:<br>
          <ul style="margin:6px 0 6px 16px; padding:0; line-height:1.8;">
            <li><strong>Claim code</strong> — go to Mist → Organization → Inventory → Add Devices,
                enter the claim code printed on the switch label.</li>
            <li><strong>Adopt via console</strong> — apply the adoption commands from Mist directly
                to the switch using the button below.</li>
          </ul>
          <div style="margin-top:8px;">
            <button class="btn btn-primary btn-sm" id="btn-adopt-from-identify">Adopt Switch</button>
          </div>
        </div>`;
        term.writeSystem('  Mist: Not found in inventory — adoption or claim required');
      }

      ui.deviceIdentity.innerHTML = html;

      // Wire the assign-to-site button (rendered when switch is in Mist but unassigned)
      document.getElementById('btn-assign-to-site')?.addEventListener('click', async () => {
        const siteId = ui.mistSite.value;
        const siteName = ui.mistSite.selectedOptions[0]?.text || siteId;
        if (!siteId || !mistDevice?.mac) return;

        const btn = document.getElementById('btn-assign-to-site') as HTMLButtonElement | null;
        if (btn) { btn.disabled = true; btn.textContent = 'Assigning…'; }

        try {
          await mistApi.assignDeviceToSite(mistDevice.mac, siteId);
          mistDevice.site_id = siteId;
          ui.btnOfflineTimeline.disabled = false;
          const matchDiv = ui.deviceIdentity.querySelector('.device-mist-match');
          if (matchDiv) {
            matchDiv.innerHTML = matchDiv.innerHTML.replace(
              /Site:.*$/s,
              `Site: ${siteName} <span style="color:var(--color-pass);font-size:11px;">✓ assigned</span>`,
            );
          }
          term.writeSystem(`  Assigned to site: ${siteName}`);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          if (btn) { btn.disabled = false; btn.textContent = `Assign to ${siteName}`; }
          term.writeError(`  Site assignment failed: ${msg}`);
        }
      });

      // Wire the inline adopt button (rendered only when switch is not in Mist)
      document.getElementById('btn-adopt-from-identify')?.addEventListener('click', async () => {
        // Clear the identify results so the user's attention moves to the adoption section
        ui.deviceIdentity.innerHTML = '';

        // Open the Device & Config accordion if it is collapsed
        const deviceTrigger = document.querySelector('[data-target="device"]') as HTMLElement | null;
        const deviceContent = document.getElementById('accordion-device');
        if (deviceTrigger && deviceContent && !deviceTrigger.classList.contains('active')) {
          deviceTrigger.classList.add('active');
          deviceContent.classList.add('open');
          setTimeout(() => term.fit(), 300);
        }

        // Pre-populate adoption root password field from Mist if not already set
        if (mistApi.isConfigured && !ui.adoptRootPw.value.trim()) {
          const siteId = ui.mistSite.value;
          const pw = await fetchMistRootPassword(siteId);
          if (pw) ui.adoptRootPw.value = pw;
        }

        ui.btnAdopt.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        adoptSwitch();
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      ui.deviceIdentity.innerHTML = `<div class="status-text error">Error: ${msg}</div>`;
      term.writeError(`Identification failed: ${msg}`);
    }

    term.writeSystem('— Identification complete —');
  }

  // ---- Config Drift Detection ----
  async function checkConfigDrift(): Promise<void> {
    if (!lastMatchResult?.mistDevice || !lastMatchResult?.mistConfig) {
      ui.configDriftResults.innerHTML = '<div class="status-text error">Identify the switch first and ensure it is found in Mist.</div>';
      return;
    }

    ui.btnConfigDrift.disabled = true;
    ui.configDriftResults.innerHTML = '<div class="status-text info">Pulling running config…</div>';

    term.writeSystem('— Checking config drift —');

    try {
      // Pull running config from the switch
      term.writeSystem('  Pulling running config (this may take a moment)…');
      const runningConfig = await switchIdentity.getRunningConfig();
      term.writeSystem(`  Got ${runningConfig.split('\\n').length} config lines.`);

      // Compare
      const result = configDrift.compare(lastMatchResult.mistConfig, runningConfig);

      // Render results
      let html = '';

      // Summary
      const summaryClass = (result.mistOnlyLines.length + result.switchOnlyLines.length) === 0 ? 'clean' : 'drifted';
      html += `<div class="drift-summary ${summaryClass}">${result.summary}<br>Mist: ${result.totalMistLines} lines | Switch: ${result.totalSwitchLines} lines | Matched: ${result.matchedLines}</div>`;
      term.writeSystem(`  ${result.summary}`);

      // Mist-only lines (in Mist config but not on switch)
      if (result.mistOnlyLines.length > 0) {
        html += '<div class="drift-section-title">In Mist but not on switch</div>';
        for (const diff of result.mistOnlyLines) {
          html += `<div class="drift-line mist-only"><span class="drift-category">${diff.category}</span>${escapeHtml(diff.line)}</div>`;
        }
      }

      // Switch-only lines (on switch but not in Mist config)
      if (result.switchOnlyLines.length > 0) {
        html += '<div class="drift-section-title">On switch but not in Mist</div>';
        for (const diff of result.switchOnlyLines) {
          html += `<div class="drift-line switch-only"><span class="drift-category">${diff.category}</span>${escapeHtml(diff.line)}</div>`;
        }
      }

      ui.configDriftResults.innerHTML = html;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      ui.configDriftResults.innerHTML = `<div class="status-text error">Error: ${msg}</div>`;
      term.writeError(`Config drift check failed: ${msg}`);
    } finally {
      ui.btnConfigDrift.disabled = false;
    }

    term.writeSystem('— Config drift check complete —');
  }

  // ---- Adopt Switch ----
  async function adoptSwitch(): Promise<void> {
    if (!mistApi.isConfigured) {
      ui.adoptResults.innerHTML = '<div class="status-text error">Configure Mist API first (cloud, token, org ID).</div>';
      return;
    }

    ui.btnAdopt.disabled = true;
    ui.adoptResults.innerHTML = '<div class="status-text info">Fetching adoption commands from Mist…</div>';

    try {
      const commands = await mistApi.getAdoptionCommands();

      if (!commands || !commands.includes('set ')) {
        ui.adoptResults.innerHTML = '<div class="status-text error">No adoption commands returned from API. The endpoint may not be available for your account.</div>';
        ui.btnAdopt.disabled = false;
        return;
      }

      // Check if root-authentication is configured on the switch
      term.writeSystem('— Checking root authentication before adoption —');
      await cmdRunner.ensureOperationalMode();
      const rootAuthCmd = await cmdRunner.execute('show configuration system root-authentication', 10000);
      const hasRootAuth = rootAuthCmd.success &&
        (rootAuthCmd.output.includes('encrypted-password') || rootAuthCmd.output.includes('ssh-'));

      // Determine root password to use if needed
      let rootPassword: string | null = null;
      if (!hasRootAuth) {
        term.writeSystem('  No root authentication configured — need to set one before adoption.');

        // Try Mist API via shared helper
        const mistPw = await fetchMistRootPassword(ui.mistSite.value);
        if (mistPw) {
          rootPassword = mistPw;
          term.writeSystem('  Using root password from Mist (template/site settings).');
          ui.adoptRootPw.value = rootPassword;
        }

        // Fall back to user-provided password (may have been pre-populated)
        if (!rootPassword) {
          rootPassword = ui.adoptRootPw.value.trim();
        }

        if (!rootPassword) {
          ui.adoptResults.innerHTML = '<div class="status-text error">' +
            '<strong>Root authentication is not configured on this switch.</strong><br><br>' +
            'A root password is required before adoption commands can be committed.<br><br>' +
            'Either:<br>' +
            '1. Enter a root password in the field above and click Adopt again, or<br>' +
            '2. Select a Mist site (in the Mist API section) that has a root password configured' +
            '</div>';
          ui.btnAdopt.disabled = false;
          return;
        }
      } else {
        term.writeSystem('  Root authentication is configured.');
      }

      // Display the commands in a centre-screen modal
      const commandLines = commands.split('\n').filter((l: string) => l.trim().length > 0);
      const totalCommands = commandLines.length + (rootPassword ? 1 : 0);
      term.writeSystem(`— Retrieved ${commandLines.length} adoption commands from Mist —`);

      // Build command list HTML
      let cmdListHtml = '';
      if (rootPassword) {
        cmdListHtml += '<div class="drift-line mist-only"><span class="drift-category">Root Auth</span>set system root-authentication plain-text-password ••••••••</div>';
      }
      for (const line of commandLines) {
        cmdListHtml += `<div class="drift-line mist-only">${escapeHtml(line.trim())}</div>`;
      }

      // Create modal
      document.getElementById('adopt-cmd-modal-overlay')?.remove();
      const overlay = document.createElement('div');
      overlay.id = 'adopt-cmd-modal-overlay';
      overlay.className = 'check-modal-overlay';

      overlay.innerHTML = `
        <div class="check-modal adopt-cmd-modal">
          <div class="check-modal-header">
            <span class="check-modal-title">Adoption Commands — ${totalCommands} lines</span>
            <button class="check-modal-close" id="adopt-modal-close">&times;</button>
          </div>
          <div class="check-modal-section">
            <div class="check-modal-section-title">Commands to apply</div>
            <div style="max-height:280px;overflow-y:auto;margin-top:6px;">${cmdListHtml}</div>
          </div>
          ${!hasRootAuth ? '<div class="check-modal-section"><div class="status-text info" style="margin:0;">Root password will be set on the switch before these commands are applied.</div></div>' : ''}
          <div class="check-modal-section" id="adopt-apply-status" style="display:none;"></div>
          <div class="adopt-cmd-modal-footer">
            <button class="btn btn-secondary" id="btn-adopt-cancel">Cancel</button>
            <button class="btn btn-primary" id="btn-adopt-apply">Apply to Switch</button>
          </div>
        </div>`;

      document.body.appendChild(overlay);

      const applyBtn  = document.getElementById('btn-adopt-apply')  as HTMLButtonElement;
      const cancelBtn = document.getElementById('btn-adopt-cancel') as HTMLButtonElement;
      const statusEl  = document.getElementById('adopt-apply-status') as HTMLElement;

      const closeModal = () => {
        overlay.remove();
        ui.adoptResults.innerHTML = '';
        ui.btnAdopt.disabled = false;
      };

      document.getElementById('adopt-modal-close')?.addEventListener('click', closeModal);
      // Clicking the backdrop dismisses (only if not mid-apply)
      overlay.addEventListener('click', (e) => {
        if (e.target === overlay && !applyBtn.disabled) closeModal();
      });

      cancelBtn.addEventListener('click', closeModal);

      applyBtn.addEventListener('click', async () => {
        applyBtn.disabled = true;
        cancelBtn.disabled = true;
        statusEl.style.display = '';
        statusEl.innerHTML = '<div class="status-text info">Entering config mode…</div>';
        term.writeSystem('— Applying adoption commands to switch —');

        try {
          // Enter config mode
          const editResult = await cmdRunner.execute('edit', 5000);
          if (!editResult.output.includes('#') && !editResult.success) {
            statusEl.innerHTML = '<div class="status-text error">Failed to enter config mode. Are you logged in as root?</div>';
            term.writeError('Failed to enter config mode.');
            applyBtn.disabled = false;
            cancelBtn.disabled = false;
            return;
          }

          // Set root password first if needed
          if (rootPassword) {
            statusEl.innerHTML = '<div class="status-text info">Setting root password…</div>';
            term.writeSystem('  Setting root authentication…');
            await cmdRunner.send('set system root-authentication plain-text-password\n');
            await new Promise((r) => setTimeout(r, 1000));
            const pw1 = await cmdRunner.sendAndWaitFor(rootPassword + '\n', /password:|secret:/, 5000);
            if (pw1.matched) {
              await cmdRunner.sendAndWaitFor(rootPassword + '\n', /#/, 5000);
            }
            term.writeSystem('  Root password set.');
          }

          statusEl.innerHTML = '<div class="status-text info">Applying adoption commands…</div>';

          // Apply each command
          let applied = 0;
          for (const line of commandLines) {
            const trimmed = line.trim();
            if (trimmed.length === 0) continue;
            await cmdRunner.execute(trimmed, 5000, 500);
            applied++;
          }

          statusEl.innerHTML = `<div class="status-text info">Applied ${applied} commands. Committing…</div>`;
          term.writeSystem(`  Applied ${applied} commands. Committing…`);

          // Commit
          const commitResult = await cmdRunner.execute('commit and-quit', 60000, 5000);
          if (commitResult.output.includes('commit complete') || commitResult.output.includes('configuration check succeeds')) {
            statusEl.innerHTML = '<div class="status-text success">Adoption commands applied and committed successfully. The switch should connect to Mist within a few minutes.</div>';
            term.writeSystem('  Commit successful. Switch should connect to Mist shortly.');
          } else if (commitResult.output.includes('error')) {
            statusEl.innerHTML = '<div class="status-text error">Commit returned errors. Check the terminal output.</div>';
            term.writeError('Commit may have failed. Check output above.');
          } else {
            statusEl.innerHTML = '<div class="status-text info">Commit sent. Check terminal for result.</div>';
          }

          // Replace Apply/Cancel with a single Close button
          applyBtn.style.display = 'none';
          cancelBtn.textContent = 'Close';
          cancelBtn.disabled = false;
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          statusEl.innerHTML = `<div class="status-text error">Error: ${msg}</div>`;
          term.writeError(`Adoption apply error: ${msg}`);
          applyBtn.disabled = false;
          cancelBtn.disabled = false;
        } finally {
          ui.btnAdopt.disabled = false;
        }
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      ui.adoptResults.innerHTML = `<div class="status-text error">Failed to fetch adoption commands: ${msg}</div>`;
      term.writeError(`Adoption fetch error: ${msg}`);
      ui.btnAdopt.disabled = false;
    }
  }

  // ---- Offline Timeline (standalone) ----
  async function checkOfflineTimeline(): Promise<void> {
    if (!lastMatchResult?.mistDevice?.site_id || !lastMatchResult?.mistDevice?.id) {
      ui.timelineResults.innerHTML = '<div class="status-text error">Identify the switch first and ensure it is found in Mist with a site.</div>';
      return;
    }

    ui.btnOfflineTimeline.disabled = true;
    ui.timelineResults.innerHTML = '<div class="status-text info">Checking Mist events and switch logs…</div>';
    term.writeSystem('— Checking offline timeline —');

    try {
      const results = await troubleshooter.checkOfflineTimeline(
        lastMatchResult.mistDevice.site_id,
        lastMatchResult.mistDevice.id,
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
  }

  function escapeHtml(text: string): string {
    return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  // ---- Shared adoption confirmation dialog ----

  /**
   * Show a confirmation overlay explaining what adoption will do.
   * If the user clicks "Yes, Adopt Switch", closes the overlay and calls adoptSwitch().
   * Safe to call multiple times — will not stack if already visible.
   */
  function confirmAndAdopt(): void {
    if (document.getElementById('adopt-confirm-overlay')) return;

    const overlay = document.createElement('div');
    overlay.id = 'adopt-confirm-overlay';
    overlay.className = 'check-modal-overlay';
    overlay.innerHTML = `
      <div class="check-modal" style="max-width:500px;">
        <div class="check-modal-header">
          <span class="check-modal-title">Adopt Switch — Confirm</span>
          <button class="check-modal-close" id="adopt-confirm-close">&times;</button>
        </div>
        <div class="check-modal-section">
          <div class="check-modal-remediation" style="white-space:normal;line-height:1.6;">
            <strong>What this will do:</strong><br>
            <ul style="margin:8px 0 8px 16px;padding:0;line-height:1.8;">
              <li>Fetch the latest adoption commands from the Mist API for this organisation</li>
              <li>Apply the outbound-SSH and Mist agent configuration to the switch</li>
              <li>Commit the configuration — the switch's current config will be modified</li>
              <li>The switch should appear connected in Mist within 1–2 minutes</li>
            </ul>
            If adoption commands were previously applied but the switch is still not connecting,
            this will overwrite them with a fresh set from Mist.
          </div>
        </div>
        <div class="check-modal-section" style="display:flex;gap:8px;justify-content:flex-end;">
          <button class="btn btn-secondary" id="adopt-confirm-no">No, Cancel</button>
          <button class="btn btn-primary" id="adopt-confirm-yes">Yes, Adopt Switch</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);

    const close = (): void => overlay.remove();
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
    overlay.querySelector('#adopt-confirm-close')?.addEventListener('click', close);
    overlay.querySelector('#adopt-confirm-no')?.addEventListener('click', close);

    overlay.querySelector('#adopt-confirm-yes')?.addEventListener('click', () => {
      close();
      // Close any open check-result modal that may be underneath
      document.getElementById('check-modal-overlay')?.remove();
      // Open Device & Config accordion if collapsed
      const deviceTrigger = document.querySelector('[data-target="device"]') as HTMLElement | null;
      const deviceContent = document.getElementById('accordion-device');
      if (deviceTrigger && deviceContent && !deviceTrigger.classList.contains('active')) {
        deviceTrigger.classList.add('active');
        deviceContent.classList.add('open');
        setTimeout(() => term.fit(), 300);
      }
      ui.btnAdopt.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      adoptSwitch();
    });
  }

  // ---- Adopt prompt (triggered when Mist agent processes check fails) ----

  function insertAdoptPrompt(): void {
    document.getElementById('ts-adopt-prompt')?.remove();

    const checkEl = document.getElementById('ts-check-mist-processes');
    if (!checkEl) return;

    const body = checkEl.querySelector('.ts-check-body');
    if (!body) return;

    const prompt = document.createElement('div');
    prompt.id = 'ts-adopt-prompt';
    prompt.className = 'ts-adopt-inline-actions';

    if (mistApi.isConfigured) {
      prompt.innerHTML = `<button class="btn btn-primary btn-sm" id="ts-adopt-yes">Adopt Switch</button>`;
    } else {
      prompt.innerHTML = `<span class="ts-adopt-prompt-msg">Configure Mist API credentials to adopt this switch.</span>`;
    }

    body.appendChild(prompt);

    document.getElementById('ts-adopt-yes')?.addEventListener('click', (e) => {
      e.stopPropagation();
      confirmAndAdopt();
    });
  }

  // ---- Upstream switch inline prompt (triggered when LLDP finds no neighbors) ----

  function insertUpstreamSwitchPrompt(): void {
    document.getElementById('ts-upstream-prompt')?.remove();

    const checkEl = document.getElementById('ts-check-lldp');
    if (!checkEl) return;

    const body = checkEl.querySelector('.ts-check-body');
    if (!body) return;

    const prompt = document.createElement('div');
    prompt.id = 'ts-upstream-prompt';
    prompt.className = 'ts-adopt-inline-actions';

    if (mistApi.isConfigured) {
      prompt.innerHTML = `<button class="btn btn-primary btn-sm" id="ts-upstream-select-btn">Select Upstream Switch</button>`;
    } else {
      prompt.innerHTML = `<span class="ts-adopt-prompt-msg">Configure Mist API credentials to identify the upstream switch.</span>`;
    }

    body.appendChild(prompt);

    document.getElementById('ts-upstream-select-btn')?.addEventListener('click', (e) => {
      e.stopPropagation();
      showUpstreamSwitchOverlay();
    });
  }

  /**
   * Open a dedicated overlay modal for upstream switch selection and port stats.
   * This is triggered by the inline prompt on the LLDP check card.
   */
  function showUpstreamSwitchOverlay(): void {
    document.getElementById('upstream-overlay')?.remove();

    const overlay = document.createElement('div');
    overlay.id = 'upstream-overlay';
    overlay.className = 'check-modal-overlay';

    const modal = document.createElement('div');
    modal.className = 'check-modal';
    modal.style.maxWidth = '560px';

    modal.innerHTML = `
      <div class="check-modal-header">
        <span class="check-modal-status ts-check-icon fail">✗</span>
        <span class="check-modal-title">Upstream Switch — Port Diagnostics</span>
        <div class="check-modal-header-actions">
          <button class="check-modal-close" id="upstream-overlay-close">&times;</button>
        </div>
      </div>
      <div class="check-modal-detail">
        No LLDP neighbors were detected. Select the upstream switch and then the port this switch is connected to — the tool will check for BPDU Guard or STP blocking and offer remediation.
      </div>
      <div id="upstream-overlay-body" style="padding:0 16px 16px;"></div>`;

    overlay.appendChild(modal);
    document.body.appendChild(overlay);

    const close = () => overlay.remove();
    document.getElementById('upstream-overlay-close')?.addEventListener('click', close);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
    document.addEventListener('keydown', function esc(e) {
      if (e.key === 'Escape') { document.removeEventListener('keydown', esc); close(); }
    });

    const body = document.getElementById('upstream-overlay-body')!;
    showUpstreamSwitchSelector(body);
  }

  // ---- CLI Mode Detection Modal ----

  /**
   * Animate the CLI mode modal shrinking toward the "CLI Mode Help" button,
   * then pulse the button so the user knows where to find it again.
   */
  function closeCliModeModal(overlay: HTMLElement, modal: HTMLElement): void {
    const btn = document.getElementById('btn-cli-help');
    const btnRect = btn?.getBoundingClientRect();
    const modalRect = modal.getBoundingClientRect();

    if (!btnRect || !modalRect || !document.body.contains(overlay)) {
      overlay.remove();
      return;
    }

    // Vector from modal centre to button centre
    const dx = (btnRect.left + btnRect.width / 2) - (modalRect.left + modalRect.width / 2);
    const dy = (btnRect.top  + btnRect.height / 2) - (modalRect.top  + modalRect.height / 2);
    const scale = Math.min(btnRect.width / modalRect.width, btnRect.height / modalRect.height);

    // Prevent further interactions while animating
    overlay.style.pointerEvents = 'none';

    modal.animate(
      [
        { transform: 'translate(0, 0) scale(1)',                          opacity: '1' },
        { transform: `translate(${dx}px, ${dy}px) scale(${scale})`,      opacity: '0' },
      ],
      { duration: 380, easing: 'cubic-bezier(0.4, 0, 1, 1)', fill: 'forwards' },
    ).onfinish = () => {
      overlay.remove();
      // Pulse the button so the user sees where the modal went
      if (btn) {
        btn.classList.remove('btn-cli-help--pulse');
        // Force reflow so re-adding the class restarts the animation
        void btn.offsetWidth;
        btn.classList.add('btn-cli-help--pulse');
        btn.addEventListener('animationend', () => btn.classList.remove('btn-cli-help--pulse'), { once: true });
      }
    };
  }

  async function showCliModeModal(): Promise<void> {
    document.getElementById('cli-mode-modal-overlay')?.remove();

    const overlay = document.createElement('div');
    overlay.id = 'cli-mode-modal-overlay';
    overlay.className = 'check-modal-overlay';

    const modal = document.createElement('div');
    modal.className = 'check-modal';
    modal.style.maxWidth = '560px';
    modal.innerHTML = `
      <div class="check-modal-header">
        <span class="check-modal-title">CLI Mode Detected</span>
        <button class="check-modal-close" id="cli-mode-modal-close">&times;</button>
      </div>
      <div id="cli-mode-modal-body">
        <div class="check-modal-section" style="display:flex;align-items:center;gap:10px;padding:16px;">
          <span class="cli-mode-spinner">⟳</span>
          <span style="color:var(--text-secondary);font-size:13px;">Detecting current CLI mode…</span>
        </div>
      </div>`;

    overlay.appendChild(modal);
    document.body.appendChild(overlay);

    const closeModal = (): void => closeCliModeModal(overlay, modal);
    document.getElementById('cli-mode-modal-close')?.addEventListener('click', closeModal);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) closeModal(); });
    const escHandler = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') { closeModal(); document.removeEventListener('keydown', escHandler); }
    };
    document.addEventListener('keydown', escHandler);

    // If not connected, show the reference table immediately with unknown mode
    if (!serial.isConnected) {
      const body = document.getElementById('cli-mode-modal-body');
      if (body) body.innerHTML = buildCliModeBody('unknown');
      document.getElementById('cli-mode-got-it')?.addEventListener('click', closeModal);
      return;
    }

    await new Promise<void>((r) => setTimeout(r, 500));
    if (!document.getElementById('cli-mode-modal-overlay') || !serial.isConnected) {
      overlay.remove();
      return;
    }

    let mode: 'operational' | 'config' | 'shell' | 'login' | 'unknown';
    try {
      mode = await cmdRunner.detectMode();
    } catch {
      mode = 'unknown';
    }

    if (!document.getElementById('cli-mode-modal-overlay')) return;

    const body = document.getElementById('cli-mode-modal-body');
    if (body) body.innerHTML = buildCliModeBody(mode);

    document.getElementById('cli-mode-got-it')?.addEventListener('click', closeModal);
  }

  /** Show the CLI mode modal immediately with a known mode — no spinner/delay. */
  function showCliModeModalWithMode(
    mode: 'operational' | 'config' | 'shell' | 'login' | 'unknown',
    warningMsg?: string,
  ): void {
    document.getElementById('cli-mode-modal-overlay')?.remove();

    const overlay = document.createElement('div');
    overlay.id = 'cli-mode-modal-overlay';
    overlay.className = 'check-modal-overlay';

    const modal = document.createElement('div');
    modal.className = 'check-modal';
    modal.style.maxWidth = '560px';
    modal.innerHTML = `
      <div class="check-modal-header">
        <span class="check-modal-title">CLI Mode</span>
        <button class="check-modal-close" id="cli-mode-modal-close">&times;</button>
      </div>
      <div id="cli-mode-modal-body">${buildCliModeBody(mode, warningMsg)}</div>`;

    overlay.appendChild(modal);
    document.body.appendChild(overlay);

    const closeModal = (): void => closeCliModeModal(overlay, modal);
    document.getElementById('cli-mode-modal-close')?.addEventListener('click', closeModal);
    document.getElementById('cli-mode-got-it')?.addEventListener('click', closeModal);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) closeModal(); });
    const escHandler = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') { closeModal(); document.removeEventListener('keydown', escHandler); }
    };
    document.addEventListener('keydown', escHandler);
  }

  /**
   * Detect current CLI mode. Returns true if operational (tests may proceed).
   * If not operational, shows the CLI mode modal with a warning and returns false.
   */
  async function requireOperationalMode(): Promise<boolean> {
    let mode: 'operational' | 'config' | 'shell' | 'login' | 'unknown';
    try {
      mode = await cmdRunner.detectMode();
    } catch {
      mode = 'unknown';
    }
    if (mode === 'operational') return true;

    const modeLabels: Record<string, string> = {
      config: 'Configuration mode (<code>user@switch#</code>) — type <code>exit</code> to return to Operational mode',
      shell:  'Shell (<code>root@switch%</code>) — type <code>cli</code> to enter Operational mode',
      login:  'the login prompt — log in first using <strong>Login to Switch</strong>',
      unknown: 'an unknown state — press Enter in the terminal to check the prompt',
    };
    const modeDesc = modeLabels[mode] ?? 'an unexpected state';
    const warningMsg = `⚠&nbsp; <strong>Cloud Check requires Operational mode.</strong><br>The switch is currently in ${modeDesc}.`;

    showCliModeModalWithMode(mode, warningMsg);
    return false;
  }

  function buildCliModeBody(mode: 'operational' | 'config' | 'shell' | 'login' | 'unknown', warningMsg?: string): string {
    const modeConfig = {
      operational: {
        label: 'Operational Mode',
        prompt: 'user@switch&gt;',
        colorClass: 'cli-mode-badge--operational',
        note: 'You are ready to run show commands and use all app features.',
      },
      config: {
        label: 'Configuration Mode',
        prompt: 'user@switch#',
        colorClass: 'cli-mode-badge--config',
        note: 'Type <code class="cli-mode-prompt-sample">exit</code> in the terminal to return to Operational mode before using most app tools.',
      },
      shell: {
        label: 'Shell (Unix)',
        prompt: 'root@switch%',
        colorClass: 'cli-mode-badge--shell',
        note: 'Type <code class="cli-mode-prompt-sample">cli</code> in the terminal to enter Junos CLI (Operational mode).',
      },
      login: {
        label: 'Not Logged In',
        prompt: 'login:',
        colorClass: 'cli-mode-badge--login',
        note: 'Use the <strong>Login to Switch</strong> button in the Device &amp; Config panel, or type credentials in the terminal.',
      },
      unknown: {
        label: 'Unknown',
        prompt: '(no prompt)',
        colorClass: 'cli-mode-badge--unknown',
        note: 'No prompt was detected. Press Enter in the terminal to wake the session, then check baud rate if nothing appears.',
      },
    };

    const rows: Array<{ mode: keyof typeof modeConfig; howTo: string }> = [
      { mode: 'operational', howTo: 'Already here — run show commands freely' },
      { mode: 'config',      howTo: 'Type: exit' },
      { mode: 'shell',       howTo: 'Type: cli' },
      { mode: 'login',       howTo: 'Log in with credentials first' },
      { mode: 'unknown',     howTo: 'Press Enter; check cable/baud if no response' },
    ];

    const current = modeConfig[mode];

    let html = '';

    if (warningMsg) {
      html += `<div class="cli-mode-warning-banner">${warningMsg}</div>`;
    }

    html += `<div class="check-modal-section">`;
    html += `<div class="check-modal-section-title">Current Mode</div>`;
    html += `<div class="cli-mode-hero">`;
    html += `<span class="cli-mode-badge ${current.colorClass}">${current.label}</span>`;
    html += `<code class="cli-mode-prompt-sample">${current.prompt}</code>`;
    html += `</div>`;
    html += `<p class="cli-mode-note">${current.note}</p>`;
    html += `</div>`;

    html += `<div class="check-modal-section">`;
    html += `<div class="check-modal-section-title">Mode Reference</div>`;
    html += `<table class="cli-mode-table">`;
    html += `<thead><tr><th>Mode</th><th>Prompt</th><th>How to reach Operational (&gt;)</th></tr></thead>`;
    html += `<tbody>`;
    for (const row of rows) {
      const cfg = modeConfig[row.mode];
      const rowClass = row.mode === mode ? 'cli-mode-table__row--current' : '';
      html += `<tr class="${rowClass}">`;
      html += `<td><span class="cli-mode-badge cli-mode-badge--sm ${cfg.colorClass}">${cfg.label}</span></td>`;
      html += `<td><code class="cli-mode-prompt-sample">${cfg.prompt}</code></td>`;
      html += `<td class="cli-mode-table__howto">${row.howTo}</td>`;
      html += `</tr>`;
    }
    html += `</tbody></table>`;
    html += `</div>`;

    html += `<div class="check-modal-section" style="display:flex;justify-content:flex-end;">`;
    html += `<button class="btn btn-primary btn-sm" id="cli-mode-got-it">Got it</button>`;
    html += `</div>`;

    return html;
  }

  // ---- Event listeners ----
  ui.btnConnect.addEventListener('click', connect);
  ui.btnDisconnect.addEventListener('click', disconnect);
  ui.btnClear.addEventListener('click', () => term.clear());
  ui.btnLoadSites.addEventListener('click', loadSites);
  ui.btnRunTroubleshoot.addEventListener('click', runTroubleshoot);
  ui.btnMistStatus.addEventListener('click', runMistStatus);
  ui.btnSslCheck.addEventListener('click', runSslCheck);
  ui.btnExamine.addEventListener('click', examineSwitch);
  ui.btnDisableAiu.addEventListener('click', disableAutoImageUpgrade);
  ui.btnConfigDrift.addEventListener('click', checkConfigDrift);
  ui.btnOfflineTimeline.addEventListener('click', checkOfflineTimeline);
  ui.btnAdopt.addEventListener('click', adoptSwitch);
  document.getElementById('btn-cli-help')?.addEventListener('click', () => showCliModeModal());
  document.getElementById('btn-show-changes')?.addEventListener('click', showConfigChangesModal);

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
  });

  // ---- Initial state ----
  setConnectedState(false);
  initLayerButtons();
  initTsCheckList();
  term.writeSystem('Junos Console ready. Click "Connect" to select a serial port.');
  term.focus();
}
