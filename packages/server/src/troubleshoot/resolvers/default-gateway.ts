import type { TroubleshootContext } from '@marvis/shared';
import type { CliExecutor } from '../runner.js';

export default async function resolveDefaultGateway(
  cli: CliExecutor,
  _ctx: TroubleshootContext,
): Promise<Partial<TroubleshootContext>> {
  const out = await cli.run('show route 0.0.0.0/0').catch(() => '');
  const gw = parseGateway(out);
  return gw ? { defaultGateway: gw } : {};
}

function parseGateway(output: string): string | undefined {
  // "> to 192.168.1.1 via irb.0"
  const direct = output.match(/>\s+to\s+([\d.]+)/);
  if (direct) return direct[1];
  // "via 192.168.1.1" fallback
  const via = output.match(/via\s+([\d.]+)/);
  return via ? via[1] : undefined;
}
