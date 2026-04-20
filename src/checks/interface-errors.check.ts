import type { Check, CheckContext, CheckResult } from './base';

export const interfaceErrorsCheck: Check = {
  id: 'interface-errors',
  name: 'Uplink Interface Errors',

  async run(ctx: CheckContext): Promise<CheckResult> {
    const id = 'interface-errors';
    const name = 'Uplink Interface Errors';
    const { runner, uplinkPort: port } = ctx;

    if (!port) {
      return { id, name, status: 'skip', detail: 'No uplink port identified' };
    }

    const cmd = await runner.execute(`show interfaces ${port} extensive | match error`, 15000);
    if (!cmd.success) {
      return { id, name, status: 'warn', detail: 'Could not retrieve error counters', raw: cmd.output };
    }

    const errors: { name: string; count: number }[] = [];
    for (const line of cmd.output.split('\n').filter((l) => l.trim().length > 0)) {
      const match = line.match(/([\w\/\s-]+errors?|drops|discards|CRC|framing|runts|giants|collisions)\s*:\s*(\d+)/i);
      if (match) {
        const count = parseInt(match[2], 10);
        if (count > 0) errors.push({ name: match[1].trim(), count });
      }
    }

    if (errors.length === 0) {
      return { id, name, status: 'pass', detail: `No errors on ${port}`, raw: cmd.output };
    }

    const errorSummary = errors.map((e) => `${e.name}: ${e.count}`).join(', ');
    return { id, name, status: 'warn', detail: `${port}: ${errorSummary}`, raw: cmd.output };
  },
};
