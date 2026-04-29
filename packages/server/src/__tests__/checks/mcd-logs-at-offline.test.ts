import { describe, it, expect, vi } from 'vitest';
import type { CheckResult, TroubleshootContext } from '@marvis/shared';
import type { CliExecutor } from '../../troubleshoot/runner.js';

type CheckImpl = (ctx: TroubleshootContext, cli: CliExecutor) => Promise<CheckResult>;

const box = vi.hoisted<{ impl: CheckImpl | null }>(() => ({ impl: null }));

vi.mock('../../troubleshoot/runner.js', () => ({
  registerCheck: (_: string, fn: CheckImpl) => { box.impl = fn; },
}));

import '../../troubleshoot/checks/mcd-logs-at-offline.js';

const noCli: CliExecutor = { run: vi.fn() };

describe('mcd-logs-at-offline', () => {
  it('warns when mcdLogLines is empty and offlineAt is set', async () => {
    const ctx = { mcdLogLines: [], offlineAt: 1000000 } as TroubleshootContext;
    const result = await box.impl!(ctx, noCli);
    expect(result.status).toBe('warn');
    expect(result.summary).toContain('offline window');
  });

  it('warns when mcdLogLines is empty and offlineAt is missing', async () => {
    const ctx = {} as TroubleshootContext;
    const result = await box.impl!(ctx, noCli);
    expect(result.status).toBe('warn');
    expect(result.summary).toContain('offline timestamp');
  });

  it('passes when log lines contain no error patterns', async () => {
    const ctx = {
      mcdLogLines: ['connected to cloud', 'heartbeat ok', 'config applied'],
      offlineAt: 1000000,
    } as TroubleshootContext;
    const result = await box.impl!(ctx, noCli);
    expect(result.status).toBe('pass');
    expect(result.summary).toContain('3 log line');
  });

  it('warns when log lines contain an error pattern', async () => {
    const ctx = {
      mcdLogLines: ['connected to cloud', 'websocket closed unexpectedly', 'reconnecting'],
      offlineAt: 1000000,
    } as TroubleshootContext;
    const result = await box.impl!(ctx, noCli);
    expect(result.status).toBe('warn');
    expect(result.summary).toContain('2 error');
  });

  it('warns when a disconnect pattern is found', async () => {
    const ctx = {
      mcdLogLines: ['disconnect from peer'],
      offlineAt: 1000000,
    } as TroubleshootContext;
    const result = await box.impl!(ctx, noCli);
    expect(result.status).toBe('warn');
  });

  it('warns when a timeout pattern is found', async () => {
    const ctx = {
      mcdLogLines: ['request timeout after 30s'],
      offlineAt: 1000000,
    } as TroubleshootContext;
    const result = await box.impl!(ctx, noCli);
    expect(result.status).toBe('warn');
  });
});
