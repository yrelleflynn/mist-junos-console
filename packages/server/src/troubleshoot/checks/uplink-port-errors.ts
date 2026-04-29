import { registerCheck } from '../runner.js';

const WARN_THRESHOLD = 100;
const FAIL_THRESHOLD = 1000;

registerCheck('uplink-port-errors', async (ctx) => {
  const { uplinkPort, uplinkPortErrors } = ctx;
  const total = (uplinkPortErrors?.input ?? 0) + (uplinkPortErrors?.output ?? 0);
  const detail = `Input: ${uplinkPortErrors?.input ?? 0}, Output: ${uplinkPortErrors?.output ?? 0}`;

  if (total === 0) {
    return { checkId: 'uplink-port-errors', status: 'pass', summary: `No errors on ${uplinkPort}` };
  }
  if (total >= FAIL_THRESHOLD) {
    return { checkId: 'uplink-port-errors', status: 'fail', summary: `High error count on ${uplinkPort} (${total} total)`, detail };
  }
  return { checkId: 'uplink-port-errors', status: 'warn', summary: `Elevated errors on ${uplinkPort} (${total} total)`, detail };
});
