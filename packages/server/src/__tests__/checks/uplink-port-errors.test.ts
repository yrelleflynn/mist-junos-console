import { describe, it, expect, vi } from 'vitest';
import type { CheckResult, TroubleshootContext } from '@marvis/shared';
import type { CliExecutor } from '../../troubleshoot/runner.js';

type CheckImpl = (ctx: TroubleshootContext, cli: CliExecutor) => Promise<CheckResult>;

const box = vi.hoisted<{ impl: CheckImpl | null }>(() => ({ impl: null }));

vi.mock('../../troubleshoot/runner.js', () => ({
  registerCheck: (_: string, fn: CheckImpl) => { box.impl = fn; },
}));

import '../../troubleshoot/checks/uplink-port-errors.js';

const noCli: CliExecutor = { run: vi.fn() };

describe('uplink-port-errors', () => {
  it('passes with zero errors', async () => {
    const ctx = { uplinkPort: 'ge-0/0/0', uplinkPortErrors: { input: 0, output: 0 } } as TroubleshootContext;
    const result = await box.impl!(ctx, noCli);
    expect(result.status).toBe('pass');
  });

  it('warns for elevated errors below fail threshold', async () => {
    const ctx = { uplinkPort: 'ge-0/0/0', uplinkPortErrors: { input: 60, output: 40 } } as TroubleshootContext;
    const result = await box.impl!(ctx, noCli);
    expect(result.status).toBe('warn');
    expect(result.summary).toContain('100');
  });

  it('warns at exactly WARN_THRESHOLD (100)', async () => {
    const ctx = { uplinkPort: 'ge-0/0/0', uplinkPortErrors: { input: 100, output: 0 } } as TroubleshootContext;
    const result = await box.impl!(ctx, noCli);
    expect(result.status).toBe('warn');
  });

  it('fails at exactly FAIL_THRESHOLD (1000)', async () => {
    const ctx = { uplinkPort: 'ge-0/0/0', uplinkPortErrors: { input: 500, output: 500 } } as TroubleshootContext;
    const result = await box.impl!(ctx, noCli);
    expect(result.status).toBe('fail');
    expect(result.summary).toContain('1000');
  });

  it('fails above FAIL_THRESHOLD', async () => {
    const ctx = { uplinkPort: 'ge-0/0/0', uplinkPortErrors: { input: 2000, output: 0 } } as TroubleshootContext;
    const result = await box.impl!(ctx, noCli);
    expect(result.status).toBe('fail');
  });

  it('includes input and output in detail', async () => {
    const ctx = { uplinkPort: 'ge-0/0/0', uplinkPortErrors: { input: 200, output: 50 } } as TroubleshootContext;
    const result = await box.impl!(ctx, noCli);
    expect(result.detail).toContain('200');
    expect(result.detail).toContain('50');
  });
});
