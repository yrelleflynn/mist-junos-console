import { registerCheck } from '../runner.js';

registerCheck('arp-gateway', async (ctx, cli) => {
  if (!ctx.defaultGateway) {
    return { checkId: 'arp-gateway', status: 'fail', summary: 'No default gateway resolved — cannot check ARP' };
  }
  const gw = ctx.defaultGateway;
  const out = await cli.run(`show arp hostname ${gw}`, 10_000).catch((e: Error) => e.message);
  const hasEntry = /([0-9a-f]{2}:){5}[0-9a-f]{2}/i.test(out);

  if (hasEntry) {
    return { checkId: 'arp-gateway', status: 'pass', summary: `ARP entry present for default gateway ${gw}` };
  }
  return {
    checkId: 'arp-gateway',
    status: 'fail',
    summary: `No ARP entry for default gateway ${gw} — gateway unreachable at layer 2`,
    rawOutput: out,
  };
});
