/**
 * base.ts — Shared types for the modular check system.
 *
 * Each check lives in its own file and exports an object (or factory function)
 * implementing the Check interface. The CheckContext is passed to every check's
 * run() method so checks are stateless and independently testable.
 */

import type { CommandRunnerService } from '../services/command-runner.service';
import type { MistApiService } from '../services/mist-api.service';
import type { MistCloud } from '../config/mist-clouds.config';

// Re-export core result types so check files only need to import from base.
import type { CheckResult, CheckStatus } from '../services/troubleshoot.service';
export type { CheckResult, CheckStatus };

/** Context passed to every check's run() method. */
export interface CheckContext {
  runner: CommandRunnerService;
  /** Selected Mist cloud region — required for DNS/endpoint/cloud checks. */
  cloud?: MistCloud;
  /** Uplink port name (e.g. "ge-0/0/0") — may be auto-detected by lldpCheck. */
  uplinkPort: string;
  /** Management IP — set after interfaceIpCheck completes. */
  mgmtIp?: string | null;
  mistApi?: MistApiService;
  siteId?: string;
  deviceId?: string;
}

/**
 * Interface every check file must implement.
 *
 * run() may return either:
 *   - a plain CheckResult                      (simple checks)
 *   - { result: CheckResult; [key]: unknown }  (checks that pass extra data back to the orchestrator)
 *
 * Callers use the helper:
 *   const result = 'result' in raw ? raw.result : raw as CheckResult;
 */
export interface Check {
  id: string;
  name: string;
  /** If true, a fail result causes runAll() to skip remaining checks. */
  critical?: boolean;
  run(ctx: CheckContext): Promise<CheckResult | { result: CheckResult; [key: string]: unknown }>;
}
