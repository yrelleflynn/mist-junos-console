import { describe, expect, it, vi } from 'vitest';

import { TroubleshootService } from '../src/services/troubleshoot.service';

function createRunnerMock(overrides: {
  currentOutput?: string;
  listOutput?: string;
  anchorMatchesOutput?: string;
  anchorContextOutput?: string;
  failShell?: boolean;
}) {
  return {
    ensureShellMode: overrides.failShell
      ? vi.fn().mockRejectedValue(new Error('shell unavailable'))
      : vi.fn().mockResolvedValue(undefined),
    ensureOperationalMode: vi.fn().mockResolvedValue(undefined),
    execute: vi.fn(async (command: string) => {
      if (command.includes('zcat -f /var/log/mcd.log | grep -E')) {
        return { command, output: overrides.currentOutput ?? '', success: true };
      }
      if (command.includes("ls -1 /var/log/mcd*.log.gz /var/log/mcd.log")) {
        return { command, output: overrides.listOutput ?? '', success: true };
      }
      if (command.includes('/var/log/mcd-2026-04-21T12-00-00.000.log.gz') && command.includes('grep -n')) {
        return { command, output: overrides.anchorMatchesOutput ?? '', success: true };
      }
      if (command.includes('/var/log/mcd-2026-04-21T12-00-00.000.log.gz') && command.includes('awk')) {
        return { command, output: overrides.anchorContextOutput ?? '', success: true };
      }
      return { command, output: '', success: false, error: `unexpected command: ${command}` };
    }),
  };
}

describe('TroubleshootService mcd log analysis', () => {
  it('returns a current-state-only result when Mist context is unavailable', async () => {
    const runner = createRunnerMock({
      currentOutput: [
        '[mcd] 2026/04/21 14:00:01 ccstate.go:243: SetState(111)',
        '[mcd] 2026/04/21 14:00:02 connect.go:332: websocket connected',
      ].join('\n'),
    });

    const service = new TroubleshootService(runner as never);
    const result = await (service as any).checkMcdLogAnalysis();

    expect(result.id).toBe('mcd-log-analysis');
    expect(result.status).toBe('pass');
    expect(result.detail).toContain('Current state: Connected (111)');
    expect(result.detail).toContain('Analysis scope: Mist context was unavailable');
  });

  it('combines a Mist-anchored disconnect window with the current live window', async () => {
    const runner = createRunnerMock({
      currentOutput: [
        '[mcd] 2026/04/21 12:01:01 ccstate.go:243: SetState(111)',
        '[mcd] 2026/04/21 12:01:02 connect.go:332: websocket connected',
      ].join('\n'),
      listOutput: [
        'mcd-2026-04-21T12-00-00.000.log.gz',
        'mcd.log',
      ].join('\n'),
      anchorMatchesOutput: [
        '15:[mcd] 2026/04/21 11:59:55 ccstate.go:511: updated disconnect reason: {"timestamp":"2026-04-21T11:59:55Z","cc_state":106,"reason":"DNS lookup failed","event_sent":false}',
      ].join('\n'),
      anchorContextOutput: [
        '[mcd] 2026/04/21 11:59:54 ccstate.go:243: SetState(106)',
        '[mcd] 2026/04/21 11:59:55 ccstate.go:511: updated disconnect reason: {"timestamp":"2026-04-21T11:59:55Z","cc_state":106,"reason":"DNS lookup failed","event_sent":false}',
        '[mcd] 2026/04/21 11:59:55 ccstate.go:406: DNS lookup failed for jma-terminator.mistsys.net via 8.8.4.4: lookup jma-terminator.mistsys.net on 8.8.4.4:53: i/o timeout',
        '[mcd] 2026/04/21 11:59:56 app.go:1040: will try again in 60s',
      ].join('\n'),
    });

    const mistApi = {
      isConfigured: false,
      hasLaunchOverlay: true,
      getDeviceStats: vi.fn().mockResolvedValue({ last_seen: Math.floor(Date.parse('2026-04-21T11:59:58Z') / 1000) }),
    };

    const service = new TroubleshootService(runner as never, mistApi as never);
    const result = await (service as any).checkMcdLogAnalysis('site-1', 'device-1');

    expect(result.status).toBe('pass');
    expect(result.detail).toContain('Current state: Connected (111)');
    expect(result.detail).toContain('Last disconnect: DNS lookup failed');
    expect(result.detail).toContain('Mist last seen: 2026-04-21T11:59:58.000Z');
    expect(result.detail).toContain('Anchor match: 3s before Mist last_seen');
    expect(result.detail).toContain('Mist hostname lookup: via 8.8.4.4 failed');
    expect(result.raw).toContain('[disconnect cycle]');
    expect(result.raw).toContain('[current cycle]');
  });

  it('returns a warning when shell access is unavailable', async () => {
    const runner = createRunnerMock({ failShell: true });
    const service = new TroubleshootService(runner as never);

    const result = await (service as any).checkMcdLogAnalysis();

    expect(result.status).toBe('warn');
    expect(result.detail).toContain('Could not read the live mcd log');
  });

  it('falls back to the live switch cloud state when retained evidence is too thin', async () => {
    const runner = createRunnerMock({
      currentOutput: '[mcd] 2026/04/22 18:47:40 app.go:865: ipc keep-alive timeout; last received "1m0s" ago',
      listOutput: 'mcd.log',
    });

    const mistApi = {
      isConfigured: false,
      hasLaunchOverlay: true,
      getDeviceStats: vi.fn().mockResolvedValue({ last_seen: Math.floor(Date.parse('2026-04-22T08:47:35Z') / 1000) }),
    };

    const service = new TroubleshootService(runner as never, mistApi as never);
    const result = await (service as any).checkMcdLogAnalysis('site-1', 'device-1', 103);

    expect(result.status).toBe('fail');
    expect(result.detail).toContain('Current state: NoDefaultGateway (103)');
    expect(result.detail).toContain('State source: live switch cloud status');
    expect(result.detail).toContain('Anchor match: no retained disconnect cycle was close to Mist last_seen.');
  });
});
