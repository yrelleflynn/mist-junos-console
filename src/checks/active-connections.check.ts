import type { Check, CheckContext, CheckResult } from './base';

export const activeConnectionsCheck: Check = {
  id: 'cloud-connections',
  name: 'Active Cloud Connections',

  async run({ runner, mgmtIp, cloud }: CheckContext): Promise<CheckResult> {
    const id = 'cloud-connections';
    const name = 'Active Cloud Connections';

    if (!mgmtIp) {
      return { id, name, status: 'skip', detail: 'No management IP detected — cannot check connections' };
    }

    const cmd = await runner.execute(`show system connections | grep ${mgmtIp}`, 30000, 3000);
    if (!cmd.success) {
      return { id, name, status: 'fail', detail: 'Could not check system connections', raw: cmd.output };
    }

    const lines = cmd.output.split('\n').filter((l) => l.trim().length > 0 && l.includes(mgmtIp));

    if (lines.length === 0) {
      return {
        id, name, status: 'fail',
        detail: `No outbound connections from ${mgmtIp}`,
        raw: cmd.output,
      };
    }

    const established = lines.filter((l) => /ESTABLISHED/i.test(l));
    const other = lines.filter((l) => !(/ESTABLISHED/i.test(l)));

    const remoteEndpoints: { ip: string; port: string }[] = [];
    for (const line of established) {
      const parts = line.trim().split(/\s+/);
      for (const part of parts) {
        const match = part.match(/^(\d+\.\d+\.\d+\.\d+)\.(\d+)$/);
        if (match && match[1] !== mgmtIp) {
          remoteEndpoints.push({ ip: match[1], port: match[2] });
        }
      }
    }

    if (established.length === 0) {
      const states = other.map((l) => {
        const stateMatch = l.match(/(SYN_SENT|CLOSE_WAIT|FIN_WAIT\S*|TIME_WAIT|LAST_ACK|LISTEN)/i);
        return stateMatch ? stateMatch[1] : 'unknown';
      });
      const uniqueStates = [...new Set(states)];
      return {
        id, name, status: 'warn',
        detail: `${other.length} connection(s) from ${mgmtIp} but none ESTABLISHED (states: ${uniqueStates.join(', ')})`,
        raw: cmd.output,
      };
    }

    // Resolve cloud endpoint FQDNs to IPs
    const resolvedMistIps: Map<string, string> = new Map();
    if (cloud) {
      for (const endpoint of cloud.switchEndpoints) {
        const hostCmd = await runner.execute(`show host ${endpoint.host}`, 15000, 2000);
        if (hostCmd.success && hostCmd.output.trim().length > 0) {
          const hostLines = hostCmd.output.split('\n');
          for (const hostLine of hostLines) {
            const addrMatch = hostLine.match(/has address\s+(\d+\.\d+\.\d+\.\d+)/);
            if (addrMatch) {
              resolvedMistIps.set(addrMatch[1], endpoint.host);
            }
          }
          if (![...resolvedMistIps.values()].includes(endpoint.host)) {
            const allIps = hostCmd.output.match(/\b(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})\b/g);
            if (allIps) {
              for (const ip of allIps) {
                if (!ip.startsWith('127.') && !ip.startsWith('0.')) {
                  resolvedMistIps.set(ip, endpoint.host);
                }
              }
            }
          }
        }
      }
    }

    const matched: string[] = [];
    const unmatched: string[] = [];

    for (const ep of remoteEndpoints) {
      const fqdn = resolvedMistIps.get(ep.ip);
      if (fqdn) {
        matched.push(`${ep.ip}:${ep.port} (${fqdn})`);
      } else {
        unmatched.push(`${ep.ip}:${ep.port}`);
      }
    }

    const uniqueMatched = [...new Set(matched)];
    const uniqueUnmatched = [...new Set(unmatched)];

    let detail = `${established.length} active connection(s)`;
    if (uniqueMatched.length > 0) detail += ` | Mist: ${uniqueMatched.join(', ')}`;
    if (uniqueUnmatched.length > 0) detail += ` | Other: ${uniqueUnmatched.join(', ')}`;
    if (other.length > 0) detail += ` (+${other.length} non-established)`;

    const status = uniqueMatched.length > 0 ? 'pass'
      : (resolvedMistIps.size > 0 ? 'warn' : 'pass');

    const warnDetail = uniqueMatched.length === 0 && resolvedMistIps.size > 0
      ? ' — none matched known Mist endpoints'
      : '';

    const resolvedDebug = [...resolvedMistIps.entries()]
      .map(([ip, fqdn]) => `  ${fqdn} -> ${ip}`)
      .join('\n');
    const rawOutput = cmd.output
      + '\n--- Resolved Mist IPs ---\n'
      + (resolvedDebug || '  (none resolved)')
      + '\n--- Remote endpoints found ---\n'
      + remoteEndpoints.map((e) => `  ${e.ip}:${e.port}`).join('\n');

    return { id, name, status, detail: detail + warnDetail, raw: rawOutput };
  },

  remediation(result, allResults) {
    const mistProcFailed = allResults?.find((x) => x.id === 'mist-processes')?.status === 'fail';
    const sshFailed = allResults?.find((x) => x.id === 'outbound-ssh-config')?.status === 'fail';
    if (mistProcFailed) return { text: 'Mist agent not running — fix that first.' };
    if (sshFailed) return { text: 'Outbound SSH not configured — adopt the switch.' };
    if (result.detail.includes('SYN_SENT'))
      return { text: 'Connections stuck in SYN_SENT — firewall blocking. Run Firewall Policy Check.' };
    if (result.detail.includes('FIN_WAIT') || result.detail.includes('CLOSE_WAIT'))
      return { text: 'Stale connections detected.', commands: ['restart mcd'] };
    return {
      text: 'No connections. Trying deactivate/reactivate outbound SSH.',
      commands: ['deactivate system services outbound-ssh client mist', 'activate system services outbound-ssh client mist'],
    };
  },
};
