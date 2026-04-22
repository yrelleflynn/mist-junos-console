import type { CommandResult } from '../../services/command-runner.service';

export interface AdoptionPlan {
  commandLines: string[];
  hasRootAuth: boolean;
  rootPassword: string | null;
  rootPasswordSource: 'mist-site' | 'user-input' | null;
  totalCommands: number;
}

export type AdoptionPreparationResult = { kind: 'ready'; plan: AdoptionPlan };

export interface AdoptionPreparationDeps {
  getAdoptionCommands: () => Promise<string>;
  getSiteId: () => string | null;
  getRootPassword: (siteId: string) => Promise<string | null>;
  getUserProvidedRootPassword: () => string;
  term: {
    writeSystem: (message: string) => void;
  };
}

export interface AdoptionApplyDeps {
  execute: (command: string, timeoutMs?: number, promptWait?: number) => Promise<Pick<CommandResult, 'success' | 'output'>>;
  send: (text: string) => Promise<void>;
  sendAndWaitFor: (text: string, pattern: RegExp, timeoutMs?: number) => Promise<{ output: string; matched: boolean }>;
  wait: (ms: number) => Promise<void>;
  term: {
    writeSystem: (message: string) => void;
    writeError: (message: string) => void;
  };
  renderStatus: (html: string) => void;
}

export type AdoptionApplyOutcome =
  | { kind: 'enter-config-failed' }
  | { kind: 'commit-success' }
  | { kind: 'commit-error' }
  | { kind: 'commit-unknown' };

export function parseAdoptionCommands(commands: string): string[] {
  const commandLines = commands
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  if (commandLines.length === 0 || !commands.includes('set ')) {
    throw new Error('No adoption commands returned from API. The endpoint may not be available for your account.');
  }

  return commandLines;
}

export function buildMissingRootPasswordHtml(): string {
  return '<div class="status-text error">' +
    '<strong>Root authentication is not configured on this switch.</strong><br><br>' +
    'A root password is required before adoption commands can be committed.<br><br>' +
    'Either:<br>' +
    '1. Enter a root password in the field above and click Adopt again, or<br>' +
    '2. Select a Mist site (in the Mist API section) that has a root password configured' +
    '</div>';
}

export function buildAdoptionPreviewHtml(
  plan: AdoptionPlan,
  escapeHtml: (value: string) => string,
): string {
  const lines = [
    ...(plan.rootPassword && !plan.hasRootAuth
      ? ['set system root-authentication plain-text-password ••••••••']
      : []),
    ...plan.commandLines,
  ];

  let html = '<div class="config-sync-section-title">Adoption Commands</div>';
  html += `<div class="config-sync-summary">${plan.totalCommands} total commands from Mist adoption intent.</div>`;
  html += `<pre class="config-sync-pre">${escapeHtml(lines.join('\n'))}</pre>`;

  if (!plan.hasRootAuth) {
    html += '<div class="config-sync-warning" style="margin-top:8px;">';
    html += '<span class="config-sync-warning-msg">Root password will be set before adoption commands are applied.</span>';
    html += '</div>';
  }

  html += '<div class="config-sync-section-title" style="margin-top:12px;">Decision Required</div>';
  html += '<div class="config-sync-summary">Review the adoption commands above, then apply them to the switch when ready.</div>';
  html += '<div class="sidebar-actions" style="margin-top:12px;">';
  html += '<button id="btn-adopt-apply" class="btn btn-primary">Apply to Switch</button>';
  html += '<button id="btn-adopt-cancel" class="btn btn-secondary">Cancel</button>';
  html += '</div>';
  html += '<div id="adopt-apply-status"></div>';
  return html;
}

export async function prepareAdoptionPlan(
  deps: AdoptionPreparationDeps,
): Promise<AdoptionPreparationResult> {
  const commands = await deps.getAdoptionCommands();
  const commandLines = parseAdoptionCommands(commands);

  let rootPassword: string | null = null;
  let rootPasswordSource: AdoptionPlan['rootPasswordSource'] = null;

  const siteId = deps.getSiteId();
  if (siteId) {
    rootPassword = await deps.getRootPassword(siteId);
    if (rootPassword) {
      rootPasswordSource = 'mist-site';
    }
  }

  if (!rootPassword) {
    const providedPassword = deps.getUserProvidedRootPassword().trim();
    if (providedPassword) {
      rootPassword = providedPassword;
      rootPasswordSource = 'user-input';
    }
  }

  return {
    kind: 'ready',
    plan: {
      commandLines,
      hasRootAuth: true,
      rootPassword,
      rootPasswordSource,
      totalCommands: commandLines.length,
    },
  };
}

export async function applyAdoptionPlan(
  plan: AdoptionPlan,
  deps: AdoptionApplyDeps,
): Promise<AdoptionApplyOutcome> {
  deps.renderStatus('<div class="status-text info">Entering config mode…</div>');
  deps.term.writeSystem('— Applying adoption commands to switch —');

  const editResult = await deps.execute('edit', 5000);
  if (!editResult.output.includes('#') && !editResult.success) {
    deps.renderStatus('<div class="status-text error">Failed to enter config mode. Are you logged in as root?</div>');
    deps.term.writeError('Failed to enter config mode.');
    return { kind: 'enter-config-failed' };
  }

  if (plan.rootPassword && !plan.hasRootAuth) {
    deps.renderStatus('<div class="status-text info">Setting root password…</div>');
    deps.term.writeSystem('  Setting root authentication…');
    await deps.send('set system root-authentication plain-text-password\n');
    await deps.wait(1000);
    const pw1 = await deps.sendAndWaitFor(`${plan.rootPassword}\n`, /password:|secret:/, 5000);
    if (pw1.matched) {
      await deps.sendAndWaitFor(`${plan.rootPassword}\n`, /#/, 5000);
    }
    deps.term.writeSystem('  Root password set.');
  }

  deps.renderStatus('<div class="status-text info">Applying adoption commands…</div>');

  let applied = 0;
  for (const line of plan.commandLines) {
    await deps.execute(line, 5000, 500);
    applied += 1;
  }

  deps.renderStatus(`<div class="status-text info">Applied ${applied} commands. Committing…</div>`);
  deps.term.writeSystem(`  Applied ${applied} commands. Committing…`);

  const commitResult = await deps.execute('commit and-quit', 60000, 5000);
  if (commitResult.output.includes('commit complete') || commitResult.output.includes('configuration check succeeds')) {
    deps.renderStatus('<div class="status-text success">Adoption commands applied and committed successfully. The switch should connect to Mist within a few minutes.</div>');
    deps.term.writeSystem('  Commit successful. Switch should connect to Mist shortly.');
    return { kind: 'commit-success' };
  }
  if (commitResult.output.includes('error')) {
    deps.renderStatus('<div class="status-text error">Commit returned errors. Check the terminal output.</div>');
    deps.term.writeError('Commit may have failed. Check output above.');
    return { kind: 'commit-error' };
  }

  deps.renderStatus('<div class="status-text info">Commit sent. Check terminal for result.</div>');
  return { kind: 'commit-unknown' };
}
