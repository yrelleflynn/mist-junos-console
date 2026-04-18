import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  ConfigSyncService,
  MIST_CLEANUP_DELETES,
  isConfigSyncStagingWarning,
  parseCommitCheckPassed,
} from '../src/services/config-sync.service';

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
      if (text === 'commit check\n') {
        const override = overrides.__commit_check_wait__ ?? {};
        return Promise.resolve({
          output: 'commit check\nconfiguration check succeeds\nroot@switch# ',
          matched: true,
          ...override,
        });
      }
      if (text === '\n') {
        const override = overrides.__prompt_settle__ ?? {};
        return Promise.resolve({
          output: 'root@switch# ',
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

/** Run a successful preview and return the stub + service, ready for action tests. */
async function makeServiceWithStagedCandidate(overrides: Record<string, CmdOverride> = {}) {
  const cmdRunner = makeCmdRunnerStub({
    'show | compare': { output: '[edit]\n+ set system host-name sw-new' },
    __commit_check_wait__: {
      output: 'commit check\nconfiguration check succeeds\nroot@switch# ',
      matched: true,
    },
    ...overrides,
  });
  const service = new ConfigSyncService(cmdRunner as any, makeMistApiStub() as any);
  const result = await service.previewSync('site-1', 'dev-1');
  expect(result.staged).toBe(true);
  return { cmdRunner, service };
}

// =========================================================================
// parseCommitCheckPassed()
// =========================================================================

describe('parseCommitCheckPassed()', () => {
  it('returns true for exact "configuration check succeeds" output', () => {
    expect(parseCommitCheckPassed('configuration check succeeds')).toBe(true);
  });

  it('is case-insensitive', () => {
    expect(parseCommitCheckPassed('Configuration Check Succeeds')).toBe(true);
    expect(parseCommitCheckPassed('CONFIGURATION CHECK SUCCEEDS')).toBe(true);
  });

  it('returns true when "configuration check succeeds" appears after warnings', () => {
    const output = [
      '[edit]',
      "warning: 'protocols rstp' is not configured",
      'configuration check succeeds',
    ].join('\n');
    expect(parseCommitCheckPassed(output)).toBe(true);
  });

  it('returns true for "commit check succeeds" variant', () => {
    expect(parseCommitCheckPassed('commit check succeeds')).toBe(true);
  });

  it('returns false when commit check fails with an error', () => {
    expect(
      parseCommitCheckPassed('error: missing required statement "root-authentication"'),
    ).toBe(false);
  });

  it('returns false for empty output', () => {
    expect(parseCommitCheckPassed('')).toBe(false);
  });

  it('returns false when output only contains error text', () => {
    const output = [
      '[edit system]',
      "  'host-name' is not set",
      'error: commit check failed',
    ].join('\n');
    expect(parseCommitCheckPassed(output)).toBe(false);
  });

  it('returns true even when staging warnings (not found) also appear in the output', () => {
    // Junos can mention "not found" warnings before the final pass line
    const output = [
      'error: 1 statement not found (during load phase)',
      'configuration check succeeds',
    ].join('\n');
    expect(parseCommitCheckPassed(output)).toBe(true);
  });

  it('previewSync returns commitCheckPassed:true independent of staging warnings', async () => {
    // Staging has a "not found" warning from the load phase, but commit check passes.
    const cmdRunner = makeCmdRunnerStub({
      __load_payload__: {
        output: 'error: 1 statement not found\nload complete\nroot@switch# ',
        matched: true,
      },
      'show | compare': { output: '' },
      __commit_check_wait__: { output: 'commit check\nconfiguration check succeeds\nroot@switch# ' },
    });
    const service = new ConfigSyncService(cmdRunner as any, makeMistApiStub([]) as any);
    const result = await service.previewSync('site-1', 'dev-1');
    expect(result.commitCheckPassed).toBe(true);
    // Staging issues are present (from load), but they should not affect commitCheckPassed
    expect(result.stagingErrors.length).toBeGreaterThan(0);
  });
});

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
      __commit_check_wait__: { output: 'commit check\nconfiguration check succeeds\nroot@switch# ' },
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
      __commit_check_wait__: { output: 'commit check\nconfiguration check succeeds\nroot@switch# ' },
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
      __commit_check_wait__: {
        output: 'commit check\nerror: missing required statement "root-authentication"\nroot@switch# ',
      },
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
      __commit_check_wait__: { output: 'commit check\nconfiguration check succeeds\nroot@switch# ' },
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
      __commit_check_wait__: { output: 'commit check\nconfiguration check succeeds\nroot@switch# ' },
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
      __commit_check_wait__: { output: 'commit check\nconfiguration check succeeds\nroot@switch# ' },
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
      __commit_check_wait__: { output: 'commit check\nconfiguration check succeeds\nroot@switch# ' },
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const service = new ConfigSyncService(cmdRunner as any, makeMistApiStub([]) as any);

    await service.previewSync('site-1', 'dev-1');

    expect(cmdRunner.sendAndWaitFor).toHaveBeenCalledTimes(3);
    const payload = cmdRunner.sendAndWaitFor.mock.calls[1][0] as string;
    expect(payload).toContain('delete protocols');
    expect(payload).toContain('delete system processes dhcp-service traceoptions');
    expect(payload.endsWith('\u0004')).toBe(true);
    expect(cmdRunner.execute).not.toHaveBeenCalledWith('delete protocols', expect.anything());
  });

  it('staged=true even when staging produces load errors', async () => {
    // Staging has a load error but commit check still passes — operator decides
    const cmdRunner = makeCmdRunnerStub({
      __load_payload__: {
        output: 'syntax error, expecting <command>\nload complete\nroot@switch# ',
        matched: true,
      },
      'show | compare': { output: '' },
      __commit_check_wait__: { output: 'commit check\nconfiguration check succeeds\nroot@switch# ' },
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const service = new ConfigSyncService(cmdRunner as any, makeMistApiStub([]) as any);

    const result = await service.previewSync('site-1', 'dev-1');
    expect(result.staged).toBe(true);
  });

  it('does NOT call rollback 0 after a successful preview', async () => {
    const cmdRunner = makeCmdRunnerStub({
      'show | compare': { output: 'diff output here' },
      __commit_check_wait__: { output: 'commit check\nconfiguration check succeeds\nroot@switch# ' },
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const service = new ConfigSyncService(cmdRunner as any, makeMistApiStub() as any);

    await service.previewSync('site-1', 'dev-1');

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const calls: string[] = (cmdRunner.execute as any).mock.calls.map((c: [string]) => c[0]);
    expect(calls).not.toContain('rollback 0');
    expect(calls).not.toContain('exit');
  });

  it('staged=true in a clean success flow', async () => {
    const cmdRunner = makeCmdRunnerStub({
      'show | compare': { output: '' },
      __commit_check_wait__: { output: 'commit check\nconfiguration check succeeds\nroot@switch# ' },
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const service = new ConfigSyncService(cmdRunner as any, makeMistApiStub() as any);

    const result = await service.previewSync('site-1', 'dev-1');
    expect(result.staged).toBe(true);
  });

  it('staged=true even when config_cmd returns no cli field', async () => {
    const cmdRunner = makeCmdRunnerStub({
      'show | compare': { output: '' },
      __commit_check_wait__: { output: 'commit check\nconfiguration check succeeds\nroot@switch# ' },
    });
    const mistApi = { getDeviceConfig: vi.fn().mockResolvedValue({}) };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const service = new ConfigSyncService(cmdRunner as any, mistApi as any);

    const result = await service.previewSync('site-1', 'dev-1');
    expect(result.staged).toBe(true);
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
        if (text === 'load set terminal\n') {
          callOrder.push('loadStart');
          return Promise.resolve({ output: '', matched: true });
        }
        if (text === 'commit check\n') {
          callOrder.push('commitCheckWait');
          return Promise.resolve({
            output: 'commit check\nconfiguration check succeeds\nroot@switch# ',
            matched: true,
          });
        }
        callOrder.push('loadPayload');
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
    expect(callOrder).toContain('commitCheckWait');
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

// =========================================================================
// Staged session state
// =========================================================================

describe('ConfigSyncService staged state', () => {
  it('hasStagedCandidate() returns false before any preview', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const service = new ConfigSyncService({} as any, {} as any);
    expect(service.hasStagedCandidate()).toBe(false);
  });

  it('hasStagedCandidate() returns true after a successful previewSync', async () => {
    const { service } = await makeServiceWithStagedCandidate();
    expect(service.hasStagedCandidate()).toBe(true);
  });

  it('sessionState is "staged" after a successful previewSync', async () => {
    const { service } = await makeServiceWithStagedCandidate();
    expect(service.sessionState).toBe('staged');
  });

  it('sessionInfo is populated after a successful previewSync', async () => {
    const { service } = await makeServiceWithStagedCandidate();
    expect(service.sessionInfo).not.toBeNull();
    expect(service.sessionInfo?.commitCheckPassed).toBe(true);
    expect(typeof service.sessionInfo?.candidateCommandCount).toBe('number');
    expect(service.sessionInfo?.blockingStagingErrorCount).toBe(0);
    expect(service.sessionInfo?.canCommit).toBe(true);
  });

  it('sessionInfo marks warning-class staging issues as non-blocking', async () => {
    const cmdRunner = makeCmdRunnerStub({
      __load_payload__: {
        output: 'syntax error: disable-port\nload complete\nroot@switch# ',
        matched: true,
      },
      'show | compare': { output: '' },
      __commit_check_wait__: {
        output: 'commit check\nconfiguration check succeeds\nroot@switch# ',
        matched: true,
      },
    });
    const service = new ConfigSyncService(cmdRunner as any, makeMistApiStub([]) as any);

    await service.previewSync('site-1', 'dev-1');

    expect(service.sessionInfo?.stagingWarningCount).toBe(1);
    expect(service.sessionInfo?.blockingStagingErrorCount).toBe(0);
    expect(service.sessionInfo?.canCommit).toBe(true);
  });

  it('sessionInfo marks hard staging failures as blocking and not safe to commit', async () => {
    const cmdRunner = makeCmdRunnerStub({
      __load_payload__: {
        output: 'syntax error, expecting <command>\nload complete\nroot@switch# ',
        matched: true,
      },
      'show | compare': { output: '' },
      __commit_check_wait__: {
        output: 'commit check\nconfiguration check succeeds\nroot@switch# ',
        matched: true,
      },
    });
    const service = new ConfigSyncService(cmdRunner as any, makeMistApiStub([]) as any);

    await service.previewSync('site-1', 'dev-1');

    expect(service.sessionInfo?.stagingWarningCount).toBe(0);
    expect(service.sessionInfo?.blockingStagingErrorCount).toBe(1);
    expect(service.sessionInfo?.canCommit).toBe(false);
  });

  it('sessionInfo marks failed commit check as not safe to commit even without staging errors', async () => {
    const cmdRunner = makeCmdRunnerStub({
      'show | compare': { output: '' },
      __commit_check_wait__: {
        output: 'commit check\nerror: commit check failed\nroot@switch# ',
        matched: true,
      },
    });
    const service = new ConfigSyncService(cmdRunner as any, makeMistApiStub([]) as any);

    await service.previewSync('site-1', 'dev-1');

    expect(service.sessionInfo?.commitCheckPassed).toBe(false);
    expect(service.sessionInfo?.blockingStagingErrorCount).toBe(0);
    expect(service.sessionInfo?.canCommit).toBe(false);
  });

  it('previewSync throws when a candidate is already staged', async () => {
    const { service } = await makeServiceWithStagedCandidate();

    await expect(service.previewSync('site-1', 'dev-1')).rejects.toThrow(
      'A config sync candidate is already staged on the switch.',
    );
  });

  it('hasStagedCandidate() returns false after reset()', async () => {
    const { service } = await makeServiceWithStagedCandidate();
    service.reset();
    expect(service.hasStagedCandidate()).toBe(false);
    expect(service.sessionState).toBe('idle');
    expect(service.sessionInfo).toBeNull();
  });
});

describe('isConfigSyncStagingWarning()', () => {
  it('treats disable-port syntax errors as warnings', () => {
    expect(
      isConfigSyncStagingWarning({
        command: 'load set terminal',
        error: 'syntax error: disable-port',
      }),
    ).toBe(true);
  });

  it('treats generic syntax errors as blocking', () => {
    expect(
      isConfigSyncStagingWarning({
        command: 'load set terminal',
        error: 'syntax error, expecting <command>',
      }),
    ).toBe(false);
  });
});

// =========================================================================
// commitSyncConfirmed()
// =========================================================================

describe('ConfigSyncService.commitSyncConfirmed()', () => {
  it('sends commit confirmed 5 comment command when staged', async () => {
    const { cmdRunner, service } = await makeServiceWithStagedCandidate();

    const result = await service.commitSyncConfirmed();

    expect(result.success).toBe(true);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const calls: string[] = (cmdRunner.execute as any).mock.calls.map((c: [string]) => c[0]);
    expect(calls).toContain('commit confirmed 5 comment "junos console config sync"');
  });

  it('exits config mode after commit confirmed', async () => {
    const { cmdRunner, service } = await makeServiceWithStagedCandidate();

    await service.commitSyncConfirmed();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const calls: string[] = (cmdRunner.execute as any).mock.calls.map((c: [string]) => c[0]);
    const commitIdx = calls.indexOf('commit confirmed 5 comment "junos console config sync"');
    const exitIdx = calls.lastIndexOf('exit');
    expect(commitIdx).toBeGreaterThanOrEqual(0);
    expect(exitIdx).toBeGreaterThan(commitIdx);
  });

  it('sessionState is "committed" after successful commitSyncConfirmed', async () => {
    const { service } = await makeServiceWithStagedCandidate();
    await service.commitSyncConfirmed();
    expect(service.sessionState).toBe('committed');
    expect(service.hasStagedCandidate()).toBe(false);
  });

  it('nudges the console and waits for prompts to settle after commit confirmed', async () => {
    const { cmdRunner, service } = await makeServiceWithStagedCandidate();

    await service.commitSyncConfirmed();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const settleCalls = (cmdRunner.sendAndWaitFor as any).mock.calls
      .map((call: unknown[]) => call[0])
      .filter((text: string) => text === '\n');
    expect(settleCalls).toHaveLength(2);
  });

  it('returns error when no staged candidate exists', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const service = new ConfigSyncService({} as any, {} as any);
    const result = await service.commitSyncConfirmed();
    expect(result.success).toBe(false);
    expect(result.error).toContain('No staged candidate');
  });
});

// =========================================================================
// commitSync()
// =========================================================================

describe('ConfigSyncService.commitSync()', () => {
  it('sends commit comment command when staged', async () => {
    const { cmdRunner, service } = await makeServiceWithStagedCandidate();

    const result = await service.commitSync();

    expect(result.success).toBe(true);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const calls: string[] = (cmdRunner.execute as any).mock.calls.map((c: [string]) => c[0]);
    expect(calls).toContain('commit comment "junos console config sync"');
  });

  it('exits config mode after commit', async () => {
    const { cmdRunner, service } = await makeServiceWithStagedCandidate();

    await service.commitSync();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const calls: string[] = (cmdRunner.execute as any).mock.calls.map((c: [string]) => c[0]);
    const commitIdx = calls.indexOf('commit comment "junos console config sync"');
    const exitIdx = calls.lastIndexOf('exit');
    expect(commitIdx).toBeGreaterThanOrEqual(0);
    expect(exitIdx).toBeGreaterThan(commitIdx);
  });

  it('sessionState is "committed" after successful commitSync', async () => {
    const { service } = await makeServiceWithStagedCandidate();
    await service.commitSync();
    expect(service.sessionState).toBe('committed');
    expect(service.hasStagedCandidate()).toBe(false);
  });

  it('nudges the console and waits for prompts to settle after commit', async () => {
    const { cmdRunner, service } = await makeServiceWithStagedCandidate();

    await service.commitSync();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const settleCalls = (cmdRunner.sendAndWaitFor as any).mock.calls
      .map((call: unknown[]) => call[0])
      .filter((text: string) => text === '\n');
    expect(settleCalls).toHaveLength(2);
  });

  it('returns error when no staged candidate exists', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const service = new ConfigSyncService({} as any, {} as any);
    const result = await service.commitSync();
    expect(result.success).toBe(false);
    expect(result.error).toContain('No staged candidate');
  });
});

// =========================================================================
// rollbackSync()
// =========================================================================

describe('ConfigSyncService.rollbackSync()', () => {
  it('sends rollback 0 when staged', async () => {
    const { cmdRunner, service } = await makeServiceWithStagedCandidate();

    const result = await service.rollbackSync();

    expect(result.success).toBe(true);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const calls: string[] = (cmdRunner.execute as any).mock.calls.map((c: [string]) => c[0]);
    expect(calls).toContain('rollback 0');
  });

  it('exits config mode after rollback', async () => {
    const { cmdRunner, service } = await makeServiceWithStagedCandidate();

    await service.rollbackSync();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const calls: string[] = (cmdRunner.execute as any).mock.calls.map((c: [string]) => c[0]);
    const rollbackIdx = calls.indexOf('rollback 0');
    const exitIdx = calls.lastIndexOf('exit');
    expect(rollbackIdx).toBeGreaterThanOrEqual(0);
    expect(exitIdx).toBeGreaterThan(rollbackIdx);
  });

  it('sessionState is "rolled_back" after rollbackSync', async () => {
    const { service } = await makeServiceWithStagedCandidate();
    await service.rollbackSync();
    expect(service.sessionState).toBe('rolled_back');
    expect(service.hasStagedCandidate()).toBe(false);
  });

  it('nudges the console and waits for prompts to settle after rollback', async () => {
    const { cmdRunner, service } = await makeServiceWithStagedCandidate();

    await service.rollbackSync();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const settleCalls = (cmdRunner.sendAndWaitFor as any).mock.calls
      .map((call: unknown[]) => call[0])
      .filter((text: string) => text === '\n');
    expect(settleCalls).toHaveLength(2);
  });

  it('returns error when no staged candidate exists', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const service = new ConfigSyncService({} as any, {} as any);
    const result = await service.rollbackSync();
    expect(result.success).toBe(false);
    expect(result.error).toContain('No staged candidate');
  });

  it('rollback clears sessionInfo', async () => {
    const { service } = await makeServiceWithStagedCandidate();
    expect(service.sessionInfo).not.toBeNull();
    await service.rollbackSync();
    expect(service.sessionInfo).toBeNull();
  });
});
