import { describe, it, expect, vi } from 'vitest';
import type { CheckResult, TroubleshootContext } from '@marvis/shared';
import type { CliExecutor } from '../../troubleshoot/runner.js';

type CheckImpl = (ctx: TroubleshootContext, cli: CliExecutor) => Promise<CheckResult>;

const box = vi.hoisted<{ impl: CheckImpl | null }>(() => ({ impl: null }));

vi.mock('../../troubleshoot/runner.js', () => ({
  registerCheck: (_: string, fn: CheckImpl) => { box.impl = fn; },
}));

import '../../troubleshoot/checks/dns-mist-ep.js';

const ep = 'ep-terminator.mist.com';

describe('dns-mist-ep', () => {
  it('passes when an IP address is present in DNS output', async () => {
    const ctx = { mistEndpoint: ep } as TroubleshootContext;
    const cli: CliExecutor = { run: vi.fn().mockResolvedValue('Address: 1.2.3.4') };
    const result = await box.impl!(ctx, cli);
    expect(result.status).toBe('pass');
    expect(result.summary).toContain(ep);
  });

  it('fails on NXDOMAIN', async () => {
    const ctx = { mistEndpoint: ep } as TroubleshootContext;
    const cli: CliExecutor = { run: vi.fn().mockResolvedValue('NXDOMAIN: no records found') };
    const result = await box.impl!(ctx, cli);
    expect(result.status).toBe('fail');
  });

  it('fails on refused', async () => {
    const ctx = { mistEndpoint: ep } as TroubleshootContext;
    const cli: CliExecutor = { run: vi.fn().mockResolvedValue('connection refused') };
    const result = await box.impl!(ctx, cli);
    expect(result.status).toBe('fail');
  });

  it('fails on timeout keyword', async () => {
    const ctx = { mistEndpoint: ep } as TroubleshootContext;
    const cli: CliExecutor = { run: vi.fn().mockResolvedValue('request timed out') };
    const result = await box.impl!(ctx, cli);
    expect(result.status).toBe('fail');
  });

  it('warns when output is indeterminate', async () => {
    const ctx = { mistEndpoint: ep } as TroubleshootContext;
    const cli: CliExecutor = { run: vi.fn().mockResolvedValue('some unexpected output with no IP') };
    const result = await box.impl!(ctx, cli);
    expect(result.status).toBe('warn');
  });

  it('warns when CLI rejects', async () => {
    const ctx = { mistEndpoint: ep } as TroubleshootContext;
    const cli: CliExecutor = { run: vi.fn().mockRejectedValue(new Error('timeout')) };
    const result = await box.impl!(ctx, cli);
    expect(result.status).toBe('warn');
  });
});
