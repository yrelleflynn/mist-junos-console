import { registerCheck } from '../runner.js';

const ERROR_PATTERNS = [
  /error/i,
  /fail/i,
  /disconnect/i,
  /timeout/i,
  /websocket.*clos/i,
  /reconnect/i,
];

registerCheck('mcd-logs-at-offline', async (ctx) => {
  const lines = ctx.mcdLogLines ?? [];
  const offlineAt = ctx.offlineAt;

  if (lines.length === 0) {
    return {
      checkId: 'mcd-logs-at-offline',
      status: 'warn',
      summary: offlineAt
        ? 'No MCD/JMD log entries found in the offline window'
        : 'No offline timestamp available — cannot scope log search',
    };
  }

  const flagged = lines.filter((line) => ERROR_PATTERNS.some((p) => p.test(line)));

  if (flagged.length === 0) {
    return {
      checkId: 'mcd-logs-at-offline',
      status: 'pass',
      summary: `${lines.length} log line(s) near offline event — no error patterns detected`,
      detail: lines.join('\n'),
    };
  }

  return {
    checkId: 'mcd-logs-at-offline',
    status: 'warn',
    summary: `${flagged.length} error/disconnect log line(s) found near offline event`,
    detail: flagged.join('\n'),
  };
});
