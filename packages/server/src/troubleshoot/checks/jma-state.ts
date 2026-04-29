import { JmaStateCode, jmaStateLabel } from '@marvis/shared';
import { registerCheck } from '../runner.js';

registerCheck('jma-state', async (ctx) => {
  if (ctx.jmaState === undefined) {
    return { checkId: 'jma-state', status: 'fail', summary: 'Could not read JMA state — check serial output' };
  }
  const code = ctx.jmaState;
  const label = jmaStateLabel(code);

  if (code === JmaStateCode.Connected) {
    return { checkId: 'jma-state', status: 'pass', summary: `JMA state ${code}: ${label}` };
  }
  if (code >= JmaStateCode.WebsocketConnecting) {
    return { checkId: 'jma-state', status: 'warn', summary: `JMA state ${code}: ${label} — connection in progress` };
  }
  return {
    checkId: 'jma-state',
    status: 'fail',
    summary: `JMA state ${code}: ${label}`,
  };
});
