import type { TroubleshootContext } from '@marvis/shared';
import type { CliExecutor } from '../runner.js';

export default async function resolveDnsServers(
  cli: CliExecutor,
  _ctx: TroubleshootContext,
): Promise<Partial<TroubleshootContext>> {
  const out = await cli.run('show system name-servers').catch(() => '');
  const dnsServers = parseDnsServers(out);
  return dnsServers.length > 0 ? { dnsServers } : {};
}

function parseDnsServers(output: string): string[] {
  const servers: string[] = [];
  for (const line of output.split('\n')) {
    // "192.168.1.1       Yes"  or  "8.8.8.8"
    const m = line.match(/^\s*([\d.]+)/);
    if (m && m[1] !== '0.0.0.0') {
      servers.push(m[1]!);
    }
  }
  return servers;
}
