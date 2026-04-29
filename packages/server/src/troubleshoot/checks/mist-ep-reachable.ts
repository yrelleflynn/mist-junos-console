import { registerCheck } from '../runner.js';

registerCheck('mist-ep-reachable', async (ctx, cli) => {
  const ep = ctx.mistEndpoint!;
  const out = await cli.run(`ping ${ep} count 5 rapid`, 20_000).catch((e: Error) => e.message);
  const m = out.match(/(\d+)%\s+packet loss/);
  const loss = m ? parseInt(m[1]!, 10) : 100;

  if (loss === 0) {
    return { checkId: 'mist-ep-reachable', status: 'pass', summary: `Mist endpoint ${ep} reachable (0% loss)` };
  }
  if (loss < 100) {
    return { checkId: 'mist-ep-reachable', status: 'warn', summary: `Mist endpoint ${ep} intermittent (${loss}% loss)`, rawOutput: out };
  }
  return {
    checkId: 'mist-ep-reachable',
    status: 'fail',
    summary: `Mist endpoint ${ep} unreachable — check firewall rules for TCP 443 outbound`,
    rawOutput: out,
  };
});
