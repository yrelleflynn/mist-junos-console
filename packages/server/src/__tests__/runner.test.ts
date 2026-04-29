import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../ws/hub.js', () => ({
  hub: { broadcast: vi.fn() },
}));

vi.mock('@marvis/shared', () => ({
  CHECKS: [
    { id: 'mgmt-ip-assigned', needs: ['managementIp'], gates: [], timeoutMs: 5000, groupId: 'connectivity', label: 'Mgmt IP', description: '' },
    { id: 'mgmt-vlan-reachable', needs: ['managementIp', 'defaultGateway'], gates: ['mgmt-ip-assigned'], timeoutMs: 5000, groupId: 'connectivity', label: 'VLAN', description: '' },
    { id: 'default-gateway-ping', needs: ['defaultGateway'], gates: ['mgmt-ip-assigned'], timeoutMs: 5000, groupId: 'connectivity', label: 'GW Ping', description: '' },
    { id: 'ntp-sync', needs: [], gates: [], timeoutMs: 5000, groupId: 'mist-cloud', label: 'NTP', description: '' },
  ],
  RESOLVERS: [],
}));

import { runAllChecks, runCheck, registerCheck } from '../troubleshoot/runner.js';
import type { CheckId, TroubleshootContext } from '@marvis/shared';

const fakeCli = { run: vi.fn().mockResolvedValue('') };
const SESSION = 'runner-test-session';

const mgmtIpImpl = vi.fn();
const ntpImpl = vi.fn();

registerCheck('mgmt-ip-assigned' as CheckId, mgmtIpImpl);
registerCheck('ntp-sync' as CheckId, ntpImpl);

beforeEach(() => {
  mgmtIpImpl.mockReset();
  ntpImpl.mockReset();
});

describe('gate skip', () => {
  it('skips gated check when gate check fails', async () => {
    mgmtIpImpl.mockResolvedValue({ checkId: 'mgmt-ip-assigned', status: 'fail', summary: 'no IP' });
    const results = await runAllChecks(SESSION, fakeCli, { managementIp: '' } as unknown as Partial<TroubleshootContext>);
    const vlan = results.find((r) => r.checkId === 'mgmt-vlan-reachable')!;
    const gw = results.find((r) => r.checkId === 'default-gateway-ping')!;
    expect(vlan.status).toBe('skip');
    expect(vlan.skipReason).toBe('mgmt-ip-assigned');
    expect(gw.status).toBe('skip');
    expect(gw.skipReason).toBe('mgmt-ip-assigned');
  });

  it('skips gated check when gate check errors', async () => {
    mgmtIpImpl.mockResolvedValue({ checkId: 'mgmt-ip-assigned', status: 'error', summary: 'crash' });
    const results = await runAllChecks(SESSION, fakeCli, { managementIp: '' } as unknown as Partial<TroubleshootContext>);
    const vlan = results.find((r) => r.checkId === 'mgmt-vlan-reachable')!;
    expect(vlan.status).toBe('skip');
  });
});

describe('needs skip', () => {
  it('skips check when required context field is undefined', async () => {
    mgmtIpImpl.mockResolvedValue({ checkId: 'mgmt-ip-assigned', status: 'pass', summary: 'ok' });
    const results = await runAllChecks(SESSION, fakeCli, { managementIp: '10.0.0.1' } as unknown as Partial<TroubleshootContext>);
    const gw = results.find((r) => r.checkId === 'default-gateway-ping')!;
    expect(gw.status).toBe('skip');
    expect(gw.skipReason).toBe('defaultGateway');
  });
});

describe('unregistered check', () => {
  it('runCheck returns error for unknown check ID', async () => {
    const result = await runCheck('jma-state' as CheckId, SESSION, fakeCli);
    expect(result.status).toBe('error');
    expect(result.summary).toMatch(/No implementation registered/);
  });
});

describe('exception handling', () => {
  it('wraps thrown error in error result', async () => {
    ntpImpl.mockRejectedValue(new Error('boom'));
    const results = await runAllChecks(SESSION, fakeCli);
    const ntp = results.find((r) => r.checkId === 'ntp-sync')!;
    expect(ntp.status).toBe('error');
    expect(ntp.detail).toContain('boom');
  });
});
