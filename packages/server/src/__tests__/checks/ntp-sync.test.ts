import { describe, it, expect, vi } from 'vitest';
import type { CheckResult, TroubleshootContext } from '@marvis/shared';
import type { CliExecutor } from '../../troubleshoot/runner.js';

type CheckImpl = (ctx: TroubleshootContext, cli: CliExecutor) => Promise<CheckResult>;

const box = vi.hoisted<{ impl: CheckImpl | null }>(() => ({ impl: null }));

vi.mock('../../troubleshoot/runner.js', () => ({
  registerCheck: (_: string, fn: CheckImpl) => { box.impl = fn; },
}));

import '../../troubleshoot/checks/ntp-sync.js';

const ctx = {} as TroubleshootContext;

describe('ntp-sync', () => {
  it('passes when output contains synchronised', async () => {
    const cli: CliExecutor = { run: vi.fn().mockResolvedValue('status: synchronised') };
    const result = await box.impl!(ctx, cli);
    expect(result.status).toBe('pass');
    expect(result.summary).toContain('synchronised');
  });

  it('includes offset in pass summary when present', async () => {
    const cli: CliExecutor = {
      run: vi.fn().mockResolvedValue('status: synchronised\noffset 2.5 ms'),
    };
    const result = await box.impl!(ctx, cli);
    expect(result.status).toBe('pass');
    expect(result.summary).toContain('2.5');
  });

  it('fails when output contains unsynchronised', async () => {
    const cli: CliExecutor = { run: vi.fn().mockResolvedValue('status: unsynchronised') };
    const result = await box.impl!(ctx, cli);
    expect(result.status).toBe('fail');
    expect(result.summary).toContain('TLS');
  });

  it('fails when output contains stratum 16', async () => {
    const cli: CliExecutor = { run: vi.fn().mockResolvedValue('stratum 16, no server') };
    const result = await box.impl!(ctx, cli);
    expect(result.status).toBe('fail');
  });

  it('warns when sync status cannot be determined', async () => {
    const cli: CliExecutor = { run: vi.fn().mockResolvedValue('ntp not configured') };
    const result = await box.impl!(ctx, cli);
    expect(result.status).toBe('warn');
  });

  it('warns when cli.run rejects', async () => {
    const cli: CliExecutor = { run: vi.fn().mockRejectedValue(new Error('timeout')) };
    const result = await box.impl!(ctx, cli);
    expect(result.status).toBe('warn');
  });
});
