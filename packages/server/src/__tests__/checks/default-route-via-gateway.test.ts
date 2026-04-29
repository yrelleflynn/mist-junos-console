import { describe, it, expect, vi } from 'vitest';
import type { CheckResult, TroubleshootContext } from '@marvis/shared';
import type { CliExecutor } from '../../troubleshoot/runner.js';

type CheckImpl = (ctx: TroubleshootContext, cli: CliExecutor) => Promise<CheckResult>;

const box = vi.hoisted<{ impl: CheckImpl | null }>(() => ({ impl: null }));

vi.mock('../../troubleshoot/runner.js', () => ({
  registerCheck: (_: string, fn: CheckImpl) => { box.impl = fn; },
}));

import '../../troubleshoot/checks/default-route-via-gateway.js';

const gw = '10.0.0.1';

describe('default-route-via-gateway', () => {
  it('passes when route detail contains Direct', async () => {
    const ctx = { defaultGateway: gw } as TroubleshootContext;
    const cli: CliExecutor = { run: vi.fn().mockResolvedValue('10.0.0.0/24 (1 entry)\n  *Direct  Preference: 0') };
    const result = await box.impl!(ctx, cli);
    expect(result.status).toBe('pass');
  });

  it('passes when route detail contains Local', async () => {
    const ctx = { defaultGateway: gw } as TroubleshootContext;
    const cli: CliExecutor = { run: vi.fn().mockResolvedValue('10.0.0.1/32 (1 entry)\n  *Local   Preference: 0') };
    const result = await box.impl!(ctx, cli);
    expect(result.status).toBe('pass');
  });

  it('warns when route is not via a directly connected interface', async () => {
    const ctx = { defaultGateway: gw } as TroubleshootContext;
    const cli: CliExecutor = { run: vi.fn().mockResolvedValue('10.0.0.1/32  *Static  Next-hop: 10.1.1.1') };
    const result = await box.impl!(ctx, cli);
    expect(result.status).toBe('warn');
    expect(result.summary).toContain(gw);
  });

  it('warns when CLI rejects', async () => {
    const ctx = { defaultGateway: gw } as TroubleshootContext;
    const cli: CliExecutor = { run: vi.fn().mockRejectedValue(new Error('timeout')) };
    const result = await box.impl!(ctx, cli);
    expect(result.status).toBe('warn');
  });
});
