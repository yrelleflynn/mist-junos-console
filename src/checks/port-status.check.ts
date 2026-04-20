import type { Check, CheckContext, CheckResult } from './base';

export const portStatusCheck: Check = {
  id: 'port-status',
  name: 'Uplink Port Status',

  async run(ctx: CheckContext): Promise<CheckResult> {
    const id = 'port-status';
    const name = 'Uplink Port Status';
    const { runner, uplinkPort: port } = ctx;

    if (!port) {
      return { id, name, status: 'skip', detail: 'No uplink port identified' };
    }

    const cmd = await runner.execute(`show interfaces ${port} terse`);
    if (!cmd.success) {
      return { id, name, status: 'fail', detail: cmd.error || 'Command failed', raw: cmd.output };
    }

    const isUp = /\bup\b/i.test(cmd.output);
    if (!isUp) {
      return { id, name, status: 'fail', detail: `Port ${port} is not up`, raw: cmd.output };
    }

    const detailCmd = await runner.execute(`show interfaces ${port}`);
    const speedMatch = detailCmd.output.match(/Speed:\s*(\S+)/i) || detailCmd.output.match(/(\d+[mMgG]bps)/);
    const speed = speedMatch ? speedMatch[1] : 'unknown';

    return { id, name, status: 'pass', detail: `Port ${port} is up (${speed})`, raw: cmd.output };
  },
};
