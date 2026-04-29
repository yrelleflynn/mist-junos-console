import { JmaStateCode, jmaStateLabel } from '@marvis/shared';
import { registerCheck } from '../runner.js';

registerCheck('mist-websocket', async (ctx) => {
  if (ctx.jmaState === undefined) {
    return { checkId: 'mist-websocket', status: 'fail', summary: 'JMA state not available' };
  }
  const code = ctx.jmaState;

  if (code === JmaStateCode.Connected) {
    return { checkId: 'mist-websocket', status: 'pass', summary: 'Mist WebSocket connected and authenticated (JMA 111)' };
  }
  if (code === JmaStateCode.WebsocketConnected || code === JmaStateCode.WebsocketConnecting) {
    return {
      checkId: 'mist-websocket',
      status: 'warn',
      summary: `WebSocket not fully authenticated — JMA state ${code}: ${jmaStateLabel(code)}`,
    };
  }
  return {
    checkId: 'mist-websocket',
    status: 'fail',
    summary: `Mist WebSocket not established — JMA state ${code}: ${jmaStateLabel(code)}`,
  };
});
