/**
 * config-sync.service.ts — Mist config sync staged workflow
 *
 * Implements a staged, operator-confirmed config sync flow:
 *   1. Fetch Mist intended config via config_cmd
 *   2. Build a candidate command list (cleanup deletes + filtered CLI lines)
 *   3. Stage the candidate in Junos config mode
 *   4. Capture `show | compare` diff output
 *   5. Run `commit check`
 *   6. STOP — leave the candidate staged and wait for operator decision
 *
 * Explicit operator actions (after preview):
 *   - commitSyncConfirmed() — commit confirmed 5 + exit
 *   - commitSync()          — commit + exit
 *   - rollbackSync()        — rollback 0 + exit
 *
 * Commands remain visible in the terminal because this is an
 * operator-invoked workflow. Silent execution is intentionally avoided.
 */

import { MistApiService } from './mist-api.service';
import { CommandRunnerService, stripCommandEcho } from './command-runner.service';

/**
 * Cleanup delete commands Mist prepends before applying intended set commands.
 * These clear Mist-managed config domains so the full intended config can be
 * applied cleanly. Order is significant and must match Mist behavior.
 */
export const MIST_CLEANUP_DELETES: readonly string[] = [
  'delete protocols',
  'delete interfaces',
  'delete apply-groups',
  'delete groups',
  'delete vlans',
  'delete system syslog',
  'delete snmp',
  'delete firewall',
  'delete routing-instances',
  'delete forwarding-options',
  'delete policy-options',
  'delete system ntp',
  'delete system name-server',
  'delete routing-options',
  'delete system time-zone',
  'delete system host-name',
  'delete virtual-chassis',
  'delete class-of-service',
  'delete access',
  'delete system processes dhcp-service traceoptions',
] as const;

/** Junos output patterns that indicate a staged command was rejected. */
const JUNOS_ERROR_PATTERNS = [
  /syntax error/i,
  /unknown command/i,
  /invalid input detected/i,
  /error:/i,
  /command not found/i,
];

const STAGING_WARNING_PATTERNS = [
  /statement not found/i,
  /warning:/i,
  /\bnot found\b/i,
  /syntax error:.*disable-port/i,
  /syntax error:.*interactive-commands match/i,
  /unknown command:.*disable-port/i,
];

function looksLikeJunosError(output: string): boolean {
  return JUNOS_ERROR_PATTERNS.some((p) => p.test(output));
}

function extractLoadErrors(output: string): ConfigSyncStagingError[] {
  const lines = output
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  return lines
    .filter((line) => looksLikeJunosError(line))
    .map((line) => ({
      command: 'load set terminal',
      error: line,
    }));
}

export interface ConfigSyncStagingError {
  command: string;
  error: string;
}

export function isConfigSyncStagingWarning(issue: ConfigSyncStagingError): boolean {
  return (
    issue.command === 'load set terminal' &&
    STAGING_WARNING_PATTERNS.some((pattern) => pattern.test(issue.error))
  );
}

/**
 * Config sync session lifecycle states.
 *
 * idle        — no active staged session
 * staged      — candidate is loaded on the switch, awaiting operator decision
 * committing  — a commit action is in progress
 * committed   — commit completed successfully
 * rolled_back — rollback completed successfully
 * failed      — commit or rollback encountered an error
 */
export type ConfigSyncState =
  | 'idle'
  | 'staged'
  | 'committing'
  | 'committed'
  | 'rolled_back'
  | 'failed';

/**
 * Summary of the currently staged session.
 * Available while `hasStagedCandidate()` returns true.
 */
export interface ConfigSyncSessionInfo {
  commitCheckPassed: boolean;
  candidateCommandCount: number;
  compareOutput: string;
  stagingWarningCount: number;
  blockingStagingErrorCount: number;
  canCommit: boolean;
}

/**
 * Result of a commitSyncConfirmed / commitSync / rollbackSync call.
 */
