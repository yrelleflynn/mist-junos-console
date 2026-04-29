import { describe, it, expect, vi } from 'vitest';
import type { CheckResult, TroubleshootContext } from '@marvis/shared';
import type { CliExecutor } from '../../troubleshoot/runner.js';

type CheckImpl = (ctx: TroubleshootContext, cli: CliExecutor) => Promise<CheckResult>;

const box = vi.hoisted<{ impl: CheckImpl | null }>(() => ({ impl: null }));

vi.mock('../../troubleshoot/runner.js', () => ({
  registerCheck: (_: string, fn: CheckImpl) => { box.impl = fn; },
}));

import '../../troubleshoot/checks/uplink-port-status.js';

const noCli: CliExecutor = { run: vi.fn() };

describe('uplink-port-status', () => {
  it('passes when uplinkPortStatus is up', async () => {
    const ctx = { uplinkPort: 'ge-0/0/0', uplinkPortStatus: 'up' } as TroubleshootContext;
    const result = await box.impl!(ctx, noCli);
    expect(result.status).toBe('pass');
    expect(result.summary).toContain('ge-0/0/0');
  });

  it('fails when uplinkPortStatus is down', async () => {
    const ctx = { uplinkPort: 'ge-0/0/0', uplinkPortStatus: 'down' } as TroubleshootContext;
    const result = await box.impl!(ctx, noCli);
    expect(result.status).toBe('fail');
    expect(result.summary).toContain('down');
  });

  it('warns when uplinkPortStatus is unknown', async () => {
    const ctx = { uplinkPort: 'ge-0/0/0', uplinkPortStatus: 'unknown' } as TroubleshootContext;
    const result = await box.impl!(ctx, noCli);
    expect(result.status).toBe('warn');
  });

  it('errors when uplinkPort is missing', async () => {
    const ctx = {} as TroubleshootContext;
    const result = await box.impl!(ctx, noCli);
    expect(result.status).toBe('error');
    expect(result.summary).toContain('uplink port');
  });
});
