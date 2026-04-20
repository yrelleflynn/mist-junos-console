import type { Check, CheckContext, CheckResult } from './base';

export const mistAgentVersionCheck: Check = {
  id: 'mist-agent',
  name: 'Mist Agent Version',

  async run(ctx: CheckContext): Promise<CheckResult> {
    const id = 'mist-agent';
    const name = 'Mist Agent Version';
    const { runner } = ctx;

    const cmd = await runner.execute('show version | match mist', 15000);
    if (!cmd.success) {
      return { id, name, status: 'warn', detail: 'Could not determine Mist agent version', raw: cmd.output };
    }

    // Look for "JUNOS Mist Agent [vX.X.X]" or similar
    const versionMatch = cmd.output.match(/Mist\s+Agent\s*\[?(v?[\d.]+[\w-]*)\]?/i);
    if (versionMatch) {
      return { id, name, status: 'pass', detail: `Mist Agent ${versionMatch[1]}`, raw: cmd.output };
    }

    // No Mist agent found
    if (cmd.output.trim().length === 0 || !cmd.output.toLowerCase().includes('mist')) {
      return { id, name, status: 'fail', detail: 'Mist Agent not installed', raw: cmd.output };
    }

    return { id, name, status: 'pass', detail: cmd.output.trim(), raw: cmd.output };
  },
};
