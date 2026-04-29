import { registerCheck } from '../runner.js';

registerCheck('dns-mist-ep', async (ctx, cli) => {
  const ep = ctx.mistEndpoint!;
  const out = await cli
    .run(`request system dns-lookup hostname ${ep}`, 10_000)
    .catch((e: Error) => e.message);

  const resolved = /\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}/.test(out);
  const refused = /refused|timed out|no answer|NXDOMAIN/i.test(out);

  if (resolved) {
    return { checkId: 'dns-mist-ep', status: 'pass', summary: `DNS resolved Mist endpoint ${ep}` };
  }
  if (refused) {
    return {
      checkId: 'dns-mist-ep',
      status: 'fail',
      summary: `DNS lookup for ${ep} failed — check DNS servers and firewall rules on port 53`,
      rawOutput: out,
    };
  }
  return {
    checkId: 'dns-mist-ep',
    status: 'warn',
    summary: `DNS lookup result for ${ep} inconclusive`,
    rawOutput: out,
  };
});
