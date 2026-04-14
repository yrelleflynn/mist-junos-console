import type { Check, CheckContext, CheckResult } from './base';

export const mistAgentVersionCheck: Check = {
  id: 'mist-agent',
  name: 'Mist Agent Version',

  async run({ runner }: CheckContext): Promise<CheckResult> {
    const id = 'mist-agent';
    const name = 'Mist Agent Version';

    const cmd = await runner.execute('show version | match mist', 15000);
    if (!cmd.success) {
      return { id, name, status: 'warn', detail: 'Could not determine Mist agent version', raw: cmd.output };
    }

    const versionMatch = cmd.output.match(/Mist\s+Agent\s*\[?(v?[\d.]+[\w-]*)\]?/i);
    if (versionMatch) {
      return { id, name, status: 'pass', detail: `Mist Agent ${versionMatch[1]}`, raw: cmd.output };
    }

    if (cmd.output.trim().length === 0 || !cmd.output.toLowerCase().includes('mist')) {
      return { id, name, status: 'fail', detail: 'Mist Agent not installed', raw: cmd.output };
    }

    return { id, name, status: 'pass', detail: cmd.output.trim(), raw: cmd.output };
  },

  remediation() {
    return { text: 'Mist Agent not installed. Use the "Adopt Switch" button.' };
  },
};
