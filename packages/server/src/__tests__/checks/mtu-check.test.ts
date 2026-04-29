import { describe, it, expect, vi } from 'vitest';
import type { CheckResult, TroubleshootContext } from '@marvis/shared';
import type { CliExecutor } from '../../troubleshoot/runner.js';

type CheckImpl = (ctx: TroubleshootContext, cli: CliExecutor) => Promise<CheckResult>;

const box = vi.hoisted<{ impl: CheckImpl | null }>(() => ({ impl: null }));

vi.mock('../../troubleshoot/runner.js', () => ({
  registerCheck: (_: string, fn: CheckImpl) => { box.impl = fn; },
}));

import '../../troubleshoot/checks/mtu-check.js';

const gw = '192.168.1.1';

describe('mtu-check', () => {
  it('passes when 0% packet loss', async () => {
    const ctx = { defaultGateway: gw } as TroubleshootContext;
    const cli: CliExecutor = { run: vi.fn().mockResolvedValue('PING 192.168.1.1: 3 packets transmitted, 3 received, 0% packet loss') };
    const result = await box.impl!(ctx, cli);
    expect(result.status).toBe('pass');
    expect(result.summary).toContain('1400');
  });

  it('fails when there is packet loss', async () => {
    const ctx = { defaultGateway: gw } as TroubleshootContext;
    const cli: CliExecutor = { run: vi.fn().mockResolvedValue('PING 192.168.1.1: 3 packets transmitted, 1 received, 66% packet loss') };
    const result = await box.impl!(ctx, cli);
    expect(result.status).toBe('fail');
  });

  it('fails when CLI rejects', async () => {
    const ctx = { defaultGateway: gw } as TroubleshootContext;
    const cli: CliExecutor = { run: vi.fn().mockRejectedValue(new Error('timeout')) };
    const result = await box.impl!(ctx, cli);
    expect(result.status).toBe('fail');
  });
});
