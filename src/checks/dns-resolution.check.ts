import type { Check, CheckContext, CheckResult } from './base';

export const dnsResolutionCheck: Check = {
  id: 'dns-resolution',
  name: 'DNS Resolution & Reachability',
  critical: true,

  async run({ runner, cloud }: CheckContext): Promise<CheckResult> {
    const id = 'dns-resolution';
    const name = 'DNS Resolution & Reachability';

    if (!cloud) {
      return { id, name, status: 'skip', detail: 'No cloud config provided' };
    }

    const ocTerm = cloud.switchEndpoints.find((e) => e.description.includes('oc-term'));
    const testHost = ocTerm?.host || cloud.switchEndpoints[0]?.host || 'redirect.juniper.net';

    const cmd = await runner.execute(`ping inet ${testHost} count 3 rapid`, 15000);
    if (!cmd.success) {
      if (cmd.output.includes('unknown host') || cmd.output.includes('not known') ||
          cmd.output.includes('Name or service not known')) {
        return { id, name, status: 'fail', detail: `Cannot resolve ${testHost} — DNS failure`, raw: cmd.output };
      }
      return { id, name, status: 'fail', detail: `Ping failed: ${cmd.error}`, raw: cmd.output };
    }

    if (cmd.output.includes('unknown host') || cmd.output.includes('not known')) {
      return { id, name, status: 'fail', detail: `Cannot resolve ${testHost} — DNS failure`, raw: cmd.output };
    }

    if (cmd.output.includes('No route to host') || cmd.output.includes('Network is unreachable')) {
      return { id, name, status: 'warn', detail: `Resolved ${testHost} but no route to host`, raw: cmd.output };
    }

    const receivedMatch = cmd.output.match(/(\d+) packets received/);
    const received = receivedMatch ? parseInt(receivedMatch[1], 10) : 0;
    const hasRapidSuccess = cmd.output.includes('!!') || cmd.output.includes('!');

    if (received > 0 || hasRapidSuccess) {
      const ipMatch = cmd.output.match(/PING\s+\S+\s+\((\d+\.\d+\.\d+\.\d+)\)/);
      const resolvedIp = ipMatch ? ` → ${ipMatch[1]}` : '';
      return { id, name, status: 'pass', detail: `${testHost}${resolvedIp} — reachable`, raw: cmd.output };
    }

    if (cmd.output.includes('0 packets received') || cmd.output.includes('100% packet loss')) {
      const ipMatch = cmd.output.match(/PING\s+\S+\s+\((\d+\.\d+\.\d+\.\d+)\)/);
      const resolvedIp = ipMatch ? ` (${ipMatch[1]})` : '';
      return { id, name, status: 'warn', detail: `Resolved ${testHost}${resolvedIp} but 0 replies — ICMP may be blocked`, raw: cmd.output };
    }

    return { id, name, status: 'warn', detail: `Uncertain result for ${testHost}`, raw: cmd.output };
  },

  remediation(result, allResults) {
    const dnsConfigFailed = allResults?.find((x) => x.id === 'dns-config')?.status === 'fail';
    if (dnsConfigFailed) return { text: 'DNS servers not configured — fix DNS Config first.' };
    if (result.detail.includes('DNS failure') || result.detail.includes('unknown host'))
      return { text: 'DNS configured but resolution failing. Check DNS server reachability and firewall (UDP 53).' };
    if (result.detail.includes('0 replies'))
      return { text: 'ICMP blocked — may be OK. Run Firewall Policy Check to verify TCP.' };
    return {};
  },
};
