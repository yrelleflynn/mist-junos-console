import { describe, it, expect, vi } from 'vitest';
import type { CheckResult, TroubleshootContext } from '@marvis/shared';
import type { CliExecutor } from '../../troubleshoot/runner.js';

type CheckImpl = (ctx: TroubleshootContext, cli: CliExecutor) => Promise<CheckResult>;

const box = vi.hoisted<{ impl: CheckImpl | null }>(() => ({ impl: null }));

vi.mock('../../troubleshoot/runner.js', () => ({
  registerCheck: (_: string, fn: CheckImpl) => { box.impl = fn; },
}));

import '../../troubleshoot/checks/default-gateway-ping.js';

function makeCli(output: string): CliExecutor {
  return { run: vi.fn().mockResolvedValue(output) };
}

describe('default-gateway-ping', () => {
  it('returns error when defaultGateway is missing', async () => {
    const ctx = {} as TroubleshootContext;
    const result = await box.impl!(ctx, makeCli(''));
    expect(result.status).toBe('error');
    expect(result.summary).toContain('defaultGateway');
  });

  it('passes with 0% packet loss', async () => {
    const ctx = { defaultGateway: '10.0.0.1' } as TroubleshootContext;
    const result = await box.impl!(ctx, makeCli('5 packets transmitted, 5 received, 0% packet loss'));
    expect(result.status).toBe('pass');
    expect(result.summary).toContain('10.0.0.1');
    expect(result.summary).toContain('0%');
  });

  it('warns with partial packet loss', async () => {
    const ctx = { defaultGateway: '10.0.0.1' } as TroubleshootContext;
    const result = await box.impl!(ctx, makeCli('5 packets transmitted, 3 received, 40% packet loss'));
    expect(result.status).toBe('warn');
    expect(result.summary).toContain('40%');
  });

  it('fails with 100% packet loss', async () => {
    const ctx = { defaultGateway: '10.0.0.1' } as TroubleshootContext;
    const result = await box.impl!(ctx, makeCli('5 packets transmitted, 0 received, 100% packet loss'));
    expect(result.status).toBe('fail');
    expect(result.summary).toContain('100%');
  });

  it('treats unparseable output as 100% loss', async () => {
    const ctx = { defaultGateway: '10.0.0.1' } as TroubleshootContext;
    const result = await box.impl!(ctx, makeCli('timeout'));
    expect(result.status).toBe('fail');
  });

  it('handles cli.run rejection gracefully', async () => {
    const ctx = { defaultGateway: '10.0.0.1' } as TroubleshootContext;
    const cli: CliExecutor = { run: vi.fn().mockRejectedValue(new Error('timed out')) };
    const result = await box.impl!(ctx, cli);
    expect(result.status).toBe('fail');
  });
});
