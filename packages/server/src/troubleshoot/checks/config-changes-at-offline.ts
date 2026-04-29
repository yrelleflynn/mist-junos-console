import { registerCheck } from '../runner.js';

registerCheck('config-changes-at-offline', async (ctx) => {
  const events = ctx.mistEventsNearOffline ?? [];
  const offlineAt = ctx.offlineAt;

  if (!offlineAt) {
    return { checkId: 'config-changes-at-offline', status: 'warn', summary: 'No offline timestamp — cannot check for config changes near offline event' };
  }

  if (events.length === 0) {
    return { checkId: 'config-changes-at-offline', status: 'pass', summary: 'No config change events found near the offline window' };
  }

  const summaries = events.map((e) => {
    const delta = e.timestamp - offlineAt;
    const sign = delta >= 0 ? '+' : '';
    return `  ${sign}${Math.round(delta / 60)}m: ${e.text}`;
  });

  return {
    checkId: 'config-changes-at-offline',
    status: 'warn',
    summary: `${events.length} config change event(s) found within ±15 min of device going offline`,
    detail: summaries.join('\n'),
  };
});
