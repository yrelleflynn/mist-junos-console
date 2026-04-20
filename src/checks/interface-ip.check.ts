import type { Check, CheckContext, CheckResult } from './base';

export interface InterfaceIpCheckResult {
  result: CheckResult;
  mgmtIp: string | null;
  [key: string]: unknown;
}

export const interfaceIpCheck: Check = {
  id: 'mgmt-ip',
  name: 'Management IP Address',
  critical: true,

  async run(ctx: CheckContext): Promise<InterfaceIpCheckResult> {
    const id = 'mgmt-ip';
    const name = 'Management IP Address';
    const { runner } = ctx;

    const cmd = await runner.execute('show interfaces terse | match "inet "');
    if (!cmd.success) {
      return {
        result: { id, name, status: 'fail', detail: cmd.error || 'Command failed', raw: cmd.output },
        mgmtIp: null,
      };
    }

    const internalPrefixes = ['bme', 'pfe', 'pfh', 'jsrv', 'lo0', 'pip', 'tap', 'gre', 'ipip', 'lsi', 'mtun', 'pimd', 'pime'];
    const mgmtPrefixes = ['irb', 'vme', 'me0', 'vlan'];

    const isRoutableIp = (ip: string): boolean => {
      const parts = ip.split('.').map(Number);
      if (parts[0] === 127) return false;
      if (parts[0] === 128 && parts[1] === 0) return false;
      if (parts[0] === 0) return false;
      if (parts[0] === 169 && parts[1] === 254) return false;
      return true;
    };

    const allLines = cmd.output.split('\n').filter((l) => /\d+\.\d+\.\d+\.\d+/.test(l));

    // Preferred: standard management interfaces (irb, vme, me0) up/up with a routable IP
    const mgmtLines = allLines.filter((l) => {
      const t = l.trim();
      if (!mgmtPrefixes.some((p) => t.startsWith(p))) return false;
      const parts = t.split(/\s+/);
      if (parts.length >= 3 && parts[1] === 'up' && parts[2] === 'up') {
        const ip = t.match(/(\d+\.\d+\.\d+\.\d+)/)?.[1];
        return ip ? isRoutableIp(ip) : false;
      }
      return false;
    });

    if (mgmtLines.length > 0) {
      const ip = mgmtLines[0].match(/(\d+\.\d+\.\d+\.\d+)/)?.[1] || null;
      const ipDisplay = mgmtLines[0].match(/(\d+\.\d+\.\d+\.\d+\/?\d*)/)?.[1] || 'unknown';
      const iface = mgmtLines[0].trim().split(/\s+/)[0];
      return {
        result: { id, name, status: 'pass', detail: `Management IP: ${ipDisplay} (${iface})`, raw: cmd.output },
        mgmtIp: ip,
      };
    }

    // Fallback: any non-internal up/up interface with a routable IP
    const otherLines = allLines.filter((l) => {
      const t = l.trim();
      if (internalPrefixes.some((p) => t.startsWith(p))) return false;
      const parts = t.split(/\s+/);
      if (parts.length >= 3 && parts[1] === 'up' && parts[2] === 'up') {
        const ip = t.match(/(\d+\.\d+\.\d+\.\d+)/)?.[1];
        return ip ? isRoutableIp(ip) : false;
      }
      return false;
    });

    if (otherLines.length > 0) {
      const ip = otherLines[0].match(/(\d+\.\d+\.\d+\.\d+)/)?.[1] || null;
      const ipDisplay = otherLines[0].match(/(\d+\.\d+\.\d+\.\d+\/?\d*)/)?.[1] || 'unknown';
      const iface = otherLines[0].trim().split(/\s+/)[0];
      return {
        result: { id, name, status: 'warn', detail: `IP ${ipDisplay} found on ${iface} (not a standard management interface)`, raw: cmd.output },
        mgmtIp: ip,
      };
    }

    // Check for management interfaces that exist but have no IP (up/down)
    const mgmtUpDown = cmd.output.split('\n').filter((l) => {
      const t = l.trim();
      return mgmtPrefixes.some((p) => t.startsWith(p)) && /up\s+down/.test(t);
    });

    let failDetail = 'No routable IP address found on any management interface';
    if (mgmtUpDown.length > 0) {
      const ifaces = mgmtUpDown.map((l) => l.trim().split(/\s+/)[0]).join(', ');
      failDetail = `Management interface(s) ${ifaces} are up but have no IP — check DHCP or static config`;
    }

    return {
      result: { id, name, status: 'fail', detail: failDetail, raw: cmd.output },
      mgmtIp: null,
    };
  },
};
