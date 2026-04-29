import { CHECKS, RESOLVERS } from '@marvis/shared';
import type {
  CheckId,
  CheckResult,
  CheckStatus,
  TroubleshootContext,
} from '@marvis/shared';
import { hub } from '../ws/hub.js';

/** Executes a CLI command on the switch and returns stdout as a string. */
export interface CliExecutor {
  run(command: string, timeoutMs?: number): Promise<string>;
}

type CheckImpl = (context: TroubleshootContext, cli: CliExecutor) => Promise<CheckResult>;

type ResolverImpl = (
  cli: CliExecutor,
  ctx: TroubleshootContext,
) => Promise<Partial<TroubleshootContext>>;

// Populated by individual check modules calling registerCheck() at load time.
const registry = new Map<CheckId, CheckImpl>();

export function registerCheck(id: CheckId, impl: CheckImpl): void {
  registry.set(id, impl);
}

async function buildContext(
  cli: CliExecutor,
  baseContext: Partial<TroubleshootContext>,
): Promise<TroubleshootContext> {
  let ctx: TroubleshootContext = { ...baseContext } as TroubleshootContext;

  for (const resolver of RESOLVERS) {
    const needsMet = (resolver.needs ?? []).every(
      (field) => ctx[field as keyof TroubleshootContext] !== undefined,
    );
    if (!needsMet) continue;

    try {
      const mod = await import(`./resolvers/${resolver.id}.js`).catch(() => null) as
        | { default: ResolverImpl }
        | null;
      if (!mod) continue;
      const patch = await mod.default(cli, ctx);
      ctx = { ...ctx, ...patch };
    } catch (err) {
      console.error(`[runner] resolver ${resolver.id} failed:`, err);
    }
  }

  return ctx;
}

export async function runAllChecks(
  sessionId: string,
  cli: CliExecutor,
  baseContext: Partial<TroubleshootContext> = {},
): Promise<CheckResult[]> {
  const ctx = await buildContext(cli, baseContext);
  const results: CheckResult[] = [];
  const failed = new Set<CheckId>();

  for (const def of CHECKS) {
    const blockedBy = def.gates?.find((g) => failed.has(g));
    if (blockedBy) {
      const result: CheckResult = {
        checkId: def.id,
        status: 'skip',
        summary: `Skipped — gate check '${blockedBy}' failed`,
        skipReason: blockedBy,
      };
      results.push(result);
      hub.broadcast(sessionId, {
        type: 'check:progress',
        sessionId,
        checkId: def.id,
        status: 'skip',
        summary: result.summary,
      });
      continue;
    }

    const missingField = def.needs.find(
      (field) => ctx[field as keyof TroubleshootContext] === undefined,
    );
    if (missingField) {
      const result: CheckResult = {
        checkId: def.id,
        status: 'skip',
        summary: `Skipped — required context '${missingField}' not available`,
        skipReason: missingField,
      };
      results.push(result);
      hub.broadcast(sessionId, {
        type: 'check:progress',
        sessionId,
        checkId: def.id,
        status: 'skip',
        summary: result.summary,
      });
      continue;
    }

    hub.broadcast(sessionId, {
      type: 'check:progress',
      sessionId,
      checkId: def.id,
      status: 'running',
      summary: 'Running…',
    });

    const result = await executeCheck(def.id, ctx, cli);
    results.push(result);

    if (result.status === 'fail' || result.status === 'error') {
      failed.add(def.id);
    }

    hub.broadcast(sessionId, {
      type: 'check:result',
      sessionId,
      checkId: def.id,
      result,
    });
  }

  hub.broadcast(sessionId, { type: 'check:complete', sessionId });
  return results;
}

export async function runCheck(
  checkId: CheckId,
  sessionId: string,
  cli: CliExecutor,
  baseContext: Partial<TroubleshootContext> = {},
): Promise<CheckResult> {
  const ctx = await buildContext(cli, baseContext);
  return executeCheck(checkId, ctx, cli);
}

async function executeCheck(
  checkId: CheckId,
  ctx: TroubleshootContext,
  cli: CliExecutor,
): Promise<CheckResult> {
  const impl = registry.get(checkId);
  if (!impl) {
    return {
      checkId,
      status: 'error' as CheckStatus,
      summary: `No implementation registered for check '${checkId}'`,
    };
  }

  const start = Date.now();
  try {
    const result = await impl(ctx, cli);
    return { ...result, durationMs: Date.now() - start };
  } catch (err) {
    return {
      checkId,
      status: 'error' as CheckStatus,
      summary: 'Check threw an unexpected error',
      detail: err instanceof Error ? err.message : String(err),
      durationMs: Date.now() - start,
    };
  }
}
