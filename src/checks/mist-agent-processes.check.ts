import type { Check, CheckContext, CheckResult } from './base';

export const mistAgentProcessesCheck: Check = {
  id: 'mist-processes',
  name: 'Mist Agent Processes',

  async run(ctx: CheckContext): Promise<CheckResult> {
    const id = 'mist-processes';
    const name = 'Mist Agent Processes';
    const { runner } = ctx;

    // Check for mcd (Mist Cloud Daemon) and jmd (Junos Mist Daemon).
    // Use interactive shell to avoid pipe/redirect issues with 'start shell command'.
    await runner.send('start shell\n');
    await new Promise((r) => setTimeout(r, 2000));

    const cmd = await runner.execute('/bin/sh -c \'ps aux | grep -E "mcd|jmd" | grep -v grep\'', 15000, 2000);

    // Exit shell back to Junos CLI
    await runner.send('exit\n');
    await new Promise((r) => setTimeout(r, 1000));
    await runner.send('cli\n');
    await new Promise((r) => setTimeout(r, 1500));

    if (!cmd.success) {
      return { id, name, status: 'warn', detail: 'Could not check processes — shell access may be restricted', raw: cmd.output };
    }

    return parseMistProcesses(cmd.output);
  },
};

function parseMistProcesses(output: string): CheckResult {
  const id = 'mist-processes';
  const name = 'Mist Agent Processes';

  const lines = output.split('\n').filter((l) => l.trim().length > 0);

  const hasMcd = lines.some((l) => /\/mcd\b/.test(l) || /\bmcd\s/.test(l));
  const hasJmd = lines.some((l) => /\/jmd\b/.test(l) || /\bjmd\s/.test(l));

  if (hasMcd && hasJmd) {
    return { id, name, status: 'pass', detail: 'mcd and jmd running', raw: output };
  }

  if (hasMcd && !hasJmd) {
    return { id, name, status: 'warn', detail: 'mcd running, jmd not found', raw: output };
  }

  if (!hasMcd && hasJmd) {
    return { id, name, status: 'warn', detail: 'jmd running, mcd not found', raw: output };
  }

  // Neither running
  return { id, name, status: 'fail', detail: 'Neither mcd nor jmd processes found — Mist agent may not be running', raw: output };
}
