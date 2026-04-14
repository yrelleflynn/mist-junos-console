import type { Check, CheckContext, CheckResult } from './base';

export interface OutboundSshCheckResult {
  result: CheckResult;
  port: string | null;
  [key: string]: unknown;
}

export const outboundSshCheck: Check = {
  id: 'outbound-ssh-config',
  name: 'Outbound SSH Config',

  async run({ runner }: CheckContext): Promise<OutboundSshCheckResult> {
    const id = 'outbound-ssh-config';
    const name = 'Outbound SSH Config';

    const cmd = await runner.execute('show configuration system services outbound-ssh', 15000);
    if (!cmd.success) {
      return {
        result: { id, name, status: 'fail', detail: 'Could not read outbound-ssh config', raw: cmd.output },
        port: null,
      };
    }

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

    const portMatch = cmd.output.match(/port\s+(\d+)/);
    const port = portMatch ? portMatch[1] : null;

    const hostMatch = cmd.output.match(/(oc-term[\w.-]+)/);
    const host = hostMatch ? hostMatch[1] : null;

    const deviceIdMatch = cmd.output.match(/device-id\s+(\S+)/);
    const deviceId = deviceIdMatch ? deviceIdMatch[1] : null;

    const hasSecret = cmd.output.includes('secret');
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

  remediation(result) {
    if (result.detail.includes('not configured') || result.detail.includes('not found'))
      return { text: 'Outbound SSH not configured — use the Adopt Switch button.' };
    if (result.detail.includes('deactivated'))
      return { text: 'Outbound SSH deactivated.', commands: ['activate system services outbound-ssh client mist'] };
    return {
      text: 'Outbound SSH may be stuck. Deactivating and reactivating.',
      commands: ['deactivate system services outbound-ssh client mist', 'activate system services outbound-ssh client mist'],
    };
  },
};