export interface ConfigSyncActionResult {
  success: boolean;
  /** Raw Junos output from the commit or rollback command. */
  output: string;
  /** Human-readable error if success is false. */
  error?: string;
}

/**
 * Parse raw `commit check` output and return whether the check passed.
 *
 * Junos says `configuration check succeeds` on success, even when the output
 * also contains warnings or informational lines about unchanged stanzas.
 * Staging errors from the load phase are NOT relevant here — this function
 * checks only the output of the `commit check` command itself.
 */
export function parseCommitCheckPassed(output: string): boolean {
  return (
    /configuration check succeeds/i.test(output) ||
    /commit check succeeds/i.test(output)
  );
}

export interface ConfigSyncPreviewResult {
  /** Total commands staged (cleanup + Mist CLI). */
  candidateCommandCount: number;
  /** Number of cleanup delete commands at the front of the candidate. */
  cleanupCommandCount: number;
  /** Number of set commands from Mist intent (after filtering). */
  mistCliCommandCount: number;
  /** Raw output of `show | compare`. Empty string if nothing changed. */
  compareOutput: string;
  /** Raw output of `commit check`. */
  commitCheckOutput: string;
  /** True when commit check output indicates validation succeeded. */
  commitCheckPassed: boolean;
  /** Commands that produced Junos error output during staging. */
  stagingErrors: ConfigSyncStagingError[];
  /**
   * True when the candidate is now staged on the switch.
   * The operator must call commitSyncConfirmed / commitSync / rollbackSync.
   */
  staged: boolean;
}

export class ConfigSyncService {
  private readonly cmdRunner: CommandRunnerService;
  private readonly mistApi: MistApiService;

  private _sessionState: ConfigSyncState = 'idle';
  private _sessionInfo: ConfigSyncSessionInfo | null = null;

  constructor(cmdRunner: CommandRunnerService, mistApi: MistApiService) {
    this.cmdRunner = cmdRunner;
    this.mistApi = mistApi;
  }

  /** Current lifecycle state of the config sync session. */
  get sessionState(): ConfigSyncState {
    return this._sessionState;
  }

  /**
   * Summary of the staged candidate, or null when no candidate is staged.
   * Populated by previewSync() and cleared by commit / rollback.
   */
  get sessionInfo(): ConfigSyncSessionInfo | null {
    return this._sessionInfo;
  }

  /** True when a candidate is currently staged on the switch. */
  hasStagedCandidate(): boolean {
    return this._sessionState === 'staged';
  }

  /**
   * Reset service state to idle.
   * Call when the serial connection drops so the service does not retain
   * stale staged-session state after the switch exits config mode on its own.
   */
  reset(): void {
    this._sessionState = 'idle';
    this._sessionInfo = null;
  }

  /**
   * Build a candidate command list from Mist `config_cmd` CLI lines.
   *
   * Prepends the known Mist cleanup delete commands, then appends the
   * filtered CLI lines. Blank lines and lines starting with `#` are dropped.
   * Line trimming happens before filtering.
   */
  buildCandidate(cli: string[]): string[] {
    const mistLines = cli
      .map((l) => l.trim())
      .filter((l) => l.length > 0 && !l.startsWith('#'));
    return [...MIST_CLEANUP_DELETES, ...mistLines];
  }

  /**
   * Run `commit check` with a longer, result-aware wait than the generic
   * command executor. Lower-spec switches such as EX2300 can pause for a long
   * time before printing the final result, and the preview must not proceed
   * until that result and the config prompt have returned.
   */
  private async runCommitCheck(): Promise<{ output: string; passed: boolean }> {
    const result = await this.cmdRunner.sendAndWaitFor(
      'commit check\n',
      /(?:configuration check succeeds|commit check succeeds|commit check failed|error:)[\s\S]*#\s*$/i,
      120000,
    );

    const output = stripCommandEcho(result.output, 'commit check').trim();
    return {
      output,
      passed: parseCommitCheckPassed(output),
    };
  }

