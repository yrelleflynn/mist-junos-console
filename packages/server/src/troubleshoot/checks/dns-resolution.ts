import { registerCheck } from '../runner.js';

registerCheck('dns-resolution', async (ctx, cli) => {
  const servers = ctx.dnsServers ?? [];

  if (servers.length === 0) {
    return { checkId: 'dns-resolution', status: 'fail', summary: 'No DNS servers configured — run: show system name-servers' };
  }

  const results = await Promise.all(
    servers.map(async (s) => {
      const out = await cli.run(`ping ${s} count 3 rapid`, 10_000).catch((e: Error) => e.message);
      const m = out.match(/(\d+)%\s+packet loss/);
      const loss = m ? parseInt(m[1]!, 10) : 100;
      return { server: s, reachable: loss < 100 };
    }),
  );

  const reachable = results.filter((r) => r.reachable);

  if (reachable.length === results.length) {
    return { checkId: 'dns-resolution', status: 'pass', summary: `All ${results.length} DNS server(s) reachable` };
  }
  if (reachable.length > 0) {
    const unreachable = results.filter((r) => !r.reachable).map((r) => r.server).join(', ');
    return { checkId: 'dns-resolution', status: 'warn', summary: `${reachable.length}/${results.length} DNS servers reachable — unreachable: ${unreachable}` };
  }
  return {
    checkId: 'dns-resolution',
    status: 'fail',
    summary: `All DNS servers unreachable: ${results.map((r) => r.server).join(', ')}`,
  };
});
