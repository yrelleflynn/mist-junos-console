import { describe, expect, it, vi } from 'vitest';

import { TroubleshootService } from '../src/services/troubleshoot.service';

const SUMMARY_OUTPUT = `
IP address        Hardware address   Expires     State      Interface
10.99.0.108       58:00:bb:b7:66:39  86260       BOUND      irb.0
`;

const SUMMARY_MULTI_OUTPUT = `
IP address        Hardware address   Expires     State      Interface
10.99.0.108       58:00:bb:b7:66:39  86260       BOUND      irb.0
172.20.10.3       58:00:bb:b7:66:3a  86260       BOUND      vme.0
`;

const DETAIL_OUTPUT = `

Client Interface/Id: irb.0
     Hardware Address:             58:00:bb:b7:66:39
     State:                        BOUND(LOCAL_CLIENT_STATE_BOUND)
     Lease Expires:                2026-04-19 11:13:12 UTC
     Lease Expires in:             86257 seconds
     Lease Start:                  2026-04-18 11:13:12 UTC
     Vendor Identifier             Juniper
     Server Identifier:            10.99.0.1
     Client IP Address:            10.99.0.108
     Update Server                 No

DHCP options:
    Name: dhcp-lease-time, Value: 1 day
    Name: server-identifier, Value: 10.99.0.1
    Name: router, Value: [ 10.99.0.1 ]
    Name: name-server, Value: [ 45.90.28.80, 45.90.30.80 ]
    Name: subnet-mask, Value: 255.255.255.0

Client Interface/Id: vme.0
     Hardware Address:             58:00:bb:b7:66:3a
     State:                        BOUND(LOCAL_CLIENT_STATE_BOUND)
     Lease Expires:                2026-04-19 11:13:12 UTC
     Lease Expires in:             86257 seconds
     Lease Start:                  2026-04-18 11:13:12 UTC
     Vendor Identifier             Juniper
     Server Identifier:            172.20.10.1
     Client IP Address:            172.20.10.3
     Update Server                 No

DHCP options:
    Name: dhcp-lease-time, Value: 1 day
    Name: server-identifier, Value: 172.20.10.1
    Name: router, Value: [ 172.20.10.1 ]
    Name: name-server, Value: [ 8.8.8.8, 1.1.1.1 ]
    Name: subnet-mask, Value: 255.255.255.240
`;

function createRunnerMock(summaryOutput = SUMMARY_OUTPUT, detailOutput = DETAIL_OUTPUT) {
  return {
    execute: vi.fn(async (command: string) => {
      if (command === 'show dhcp client binding') {
        return { command, output: summaryOutput, success: true };
      }
      if (command === 'show dhcp client binding detail') {
        return { command, output: detailOutput, success: true };
      }
      return { command, output: '', success: false, error: 'unexpected command' };
    }),
  };
}

describe('TroubleshootService DHCP Lease Details', () => {
  it('parses mask, gateway, and DNS from DHCP option blocks in detail output', async () => {
    const runner = createRunnerMock();
    const service = new TroubleshootService(runner as never);

    const result = await (service as any).checkDhcpLease();

    expect(result.status).toBe('pass');
    expect(result.detail).toContain('irb.0: 10.99.0.108');
    expect(result.detail).toContain('Mask 255.255.255.0');
    expect(result.detail).toContain('Gateway 10.99.0.1');
    expect(result.detail).toContain('DNS 45.90.28.80, 45.90.30.80');
  });

  it('summarizes multiple DHCP-bound interfaces separately', async () => {
    const runner = createRunnerMock(SUMMARY_MULTI_OUTPUT, DETAIL_OUTPUT);
    const service = new TroubleshootService(runner as never);

    const result = await (service as any).checkDhcpLease();

    expect(result.detail).toContain('irb.0: 10.99.0.108');
    expect(result.detail).toContain('vme.0: 172.20.10.3');
    expect(result.detail).toContain('Gateway 172.20.10.1');
    expect(result.detail).toContain('DNS 8.8.8.8, 1.1.1.1');
  });
});
