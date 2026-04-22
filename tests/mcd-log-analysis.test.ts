import { describe, expect, it } from 'vitest';

import { buildMcdLogAnalysisResult } from '../src/features/troubleshoot/mcd-log-analysis';
import type { McdParsedLog } from '../src/features/troubleshoot/mcd-log-parser.types';

function makeParsed(overrides: Partial<McdParsedLog> = {}): McdParsedLog {
  return {
    cycles: [],
    totalLines: 0,
    signalLines: 0,
    ...overrides,
  };
}

describe('buildMcdLogAnalysisResult', () => {
  it('returns a warning when no cycles are available', () => {
    const result = buildMcdLogAnalysisResult(makeParsed());
    expect(result.status).toBe('warn');
    expect(result.detail).toContain('No mcd diagnostic signal');
    expect(result.remediation).toContain('Expand the mcd log window');
  });

  it('reports a passing connected state with disconnect history', () => {
    const parsed = makeParsed({
      signalLines: 12,
      cycles: [
        {
          cycleNumber: 1,
          states: [106],
          killPath: null,
          disconnectReason: {
            timestamp: '2026-04-20T14:30:00Z',
            cc_state: 106,
            reason: 'DNS lookup failed',
            event_sent: false,
          },
          retryIntervalSeconds: 60,
          rawLines: ['disconnect line'],
        },
        {
          cycleNumber: 2,
          states: [111],
          killPath: null,
          disconnectReason: null,
          retryIntervalSeconds: null,
          rawLines: ['connected line'],
        },
      ],
    });

    const result = buildMcdLogAnalysisResult(parsed);
    expect(result.status).toBe('pass');
    expect(result.detail).toContain('Current state: Connected (111)');
    expect(result.detail).toContain('Last disconnect: DNS lookup failed');
    expect(result.raw).toContain('[disconnect cycle]');
    expect(result.raw).toContain('[current cycle]');
  });

  it('maps a DNS failure state to a failing result with DNS remediation', () => {
    const parsed = makeParsed({
      cycles: [
        {
          cycleNumber: 1,
          states: [106],
          killPath: null,
          disconnectReason: {
            timestamp: '2026-04-20T14:30:00Z',
            cc_state: 106,
            reason: 'DNS lookup failed',
            event_sent: false,
          },
          retryIntervalSeconds: 60,
          rawLines: [
            '[mcd] 2026/04/20 14:29:58 ccstate.go:406: DNS lookup failed for jma-terminator.mistsys.net via 8.8.4.4: lookup jma-terminator.mistsys.net on 8.8.4.4:53: i/o timeout',
            '[mcd] 2026/04/20 14:29:59 ccstate.go:431: checking google.com is reachable via well-known dns server 8.8.8.8 Failed',
          ],
        },
      ],
    });

    const result = buildMcdLogAnalysisResult(parsed);
    expect(result.status).toBe('fail');
    expect(result.detail).toContain('Current state: DNSLookupFailed (106)');
    expect(result.detail).toContain('Retry interval: 60s');
    expect(result.detail).toContain('Disconnect state: DNSLookupFailed (106)');
    expect(result.detail).toContain('Mist hostname lookup: via 8.8.4.4 failed: jma-terminator.mistsys.net on 8.8.4.4:53: i/o timeout');
    expect(result.detail).toContain('Fallback resolver probe: google.com via 8.8.8.8: failed');
    expect(result.detail).toContain('mcd conclusion: mcd reached the DNS stage and failed there');
    expect(result.remediation).toContain('DNS configuration and resolver reachability');
  });

  it('prioritizes keep-alive timeout remediation when kill path is present', () => {
    const parsed = makeParsed({
      cycles: [
        {
          cycleNumber: 1,
          states: [110],
          killPath: 'keep-alive-timeout',
          disconnectReason: null,
          retryIntervalSeconds: 1,
          rawLines: ['keep alive timeout line'],
        },
      ],
    });

    const result = buildMcdLogAnalysisResult(parsed);
    expect(result.status).toBe('fail');
    expect(result.detail).toContain('Current cycle: jmd keep-alive timeout');
    expect(result.remediation).toContain('restarting the Mist agent');
  });

  it('shows explicit no-management-ip evidence for 102 cycles', () => {
    const parsed = makeParsed({
      cycles: [
        {
          cycleNumber: 1,
          states: [102],
          killPath: null,
          disconnectReason: {
            timestamp: '2026-04-22 08:02:00 UTC',
            cc_state: 102,
            reason: 'NoIPAddress',
            event_sent: false,
          },
          retryIntervalSeconds: 60,
          rawLines: [
            '[mcd] 2026/04/22 08:02:00 ccstate.go:308: no management ip address',
            '[mcd] 2026/04/22 08:02:03 connect.go:616: calling dialer.Dial(tcp, jma-terminator.mistsys.net:443)',
            '[mcd] 2026/04/22 08:02:03 connect.go:648: dial(\"wss://jma-terminator.mistsys.net/ws\") failed: dial tcp: lookup jma-terminator.mistsys.net on 8.8.4.4:53: dial udp 8.8.4.4:53: connect: can\'t assign requested address',
          ],
        },
      ],
    });

    const result = buildMcdLogAnalysisResult(parsed);
    expect(result.status).toBe('fail');
    expect(result.detail).toContain('Current state: NoIPAddress (102)');
    expect(result.detail).toContain('Management IP: not present');
    expect(result.detail).toContain('mcd conclusion: The switch did not have a usable management IP');
    expect(result.detail).not.toContain('Cloud TCP dial:');
    expect(result.detail).not.toContain('Cloud websocket dial:');
  });

  it('shows explicit no-default-gateway evidence for 103 cycles', () => {
    const parsed = makeParsed({
      cycles: [
        {
          cycleNumber: 1,
          states: [103],
          killPath: null,
          disconnectReason: {
            timestamp: '2026-04-22 08:35:33 UTC',
            cc_state: 103,
            reason: 'NoDefaultGateway',
            event_sent: false,
          },
          retryIntervalSeconds: 15,
          rawLines: [
            '[mcd] 2026/04/22 08:35:33 ccstate.go:311: management ip address 172.20.10.3',
            '[mcd] 2026/04/22 08:35:33 ccstate.go:327: no default gateway',
            '[mcd] 2026/04/22 08:35:35 connect.go:616: calling dialer.Dial(tcp, jma-terminator.mistsys.net:443)',
            '[mcd] 2026/04/22 08:35:35 connect.go:648: dial(\"wss://jma-terminator.mistsys.net/ws\") failed: dial tcp: lookup jma-terminator.mistsys.net on 8.8.4.4:53: dial udp 8.8.4.4:53: connect: can\'t assign requested address',
          ],
        },
      ],
    });

    const result = buildMcdLogAnalysisResult(parsed);
    expect(result.status).toBe('fail');
    expect(result.detail).toContain('Current state: NoDefaultGateway (103)');
    expect(result.detail).toContain('Management IP: 172.20.10.3');
    expect(result.detail).toContain('Default gateway: not present');
    expect(result.detail).toContain('mcd conclusion: The switch had management IP but no default gateway');
    expect(result.detail).not.toContain('Cloud TCP dial:');
    expect(result.detail).not.toContain('Cloud websocket dial:');
  });

  it('shows gateway-unreachable evidence for 104 cycles and suppresses downstream cloud noise', () => {
    const parsed = makeParsed({
      cycles: [
        {
          cycleNumber: 1,
          states: [104],
          killPath: null,
          disconnectReason: {
            timestamp: '2026-04-22 07:40:40 UTC',
            cc_state: 104,
            reason: 'DefaultGatewayUnreachable',
            event_sent: false,
          },
          retryIntervalSeconds: 60,
          rawLines: [
            '[mcd] 2026/04/22 07:40:30 ccstate.go:311: management ip address 192.168.20.11',
            '[mcd] 2026/04/22 07:40:30 ccstate.go:330: default gateway 192.168.20.1',
            '[mcd] 2026/04/22 07:40:40 ccstate.go:334: default gateway not reachable, default gateway ip: 192.168.20.1',
            '[mcd] 2026/04/22 07:40:42 connect.go:616: calling dialer.Dial(tcp, jma-terminator.mistsys.net:443)',
            '[mcd] 2026/04/22 07:40:57 connect.go:648: dial(\"wss://jma-terminator.mistsys.net/ws\") failed: dial tcp: lookup jma-terminator.mistsys.net: i/o timeout',
          ],
        },
      ],
    });

    const result = buildMcdLogAnalysisResult(parsed);
    expect(result.status).toBe('fail');
    expect(result.detail).toContain('Current state: DefaultGatewayUnreachable (104)');
    expect(result.detail).toContain('Management IP: 192.168.20.11');
    expect(result.detail).toContain('Default gateway: 192.168.20.1');
    expect(result.detail).toContain('Gateway reachability: not reachable');
    expect(result.detail).toContain('mcd conclusion: The switch found a default gateway but could not reach it');
    expect(result.detail).not.toContain('Cloud TCP dial:');
    expect(result.detail).not.toContain('Cloud websocket dial:');
  });

  it('shows the shared cloud-stage evidence set for cloud-unreachable cycles', () => {
    const parsed = makeParsed({
      cycles: [
        {
          cycleNumber: 1,
          states: [108],
          killPath: null,
          disconnectReason: {
            timestamp: '2026-04-20T14:30:00Z',
            cc_state: 108,
            reason: 'cloud unreachable',
            event_sent: false,
          },
          retryIntervalSeconds: 36,
          rawLines: [
            '[mcd] 2026/04/20 14:29:54 ccstate.go:330: default gateway 10.99.0.1',
            '[mcd] 2026/04/20 14:29:55 ccstate.go:346: default gateway is reachable',
            '[mcd] 2026/04/20 14:29:55 ccstate.go:422: DNS Server ip: 8.8.4.4',
            '[mcd] 2026/04/20 14:29:56 connect.go:630: Using cached cloud ip address ws://50.18.142.60:443',
            '[mcd] 2026/04/20 14:29:56 connect.go:616: calling dialer.Dial(tcp, jma-terminator.mistsys.net:443)',
            '[mcd] 2026/04/20 14:29:57 connect.go:648: dial("wss://jma-terminator.mistsys.net/ws") failed: dial tcp: lookup jma-terminator.mistsys.net: i/o timeout',
          ],
        },
      ],
    });

    const result = buildMcdLogAnalysisResult(parsed);
    expect(result.status).toBe('fail');
    expect(result.detail).toContain('Current state: CloudUnreachable (108)');
    expect(result.detail).toContain('Default gateway: 10.99.0.1');
    expect(result.detail).toContain('Gateway reachability: reachable');
    expect(result.detail).toContain('DNS server: 8.8.4.4');
    expect(result.detail).toContain('Cached cloud endpoint: ws://50.18.142.60:443');
    expect(result.detail).toContain('Cloud TCP dial: jma-terminator.mistsys.net:443');
    expect(result.detail).toContain('Cloud websocket dial: wss://jma-terminator.mistsys.net/ws failed: lookup jma-terminator.mistsys.net: i/o timeout');
    expect(result.detail).toContain('mcd conclusion: DNS succeeded and mcd reached the cloud dial stage');
  });

  it('returns a warning when the latest cycle has no SetState but does have disconnect evidence', () => {
    const parsed = makeParsed({
      cycles: [
        {
          cycleNumber: 1,
          states: [],
          killPath: null,
          disconnectReason: {
            timestamp: '2026-04-20T14:30:00Z',
            cc_state: 103,
            reason: 'no default gateway',
            event_sent: true,
          },
          retryIntervalSeconds: null,
          rawLines: ['disconnect line'],
        },
      ],
    });

    const result = buildMcdLogAnalysisResult(parsed);
    expect(result.status).toBe('warn');
    expect(result.detail).toContain('Current state: unknown');
    expect(result.detail).toContain('no default gateway');
  });

  it('uses the live switch cloud state as fallback when the current window has no SetState', () => {
    const parsed = makeParsed({
      signalLines: 1,
      cycles: [
        {
          cycleNumber: 1,
          states: [],
          killPath: 'keep-alive-timeout',
          disconnectReason: null,
          retryIntervalSeconds: null,
          rawLines: ['[mcd] 2026/04/22 18:47:40 app.go:865: ipc keep-alive timeout; last received "1m0s" ago'],
        },
      ],
    });

    const result = buildMcdLogAnalysisResult(parsed, { fallbackStateCode: 103 });
    expect(result.status).toBe('fail');
    expect(result.detail).toContain('Current state: NoDefaultGateway (103)');
    expect(result.detail).toContain('State source: live switch cloud status');
    expect(result.detail).toContain('Current cycle: jmd keep-alive timeout');
    expect(result.detail).toContain('Retained evidence: the switch reported a live cloud state');
    expect(result.remediation).toContain('Fix the default route');
  });
});
