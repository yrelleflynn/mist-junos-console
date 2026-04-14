import type { Check, CheckContext, CheckResult } from './base';

export const dnsConfigCheck: Check = {
  id: 'dns-config',
  name: 'DNS Configuration',

  async run({ runner }: CheckContext): Promise<CheckResult> {
    const id = 'dns-config';
    const name = 'DNS Configuration';
    const allOutputs: string[] = [];
    let servers: string[] = [];

    const cmd1 = await runner.execute('show configuration system name-server');
    if (cmd1.success) {
      allOutputs.push(cmd1.output);
      const found = cmd1.output.match(/(\d+\.\d+\.\d+\.\d+)/g);
      if (found) servers.push(...found);
    }

    if (servers.length === 0) {
      const cmd2 = await runner.execute('show configuration groups | display set | match name-server');
      if (cmd2.success) {
        allOutputs.push(cmd2.output);
        const found = cmd2.output.match(/(\d+\.\d+\.\d+\.\d+)/g);
        if (found) servers.push(...found);
      }
    }

    if (servers.length === 0) {
      const cmd3 = await runner.execute('show configuration system name-server | display inheritance');
      if (cmd3.success) {
        allOutputs.push(cmd3.output);
        const found = cmd3.output.match(/(\d+\.\d+\.\d+\.\d+)/g);
        if (found) servers.push(...found);
      }
    }

    if (servers.length === 0) {
      const cmd4 = await runner.execute('show system name-server');
      if (cmd4.success) {
        allOutputs.push(cmd4.output);
        const found = cmd4.output.match(/(\d+\.\d+\.\d+\.\d+)/g);
        if (found) servers.push(...found);
      }
    }

    if (servers.length === 0) {
      const cmd5 = await runner.execute('file show /etc/resolv.conf');
      if (cmd5.success) {
        allOutputs.push(cmd5.output);
        const nameserverLines = cmd5.output.split('\n').filter((l) => l.trim().startsWith('nameserver'));
        const found = nameserverLines.map((l) => l.match(/(\d+\.\d+\.\d+\.\d+)/)?.[1]).filter(Boolean) as string[];
        if (found.length > 0) servers.push(...found);
      }
    }

    servers = [...new Set(servers)];
    const raw = allOutputs.join('\n---\n');

    if (servers.length === 0) {
      return { id, name, status: 'fail', detail: 'No DNS servers found in config or resolve.conf', raw };
    }

    return { id, name, status: 'pass', detail: `DNS servers: ${servers.join(', ')}`, raw };
  },

  remediation(_result, allResults) {
    const dhcpDtl = (allResults?.find((x) => x.id === 'dhcp-lease')?.detail || '').toLowerCase();
    const hasDhcp = dhcpDtl.includes('ip:') && !dhcpDtl.includes('static');
    let text = 'No DNS servers configured.';
    if (hasDhcp) text += '\nIP via DHCP — update DHCP scope to include DNS (Option 6).';
    return {
      text,
      commands: ['set system name-server 8.8.8.8', 'set system name-server 8.8.4.4'],
    };
  },
};
