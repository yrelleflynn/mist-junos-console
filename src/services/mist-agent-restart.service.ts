import { CommandRunnerService } from './command-runner.service';

export interface MistAgentProcessState {
  hasMcd: boolean;
  hasJmd: boolean;
  detail: string;
  raw: string;
}

export interface MistAgentRestartResult {
  before: MistAgentProcessState;
  after: MistAgentProcessState;
  restartCommand: string;
  restartAccepted: boolean;
  restartOutput: string;
  errors: string[];
}

export type MistAgentRestartStepStatus = 'running' | 'completed';

export interface MistAgentRestartStep {
  key: 'check-before' | 'restart-agent' | 'wait-restart' | 'check-after';
  label: string;
  status: MistAgentRestartStepStatus;
}

const POST_RESTART_MAX_WAIT_MS = 90000;
const POST_RESTART_POLL_MS = 5000;
const RESTART_COMMAND = 'request extension-service restart-daemonize-app mcd';

export class MistAgentRestartService {
  constructor(private readonly runner: CommandRunnerService) {}

  async restart(onStep?: (step: MistAgentRestartStep) => void): Promise<MistAgentRestartResult> {
    const errors: string[] = [];
    const reportStep = (
      key: MistAgentRestartStep['key'],
      label: string,
      status: MistAgentRestartStepStatus,
    ): void => {
      onStep?.({ key, label, status });
    };

    reportStep('check-before', 'Checking Mist agent processes before restart', 'running');
    const before = await this.readProcessState({ silent: true });
    reportStep('check-before', 'Checked Mist agent processes before restart', 'completed');

    reportStep('restart-agent', 'Restarting Mist agent daemon (mcd)', 'running');
    const restartResult = await this.runner.execute(RESTART_COMMAND, 30000, 3000);
    const restartOutput = (restartResult.output || restartResult.error || '').trim();
    const restartAccepted = restartResult.success
      && /restarted successfully|application restarted successfully|exited with return/i.test(restartOutput)
      && !/invalid script name|unknown command|syntax error/i.test(restartOutput);
    reportStep(
      'restart-agent',
      restartAccepted ? 'Restarted Mist agent daemon (mcd)' : 'Mist agent restart command failed',
      'completed',
    );

    if (!restartAccepted) {
      errors.push(restartOutput || 'Mist agent restart command failed.');
    }

    reportStep('wait-restart', 'Waiting for mcd and jmd to settle after restart (up to 90 seconds)', 'running');
    reportStep('check-after', 'Checking Mist agent processes after restart', 'running');
    const after = await this.waitForProcessRecovery();
    reportStep('check-after', 'Checked Mist agent processes after restart', 'completed');
    reportStep('wait-restart', 'Finished waiting for mcd and jmd after restart', 'completed');

    if (!after.hasMcd) {
      errors.push('mcd is still not running after the restart attempt.');
    }
    if (!after.hasJmd) {
      errors.push('jmd did not return within the restart wait window.');
    }

    return {
      before,
      after,
      restartCommand: RESTART_COMMAND,
      restartAccepted,
      restartOutput,
      errors,
    };
  }

  private async readProcessState(options: { silent?: boolean } = {}): Promise<MistAgentProcessState> {
    try {
      await this.runner.ensureShellMode({ silent: options.silent });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        hasMcd: false,
        hasJmd: false,
        detail: 'Could not check processes — shell access may be restricted',
        raw: message,
      };
    }

    const cmd = await this.runner.execute('/bin/sh -c \'ps aux | grep -E "mcd|jmd" | grep -v grep\'', 15000, 2000, {
      silent: options.silent,
    });

    await this.runner.ensureOperationalMode({ silent: options.silent });

    if (!cmd.success) {
      return {
        hasMcd: false,
        hasJmd: false,
        detail: 'Could not check processes — shell access may be restricted',
        raw: cmd.output || cmd.error || '',
      };
    }

    return this.parseProcessState(cmd.output);
  }

  private async waitForProcessRecovery(): Promise<MistAgentProcessState> {
    const startedAt = Date.now();
    let latest = await this.readProcessState({ silent: true });

    while (Date.now() - startedAt < POST_RESTART_MAX_WAIT_MS) {
      if (latest.hasMcd && latest.hasJmd) {
        return latest;
      }
      await new Promise<void>((resolve) => setTimeout(resolve, POST_RESTART_POLL_MS));
      latest = await this.readProcessState({ silent: true });
    }

    return latest;
  }

  private parseProcessState(output: string): MistAgentProcessState {
    const lines = output.split('\n').filter((line) => line.trim().length > 0);
    const hasMcd = lines.some((line) => /\/mcd\b/.test(line) || /\bmcd\s/.test(line));
    const hasJmd = lines.some((line) => /\/jmd\b/.test(line) || /\bjmd\s/.test(line));

    let detail = 'Neither mcd nor jmd found';
    if (hasMcd && hasJmd) detail = 'mcd and jmd running';
    else if (hasMcd) detail = 'mcd running, jmd not found';
    else if (hasJmd) detail = 'jmd running, mcd not found';

    return {
      hasMcd,
      hasJmd,
      detail,
      raw: output,
    };
  }
}
