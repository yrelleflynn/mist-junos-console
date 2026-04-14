import type { Check, CheckContext, CheckResult } from './base';

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

  return { id, name, status: 'fail', detail: 'Neither mcd nor jmd processes found — Mist agent may not be running', raw: output };
}

export const mistAgentProcessesCheck: Check = {
  id: 'mist-processes',
  name: 'Mist Agent Processes',

  async run({ runner }: CheckContext): Promise<CheckResult> {
    const id = 'mist-processes';
    const name = 'Mist Agent Processes';

    await runner.send('start shell\n');
    await new Promise((r) => setTimeout(r, 2000));

    const cmd = await runner.execute('/bin/sh -c \'ps aux | grep -E "mcd|jmd" | grep -v grep\'', 15000, 2000);

    await runner.send('exit\n');
    await new Promise((r) => setTimeout(r, 1000));
    await runner.send('cli\n');
    await new Promise((r) => setTimeout(r, 1500));

    if (!cmd.success) {
      return { id, name, status: 'warn', detail: 'Could not check processes — shell access may be restricted', raw: cmd.output };
    }

    return parseMistProcesses(cmd.output);
  },

  remediation(result, allResults) {
    const agentNotInstalled = allResults?.find((x) => x.id === 'mist-agent')?.status === 'fail';
    if (agentNotInstalled) {
      return {
        text: 'Mist Agent not installed.\n\nOption 1 — Adopt via console:\nUse the Adopt Switch button to fetch and apply adoption commands from Mist.\n\nOption 2 — Claim in Mist portal:\nGo to Organization → Inventory → Add Devices and enter the claim code from the switch label.',
      };
    }
    return {
      text: 'Mist agent processes (mcd/jmd) are not running.\n\nOption 1 — Restart mcd:\nAttempts to restart the Mist cloud daemon. This fixes most cases where the agent has stopped unexpectedly.\n\nOption 2 — Re-adopt the switch:\nIf restarting mcd does not resolve the issue, re-applying the adoption commands will reconfigure the agent from scratch.',
      commands: ['restart mcd'],
    };
  },
};
