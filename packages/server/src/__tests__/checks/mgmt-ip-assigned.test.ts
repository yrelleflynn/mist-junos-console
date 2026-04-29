import { describe, it, expect, vi } from 'vitest';
import type { CheckResult, TroubleshootContext } from '@marvis/shared';
import type { CliExecutor } from '../../troubleshoot/runner.js';

type CheckImpl = (ctx: TroubleshootContext, cli: CliExecutor) => Promise<CheckResult>;

const box = vi.hoisted<{ impl: CheckImpl | null }>(() => ({ impl: null }));

vi.mock('../../troubleshoot/runner.js', () => ({
  registerCheck: (_: string, fn: CheckImpl) => { box.impl = fn; },
}));

import '../../troubleshoot/checks/mgmt-ip-assigned.js';

const noCli: CliExecutor = { run: vi.fn() };

describe('mgmt-ip-assigned', () => {
  it('passes when managementIp is set', async () => {
    const ctx = { managementIp: '10.0.0.1', managementPrefix: 24 } as TroubleshootContext;
    const result = await box.impl!(ctx, noCli);
    expect(result.status).toBe('pass');
    expect(result.summary).toContain('10.0.0.1');
    expect(result.summary).toContain('24');
  });

  it('passes with unknown prefix when managementPrefix is missing', async () => {
    const ctx = { managementIp: '192.168.1.1' } as TroubleshootContext;
    const result = await box.impl!(ctx, noCli);
    expect(result.status).toBe('pass');
    expect(result.summary).toContain('?');
  });

  it('fails when managementIp is empty string', async () => {
    const ctx = { managementIp: '' } as TroubleshootContext;
    const result = await box.impl!(ctx, noCli);
    expect(result.status).toBe('fail');
    expect(result.checkId).toBe('mgmt-ip-assigned');
  });

  it('fails when managementIp is undefined', async () => {
    const ctx = {} as TroubleshootContext;
    const result = await box.impl!(ctx, noCli);
    expect(result.status).toBe('fail');
  });
});
