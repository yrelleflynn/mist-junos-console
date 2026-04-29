import type { TroubleshootContext } from '@marvis/shared';
import type { CliExecutor } from '../runner.js';

export default async function resolveManagementIp(
  cli: CliExecutor,
  _ctx: TroubleshootContext,
): Promise<Partial<TroubleshootContext>> {
  for (const iface of ['irb.0', 'me0', 'vme0']) {
    const out = await cli.run(`show interfaces ${iface}`).catch(() => '');
    const parsed = parseInetAddress(out);
    if (parsed) {
      const vlan = parseVlan(iface);
      return {
        managementIp: parsed.ip,
        managementPrefix: parsed.prefix,
        ...(vlan !== undefined ? { managementVlan: vlan } : {}),
      };
    }
  }
  return {};
}

function parseInetAddress(output: string): { ip: string; prefix: number } | undefined {
  // "    inet  192.168.100.10/24"
  const m = output.match(/inet\s+([\d.]+)\/(\d+)/);
  if (!m) return undefined;
  return { ip: m[1]!, prefix: parseInt(m[2]!, 10) };
}

function parseVlan(iface: string): number | undefined {
  const m = iface.match(/irb\.(\d+)/);
  return m ? parseInt(m[1]!, 10) : undefined;
}
