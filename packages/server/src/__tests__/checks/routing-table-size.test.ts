import { describe, it, expect, vi } from 'vitest';
import type { CheckResult, TroubleshootContext } from '@marvis/shared';
import type { CliExecutor } from '../../troubleshoot/runner.js';

type CheckImpl = (ctx: TroubleshootContext, cli: CliExecutor) => Promise<CheckResult>;

const box = vi.hoisted<{ impl: CheckImpl | null }>(() => ({ impl: null }));

vi.mock('../../troubleshoot/runner.js', () => ({
  registerCheck: (_: string, fn: CheckImpl) => { box.impl = fn; },
}));

import '../../troubleshoot/checks/routing-table-size.js';

const ctx = {} as TroubleshootContext;

describe('routing-table-size', () => {
  it('warns when output cannot be parsed', async () => {
    const cli: CliExecutor = { run: vi.fn().mockResolvedValue('some unrelated output') };
    const result = await box.impl!(ctx, cli);
    expect(result.status).toBe('warn');
    expect(result.checkId).toBe('routing-table-size');
  });

  it('warns when destination count is less than 2', async () => {
    const cli: CliExecutor = { run: vi.fn().mockResolvedValue('Totals: 1 destinations, 1 routes') };
    const result = await box.impl!(ctx, cli);
    expect(result.status).toBe('warn');
    expect(result.summary).toContain('1');
  });

  it('warns when destination count exceeds 500', async () => {
    const cli: CliExecutor = { run: vi.fn().mockResolvedValue('Totals: 501 destinations, 600 routes') };
    const result = await box.impl!(ctx, cli);
    expect(result.status).toBe('warn');
    expect(result.summary).toContain('501');
  });

  it('passes with a normal route count', async () => {
    const cli: CliExecutor = { run: vi.fn().mockResolvedValue('Totals: 42 destinations, 48 routes') };
    const result = await box.impl!(ctx, cli);
    expect(result.status).toBe('pass');
    expect(result.summary).toContain('42');
  });

  it('passes at exactly 2 destinations', async () => {
    const cli: CliExecutor = { run: vi.fn().mockResolvedValue('Totals: 2 destinations, 2 routes') };
    const result = await box.impl!(ctx, cli);
    expect(result.status).toBe('pass');
  });

  it('passes at exactly 500 destinations', async () => {
    const cli: CliExecutor = { run: vi.fn().mockResolvedValue('Totals: 500 destinations, 510 routes') };
    const result = await box.impl!(ctx, cli);
    expect(result.status).toBe('pass');
  });

  it('warns when CLI rejects', async () => {
    const cli: CliExecutor = { run: vi.fn().mockRejectedValue(new Error('timeout')) };
    const result = await box.impl!(ctx, cli);
    expect(result.status).toBe('warn');
  });
});
