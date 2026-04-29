import type { TroubleshootContext } from '@marvis/shared';
import type { CliExecutor } from '../runner.js';

export default async function resolveUplinkPort(
  cli: CliExecutor,
  _ctx: TroubleshootContext,
): Promise<Partial<TroubleshootContext>> {
  const lldp = await cli.run('show lldp neighbors').catch(() => '');
  const uplinkPort = parseLldpUplink(lldp);
  if (!uplinkPort) return {};

  const ifaceOut = await cli.run(`show interfaces ${uplinkPort}`).catch(() => '');
  const uplinkPortStatus = parseIfaceStatus(ifaceOut);
  const uplinkPortErrors = parseIfaceErrors(ifaceOut);

  return { uplinkPort, uplinkPortStatus, uplinkPortErrors };
}

function parseLldpUplink(output: string): string | undefined {
  for (const line of output.split('\n')) {
    // Match first interface column: "et-0/0/49   00:11:22:33:44:55  ..."
    const m = line.match(/^((?:et|xe|ge)-\d+\/\d+\/\d+)/);
    if (m) return m[1];
  }
  return undefined;
}

function parseIfaceStatus(output: string): 'up' | 'down' | 'unknown' {
  if (/Physical link is Up/i.test(output)) return 'up';
  if (/Physical link is Down/i.test(output)) return 'down';
  return 'unknown';
}

function parseIfaceErrors(output: string): { input: number; output: number } {
  const inp = output.match(/Input\s+errors:\s+(\d+)/i);
  const out = output.match(/Output\s+errors:\s+(\d+)/i);
  return {
    input: inp ? parseInt(inp[1]!, 10) : 0,
    output: out ? parseInt(out[1]!, 10) : 0,
  };
}
