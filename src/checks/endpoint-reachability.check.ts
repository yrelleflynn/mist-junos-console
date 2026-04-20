import type { Check, CheckContext, CheckResult } from './base';
import type { MistEndpoint } from '../config/mist-clouds.config';

/**
 * Factory function — returns a Check for a specific endpoint.
 * Called per-endpoint from TroubleshootService.checkFirewallPolicy() and checkMistCloudStatus().
 */
export function endpointReachabilityCheck(endpoint: MistEndpoint): Check {
  return {
    id: `reach-${endpoint.host.replace(/\./g, '-')}`,
    name: `${endpoint.host}:${endpoint.port}`,

    async run(ctx: CheckContext): Promise<CheckResult> {
      const id = `reach-${endpoint.host.replace(/\./g, '-')}`;
      const name = `${endpoint.host}:${endpoint.port}`;
      const { runner } = ctx;

      // Step 1: Quick ping inet — test DNS resolution + basic reachability
      const pingCmd = await runner.execute(`ping inet ${endpoint.host} count 1 rapid`, 10000);
      const pingOutput = pingCmd.output;

      if (pingOutput.includes('unknown host') || pingOutput.includes('not known')) {
        return { id, name, status: 'fail', detail: `Cannot resolve ${endpoint.host}`, raw: pingOutput };
      }
      if (pingOutput.includes('No route to host') || pingOutput.includes('Network is unreachable')) {
        return { id, name, status: 'fail', detail: 'No route to host', raw: pingOutput };
      }

      // Step 2: Test TCP port with telnet inet (IPv4 forced)
      const cmd = await runner.execute(`telnet inet ${endpoint.host} port ${endpoint.port}`, 10000, 3000);
      const output = cmd.output;

      if (output.includes('Connected to') || output.includes('Escape character is') ||
          output.includes('Connection established')) {
        await runner.send('\x1d');
        await new Promise((r) => setTimeout(r, 500));
        await runner.send('quit\n');
        await new Promise((r) => setTimeout(r, 500));
        return { id, name, status: 'pass', detail: `Reachable (TCP ${endpoint.port})`, raw: output };
      }

      if (output.includes('Connection refused')) {
        return { id, name, status: 'warn', detail: `Connection refused (TCP ${endpoint.port}) — host reachable but port may be filtered`, raw: output };
      }
      if (output.includes('No route to host') || output.includes('Network is unreachable')) {
        return { id, name, status: 'fail', detail: 'No route to host', raw: output };
      }
      if (output.includes('Name or service not known') || output.includes('could not resolve') ||
          output.includes('unknown host')) {
        return { id, name, status: 'fail', detail: 'DNS resolution failed', raw: output };
      }
      if (output.includes('timed out') || output.includes('Connection timed out') || !cmd.success) {
        const pingWorked = pingOutput.includes('!') || /\d+ packets received/.test(pingOutput);
        if (pingWorked) {
          return { id, name, status: 'fail', detail: `Host reachable (ICMP) but TCP ${endpoint.port} timed out — likely firewall blocked`, raw: output };
        }
        return { id, name, status: 'fail', detail: `Connection timed out (TCP ${endpoint.port})`, raw: output };
      }

      await runner.send('\x03');
      await new Promise((r) => setTimeout(r, 500));
      return { id, name, status: 'fail', detail: `Unable to connect (TCP ${endpoint.port})`, raw: output };
    },
  };
}
