import { describe, it, expect, vi } from 'vitest';
import type { CheckResult, TroubleshootContext } from '@marvis/shared';
import type { CliExecutor } from '../../troubleshoot/runner.js';

type CheckImpl = (ctx: TroubleshootContext, cli: CliExecutor) => Promise<CheckResult>;

const box = vi.hoisted<{ impl: CheckImpl | null }>(() => ({ impl: null }));

vi.mock('../../troubleshoot/runner.js', () => ({
  registerCheck: (_: string, fn: CheckImpl) => { box.impl = fn; },
}));

import '../../troubleshoot/checks/default-route-present.js';

const noCli: CliExecutor = { run: vi.fn() };

describe('default-route-present', () => {
  it('passes when defaultGateway is set', async () => {
    const ctx = { defaultGateway: '10.0.0.1' } as TroubleshootContext;
    const result = await box.impl!(ctx, noCli);
    expect(result.status).toBe('pass');
    expect(result.summary).toContain('10.0.0.1');
    expect(noCli.run).not.toHaveBeenCalled();
  });

  it('fails when defaultGateway is undefined', async () => {
    const ctx = {} as TroubleshootContext;
    const result = await box.impl!(ctx, noCli);
    expect(result.status).toBe('fail');
    expect(result.checkId).toBe('default-route-present');
  });

  it('fails when defaultGateway is empty string', async () => {
    const ctx = { defaultGateway: '' } as TroubleshootContext;
    const result = await box.impl!(ctx, noCli);
    expect(result.status).toBe('fail');
  });
});
