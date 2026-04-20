import type { Check, CheckContext, CheckResult } from './base';
import type { MistEndpoint } from '../config/mist-clouds.config';

/**
 * Factory function — returns a Check for a specific endpoint.
 * Called per-endpoint from TroubleshootService.checkFirewallPolicy().
 */
export function tracerouteCheck(endpoint: MistEndpoint): Check {
  return {
    id: `trace-${endpoint.host.replace(/\./g, '-')}`,
    name: `Traceroute ${endpoint.host}`,

    async run(ctx: CheckContext): Promise<CheckResult> {
      const id = `trace-${endpoint.host.replace(/\./g, '-')}`;
      const name = `Traceroute ${endpoint.host}`;
      const { runner } = ctx;

      // Run traceroute with inet (IPv4), limited hops and wait time
      const cmd = await runner.execute(
        `traceroute inet ${endpoint.host} wait 2 as-number-lookup no-resolve`,
        30000,
        3000,
      );

      if (!cmd.success) {
        return { id, name, status: 'info', detail: `Traceroute failed: ${cmd.error}`, raw: cmd.output };
      }

      // Parse traceroute output to find the last responding hop
      const hopLines = cmd.output.split('\n').filter((l) => /^\s*\d+\s/.test(l));
      const respondingHops = hopLines.filter((l) => !l.includes('* * *'));
      const deadHops = hopLines.filter((l) => l.includes('* * *'));

      if (respondingHops.length === 0) {
        return { id, name, status: 'info', detail: 'No hops responded — traffic may be blocked at first hop', raw: cmd.output };
      }

      // Get the last responding hop
      const lastHop = respondingHops[respondingHops.length - 1];
      const lastHopIp = lastHop.match(/(\d+\.\d+\.\d+\.\d+)/)?.[1] || 'unknown';
      const deadCount = deadHops.length;

      let detail = `${respondingHops.length} hop(s) responded, last: ${lastHopIp}`;
      if (deadCount > 0) {
        detail += ` (${deadCount} hop(s) no response — possible firewall)`;
      }

      return { id, name, status: 'info', detail, raw: cmd.output };
    },
  };
}