  /**
   * Stage the Mist intended config on the switch and run commit check.
   *
   * The candidate is LEFT STAGED on the switch — the running config is NOT
   * changed. The operator must then call commitSyncConfirmed(), commitSync(),
   * or rollbackSync().
   *
   * If the preview itself fails (exception thrown before completing), the
   * method rolls back and exits config mode to leave the switch clean.
   *
   * Commands are executed visibly (operator workflow — not silent).
   */
  async previewSync(siteId: string, deviceId: string): Promise<ConfigSyncPreviewResult> {
    const stagingErrors: ConfigSyncStagingError[] = [];
    let compareOutput = '';
    let commitCheckOutput = '';
    let commitCheckPassed = false;
    let enteredConfigMode = false;
    let shouldLeaveStaged = false;

    // Guard: refuse if we already own a staged candidate
    if (this.hasStagedCandidate()) {
      throw new Error(
        'A config sync candidate is already staged on the switch. Commit or roll back before starting a new preview.',
      );
    }

    // 1. Fetch Mist intended config
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const configCmd = await this.mistApi.getDeviceConfig(siteId, deviceId) as any;
    const cliLines: string[] = Array.isArray(configCmd?.cli) ? configCmd.cli : [];

    // 2. Build candidate
    const candidate = this.buildCandidate(cliLines);
    const cleanupCount = MIST_CLEANUP_DELETES.length;
    const mistCliCount = candidate.length - cleanupCount;

    try {
      // 3. Refuse to run inside an existing config session not owned by this
      //    service. `rollback 0` would clear the operator's uncommitted
      //    candidate, which is not safe.
      const startingMode = await this.cmdRunner.detectMode();
      if (startingMode === 'config') {
        throw new Error(
          'Config sync preview cannot run while already in configuration mode. Exit, commit, or roll back the current candidate first.',
        );
      }

      // 4. Enter config mode — visible, operator-invoked workflow
      await this.cmdRunner.ensureConfigMode();
      enteredConfigMode = true;

      // 5. Bulk-load the candidate for speed using Junos-native terminal loading.
      const loadStart = await this.cmdRunner.sendAndWaitFor(
        'load set terminal\n',
        /(?:Ctrl-D|control-d|new line to end input|#\s*$)/i,
        10000,
      );
      if (!loadStart.matched) {
        stagingErrors.push({
          command: 'load set terminal',
          error: 'Timed out waiting for load set terminal prompt.',
        });
      } else {
        const payload = `${candidate.join('\n')}\n\u0004`;
        const loadResult = await this.cmdRunner.sendAndWaitFor(
          payload,
          /#\s*$/i,
          Math.max(30000, candidate.length * 150),
        );

        if (!loadResult.matched) {
          stagingErrors.push({
            command: 'load set terminal',
            error: 'Timed out waiting for config load to finish.',
          });
        }

        stagingErrors.push(...extractLoadErrors(loadResult.output));
      }

      // 6. Capture diff between staged candidate and committed config
      const compareResult = await this.cmdRunner.execute('show | compare', 60000, 3000);
      compareOutput = compareResult.output.trim();

      // 7. Validate the candidate (non-destructive — does not commit)
      const checkResult = await this.runCommitCheck();
      commitCheckOutput = checkResult.output;
      commitCheckPassed = checkResult.passed;

      // All steps completed — mark for staged state rather than rollback
      shouldLeaveStaged = true;

    } finally {
      if (enteredConfigMode && !shouldLeaveStaged) {
        // Something went wrong before the preview completed — clean up
        try {
          await this.cmdRunner.execute('rollback 0', 10000);
          await this.cmdRunner.execute('exit', 5000);
        } catch {
          try {
            await this.cmdRunner.execute('exit', 5000);
          } catch { /* ignored */ }
        }
        this._sessionState = 'idle';
        this._sessionInfo = null;
      }
    }

    if (shouldLeaveStaged) {
      const stagingWarningCount = stagingErrors.filter(isConfigSyncStagingWarning).length;
      const blockingStagingErrorCount = stagingErrors.length - stagingWarningCount;
      this._sessionState = 'staged';
      this._sessionInfo = {
        commitCheckPassed,
        candidateCommandCount: candidate.length,
        compareOutput,
        stagingWarningCount,
        blockingStagingErrorCount,
        canCommit: commitCheckPassed && blockingStagingErrorCount === 0,
      };
    }

    return {
      candidateCommandCount: candidate.length,
      cleanupCommandCount: cleanupCount,
      mistCliCommandCount: mistCliCount,
      compareOutput,
      commitCheckOutput,
      commitCheckPassed,
      stagingErrors,
      staged: shouldLeaveStaged,
    };
  }

  /**
   * Commit with a 5-minute auto-rollback safety window.
   *
   * Sends: `commit confirmed 5 comment "junos console config sync"`
   * Then:  `exit`
   *
   * The config is applied immediately. If `commit` is not run within 5 minutes,
   * Junos automatically rolls back. The operator can re-enter config mode and
   * run `commit` from the terminal to permanently lock in the config.
   */
  async commitSyncConfirmed(): Promise<ConfigSyncActionResult> {
    if (!this.hasStagedCandidate()) {
      return { success: false, output: '', error: 'No staged candidate to commit.' };
    }

    this._sessionState = 'committing';
    try {
      const result = await this.cmdRunner.execute(
        'commit confirmed 5 comment "junos console config sync"',
        120000,
        3000,
      );
      await this.cmdRunner.execute('exit', 5000);

      if (result.success) {
        this._sessionState = 'committed';
        this._sessionInfo = null;
        return { success: true, output: result.output };
      } else {
        this._sessionState = 'failed';
        return {
          success: false,
          output: result.output,
          error: result.error ?? 'Commit confirmed command failed.',
        };
      }
    } catch (err) {
      this._sessionState = 'failed';
      return {
        success: false,
        output: '',
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  /**
   * Commit the staged candidate permanently.
   *
   * Sends: `commit comment "junos console config sync"`
   * Then:  `exit`
   */
  async commitSync(): Promise<ConfigSyncActionResult> {
    if (!this.hasStagedCandidate()) {
      return { success: false, output: '', error: 'No staged candidate to commit.' };
    }

    this._sessionState = 'committing';
    try {
      const result = await this.cmdRunner.execute(
        'commit comment "junos console config sync"',
        120000,
        3000,
      );
      await this.cmdRunner.execute('exit', 5000);

      if (result.success) {
        this._sessionState = 'committed';
        this._sessionInfo = null;
        return { success: true, output: result.output };
      } else {
        this._sessionState = 'failed';
        return {
          success: false,
          output: result.output,
          error: result.error ?? 'Commit command failed.',
        };
      }
    } catch (err) {
      this._sessionState = 'failed';
      return {
        success: false,
        output: '',
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  /**
   * Roll back the staged candidate and exit config mode.
   *
   * Sends: `rollback 0`
   * Then:  `exit`
   *
   * The switch returns to its committed running config.
   */
  async rollbackSync(): Promise<ConfigSyncActionResult> {
    if (!this.hasStagedCandidate()) {
      return { success: false, output: '', error: 'No staged candidate to roll back.' };
    }

    try {
      const rbResult = await this.cmdRunner.execute('rollback 0', 10000);
      await this.cmdRunner.execute('exit', 5000);

      this._sessionState = 'rolled_back';
      this._sessionInfo = null;
      return { success: true, output: rbResult.output };
    } catch (err) {
      this._sessionState = 'failed';
      return {
        success: false,
        output: '',
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }
}
