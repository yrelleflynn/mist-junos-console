import { registerCheck } from '../runner.js';

const LARGE_PAYLOAD = 1400;

registerCheck('mtu-check', async (ctx, cli) => {
  const target = ctx.defaultGateway!;
  const out = await cli
    .run(`ping ${target} count 3 size ${LARGE_PAYLOAD} do-not-fragment rapid`, 20_000)
    .catch((e: Error) => e.message);
  const m = out.match(/(\d+)%\s+packet loss/);
  const loss = m ? parseInt(m[1]!, 10) : 100;

  if (loss === 0) {
    return { checkId: 'mtu-check', status: 'pass', summary: `No MTU black hole detected (${LARGE_PAYLOAD}-byte packets pass)` };
  }
  return {
    checkId: 'mtu-check',
    status: 'fail',
    summary: `MTU black hole suspected — ${LARGE_PAYLOAD}-byte DF ping to ${target} dropped (${loss}% loss)`,
    detail: 'Check upstream interface MTU and any intermediate device MTU settings',
    rawOutput: out,
  };
});
