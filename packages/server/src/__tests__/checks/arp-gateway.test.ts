import { describe, it, expect, vi } from 'vitest';
import type { CheckResult, TroubleshootContext } from '@marvis/shared';
import type { CliExecutor } from '../../troubleshoot/runner.js';

type CheckImpl = (ctx: TroubleshootContext, cli: CliExecutor) => Promise<CheckResult>;

const box = vi.hoisted<{ impl: CheckImpl | null }>(() => ({ impl: null }));

vi.mock('../../troubleshoot/runner.js', () => ({
  registerCheck: (_: string, fn: CheckImpl) => { box.impl = fn; },
}));

import '../../troubleshoot/checks/arp-gateway.js';

describe('arp-gateway', () => {
  it('fails when defaultGateway is missing', async () => {
    const ctx = {} as TroubleshootContext;
    const cli: CliExecutor = { run: vi.fn() };
    const result = await box.impl!(ctx, cli);
    expect(result.status).toBe('fail');
    expect(result.summary).toContain('No default gateway');
  });

  it('passes when ARP output contains a MAC address', async () => {
    const ctx = { defaultGateway: '10.0.0.1' } as TroubleshootContext;
    const cli: CliExecutor = {
      run: vi.fn().mockResolvedValue('10.0.0.1 at aa:bb:cc:dd:ee:ff on irb.100'),
    };
    const result = await box.impl!(ctx, cli);
    expect(result.status).toBe('pass');
    expect(result.summary).toContain('10.0.0.1');
  });

  it('fails when ARP output has no MAC address', async () => {
    const ctx = { defaultGateway: '10.0.0.1' } as TroubleshootContext;
    const cli: CliExecutor = {
      run: vi.fn().mockResolvedValue('no entries found'),
    };
    const result = await box.impl!(ctx, cli);
    expect(result.status).toBe('fail');
    expect(result.summary).toContain('No ARP entry');
  });

  it('fails when cli.run rejects', async () => {
    const ctx = { defaultGateway: '10.0.0.1' } as TroubleshootContext;
    const cli: CliExecutor = {
      run: vi.fn().mockRejectedValue(new Error('timeout')),
    };
    const result = await box.impl!(ctx, cli);
    expect(result.status).toBe('fail');
  });
});
