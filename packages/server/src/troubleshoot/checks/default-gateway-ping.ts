import { registerCheck } from '../runner.js';

registerCheck('default-gateway-ping', async (ctx, cli) => {
  if (!ctx.defaultGateway) {
    return { checkId: 'default-gateway-ping', status: 'error', summary: 'defaultGateway context not resolved' };
  }
  const gw = ctx.defaultGateway;
  const out = await cli.run(`ping ${gw} count 5 rapid`, 15_000).catch((e: Error) => e.message);
  const m = out.match(/(\d+)%\s+packet loss/);
  const loss = m ? parseInt(m[1]!, 10) : 100;

  if (loss === 0) {
    return { checkId: 'default-gateway-ping', status: 'pass', summary: `Default gateway ${gw} reachable (0% loss)` };
  }
  if (loss < 100) {
    return { checkId: 'default-gateway-ping', status: 'warn', summary: `Default gateway ${gw} intermittent (${loss}% loss)`, rawOutput: out };
  }
  return {
    checkId: 'default-gateway-ping',
    status: 'fail',
    summary: `Default gateway ${gw} unreachable (100% loss) — check routing and upstream connectivity`,
    rawOutput: out,
  };
});
