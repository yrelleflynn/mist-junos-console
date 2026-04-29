import { registerCheck } from '../runner.js';

registerCheck('arp-mist-ep', async (ctx, cli) => {
  const ep = ctx.mistEndpoint!;
  // Ping once to trigger ARP resolution, then check the ARP cache
  await cli.run(`ping ${ep} count 1 rapid`, 10_000).catch(() => null);
  const out = await cli.run(`show arp hostname ${ep}`, 10_000).catch((e: Error) => e.message);
  const hasEntry = /([0-9a-f]{2}:){5}[0-9a-f]{2}/i.test(out);

  if (hasEntry) {
    return { checkId: 'arp-mist-ep', status: 'pass', summary: `ARP resolved for Mist endpoint ${ep}` };
  }
  return {
    checkId: 'arp-mist-ep',
    status: 'warn',
    summary: `No ARP entry for Mist endpoint ${ep} — endpoint may be on a different subnet (normal if routed)`,
    rawOutput: out,
  };
});
