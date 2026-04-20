import type { Check, CheckContext, CheckResult } from './base';

export interface OutboundSshCheckResult {
  result: CheckResult;
  port: string | null;
  [key: string]: unknown;
}

export const outboundSshCheck: Check = {
  id: 'outbound-ssh-config',
  name: 'Outbound SSH Config',

  async run(ctx: CheckContext): Promise<OutboundSshCheckResult> {
    const id = 'outbound-ssh-config';
    const name = 'Outbound SSH Config';
    const { runner } = ctx;

    const cmd = await runner.execute('show configuration system services outbound-ssh', 15000);
    if (!cmd.success) {
      return {
        result: { id, name, status: 'fail', detail: 'Could not read outbound-ssh config', raw: cmd.output },
        port: null,
      };
    }

    // Check for client mist block
    if (!cmd.output.includes('client mist') && !cmd.output.includes('client "mist"')) {
      if (cmd.output.includes('inactive')) {
        return {
          result: { id, name, status: 'fail', detail: 'Outbound SSH client "mist" is deactivated', raw: cmd.output },
          port: null,
        };
      }
      return {
        result: { id, name, status: 'fail', detail: 'Outbound SSH client "mist" not configured', raw: cmd.output },
        port: null,
      };
    }

    // Extract port from config (e.g. "port 2200;" or "port 443;")
    const portMatch = cmd.output.match(/port\s+(\d+)/);
    const port = portMatch ? portMatch[1] : null;

    // Extract oc-term host
    const hostMatch = cmd.output.match(/(oc-term[\w.-]+)/);
    const host = hostMatch ? hostMatch[1] : null;

    // Check for device-id
    const deviceIdMatch = cmd.output.match(/device-id\s+(\S+)/);
    const deviceId = deviceIdMatch ? deviceIdMatch[1] : null;

    // Check for secret
    const hasSecret = cmd.output.includes('secret');

    // Check for services (should list netconf)
    const hasServices = cmd.output.includes('services') && cmd.output.includes('netconf');

    const details: string[] = ['Configured'];
    if (host && port) {
      details.push(`${host}:${port}`);
    } else if (port) {
      details.push(`Port ${port}`);
    }
    if (deviceId) {
      const shortId = deviceId.length > 36 ? deviceId.substring(0, 32) + '…' : deviceId;
      details.push(`ID: ${shortId}`);
    }
    if (!hasSecret) details.push('⚠ No secret');
    if (!hasServices) details.push('⚠ Missing netconf service');

    const status = (hasSecret && deviceId) ? 'pass' : 'warn';
    return {
      result: { id, name, status, detail: details.join(' | '), raw: cmd.output },
      port,
    };
  },
};
