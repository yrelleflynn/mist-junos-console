import { registerCheck } from '../runner.js';

const STALE_WARN_SECS = 60 * 60;      // 1 hour
const STALE_FAIL_SECS = 24 * 60 * 60; // 24 hours

registerCheck('mist-last-seen', async (ctx) => {
  const lastSeen = ctx.mistLastSeen;

  if (!lastSeen) {
    return { checkId: 'mist-last-seen', status: 'warn', summary: 'Mist has no last-seen data for this device — verify device is claimed to the org' };
  }

  const ageSecs = Math.floor(Date.now() / 1000) - lastSeen;
  const ago = formatAge(ageSecs);

  if (ageSecs < STALE_WARN_SECS) {
    return { checkId: 'mist-last-seen', status: 'pass', summary: `Device last seen by Mist ${ago} ago` };
  }
  if (ageSecs < STALE_FAIL_SECS) {
    return { checkId: 'mist-last-seen', status: 'warn', summary: `Device last seen by Mist ${ago} ago — may have been offline for an extended period` };
  }
  return {
    checkId: 'mist-last-seen',
    status: 'fail',
    summary: `Device last seen by Mist ${ago} ago — confirm device is still managed by this org`,
  };
});

function formatAge(secs: number): string {
  if (secs < 120) return `${secs}s`;
  if (secs < 7200) return `${Math.floor(secs / 60)}m`;
  if (secs < 172800) return `${Math.floor(secs / 3600)}h`;
  return `${Math.floor(secs / 86400)}d`;
}
