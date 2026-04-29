import { describe, it, expect, vi } from 'vitest';
import type { CheckResult, TroubleshootContext } from '@marvis/shared';
import type { CliExecutor } from '../../troubleshoot/runner.js';

type CheckImpl = (ctx: TroubleshootContext, cli: CliExecutor) => Promise<CheckResult>;

const box = vi.hoisted<{ impl: CheckImpl | null }>(() => ({ impl: null }));

vi.mock('../../troubleshoot/runner.js', () => ({
  registerCheck: (_: string, fn: CheckImpl) => { box.impl = fn; },
}));

import '../../troubleshoot/checks/mgmt-vlan-reachable.js';

describe('mgmt-vlan-reachable', () => {
  it('passes with 0% packet loss to defaultGateway', async () => {
    const ctx = { defaultGateway: '10.0.0.1', managementIp: '10.0.0.100' } as TroubleshootContext;
    const cli: CliExecutor = {
      run: vi.fn().mockResolvedValue('3 packets transmitted, 3 received, 0% packet loss'),
    };
    const result = await box.impl!(ctx, cli);
    expect(result.status).toBe('pass');
    expect(result.summary).toContain('10.0.0.1');
  });

  it('fails with packet loss to defaultGateway', async () => {
    const ctx = { defaultGateway: '10.0.0.1', managementIp: '10.0.0.100' } as TroubleshootContext;
    const cli: CliExecutor = {
      run: vi.fn().mockResolvedValue('3 packets transmitted, 0 received, 100% packet loss'),
    };
    const result = await box.impl!(ctx, cli);
    expect(result.status).toBe('fail');
    expect(result.summary).toContain('100%');
  });

  it('falls back to managementIp when defaultGateway is absent', async () => {
    const ctx = { managementIp: '10.0.0.100' } as TroubleshootContext;
    const cli: CliExecutor = {
      run: vi.fn().mockResolvedValue('3 packets transmitted, 3 received, 0% packet loss'),
    };
    const result = await box.impl!(ctx, cli);
    expect(result.status).toBe('pass');
    expect(result.summary).toContain('10.0.0.100');
  });

  it('fails when cli.run rejects (treated as 100% loss)', async () => {
    const ctx = { defaultGateway: '10.0.0.1', managementIp: '10.0.0.100' } as TroubleshootContext;
    const cli: CliExecutor = {
      run: vi.fn().mockRejectedValue(new Error('timeout')),
    };
    const result = await box.impl!(ctx, cli);
    expect(result.status).toBe('fail');
  });
});
