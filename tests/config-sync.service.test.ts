import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ConfigSyncService, MIST_CLEANUP_DELETES } from '../src/services/config-sync.service';

// =========================================================================
// Helpers
// =========================================================================

type CmdOverride = Partial<{ output: string; success: boolean; error: string; matched: boolean }>;

/**
 * Build a CommandRunnerService stub.
 * `overrides` keys are command strings; values override the default response.
 * Any un-matched command returns { success: true, output: '' }.
 */
function makeCmdRunnerStub(overrides: Record<string, CmdOverride> = {}) {
  return {
    detectMode: vi.fn().mockResolvedValue('operational'),
    ensureConfigMode: vi.fn().mockResolvedValue(undefined),
    sendAndWaitFor: vi.fn().mockImplementation((text: string) => {
      if (text === 'load set terminal\n') {
        const override = overrides.__load_start__ ?? {};
        return Promise.resolve({
          output: '[Type ^D at a new line to end input]\n',
          matched: true,
          ...override,
        });
      }
      if (text.includes('\u0004')) {
        const override = overrides.__load_payload__ ?? {};
        return Promise.resolve({
          output: 'load complete\nroot@switch# ',
          matched: true,
          ...override,
        });
      }
      return Promise.resolve({ output: '', matched: false });
    }),
    execute: vi.fn().mockImplementation((cmd: string) => {
      const base = { command: cmd, success: true, output: '' };
      const override = overrides[cmd] ?? {};
      return Promise.resolve({ ...base, ...override });
    }),
  };
}

function makeMistApiStub(cli: string[] = ['set system host-name sw-test']) {
  return {
    getDeviceConfig: vi.fn().mockResolvedValue({ cli }),
  };
}

// =========================================================================
// buildCandidate()
// =========================================================================

describe('ConfigSyncService.buildCandidate()', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let service: ConfigSyncService;

  beforeEach(() => {
    // Constructor args not used by buildCandidate — pass dummies.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    service = new ConfigSyncService({} as any, {} as any);
  });

  it('prepends all cleanup delete commands in exact order', () => {
    const result = service.buildCandidate([]);
    expect(result.slice(0, MIST_CLEANUP_DELETES.length)).toEqual([...MIST_CLEANUP_DELETES]);
  });

  it('first command is "delete protocols"', () => {
    expect(service.buildCandidate([])[0]).toBe('delete protocols');
  });

  it('last cleanup command is "delete system processes dhcp-service traceoptions"', () => {
    expect(service.buildCandidate([])[MIST_CLEANUP_DELETES.length - 1]).toBe(
      'delete system processes dhcp-service traceoptions',
    );
  });

  it('MIST_CLEANUP_DELETES has exactly 20 commands', () => {
    expect(MIST_CLEANUP_DELETES.length).toBe(20);
  });

  it('returns only cleanup commands when cli is empty', () => {
    const result = service.buildCandidate([]);
    expect(result.length).toBe(MIST_CLEANUP_DELETES.length);
  });

  it('appends non-empty, non-comment CLI lines after cleanup commands', () => {
    const cli = ['set system host-name sw-test', 'set interfaces ge-0/0/0 unit 0'];
    const result = service.buildCandidate(cli);
    expect(result[MIST_CLEANUP_DELETES.length]).toBe('set system host-name sw-test');
    expect(result[MIST_CLEANUP_DELETES.length + 1]).toBe('set interfaces ge-0/0/0 unit 0');
  });

  it('filters blank lines from the Mist CLI input', () => {
    const cli = ['set system host-name sw-test', '', '   ', 'set vlans v10 vlan-id 10'];
    const result = service.buildCandidate(cli);
    expect(result.length).toBe(MIST_CLEANUP_DELETES.length + 2);
  });

  it('filters comment lines starting with #', () => {
    const cli = ['# This is a comment', 'set system host-name sw-test', '# another comment'];
    const result = service.buildCandidate(cli);
    expect(result.length).toBe(MIST_CLEANUP_DELETES.length + 1);
    expect(result[MIST_CLEANUP_DELETES.length]).toBe('set system host-name sw-test');
  });

  it('trims whitespace from CLI lines before filtering', () => {
    const cli = ['  set system host-name sw-test  ', '  # inline comment  '];
    const result = service.buildCandidate(cli);
    expect(result[MIST_CLEANUP_DELETES.length]).toBe('set system host-name sw-test');
    expect(result.length).toBe(MIST_CLEANUP_DELETES.length + 1);
  });

  it('filters a line that becomes empty after trimming', () => {
    const result = service.buildCandidate(['   ']);
    expect(result.length).toBe(MIST_CLEANUP_DELETES.length);
  });

  it('does not add any cleanup command to the Mist CLI section', () => {
    const cli = ['set system host-name sw-test'];
    const result = service.buildCandidate(cli);
    // The section after cleanup must contain only the CLI line
    const mistSection = result.slice(MIST_CLEANUP_DELETES.length);
    expect(mistSection).toEqual(['set system host-name sw-test']);
  });

  it('preserves the order of CLI lines', () => {
    const cli = ['set system host-name a', 'set system host-name b', 'set system host-name c'];
    const mistSection = service.buildCandidate(cli).slice(MIST_CLEANUP_DELETES.length);
    expect(mistSection).toEqual(cli);
  });
});

