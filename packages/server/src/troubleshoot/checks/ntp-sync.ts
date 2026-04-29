import { registerCheck } from '../runner.js';

registerCheck('ntp-sync', async (_ctx, cli) => {
  const out = await cli.run('show ntp status', 15_000).catch((e: Error) => e.message);

  if (/unsynchronised|unsynced|no server|stratum 16/i.test(out)) {
    return {
      checkId: 'ntp-sync',
      status: 'fail',
      summary: 'NTP not synchronised — clock skew will cause TLS certificate validation failures',
      rawOutput: out,
    };
  }

  if (/synchronised/i.test(out)) {
    const offsetMatch = out.match(/offset\s+([\d.]+)\s*ms/i);
    const offset = offsetMatch ? parseFloat(offsetMatch[1]!) : null;
    const detail = offset !== null ? ` (offset ${offset} ms)` : '';
    return { checkId: 'ntp-sync', status: 'pass', summary: `NTP synchronised${detail}` };
  }

  return {
    checkId: 'ntp-sync',
    status: 'warn',
    summary: 'NTP sync status could not be determined',
    rawOutput: out,
  };
});
