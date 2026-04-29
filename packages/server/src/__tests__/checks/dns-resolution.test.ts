import { describe, it, expect, vi } from 'vitest';
import type { CheckResult, TroubleshootContext } from '@marvis/shared';
import type { CliExecutor } from '../../troubleshoot/runner.js';

type CheckImpl = (ctx: TroubleshootContext, cli: CliExecutor) => Promise<CheckResult>;

const box = vi.hoisted<{ impl: CheckImpl | null }>(() => ({ impl: null }));

vi.mock('../../troubleshoot/runner.js', () => ({
  registerCheck: (_: string, fn: CheckImpl) => { box.impl = fn; },
}));

import '../../troubleshoot/checks/dns-resolution.js';

describe('dns-resolution', () => {
  it('fails when no DNS servers are configured', async () => {
    const ctx = { dnsServers: [] } as TroubleshootContext;
    const cli: CliExecutor = { run: vi.fn() };
    const result = await box.impl!(ctx, cli);
    expect(result.status).toBe('fail');
    expect(result.summary).toContain('No DNS');
  });

  it('fails when dnsServers is undefined', async () => {
    const ctx = {} as TroubleshootContext;
    const cli: CliExecutor = { run: vi.fn() };
    const result = await box.impl!(ctx, cli);
    expect(result.status).toBe('fail');
  });

  it('passes when all DNS servers are reachable', async () => {
    const ctx = { dnsServers: ['8.8.8.8', '1.1.1.1'] } as TroubleshootContext;
    const cli: CliExecutor = {
      run: vi.fn().mockResolvedValue('3 packets transmitted, 3 received, 0% packet loss'),
    };
    const result = await box.impl!(ctx, cli);
    expect(result.status).toBe('pass');
    expect(result.summary).toContain('2');
  });

  it('warns when some but not all DNS servers are reachable', async () => {
    const ctx = { dnsServers: ['8.8.8.8', '1.1.1.1'] } as TroubleshootContext;
    const cli: CliExecutor = {
      run: vi.fn()
        .mockResolvedValueOnce('3 packets transmitted, 3 received, 0% packet loss')
        .mockResolvedValueOnce('3 packets transmitted, 0 received, 100% packet loss'),
    };
    const result = await box.impl!(ctx, cli);
    expect(result.status).toBe('warn');
    expect(result.summary).toContain('1/2');
    expect(result.summary).toContain('1.1.1.1');
  });

  it('fails when all DNS servers are unreachable', async () => {
    const ctx = { dnsServers: ['8.8.8.8', '1.1.1.1'] } as TroubleshootContext;
    const cli: CliExecutor = {
      run: vi.fn().mockResolvedValue('3 packets transmitted, 0 received, 100% packet loss'),
    };
    const result = await box.impl!(ctx, cli);
    expect(result.status).toBe('fail');
    expect(result.summary).toContain('8.8.8.8');
  });
});