// =========================================================================
// previewSync()
// =========================================================================

describe('ConfigSyncService.previewSync()', () => {
  it('calls getDeviceConfig with the correct siteId and deviceId', async () => {
    const cmdRunner = makeCmdRunnerStub({
      'show | compare': { output: '[edit]\n+ set system host-name sw-test' },
      'commit check': { output: 'configuration check succeeds' },
    });
    const mistApi = makeMistApiStub();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const service = new ConfigSyncService(cmdRunner as any, mistApi as any);

    await service.previewSync('site-abc', 'dev-xyz');

    expect(mistApi.getDeviceConfig).toHaveBeenCalledWith('site-abc', 'dev-xyz');
  });

  it('returns correct candidate counts when cli has 2 lines', async () => {
    const cmdRunner = makeCmdRunnerStub({
      'show | compare': { output: '' },
      'commit check': { output: 'configuration check succeeds' },
    });
    const mistApi = makeMistApiStub(['set system host-name sw-test', 'set vlans v10 vlan-id 10']);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const service = new ConfigSyncService(cmdRunner as any, mistApi as any);

    const result = await service.previewSync('site-1', 'dev-1');

    expect(result.cleanupCommandCount).toBe(MIST_CLEANUP_DELETES.length);
    expect(result.mistCliCommandCount).toBe(2);
    expect(result.candidateCommandCount).toBe(MIST_CLEANUP_DELETES.length + 2);
  });

  it('returns mistCliCommandCount=0 when config_cmd has no cli field', async () => {
    const cmdRunner = makeCmdRunnerStub({
      'show | compare': { output: '' },
      'commit check': { output: 'configuration check succeeds' },
    });
    const mistApi = { getDeviceConfig: vi.fn().mockResolvedValue({}) };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const service = new ConfigSyncService(cmdRunner as any, mistApi as any);

    const result = await service.previewSync('site-1', 'dev-1');
    expect(result.mistCliCommandCount).toBe(0);
    expect(result.candidateCommandCount).toBe(MIST_CLEANUP_DELETES.length);
  });

  it('commitCheckPassed=true when output contains "configuration check succeeds"', async () => {
    const cmdRunner = makeCmdRunnerStub({
      'show | compare': { output: '' },
      'commit check': { output: 'configuration check succeeds' },
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const service = new ConfigSyncService(cmdRunner as any, makeMistApiStub() as any);

    const result = await service.previewSync('site-1', 'dev-1');
    expect(result.commitCheckPassed).toBe(true);
  });

  it('commitCheckPassed=false when commit check returns an error', async () => {
    const cmdRunner = makeCmdRunnerStub({
      'show | compare': { output: '' },
      'commit check': { output: 'error: missing required statement "root-authentication"' },
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const service = new ConfigSyncService(cmdRunner as any, makeMistApiStub() as any);

    const result = await service.previewSync('site-1', 'dev-1');
    expect(result.commitCheckPassed).toBe(false);
  });

  it('captures compare output in the result', async () => {
    const diff = '[edit]\n- set system host-name old\n+ set system host-name new';
    const cmdRunner = makeCmdRunnerStub({
      'show | compare': { output: diff },
      'commit check': { output: 'configuration check succeeds' },
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const service = new ConfigSyncService(cmdRunner as any, makeMistApiStub() as any);

    const result = await service.previewSync('site-1', 'dev-1');
    expect(result.compareOutput).toBe(diff);
  });

  it('records a staging error when a command produces "syntax error" output', async () => {
    const cmdRunner = makeCmdRunnerStub({
      __load_payload__: { output: 'syntax error, expecting <command>\nroot@switch# ' },
      'show | compare': { output: '' },
      'commit check': { output: 'configuration check succeeds' },
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const service = new ConfigSyncService(cmdRunner as any, makeMistApiStub([]) as any);

    const result = await service.previewSync('site-1', 'dev-1');

    const err = result.stagingErrors.find((e) => e.command === 'load set terminal');
    expect(err).toBeDefined();
  });

  it('records a staging error when bulk load does not finish', async () => {
    const cmdRunner = makeCmdRunnerStub({
      __load_payload__: { matched: false, output: '' },
      'show | compare': { output: '' },
      'commit check': { output: 'configuration check succeeds' },
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const service = new ConfigSyncService(cmdRunner as any, makeMistApiStub([]) as any);

    const result = await service.previewSync('site-1', 'dev-1');

    const err = result.stagingErrors.find((e) => e.command === 'load set terminal');
    expect(err).toBeDefined();
    expect(err?.error).toContain('Timed out');
  });

  it('uses a single bulk load payload instead of staging line by line', async () => {
    const cmdRunner = makeCmdRunnerStub({
      'show | compare': { output: '' },
      'commit check': { output: 'configuration check succeeds' },
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const service = new ConfigSyncService(cmdRunner as any, makeMistApiStub([]) as any);

    await service.previewSync('site-1', 'dev-1');

    expect(cmdRunner.sendAndWaitFor).toHaveBeenCalledTimes(2);
    const payload = cmdRunner.sendAndWaitFor.mock.calls[1][0] as string;
    expect(payload).toContain('delete protocols');
    expect(payload).toContain('delete system processes dhcp-service traceoptions');
    expect(payload.endsWith('\u0004')).toBe(true);
    expect(cmdRunner.execute).not.toHaveBeenCalledWith('delete protocols', expect.anything());
  });

  it('rolls back even when staging produces errors', async () => {
    const cmdRunner = makeCmdRunnerStub({
      'delete protocols': { output: 'syntax error', success: true },
      'show | compare': { output: '' },
      'commit check': { output: 'configuration check succeeds' },
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const service = new ConfigSyncService(cmdRunner as any, makeMistApiStub([]) as any);

    const result = await service.previewSync('site-1', 'dev-1');
    expect(result.rolledBack).toBe(true);
  });

  it('calls rollback 0 before exit after a successful preview', async () => {
    const cmdRunner = makeCmdRunnerStub({
      'show | compare': { output: 'diff output here' },
      'commit check': { output: 'configuration check succeeds' },
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const service = new ConfigSyncService(cmdRunner as any, makeMistApiStub() as any);

    await service.previewSync('site-1', 'dev-1');

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const calls: string[] = (cmdRunner.execute as any).mock.calls.map((c: [string]) => c[0]);
    const rollbackIdx = calls.indexOf('rollback 0');
    const exitIdx = calls.indexOf('exit');
    expect(rollbackIdx).toBeGreaterThanOrEqual(0);
    expect(exitIdx).toBeGreaterThanOrEqual(0);
    expect(rollbackIdx).toBeLessThan(exitIdx);
  });

  it('sets rolledBack=true in a clean success flow', async () => {
    const cmdRunner = makeCmdRunnerStub({
      'show | compare': { output: '' },
      'commit check': { output: 'configuration check succeeds' },
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const service = new ConfigSyncService(cmdRunner as any, makeMistApiStub() as any);

    const result = await service.previewSync('site-1', 'dev-1');
    expect(result.rolledBack).toBe(true);
  });

  it('still rolls back even when config_cmd returns no cli field', async () => {
    const cmdRunner = makeCmdRunnerStub({
      'show | compare': { output: '' },
      'commit check': { output: 'configuration check succeeds' },
    });
    const mistApi = { getDeviceConfig: vi.fn().mockResolvedValue({}) };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const service = new ConfigSyncService(cmdRunner as any, mistApi as any);

    const result = await service.previewSync('site-1', 'dev-1');
    expect(result.rolledBack).toBe(true);
  });

  it('enters config mode before staging commands', async () => {
    const callOrder: string[] = [];
    const cmdRunner = {
      detectMode: vi.fn().mockImplementation(() => {
        callOrder.push('detectMode');
        return Promise.resolve('operational');
      }),
      ensureConfigMode: vi.fn().mockImplementation(() => {
        callOrder.push('ensureConfigMode');
        return Promise.resolve();
      }),
      sendAndWaitFor: vi.fn().mockImplementation((text: string) => {
        callOrder.push(text === 'load set terminal\n' ? 'loadStart' : 'loadPayload');
        if (text === 'load set terminal\n') return Promise.resolve({ output: '', matched: true });
        return Promise.resolve({ output: 'root@switch# ', matched: true });
      }),
      execute: vi.fn().mockImplementation((cmd: string) => {
        callOrder.push(cmd);
        return Promise.resolve({ command: cmd, success: true, output: '' });
      }),
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const service = new ConfigSyncService(cmdRunner as any, makeMistApiStub([]) as any);

    await service.previewSync('site-1', 'dev-1');

    expect(callOrder[0]).toBe('detectMode');
    expect(callOrder[1]).toBe('ensureConfigMode');
    expect(callOrder[2]).toBe('loadStart');
    expect(callOrder[3]).toBe('loadPayload');
  });

  it('refuses to run when the operator is already in config mode', async () => {
    const cmdRunner = {
      detectMode: vi.fn().mockResolvedValue('config'),
      ensureConfigMode: vi.fn().mockResolvedValue(undefined),
      sendAndWaitFor: vi.fn().mockResolvedValue({ output: '', matched: false }),
      execute: vi.fn().mockResolvedValue({ command: '', success: true, output: '' }),
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const service = new ConfigSyncService(cmdRunner as any, makeMistApiStub([]) as any);

    await expect(service.previewSync('site-1', 'dev-1')).rejects.toThrow(
      'Config sync preview cannot run while already in configuration mode.',
    );

    expect(cmdRunner.ensureConfigMode).not.toHaveBeenCalled();
    expect(cmdRunner.execute).not.toHaveBeenCalled();
  });
});
