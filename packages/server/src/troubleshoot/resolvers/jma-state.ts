import type { TroubleshootContext } from '@marvis/shared';
import type { CliExecutor } from '../runner.js';

export default async function resolveJmaState(
  cli: CliExecutor,
  _ctx: TroubleshootContext,
): Promise<Partial<TroubleshootContext>> {
  const out = await cli.run('show system jma').catch(() => '');
  const stateMatch = out.match(/JMA State\s*:\s*(\d+)/i);
  const epMatch = out.match(/JMA Connected to\s*:\s*(\S+)/i);

  return {
    ...(stateMatch && { jmaState: parseInt(stateMatch[1]!, 10) }),
    ...(epMatch?.[1] && { mistEndpoint: epMatch[1] }),
  };
}
