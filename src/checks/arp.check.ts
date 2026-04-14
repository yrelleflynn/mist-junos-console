import type { Check, CheckContext, CheckResult } from './base';

export const arpCheck: Check = {
  id: 'arp',
  name: 'ARP Table',

  async run({ runner }: CheckContext): Promise<CheckResult> {
    const id = 'arp';
    const name = 'ARP Table';

    const cmd = await runner.execute('show arp no-resolve', 30000, 3000);
    if (!cmd.success) {
      return { id, name, status: 'fail', detail: cmd.error || 'Command failed', raw: cmd.output };
    }

    const arpLines = cmd.output.split('\n').filter((l) => /\d+\.\d+\.\d+\.\d+/.test(l));

    if (arpLines.length === 0) {
      return { id, name, status: 'fail', detail: 'ARP table is empty', raw: cmd.output };
    }

    return { id, name, status: 'pass', detail: `${arpLines.length} ARP entry/entries`, raw: cmd.output };
  },

  remediation(_result, allResults) {
    const portFailed = allResults?.find((x) => x.id === 'port-status')?.status === 'fail';
    const vlanFailed = allResults?.find((x) => x.id === 'vlan-config')?.status === 'fail';
    if (portFailed) return { text: 'Uplink port is down — fix physical connection first.' };
    if (vlanFailed) return { text: 'VLAN config failed — gateway may be on a different VLAN.' };
    return { text: 'ARP table is empty. Check STP blocking and Layer 2 connectivity.' };
  },
};
