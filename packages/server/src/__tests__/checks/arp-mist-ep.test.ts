import { describe, it, expect, vi } from 'vitest';
import type { CheckResult, TroubleshootContext } from '@marvis/shared';
import type { CliExecutor } from '../../troubleshoot/runner.js';

type CheckImpl = (ctx: TroubleshootContext, cli: CliExecutor) => Promise<CheckResult>;

const box = vi.hoisted<{ impl: CheckImpl | null }>(() => ({ impl: null }));

vi.mock('../../troubleshoot/runner.js', () => ({
  registerCheck: (_: string, fn: CheckImpl) => { box.impl = fn; },
}));

import '../../troubleshoot/checks/arp-mist-ep.js';

const ep = 'ep-terminator.mist.com';

describe('arp-mist-ep', () => {
  it('passes when a MAC address is found in ARP output', async () => {
    const ctx = { mistEndpoint: ep } as TroubleshootContext;
    const cli: CliExecutor = { run: vi.fn().mockResolvedValue('ep-terminator.mist.com at 50:c7:bf:01:02:03 [ether]') };
    const result = await box.impl!(ctx, cli);
    expect(result.status).toBe('pass');
    expect(result.summary).toContain(ep);
  });

  it('warns when no MAC address is found in output', async () => {
    const ctx = { mistEndpoint: ep } as TroubleshootContext;
    const cli: CliExecutor = { run: vi.fn().mockResolvedValue('no entry for ep-terminator.mist.com') };
    const result = await box.impl!(ctx, cli);
    expect(result.status).toBe('warn');
  });

  it('warns when CLI rejects', async () => {
    const ctx = { mistEndpoint: ep } as TroubleshootContext;
    const cli: CliExecutor = { run: vi.fn().mockRejectedValue(new Error('timeout')) };
    const result = await box.impl!(ctx, cli);
    expect(result.status).toBe('warn');
  });
});
