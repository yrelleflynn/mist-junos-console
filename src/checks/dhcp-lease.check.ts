import type { Check, CheckContext, CheckResult, CheckStatus } from './base';

export const dhcpLeaseCheck: Check = {
  id: 'dhcp-lease',
  name: 'DHCP Lease Details',

  async run({ runner }: CheckContext): Promise<CheckResult> {
    const id = 'dhcp-lease';
    const name = 'DHCP Lease Details';

    let cmd = await runner.execute('show dhcp client binding');

    if (!cmd.success || cmd.output.includes('unknown command') || cmd.output.includes('syntax error')) {
      cmd = await runner.execute('show system services dhcp client binding');
    }

    if (!cmd.success) {
      return { id, name, status: 'skip', detail: 'DHCP client info not available', raw: cmd.output };
    }

    const hasBinding = /\d+\.\d+\.\d+\.\d+/.test(cmd.output) &&
      !cmd.output.includes('no entries') &&
      !cmd.output.includes('0 bindings');

    if (!hasBinding) {
      return { id, name, status: 'info' as CheckStatus, detail: 'No DHCP lease — IP is likely static', raw: cmd.output };
    }

    const allIps = cmd.output.match(/\b(\d+\.\d+\.\d+\.\d+)\b/g) || [];
    const realIps = allIps.filter((ip) => ip !== '0.0.0.0');
    if (realIps.length === 0) {
      return { id, name, status: 'info' as CheckStatus, detail: 'DHCP client bound to 0.0.0.0 — management IP appears to be statically assigned', raw: cmd.output };
    }

    const ipMatch = cmd.output.match(/(?:IP address|Address)\s*[:=]?\s*(\d+\.\d+\.\d+\.\d+)/i) ||
                    cmd.output.match(/(\d+\.\d+\.\d+\.\d+\/\d+)/);
    const maskMatch = cmd.output.match(/(?:Subnet mask|mask)\s*[:=]?\s*(\d+\.\d+\.\d+\.\d+)/i);
    const gwMatch = cmd.output.match(/(?:Router|Gateway|Default gateway)\s*[:=]?\s*(\d+\.\d+\.\d+\.\d+)/i);
    const dnsMatch = cmd.output.match(/(?:DNS|Name server|Domain name server)\s*[:=]?\s*([\d.\s,]+)/i);

    const detailCmd = await runner.execute('show dhcp client binding detail');
    const allOutput = cmd.output + '\n' + (detailCmd.success ? detailCmd.output : '');

    const ipAddr = ipMatch?.[1] ||
      allOutput.match(/(?:IP address|Address)\s*[:=]?\s*(\d+\.\d+\.\d+\.\d+)/i)?.[1] ||
      allOutput.match(/(\d+\.\d+\.\d+\.\d+\/\d+)/)?.[1] ||
      'unknown';

    const subnet = maskMatch?.[1] ||
      allOutput.match(/(?:Subnet mask|mask)\s*[:=]?\s*(\d+\.\d+\.\d+\.\d+)/i)?.[1] ||
      'not found';

    const gateway = gwMatch?.[1] ||
      allOutput.match(/(?:Router|Gateway|Default gateway|router)\s*[:=]?\s*(\d+\.\d+\.\d+\.\d+)/i)?.[1] ||
      'not found';

    const dnsRaw = dnsMatch?.[1] ||
      allOutput.match(/(?:DNS|Name server|Domain name server|name-server)\s*[:=]?\s*([\d.\s,]+)/i)?.[1] ||
      '';
    const dnsServers = dnsRaw.match(/\d+\.\d+\.\d+\.\d+/g);
    const dns = dnsServers ? dnsServers.join(', ') : 'not found';

    const lines = [
      `IP: ${ipAddr}`,
      `Mask: ${subnet}`,
      `Gateway: ${gateway}`,
      `DNS: ${dns}`,
    ];

    return { id, name, status: 'pass', detail: lines.join(' | '), raw: allOutput };
  },

  remediation() {
    return {
      text: 'DHCP client may not be configured, or server is unreachable.\nEnsure management VLAN is correct and DHCP server has available addresses.',
      commands: ['set interfaces irb unit 0 family inet dhcp'],
    };
  },
};
