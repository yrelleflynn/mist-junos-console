import { describe, it, expect, vi } from 'vitest';
import type { CheckResult, TroubleshootContext } from '@marvis/shared';
import type { CliExecutor } from '../../troubleshoot/runner.js';

type CheckImpl = (ctx: TroubleshootContext, cli: CliExecutor) => Promise<CheckResult>;

const box = vi.hoisted<{ impl: CheckImpl | null }>(() => ({ impl: null }));

vi.mock('../../troubleshoot/runner.js', () => ({
  registerCheck: (_: string, fn: CheckImpl) => { box.impl = fn; },
}));

import '../../troubleshoot/checks/mist-ep-reachable.js';

const ep = 'ep-terminator.mist.com';

describe('mist-ep-reachable', () => {
  it('passes on 0% packet loss', async () => {
    const ctx = { mistEndpoint: ep } as TroubleshootContext;
    const cli: CliExecutor = { run: vi.fn().mockResolvedValue('5 packets transmitted, 5 received, 0% packet loss') };
    const result = await box.impl!(ctx, cli);
    expect(result.status).toBe('pass');
    expect(result.summary).toContain(ep);
  });

  it('warns on partial packet loss', async () => {
    const ctx = { mistEndpoint: ep } as TroubleshootContext;
    const cli: CliExecutor = { run: vi.fn().mockResolvedValue('5 packets transmitted, 3 received, 40% packet loss') };
    const result = await box.impl!(ctx, cli);
    expect(result.status).toBe('warn');
  });

  it('fails on 100% packet loss', async () => {
    const ctx = { mistEndpoint: ep } as TroubleshootContext;
    const cli: CliExecutor = { run: vi.fn().mockResolvedValue('5 packets transmitted, 0 received, 100% packet loss') };
    const result = await box.impl!(ctx, cli);
    expect(result.status).toBe('fail');
  });

  it('fails when output is unparseable', async () => {
    const ctx = { mistEndpoint: ep } as TroubleshootContext;
    const cli: CliExecutor = { run: vi.fn().mockResolvedValue('ping: unknown host') };
    const result = await box.impl!(ctx, cli);
    expect(result.status).toBe('fail');
  });

  it('fails when CLI rejects', async () => {
    const ctx = { mistEndpoint: ep } as TroubleshootContext;
    const cli: CliExecutor = { run: vi.fn().mockRejectedValue(new Error('timeout')) };
    const result = await box.impl!(ctx, cli);
    expect(result.status).toBe('fail');
  });
});
