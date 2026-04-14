/**
 * base.ts — Shared types for the modular check system.
 *
 * Each check lives in its own file and exports an object implementing Check.
 * The CheckContext is passed to every check's run() method.
 */

import type { CommandRunnerService } from '../services/command-runner.service';
import type { MistApiService } from '../services/mist-api.service';
import type { MistCloud } from '../config/mist-clouds.config';

// Import and re-export core result types so check files only need to import from base
import type { CheckResult, CheckStatus } from '../services/troubleshoot.service';
export type { CheckResult, CheckStatus };

/** Context passed to every check's run() method */
export interface CheckContext {
  runner: CommandRunnerService;
  cloud?: MistCloud;
  uplinkPort?: string;
  mgmtIp?: string | null;
  mistApi?: MistApiService;
  siteId?: string;
  deviceId?: string;
  /** Show a password prompt to the user; returns the entered password or null if cancelled. */
  promptPassword?: (message: string) => Promise<string | null>;
}

/** Interface every check file must implement */
export interface Check {
  id: string;
  name: string;
  /** If true, a fail result aborts the remaining checks in runAll() */
  critical?: boolean;
  run(ctx: CheckContext): Promise<CheckResult | { result: CheckResult; [key: string]: unknown }>;
  remediation?(result: CheckResult, allResults: CheckResult[]): { text?: string; commands?: string[] };
}
