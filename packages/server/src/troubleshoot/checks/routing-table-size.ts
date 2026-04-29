import { registerCheck } from '../runner.js';

const WARN_MIN = 2;
const WARN_MAX = 500;

registerCheck('routing-table-size', async (_ctx, cli) => {
  const out = await cli.run('show route summary', 10_000).catch((e: Error) => e.message);
  const m = out.match(/(\d+)\s+destinations/);
  const count = m ? parseInt(m[1]!, 10) : -1;

  if (count < 0) {
    return { checkId: 'routing-table-size', status: 'warn', summary: 'Could not parse routing table size', rawOutput: out };
  }
  if (count < WARN_MIN) {
    return { checkId: 'routing-table-size', status: 'warn', summary: `Routing table has only ${count} destination(s) — may be missing routes`, rawOutput: out };
  }
  if (count > WARN_MAX) {
    return { checkId: 'routing-table-size', status: 'warn', summary: `Routing table unusually large (${count} destinations) — check for route leaks`, rawOutput: out };
  }
  return { checkId: 'routing-table-size', status: 'pass', summary: `Routing table size normal (${count} destinations)` };
});
