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
import { TroubleshootService, CheckResult, CheckStatus } from './services/troubleshoot.service';
import { SwitchIdentityService, MistMatchResult } from './services/switch-identity.service';
import { ConfigDriftService, ConfigDiffLine } from './services/config-drift.service';
import { MIST_CLOUDS, getCloudById } from './config/mist-clouds.config';
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
    btnLogin: document.getElementById('btn-login') as HTMLButtonElement,
    loginResult: document.getElementById('login-result') as HTMLElement,
    btnIdentify: document.getElementById('btn-identify') as HTMLButtonElement,
    deviceIdentity: document.getElementById('device-identity') as HTMLElement,
    btnRootPassword: document.getElementById('btn-root-password') as HTMLButtonElement,
    rootPasswordResult: document.getElementById('root-password-result') as HTMLElement,
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
    ui.btnIdentify.disabled = !connected;
    ui.btnLogin.disabled = !connected;
    ui.btnAdopt.disabled = !connected;
    // Config drift only enabled after identification succeeds
    if (!connected) {
      ui.btnConfigDrift.disabled = true;
      ui.btnRootPassword.disabled = true;
      ui.btnOfflineTimeline.disabled = true;
      lastMatchResult = null;
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

    // Run Fix button handler
    const runFixBtn = document.getElementById('check-modal-run-fix');
    if (runFixBtn && result.commands) {
      const commands = result.commands;
      runFixBtn.addEventListener('click', async () => {
        runFixBtn.setAttribute('disabled', 'true');
        runFixBtn.textContent = 'Running…';
        const outputEl = document.getElementById('check-modal-output')!;
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

  // ---- Troubleshoot: Run ----
  async function runTroubleshoot(): Promise<void> {
    const cloudId = ui.mistCloud.value;
    const cloud = getCloudById(cloudId);
    if (!cloud) {
      term.writeError('Please select a Mist cloud region.');
      return;
    }

    const siteId = ui.mistSite.value;
    const uplinkPort = ui.tsUplinkPort.value.trim();

    ui.tsResults.innerHTML = '';
    ui.btnRunTroubleshoot.disabled = true;

    const rc = createResultsContainer('Cloud Connectivity Check');
    ui.tsResults.appendChild(rc.container);

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

    // Run checks
    accumulatedResults = [];

    const results = await troubleshooter.runAll({
      cloud,
      uplinkPort,
      siteId: siteId || undefined,
      deviceId: lastMatchResult?.mistDevice?.id || undefined,
      onProgress: (result: CheckResult) => {
        accumulatedResults.push(result);
        rc.addResult(result);
        term.writeSystem(`  [${statusIcon(result.status)}] ${result.name}: ${result.detail}`);
      },
    });

    rc.finalise(results);
    term.writeSystem('— Cloud connectivity check complete —');
    ui.btnRunTroubleshoot.disabled = false;
  }

  // ---- Mist Status (standalone) ----
  async function runMistStatus(): Promise<void> {
    ui.tsResults.innerHTML = '';
    ui.btnMistStatus.disabled = true;

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

    ui.tsResults.innerHTML = '';
    ui.btnSslCheck.disabled = true;

    const rc = createResultsContainer('Firewall Policy Check');
    ui.tsResults.appendChild(rc.container);

    term.writeSystem('— Running firewall policy check —');

    const results = await troubleshooter.checkFirewallPolicy(cloud);
    for (const result of results) {
      rc.addResult(result);
      term.writeSystem(`  [${statusIcon(result.status)}] ${result.name}: ${result.detail}`);
    }

    rc.finalise(results);
    term.writeSystem('— Firewall policy check complete —');
    ui.btnSslCheck.disabled = false;
  }

  // ---- Login to Switch ----
  async function loginToSwitch(): Promise<void> {
    ui.btnLogin.disabled = true;
    ui.loginResult.innerHTML = '<div class="status-text info">Detecting switch state…</div>';
    term.writeSystem('— Attempting to log in to switch —');

    try {
      // Step 1: Send Enter to see what prompt we get
      const initial = await cmdRunner.sendAndWaitFor('\n', /login:|>|#|%/, 5000);
      const output = initial.output;

      // Case 1: Already at a CLI prompt (already logged in)
      if (/>\s*$|#\s*$/.test(output)) {
        ui.loginResult.innerHTML = '<div class="device-mist-match found">Already logged in to Junos CLI.</div>';
        term.writeSystem('  Already logged in.');
        ui.btnIdentify.disabled = false;
        ui.btnLogin.disabled = false;
        return;
      }

      // Case 2: Shell prompt (root@switch%)
      if (/%\s*$/.test(output)) {
        term.writeSystem('  At shell prompt — entering Junos CLI…');
        await cmdRunner.send('cli\n');
        await new Promise((r) => setTimeout(r, 1500));
        ui.loginResult.innerHTML = '<div class="device-mist-match found">Logged in (was at shell prompt, entered CLI).</div>';
        term.writeSystem('  Entered Junos CLI.');
        ui.btnIdentify.disabled = false;
        ui.btnLogin.disabled = false;
        return;
      }

      // Case 3: Login prompt
      if (/login:/i.test(output)) {
        term.writeSystem('  Login prompt detected. Trying root with no password (factory default)…');

        // Try root with no password first (factory default)
        const userResult = await cmdRunner.sendAndWaitFor('root\n', /[Pp]assword:|>|#|%/, 5000);

        // Factory default: root with no password goes straight to shell/CLI
        if (/>\s*$|#\s*$/.test(userResult.output)) {
          // Went straight to Junos CLI — factory default, no password
          ui.loginResult.innerHTML = '<div class="device-mist-match found">' +
            '<strong>Factory default switch — logged in as root (no password).</strong><br><br>' +
            'A root password must be set before any configuration can be committed.' +
            '</div>';
          term.writeSystem('  Factory default — logged in with no password. Root password required.');
          ui.btnIdentify.disabled = false;
          ui.btnLogin.disabled = false;
          return;
        }

        if (/%\s*$/.test(userResult.output)) {
          // Went to shell — factory default, enter CLI
          term.writeSystem('  Factory default — at shell prompt, entering CLI…');
          await cmdRunner.send('cli\n');
          await new Promise((r) => setTimeout(r, 1500));
          ui.loginResult.innerHTML = '<div class="device-mist-match found">' +
            '<strong>Factory default switch — logged in as root (no password).</strong><br><br>' +
            'A root password must be set before any configuration can be committed.' +
            '</div>';
          term.writeSystem('  Entered Junos CLI. Root password required.');
          ui.btnIdentify.disabled = false;
          ui.btnLogin.disabled = false;
          return;
        }

        // Got a password prompt — switch has a password set
        if (/[Pp]assword:/i.test(userResult.output)) {
          term.writeSystem('  Password required. Attempting to retrieve from Mist API…');

          // Try Mist site root password
          let rootPw: string | null = null;
          const siteId = ui.mistSite.value;
          if (siteId && mistApi.isConfigured) {
            rootPw = await mistApi.getRootPassword(siteId);
          }

          if (rootPw) {
            term.writeSystem('  Got root password from Mist. Logging in…');
            const passResult = await cmdRunner.sendAndWaitFor(rootPw + '\n', />|#|%|login:/, 10000);

            if (/login:/i.test(passResult.output)) {
              // Login failed — wrong password
              ui.loginResult.innerHTML = '<div class="device-mist-match not-found">' +
                '<strong>Login failed</strong> — Mist site root password was rejected.<br><br>' +
                'The switch may have a different password than what is configured in the Mist site settings.' +
                '</div>';
              term.writeError('  Login failed — Mist password rejected.');
              ui.btnLogin.disabled = false;
              return;
            }

            if (/%\s*$/.test(passResult.output)) {
              await cmdRunner.send('cli\n');
              await new Promise((r) => setTimeout(r, 1500));
            }

            ui.loginResult.innerHTML = '<div class="device-mist-match found">Logged in as root using Mist site password.</div>';
            term.writeSystem('  Login successful.');
            ui.btnIdentify.disabled = false;
            ui.btnLogin.disabled = false;
            return;
          }

          // No Mist password available — tell the user
          // Send Ctrl+C to cancel the password prompt
          await cmdRunner.send('\x03\n');
          await new Promise((r) => setTimeout(r, 1000));

          let html = '<div class="device-mist-match not-found">';
          html += '<strong>Password required but not available.</strong><br><br>';
          if (!mistApi.isConfigured) {
            html += 'Configure the Mist API (cloud, token, org ID) and select a site to auto-retrieve the root password.<br><br>';
          } else if (!siteId) {
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
  }

  // ---- Device Identification ----
  async function identifySwitch(): Promise<void> {
    ui.btnIdentify.disabled = true;
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
        const siteName = mistDevice.site_id ? 'assigned' : 'unassigned';
        html += `<div class="device-mist-match found">Found in Mist (matched by ${matchedBy}) — ${mistDevice.name || mistDevice.id}<br>Site: ${siteName}</div>`;
        term.writeSystem(`  Mist: Found (${matchedBy}) — ${mistDevice.name || mistDevice.id}`);
        ui.btnConfigDrift.disabled = false;
        ui.btnRootPassword.disabled = !mistDevice.site_id;
        ui.btnOfflineTimeline.disabled = !mistDevice.site_id;
      } else if (!mistApi.isConfigured) {
        html += '<div class="device-mist-match no-api">Mist API not configured — cannot search inventory</div>';
        term.writeSystem('  Mist: API not configured');
      } else {
        html += '<div class="device-mist-match not-found">Not found in Mist inventory</div>';
        term.writeSystem('  Mist: Not found in inventory');
      }

      ui.deviceIdentity.innerHTML = html;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      ui.deviceIdentity.innerHTML = `<div class="status-text error">Error: ${msg}</div>`;
      term.writeError(`Identification failed: ${msg}`);
    } finally {
      ui.btnIdentify.disabled = false;
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

  // ---- Get Root Password ----
  async function getRootPassword(): Promise<void> {
    if (!lastMatchResult?.mistDevice?.site_id) {
      ui.rootPasswordResult.innerHTML = '<div class="status-text error">Identify the switch first and ensure it is assigned to a site in Mist.</div>';
      return;
    }

    ui.btnRootPassword.disabled = true;
    ui.rootPasswordResult.innerHTML = '<div class="status-text info">Fetching root password from Mist…</div>';

    try {
      const siteId = lastMatchResult.mistDevice.site_id;
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
      } else {
        html += '<div class="device-mist-match not-found" style="margin-top:6px;">';
        html += '<strong>No root password set in Mist site settings.</strong><br><br>';
        html += 'The switch may be using the Mist default random password set during adoption. Try these options:<br><br>';
        html += '1. <strong>Default factory credentials:</strong> Username <code>root</code> with no password (only works on factory-default or zeroized switches)<br><br>';
        html += '2. <strong>Set a password in Mist:</strong> Go to <em>Organization → Site Configuration → select the site → Switch Management → Root Password</em>, set a password, and wait for the config to push<br><br>';
        html += '3. <strong>Mist user account:</strong> If the switch was adopted via CLI, try username <code>mist</code> with the device claim code as the password';
        html += '</div>';
        term.writeSystem('  Root password not set in Mist site settings.');
      }

      ui.rootPasswordResult.innerHTML = html;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      ui.rootPasswordResult.innerHTML = `<div class="status-text error">Error: ${msg}</div>`;
      term.writeError(`Failed to fetch root password: ${msg}`);
    } finally {
      ui.btnRootPassword.disabled = false;
    }
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

        // Try Mist site password first
        const siteId = ui.mistSite.value;
        if (siteId) {
          rootPassword = await mistApi.getRootPassword(siteId);
          if (rootPassword) {
            term.writeSystem('  Using root password from Mist site settings.');
          }
        }

        // Fall back to user-provided password
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

      // Display the commands (including root password set if needed)
      const commandLines = commands.split('\n').filter((l: string) => l.trim().length > 0);
      const totalCommands = commandLines.length + (rootPassword ? 1 : 0);

      let html = '<div class="drift-section-title">Adoption Commands (' + totalCommands + ' lines)</div>';
      html += '<div style="max-height:200px;overflow-y:auto;margin-bottom:8px;">';
      if (rootPassword) {
        html += '<div class="drift-line mist-only"><span class="drift-category">Root Auth</span>set system root-authentication plain-text-password ••••••••</div>';
      }
      for (const line of commandLines) {
        html += `<div class="drift-line mist-only">${escapeHtml(line.trim())}</div>`;
      }
      html += '</div>';

      if (!hasRootAuth) {
        html += '<div class="status-text info" style="margin-bottom:8px;">Root password will be set before adoption commands are applied.</div>';
      }

      html += '<div class="sidebar-actions" style="margin-top:8px;">';
      html += '<button id="btn-adopt-apply" class="btn btn-primary">Apply to Switch</button>';
      html += '<button id="btn-adopt-cancel" class="btn btn-secondary">Cancel</button>';
      html += '</div>';
      html += '<div id="adopt-apply-status"></div>';

      ui.adoptResults.innerHTML = html;
      term.writeSystem(`— Retrieved ${commandLines.length} adoption commands from Mist —`);

      // Wire up the apply button
      const applyBtn = document.getElementById('btn-adopt-apply') as HTMLButtonElement;
      const cancelBtn = document.getElementById('btn-adopt-cancel') as HTMLButtonElement;
      const statusEl = document.getElementById('adopt-apply-status') as HTMLElement;

      cancelBtn.addEventListener('click', () => {
        ui.adoptResults.innerHTML = '';
        ui.btnAdopt.disabled = false;
      });

      applyBtn.addEventListener('click', async () => {
        applyBtn.disabled = true;
        cancelBtn.disabled = true;
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

            // Use plain-text-password which prompts for password twice
            await cmdRunner.send('set system root-authentication plain-text-password\n');
            await new Promise((r) => setTimeout(r, 1000));

            // Enter password at "New password:" prompt
            const pw1 = await cmdRunner.sendAndWaitFor(rootPassword + '\n', /password:|secret:/, 5000);
            if (pw1.matched) {
              // Enter password again at "Retype new password:" prompt
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
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          statusEl.innerHTML = `<div class="status-text error">Error: ${msg}</div>`;
          term.writeError(`Adoption apply error: ${msg}`);
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

  // ---- Event listeners ----
  ui.btnConnect.addEventListener('click', connect);
  ui.btnDisconnect.addEventListener('click', disconnect);
  ui.btnClear.addEventListener('click', () => term.clear());
  ui.btnLoadSites.addEventListener('click', loadSites);
  ui.btnRunTroubleshoot.addEventListener('click', runTroubleshoot);
  ui.btnMistStatus.addEventListener('click', runMistStatus);
  ui.btnSslCheck.addEventListener('click', runSslCheck);
  ui.btnIdentify.addEventListener('click', identifySwitch);
  ui.btnLogin.addEventListener('click', loginToSwitch);
  ui.btnRootPassword.addEventListener('click', getRootPassword);
  ui.btnConfigDrift.addEventListener('click', checkConfigDrift);
  ui.btnOfflineTimeline.addEventListener('click', checkOfflineTimeline);
  ui.btnAdopt.addEventListener('click', adoptSwitch);

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
  term.writeSystem('Junos Console ready. Click "Connect" to select a serial port.');
  term.focus();
}
