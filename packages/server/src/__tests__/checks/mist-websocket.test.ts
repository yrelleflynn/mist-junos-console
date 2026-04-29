import { describe, it, expect, vi } from 'vitest';
import { JmaStateCode } from '@marvis/shared';
import type { CheckResult, TroubleshootContext } from '@marvis/shared';
import type { CliExecutor } from '../../troubleshoot/runner.js';

type CheckImpl = (ctx: TroubleshootContext, cli: CliExecutor) => Promise<CheckResult>;

const box = vi.hoisted<{ impl: CheckImpl | null }>(() => ({ impl: null }));

vi.mock('../../troubleshoot/runner.js', () => ({
  registerCheck: (_: string, fn: CheckImpl) => { box.impl = fn; },
}));

import '../../troubleshoot/checks/mist-websocket.js';

const noCli: CliExecutor = { run: vi.fn() };

describe('mist-websocket', () => {
  it('fails when jmaState is undefined', async () => {
    const ctx = {} as TroubleshootContext;
    const result = await box.impl!(ctx, noCli);
    expect(result.status).toBe('fail');
    expect(result.checkId).toBe('mist-websocket');
  });

  it('passes when jmaState is Connected (111)', async () => {
    const ctx = { jmaState: JmaStateCode.Connected } as TroubleshootContext;
    const result = await box.impl!(ctx, noCli);
    expect(result.status).toBe('pass');
    expect(result.summary).toContain('111');
  });

  it('warns when jmaState is WebsocketConnecting (109)', async () => {
    const ctx = { jmaState: JmaStateCode.WebsocketConnecting } as TroubleshootContext;
    const result = await box.impl!(ctx, noCli);
    expect(result.status).toBe('warn');
    expect(result.summary).toContain('109');
  });

  it('warns when jmaState is WebsocketConnected (110)', async () => {
    const ctx = { jmaState: JmaStateCode.WebsocketConnected } as TroubleshootContext;
    const result = await box.impl!(ctx, noCli);
    expect(result.status).toBe('warn');
    expect(result.summary).toContain('110');
  });

  it('fails when jmaState is NoIPAddress (102)', async () => {
    const ctx = { jmaState: JmaStateCode.NoIPAddress } as TroubleshootContext;
    const result = await box.impl!(ctx, noCli);
    expect(result.status).toBe('fail');
    expect(result.summary).toContain('102');
  });

  it('fails when jmaState is DNSLookupFailed (106)', async () => {
    const ctx = { jmaState: JmaStateCode.DNSLookupFailed } as TroubleshootContext;
    const result = await box.impl!(ctx, noCli);
    expect(result.status).toBe('fail');
    expect(result.summary).toContain('106');
  });
});
