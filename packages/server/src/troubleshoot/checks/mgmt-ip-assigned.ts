import { registerCheck } from '../runner.js';

registerCheck('mgmt-ip-assigned', async (ctx) => {
  const { managementIp, managementPrefix } = ctx;
  if (managementIp) {
    return {
      checkId: 'mgmt-ip-assigned',
      status: 'pass',
      summary: `Management IP assigned: ${managementIp}/${managementPrefix ?? '?'}`,
    };
  }
  return {
    checkId: 'mgmt-ip-assigned',
    status: 'fail',
    summary: 'No management IP assigned on irb or me0 — check DHCP or static IP config',
  };
});
