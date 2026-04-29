import { registerCheck } from '../runner.js';

registerCheck('uplink-port-status', async (ctx) => {
  const { uplinkPort, uplinkPortStatus } = ctx;
  if (!uplinkPort) {
    return { checkId: 'uplink-port-status', status: 'error', summary: 'Could not identify uplink port' };
  }
  if (uplinkPortStatus === 'up') {
    return { checkId: 'uplink-port-status', status: 'pass', summary: `${uplinkPort} is operationally up` };
  }
  if (uplinkPortStatus === 'down') {
    return { checkId: 'uplink-port-status', status: 'fail', summary: `${uplinkPort} is operationally down — check physical cable and upstream switch port` };
  }
  return { checkId: 'uplink-port-status', status: 'warn', summary: `${uplinkPort} operational status could not be determined` };
});
