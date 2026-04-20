import type { Check, CheckContext, CheckResult } from './base';

export const defaultRouteCheck: Check = {
  id: 'default-route',
  name: 'Default Gateway',
  critical: true,

  async run(ctx: CheckContext): Promise<CheckResult> {
    const id = 'default-route';
    const name = 'Default Gateway';
    const { runner } = ctx;

    const cmd = await runner.execute('show route 0.0.0.0/0', 20000, 3000);
    if (!cmd.success) {
      return { id, name, status: 'fail', detail: cmd.error || 'Command failed', raw: cmd.output };
    }

    const hasDefault = cmd.output.includes('0.0.0.0/0') || cmd.output.includes('default');
    if (!hasDefault) {
      return { id, name, status: 'fail', detail: 'No default route found', raw: cmd.output };
    }

    const nhMatch =
      cmd.output.match(/to\s+(\d+\.\d+\.\d+\.\d+)/i) ||
      cmd.output.match(/via\s+(\d+\.\d+\.\d+\.\d+)/i) ||
      cmd.output.match(/>\s+(\d+\.\d+\.\d+\.\d+)/);
    const nextHop = nhMatch ? nhMatch[1] : 'unknown';

    return { id, name, status: 'pass', detail: `Default route via ${nextHop}`, raw: cmd.output };
  },
};
