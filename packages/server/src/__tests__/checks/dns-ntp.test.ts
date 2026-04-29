import { describe, it, expect, vi } from 'vitest';
import type { CheckResult, TroubleshootContext } from '@marvis/shared';
import type { CliExecutor } from '../../troubleshoot/runner.js';

type CheckImpl = (ctx: TroubleshootContext, cli: CliExecutor) => Promise<CheckResult>;

const box = vi.hoisted<{ impl: CheckImpl | null }>(() => ({ impl: null }));

vi.mock('../../troubleshoot/runner.js', () => ({
  registerCheck: (_: string, fn: CheckImpl) => { box.impl = fn; },
}));

import '../../troubleshoot/checks/dns-ntp.js';

const ctx = {} as TroubleshootContext;

describe('dns-ntp', () => {
  it('passes when all NTP peers are IP-only (no DNS lookup needed)', async () => {
    const associations = 'remote           refid      st\n192.168.1.1      .GPS.       1\n10.0.0.2         .PPS.       1';
    const cli: CliExecutor = { run: vi.fn().mockResolvedValue(associations) };
    const result = await box.impl!(ctx, cli);
    expect(result.status).toBe('pass');
    expect(cli.run).toHaveBeenCalledTimes(1);
  });

  it('passes when all NTP hostnames resolve successfully', async () => {
    const associations = 'remote           refid\n* ntp1.example.com .GPS.';
    const cli: CliExecutor = { run: vi.fn()
      .mockResolvedValueOnce(associations)
      .mockResolvedValue('Address: 1.2.3.4'),
    };
    const result = await box.impl!(ctx, cli);
    expect(result.status).toBe('pass');
  });

  it('fails when a NTP hostname fails to resolve', async () => {
    const associations = 'remote           refid\n* ntp1.example.com .GPS.';
    const cli: CliExecutor = { run: vi.fn()
      .mockResolvedValueOnce(associations)
      .mockResolvedValue('NXDOMAIN'),
    };
    const result = await box.impl!(ctx, cli);
    expect(result.status).toBe('fail');
    expect(result.summary).toContain('ntp1.example.com');
  });

  it('passes when NTP output contains no hostnames (IP-only config)', async () => {
    const cli: CliExecutor = { run: vi.fn().mockResolvedValue('error: command not found') };
    const result = await box.impl!(ctx, cli);
    expect(result.status).toBe('pass');
  });
});
