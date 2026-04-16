/**
 * config-sync.service.ts — Mist config sync preview workflow
 *
 * Implements the non-destructive first-pass config sync preview:
 *   1. Fetch Mist intended config via config_cmd
 *   2. Build a candidate command list (cleanup deletes + filtered CLI lines)
 *   3. Stage the candidate visibly in Junos config mode
 *   4. Capture `show | compare` diff output
 *   5. Run `commit check`
 *   6. Always roll back and exit — the running config is NEVER changed
 *
 * Commands remain visible in the terminal because this is an
 * operator-invoked workflow. Silent execution is intentionally avoided.
 */

import { MistApiService } from './mist-api.service';
import { CommandRunnerService } from './command-runner.service';

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
  /** True when `rollback 0` completed and we exited config mode cleanly. */
  rolledBack: boolean;
}

export class ConfigSyncService {
  private readonly cmdRunner: CommandRunnerService;
  private readonly mistApi: MistApiService;

  constructor(cmdRunner: CommandRunnerService, mistApi: MistApiService) {
    this.cmdRunner = cmdRunner;
    this.mistApi = mistApi;
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
   * Run the full config sync preview workflow (non-destructive).
   *
   * Fetches the Mist intended config, stages it in Junos config mode,
   * captures the diff and commit check result, then always rolls back.
   * The switch's running config is NEVER committed or changed.
   *
   * Commands are executed visibly (operator workflow — not silent).
   */
  async previewSync(siteId: string, deviceId: string): Promise<ConfigSyncPreviewResult> {
    const stagingErrors: ConfigSyncStagingError[] = [];
    let compareOutput = '';
    let commitCheckOutput = '';
    let commitCheckPassed = false;
    let rolledBack = false;
    let enteredConfigMode = false;

    // 1. Fetch Mist intended config
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const configCmd = await this.mistApi.getDeviceConfig(siteId, deviceId) as any;
    const cliLines: string[] = Array.isArray(configCmd?.cli) ? configCmd.cli : [];

    // 2. Build candidate
    const candidate = this.buildCandidate(cliLines);
    const cleanupCount = MIST_CLEANUP_DELETES.length;
    const mistCliCount = candidate.length - cleanupCount;

    try {
      // 3. Refuse to run inside an existing config session. `rollback 0`
      // would clear the operator's uncommitted candidate, which is not safe
      // for a preview workflow.
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

      // 7. Validate the candidate — must not commit
      const checkResult = await this.cmdRunner.execute('commit check', 30000, 3000);
      commitCheckOutput = checkResult.output.trim();
      commitCheckPassed =
        /configuration check succeeds/i.test(commitCheckOutput) ||
        /commit check succeeds/i.test(commitCheckOutput);

    } finally {
      // 8. Always roll back and exit config mode — non-destructive guarantee
      if (enteredConfigMode) {
        try {
          await this.cmdRunner.execute('rollback 0', 10000);
          await this.cmdRunner.execute('exit', 5000);
          rolledBack = true;
        } catch {
          // If rollback itself fails, at least attempt to leave config mode
          try {
            await this.cmdRunner.execute('exit', 5000);
          } catch { /* ignored */ }
        }
      }
    }

    return {
      candidateCommandCount: candidate.length,
      cleanupCommandCount: cleanupCount,
      mistCliCommandCount: mistCliCount,
      compareOutput,
      commitCheckOutput,
      commitCheckPassed,
      stagingErrors,
      rolledBack,
    };
  }
}
