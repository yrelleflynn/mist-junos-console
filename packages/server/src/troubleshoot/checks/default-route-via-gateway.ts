import { registerCheck } from '../runner.js';

registerCheck('default-route-via-gateway', async (ctx, cli) => {
  const gw = ctx.defaultGateway!;
  const out = await cli.run(`show route ${gw} detail`, 10_000).catch((e: Error) => e.message);
  const isDirect = /\bDirect\b/i.test(out) || /\bLocal\b/i.test(out);

  if (isDirect) {
    return { checkId: 'default-route-via-gateway', status: 'pass', summary: `Default gateway ${gw} is directly connected` };
  }
  return {
    checkId: 'default-route-via-gateway',
    status: 'warn',
    summary: `Default gateway ${gw} may be reached recursively — verify next-hop is on a directly-attached subnet`,
    rawOutput: out,
  };
});
