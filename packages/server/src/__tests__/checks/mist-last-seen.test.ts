import { describe, it, expect, vi, afterEach } from 'vitest';
import type { CheckResult, TroubleshootContext } from '@marvis/shared';
import type { CliExecutor } from '../../troubleshoot/runner.js';

type CheckImpl = (ctx: TroubleshootContext, cli: CliExecutor) => Promise<CheckResult>;

const box = vi.hoisted<{ impl: CheckImpl | null }>(() => ({ impl: null }));

vi.mock('../../troubleshoot/runner.js', () => ({
  registerCheck: (_: string, fn: CheckImpl) => { box.impl = fn; },
}));

import '../../troubleshoot/checks/mist-last-seen.js';

const noCli: CliExecutor = { run: vi.fn() };
const NOW_MS = 1_000_000_000_000;
const NOW_S = NOW_MS / 1000;

afterEach(() => { vi.restoreAllMocks(); });

function mockNow() {
  vi.spyOn(Date, 'now').mockReturnValue(NOW_MS);
}

describe('mist-last-seen', () => {
  it('warns when mistLastSeen is undefined', async () => {
    const ctx = {} as TroubleshootContext;
    const result = await box.impl!(ctx, noCli);
    expect(result.status).toBe('warn');
    expect(result.summary).toContain('no last-seen');
  });

  it('passes when device was seen less than 1 hour ago', async () => {
    mockNow();
    const ctx = { mistLastSeen: NOW_S - 30 } as TroubleshootContext;
    const result = await box.impl!(ctx, noCli);
    expect(result.status).toBe('pass');
    expect(result.summary).toContain('30s');
  });

  it('warns when device was seen between 1 and 24 hours ago', async () => {
    mockNow();
    const ctx = { mistLastSeen: NOW_S - 7200 } as TroubleshootContext;
    const result = await box.impl!(ctx, noCli);
    expect(result.status).toBe('warn');
    expect(result.summary).toContain('2h');
  });

  it('fails when device was seen more than 24 hours ago', async () => {
    mockNow();
    const ctx = { mistLastSeen: NOW_S - 200_000 } as TroubleshootContext;
    const result = await box.impl!(ctx, noCli);
    expect(result.status).toBe('fail');
    expect(result.summary).toContain('2d');
  });
});
