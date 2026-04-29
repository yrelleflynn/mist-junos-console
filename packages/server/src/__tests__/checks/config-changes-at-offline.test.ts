import { describe, it, expect, vi } from 'vitest';
import type { CheckResult, TroubleshootContext } from '@marvis/shared';
import type { CliExecutor } from '../../troubleshoot/runner.js';

type CheckImpl = (ctx: TroubleshootContext, cli: CliExecutor) => Promise<CheckResult>;

const box = vi.hoisted<{ impl: CheckImpl | null }>(() => ({ impl: null }));

vi.mock('../../troubleshoot/runner.js', () => ({
  registerCheck: (_: string, fn: CheckImpl) => { box.impl = fn; },
}));

import '../../troubleshoot/checks/config-changes-at-offline.js';

const noCli: CliExecutor = { run: vi.fn() };

describe('config-changes-at-offline', () => {
  it('warns when offlineAt is missing', async () => {
    const ctx = {} as TroubleshootContext;
    const result = await box.impl!(ctx, noCli);
    expect(result.status).toBe('warn');
    expect(result.summary).toContain('No offline timestamp');
  });

  it('passes when offlineAt is set but no events exist', async () => {
    const ctx = { offlineAt: 1_000_000, mistEventsNearOffline: [] } as TroubleshootContext;
    const result = await box.impl!(ctx, noCli);
    expect(result.status).toBe('pass');
    expect(result.summary).toContain('No config change');
  });

  it('passes when mistEventsNearOffline is undefined', async () => {
    const ctx = { offlineAt: 1_000_000 } as TroubleshootContext;
    const result = await box.impl!(ctx, noCli);
    expect(result.status).toBe('pass');
  });

  it('warns when config change events are found near offline time', async () => {
    const ctx = {
      offlineAt: 1_000_000,
      mistEventsNearOffline: [
        { type: 'config', timestamp: 1_000_900, text: 'VLAN config changed' },
        { type: 'config', timestamp: 999_100, text: 'Port profile updated' },
      ],
    } as TroubleshootContext;
    const result = await box.impl!(ctx, noCli);
    expect(result.status).toBe('warn');
    expect(result.summary).toContain('2 config change');
    expect(result.detail).toContain('VLAN config changed');
    expect(result.detail).toContain('Port profile updated');
  });

  it('includes signed time delta in detail output', async () => {
    const ctx = {
      offlineAt: 1_000_000,
      mistEventsNearOffline: [{ type: 'config', timestamp: 1_000_600, text: 'BGP peer reset' }],
    } as TroubleshootContext;
    const result = await box.impl!(ctx, noCli);
    expect(result.detail).toContain('+10m');
  });
});
