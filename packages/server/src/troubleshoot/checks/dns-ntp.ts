import { registerCheck } from '../runner.js';

registerCheck('dns-ntp', async (_ctx, cli) => {
  const statusOut = await cli.run('show ntp associations', 10_000).catch((e: Error) => e.message);

  // Extract hostnames (non-IP server entries) from NTP associations
  const hostnames = [...statusOut.matchAll(/^\s*[*+\-x ]\s+([a-z][a-z0-9.\-]+\.[a-z]{2,})\s/gim)]
    .map((m) => m[1]!)
    .filter(Boolean);

  if (hostnames.length === 0) {
    return { checkId: 'dns-ntp', status: 'pass', summary: 'NTP servers configured by IP — no DNS lookup needed' };
  }

  const results = await Promise.all(
    hostnames.map(async (host) => {
      const out = await cli.run(`request system dns-lookup hostname ${host}`, 8_000).catch((e: Error) => e.message);
      const resolved = /\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}/.test(out);
      return { host, resolved };
    }),
  );

  const failed = results.filter((r) => !r.resolved).map((r) => r.host);

  if (failed.length === 0) {
    return { checkId: 'dns-ntp', status: 'pass', summary: `All NTP hostnames resolved (${hostnames.join(', ')})` };
  }
  return {
    checkId: 'dns-ntp',
    status: 'fail',
    summary: `NTP hostname(s) failed DNS resolution: ${failed.join(', ')}`,
  };
});
