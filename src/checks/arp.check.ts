import type { Check, CheckContext, CheckResult } from './base';

export const arpCheck: Check = {
  id: 'arp',
  name: 'ARP Table',

  async run(ctx: CheckContext): Promise<CheckResult> {
    const id = 'arp';
    const name = 'ARP Table';
    const { runner } = ctx;

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
};
