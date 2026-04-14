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

  async run({ runner }: CheckContext): Promise<InterfaceIpCheckResult> {
    const id = 'mgmt-ip';
    const name = 'Management IP Address';

    const cmd = await runner.execute('show interfaces terse | match "inet "');
    if (!cmd.success) {
      return {
        result: { id, name, status: 'fail', detail: cmd.error || 'Command failed', raw: cmd.output },
        mgmtIp: null,
      };
    }

    const internalPrefixes = ['bme', 'pfe', 'pfh', 'jsrv', 'lo0', 'pip', 'tap', 'gre', 'ipip', 'lsi', 'mtun', 'pimd', 'pime'];

    const isRoutableIp = (ip: string): boolean => {
      const parts = ip.split('.').map(Number);
      if (parts[0] === 127) return false;
      if (parts[0] === 128 && parts[1] === 0) return false;
      if (parts[0] === 0) return false;
      if (parts[0] === 169 && parts[1] === 254) return false;
      return true;
    };

    const allLines = cmd.output.split('\n').filter((l) => /\d+\.\d+\.\d+\.\d+/.test(l));

    const mgmtPrefixes = ['irb', 'vme', 'me0', 'vlan'];
    const mgmtLines = allLines.filter((l) => {
      const trimmed = l.trim();
      const isMgmt = mgmtPrefixes.some((p) => trimmed.startsWith(p));
      if (!isMgmt) return false;
      const parts = trimmed.split(/\s+/);
      if (parts.length >= 3 && parts[1] === 'up' && parts[2] === 'up') {
        const ip = trimmed.match(/(\d+\.\d+\.\d+\.\d+)/)?.[1];
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

    const otherLines = allLines.filter((l) => {
      const trimmed = l.trim();
      const isInternal = internalPrefixes.some((p) => trimmed.startsWith(p));
      if (isInternal) return false;
      const parts = trimmed.split(/\s+/);
      if (parts.length >= 3 && parts[1] === 'up' && parts[2] === 'up') {
        const ip = trimmed.match(/(\d+\.\d+\.\d+\.\d+)/)?.[1];
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

    const rawLines = cmd.output.split('\n');
    const mgmtUpDown = rawLines.filter((l) => {
      const trimmed = l.trim();
      return mgmtPrefixes.some((p) => trimmed.startsWith(p)) && /up\s+down/.test(trimmed);
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

  remediation(result, allResults) {
    const dhcpDtl = (allResults?.find((x) => x.id === 'dhcp-lease')?.detail || '').toLowerCase();
    const isDhcp = dhcpDtl.includes('dhcp') || dhcpDtl.includes('0.0.0.0');
    const isStatic = dhcpDtl.includes('static');
    const steps: string[] = [];
    const cmds: string[] = [];
    const portFailed = allResults?.find((x) => x.id === 'port-status')?.status === 'fail';
    const vlanFailed = allResults?.find((x) => x.id === 'vlan-config')?.status === 'fail';

    if (result.detail.includes('up but have no IP')) {
      steps.push('Management interface is up but has no IP.');
    }
    if (portFailed) {
      steps.push('→ Uplink port is down — fix physical connection first.');
    } else if (vlanFailed) {
      steps.push('→ VLAN config failed — DHCP server may be unreachable.');
    }
    if (isDhcp || (!isStatic && !isDhcp)) {
      steps.push('Ensure DHCP client is configured on the management interface.');
      cmds.push('set interfaces irb unit 0 family inet dhcp');
    } else if (isStatic) {
      steps.push('Static IP not configured.');
      cmds.push('set interfaces irb unit 0 family inet address <ip>/<prefix>');
    }
    return { text: steps.join('\n'), commands: cmds.length > 0 ? cmds : undefined };
  },
};
