import { beforeEach, describe, expect, it, vi } from 'vitest';

import { TroubleshootService, CheckResult } from '../src/services/troubleshoot.service';
import type { MistCloud } from '../src/config/mist-clouds.config';
import {
  LLDP_EMPTY,
  LLDP_SINGLE_NEIGHBOR,
  LLDP_TWO_NEIGHBORS,
} from './fixtures/lldp-neighbors';

type ExecuteResult = {
  command: string;
  output: string;
  success: boolean;
  error?: string;
};

function createRunnerMock(lldpResult: ExecuteResult) {
  return {
    ensureOperationalMode: vi.fn().mockResolvedValue(undefined),
    execute: vi.fn(async (command: string) => {
      if (command === 'show lldp neighbors') {
        return lldpResult;
      }
      if (command.includes('show interfaces')) {
        return { command, output: 'Interface down', success: false, error: 'stop after lldp' };
      }
      return { command, output: '', success: false, error: 'unexpected command' };
    }),
  };
}

function createCloud(): MistCloud {
  return {
    id: 'test',
    name: 'Test Cloud',
    apiHost: 'api.test.mist.local',
    switchEndpoints: [
      { host: 'example.mist.local', port: 443, protocol: 'tcp', description: 'Test endpoint' },
    ],
  };
}

async function runUntilLldp(
  runner: ReturnType<typeof createRunnerMock>,
  uplinkPort = '',
): Promise<CheckResult[]> {
  const service = new TroubleshootService(runner as never);
  const progress: CheckResult[] = [];

  await expect(service.runAll({
    cloud: createCloud(),
    uplinkPort,
    onProgress: (result) => {
      progress.push(result);
      if (result.id === 'port-status') {
        throw new Error('stop-after-port-status');
      }
    },
  })).rejects.toThrow('stop-after-port-status');

  return progress;
}

describe('TroubleshootService LLDP behavior', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('reports a pass result with detected uplink details when neighbors are found', async () => {
    const runner = createRunnerMock({
      command: 'show lldp neighbors',
      output: LLDP_SINGLE_NEIGHBOR,
      success: true,
    });

    const progress = await runUntilLldp(runner);
    const lldp = progress.find((r) => r.id === 'lldp');

    expect(lldp).toBeDefined();
    expect(lldp?.status).toBe('pass');
    expect(lldp?.detail).toContain('1 neighbor(s). Uplink: ge-0/0/0.0');
    expect(lldp?.detail).toContain('core-sw-01');
    expect(lldp?.detail).toContain('ge-0/1/5');
  });

  it('prefers the user-specified uplink port when it matches a neighbor', async () => {
    const runner = createRunnerMock({
      command: 'show lldp neighbors',
      output: LLDP_TWO_NEIGHBORS,
      success: true,
    });

    const progress = await runUntilLldp(runner, 'ge-0/0/1.0');
    const lldp = progress.find((r) => r.id === 'lldp');

    expect(lldp?.status).toBe('pass');
    expect(lldp?.detail).toContain('Uplink: ge-0/0/1.0');
    expect(lldp?.detail).toContain('ap-floor-2');
    expect(lldp?.detail).toContain('ge-0/2/3');
  });

  it('reports a fail result when no neighbors are found', async () => {
    const runner = createRunnerMock({
      command: 'show lldp neighbors',
      output: LLDP_EMPTY,
      success: true,
    });

    const service = new TroubleshootService(runner as never);
    const progress: CheckResult[] = [];

    const results = await service.runAll({
      cloud: createCloud(),
      onProgress: (result) => progress.push(result),
    });

    const lldp = results.find((r) => r.id === 'lldp');
    expect(lldp?.status).toBe('fail');
    expect(lldp?.detail).toBe('No LLDP neighbors found');
    expect(progress.some((r) => r.id === 'lldp')).toBe(true);
  });

  it('reports command failure details when show lldp neighbors fails', async () => {
    const runner = createRunnerMock({
      command: 'show lldp neighbors',
      output: '',
      success: false,
      error: 'Command timed out after 20000ms',
    });

    const service = new TroubleshootService(runner as never);
    const progress: CheckResult[] = [];

    const results = await service.runAll({
      cloud: createCloud(),
      onProgress: (result) => progress.push(result),
    });

    const lldp = results.find((r) => r.id === 'lldp');
    expect(lldp?.status).toBe('fail');
    expect(lldp?.detail).toBe('Command timed out after 20000ms');
    expect(progress.some((r) => r.id === 'lldp')).toBe(true);
  });
});
