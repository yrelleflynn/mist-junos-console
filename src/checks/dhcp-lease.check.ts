import type { Check, CheckContext, CheckResult, CheckStatus } from './base';

export const dhcpLeaseCheck: Check = {
  id: 'dhcp-lease',
  name: 'DHCP Lease Details',

  async run(ctx: CheckContext): Promise<CheckResult> {
    const id = 'dhcp-lease';
    const name = 'DHCP Lease Details';
    const { runner } = ctx;

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

    const detailCmd = await runner.execute('show dhcp client binding detail');
    const allOutput = cmd.output + '\n' + (detailCmd.success ? detailCmd.output : '');

    const ipAddr =
      allOutput.match(/(?:IP address|Address)\s*[:=]?\s*(\d+\.\d+\.\d+\.\d+)/i)?.[1] ||
      allOutput.match(/(\d+\.\d+\.\d+\.\d+\/\d+)/)?.[1] ||
      'unknown';
    const subnet =
      allOutput.match(/(?:Subnet mask|mask)\s*[:=]?\s*(\d+\.\d+\.\d+\.\d+)/i)?.[1] || 'not found';
    const gateway =
      allOutput.match(/(?:Router|Gateway|Default gateway|router)\s*[:=]?\s*(\d+\.\d+\.\d+\.\d+)/i)?.[1] || 'not found';
    const dnsRaw =
      allOutput.match(/(?:DNS|Name server|Domain name server|name-server)\s*[:=]?\s*([\d.\s,]+)/i)?.[1] || '';
    const dnsServers = dnsRaw.match(/\d+\.\d+\.\d+\.\d+/g);
    const dns = dnsServers ? dnsServers.join(', ') : 'not found';

    return {
      id,
      name,
      status: 'pass',
      detail: `IP: ${ipAddr} | Mask: ${subnet} | Gateway: ${gateway} | DNS: ${dns}`,
      raw: allOutput,
    };
  },
};
