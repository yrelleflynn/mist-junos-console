import type { Check, CheckContext, CheckResult } from './base';

export const vlanConfigCheck: Check = {
  id: 'vlan-config',
  name: 'VLAN Configuration',

  async run(ctx: CheckContext): Promise<CheckResult> {
    const id = 'vlan-config';
    const name = 'VLAN Configuration';
    const { runner, uplinkPort: port } = ctx;

    if (!port) {
      return { id, name, status: 'skip', detail: 'No uplink port identified' };
    }

    const cmd = await runner.execute(`show vlans interface ${port}`);
    if (!cmd.success) {
      return { id, name, status: 'fail', detail: cmd.error || 'Command failed', raw: cmd.output };
    }

    const vlanLines = cmd.output.split('\n').filter((l) => /\d+/.test(l) && !/^(Routing|Name|VLAN)/.test(l.trim()));
    if (vlanLines.length === 0) {
      const altCmd = await runner.execute(`show ethernet-switching interface ${port}`);
      if (altCmd.output.includes('trunk') || altCmd.output.includes('access')) {
        return { id, name, status: 'pass', detail: `VLANs configured on ${port}`, raw: altCmd.output };
      }
      return { id, name, status: 'warn', detail: `No VLANs found on ${port}`, raw: cmd.output };
    }

    return { id, name, status: 'pass', detail: `${vlanLines.length} VLAN(s) on ${port}`, raw: cmd.output };
  },
};
