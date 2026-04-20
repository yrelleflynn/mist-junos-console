/**
 * config-drift.service.ts — Compare Mist intended config vs actual Junos config
 *
 * Converts the Mist device JSON config into equivalent 'set' commands,
 * then diffs against the actual 'show configuration | display inheritance | display set' output
 * to detect drift.
 */

import { MistDeviceConfig } from './mist-api.service';

export interface ConfigDiffLine {
  type: 'match' | 'mist-only' | 'switch-only';
  line: string;
  category: string;
}

export interface ConfigDriftResult {
  totalMistLines: number;
  totalSwitchLines: number;
  matchedLines: number;
  mistOnlyLines: ConfigDiffLine[];
  switchOnlyLines: ConfigDiffLine[];
  summary: string;
}

/**
 * Categories of config lines to compare.
 * We focus on the sections most relevant to cloud connectivity and
 * general switch operation — ignoring ephemeral or auto-generated lines.
 */
const RELEVANT_PREFIXES = [
  'set apply-groups',
  'set system commit',
  'set system time-zone',
  'set system host-name',
  'set system name-server',
  'set system ntp',
  'set system syslog',
  'set system services',
  'set system login',
  'set system root-authentication',
  'set system management-instance',
  'set interfaces irb',
  'set interfaces vme',
  'set interfaces me0',
  'set interfaces ge-',
  'set interfaces xe-',
  'set interfaces et-',
  'set interfaces mge-',
  'set vlans',
  'set protocols lldp',
  'set protocols dot1x',
  'set protocols rstp',
  'set protocols stp',
  'set protocols vstp',
  'set forwarding-options',
  'set policy-options',
  'set firewall',
  'set access',
  'set routing-options',
  'set switch-options',
  'set ethernet-switching-options',
  'set groups',
  'set poe',
];

/**
 * Lines to ignore in comparison — auto-generated, timestamps, secrets, etc.
 */
const IGNORE_PATTERNS = [
  /^set version /,
  /^set system (commit|scripts|extensions|processes)/,
  /^set system configuration-database ephemeral/,
  /^set system services outbound-ssh client mist secret/,
  /^set system services ssh protocol-version/,
  /^set system services ssh connection-limit/,
  /^set system services netconf/,
  /^set system services outbound-ssh/,
  /^set system services telnet/,
  /^set system login user mist/,
  /^set system root-authentication encrypted-password/,
  /^set system login user \S+ authentication encrypted-password/,
  /^set system auto-snapshot/,
  /^set system authentication-order/,
  /^set chassis redundancy graceful-switchover/,
  /^set security pki/,
  /^set (event-options|chassis auto-image-upgrade)/,
  /encrypted-password/,
  /\$\d\$/,  // Hashed passwords
];

export class ConfigDriftService {
  /**
   * Compare Mist intended config against the actual running config.
   *
   * @param mistConfig — Mist device config JSON from the API
   * @param runningConfig — Output of 'show configuration | display inheritance | display set'
   */
  compare(mistConfig: MistDeviceConfig, runningConfig: string): ConfigDriftResult {
    // Parse running config into a set of normalised lines
    const switchLines = this.parseRunningConfig(runningConfig);

    // Convert Mist config JSON to equivalent 'set' commands
    const mistLines = this.parseMistConfig(mistConfig);

    const switchMap = this.toUniqueNormalizedMap(switchLines);
    const mistMap = this.toUniqueNormalizedMap(mistLines);

    const switchSet = new Set(switchMap.keys());
    const mistSet = new Set(mistMap.keys());

    const mistOnlyLines: ConfigDiffLine[] = [];
    const switchOnlyLines: ConfigDiffLine[] = [];
    let matchedLines = 0;

    // Find lines in Mist config but not on switch
    for (const [normalized, line] of mistMap.entries()) {
      if (switchSet.has(normalized)) {
        matchedLines++;
      } else {
        mistOnlyLines.push({
          type: 'mist-only',
          line,
          category: this.categorize(line),
        });
      }
    }

    // Find lines on switch but not in Mist config
    for (const [normalized, line] of switchMap.entries()) {
      if (!mistSet.has(normalized)) {
        switchOnlyLines.push({
          type: 'switch-only',
          line,
          category: this.categorize(line),
        });
      }
    }

    // Generate summary
    const totalDiffs = mistOnlyLines.length + switchOnlyLines.length;
    let summary: string;
    if (totalDiffs === 0) {
      summary = 'No drift detected — Mist config and switch config match.';
    } else {
      summary = `${totalDiffs} difference(s): ${mistOnlyLines.length} in Mist but not on switch, ${switchOnlyLines.length} on switch but not in Mist.`;
    }

    return {
      totalMistLines: mistMap.size,
      totalSwitchLines: switchMap.size,
      matchedLines,
      mistOnlyLines,
      switchOnlyLines,
      summary,
    };
  }

  /**
   * Parse the running config output into filtered, relevant 'set' lines.
   */
  private parseRunningConfig(config: string): string[] {
    return this.expandBracketArrayLines(
      config
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l.startsWith('set '))
      .filter((l) => this.isRelevant(l))
      .filter((l) => !this.isIgnored(l)),
    );
  }

  /**
   * Convert Mist device config JSON into 'set' command lines.
   *
   * The Mist API returns a JSON object. We need to extract the parts
   * that map to Junos 'set' commands. This is a best-effort conversion
   * for the most common config elements.
   */
  private parseMistConfig(config: MistDeviceConfig): string[] {
    if (Array.isArray(config.cli) && config.cli.length > 0) {
      return this.parseMistCliConfig(config.cli);
    }

    const lines: string[] = [];

    // Hostname
    if (config.name) {
      lines.push(`set system host-name ${config.name}`);
    }

    // DNS servers (from site settings, may be in additional_config_cmds)
    if (config.dns_servers && Array.isArray(config.dns_servers)) {
      for (const dns of config.dns_servers) {
        lines.push(`set system name-server ${dns}`);
      }
    }

    // NTP servers
    if (config.ntp_servers && Array.isArray(config.ntp_servers)) {
      for (const ntp of config.ntp_servers) {
        lines.push(`set system ntp server ${ntp}`);
      }
    }

    // Networks / VLANs
    if (config.networks && typeof config.networks === 'object') {
      for (const [name, net] of Object.entries(config.networks)) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const vlanId = (net as any)?.vlan_id;
        if (vlanId) {
          lines.push(`set vlans ${name} vlan-id ${vlanId}`);
        }
      }
    }

    // Port profiles / interfaces
    if (config.port_config && typeof config.port_config === 'object') {
      for (const [portRange, profile] of Object.entries(config.port_config)) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const p = profile as any;
        if (p?.usage === 'trunk' || p?.mode === 'trunk') {
          // Trunk port config
          const ports = this.expandPortRange(portRange);
          for (const port of ports) {
            lines.push(`set interfaces ${port} unit 0 family ethernet-switching interface-mode trunk`);
            if (p.all_networks || p.networks) {
              // VLANs allowed on trunk
            }
          }
        } else if (p?.usage === 'access' || p?.mode === 'access') {
          const ports = this.expandPortRange(portRange);
          for (const port of ports) {
            lines.push(`set interfaces ${port} unit 0 family ethernet-switching interface-mode access`);
            if (p.port_network) {
              lines.push(`set interfaces ${port} unit 0 family ethernet-switching vlan members ${p.port_network}`);
            }
          }
        }
      }
    }

    // Additional CLI commands (these are already in 'set' format)
    if (config.additional_config_cmds && Array.isArray(config.additional_config_cmds)) {
      for (const cmd of config.additional_config_cmds) {
        if (typeof cmd === 'string' && cmd.startsWith('set ')) {
          lines.push(cmd);
        }
      }
    }

    // IP config (if present)
    if (config.ip_config && typeof config.ip_config === 'object') {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const ip = config.ip_config as any;
      if (ip.type === 'dhcp') {
        // DHCP is typically on irb.0
      } else if (ip.type === 'static' && ip.ip && ip.netmask) {
        lines.push(`set interfaces irb unit 0 family inet address ${ip.ip}/${this.netmaskToCidr(ip.netmask)}`);
        if (ip.gateway) {
          lines.push(`set routing-options static route 0.0.0.0/0 next-hop ${ip.gateway}`);
        }
      }
    }

    return this.expandBracketArrayLines(lines.filter((l) => !this.isIgnored(l)));
  }

  private parseMistCliConfig(cli: unknown[]): string[] {
    const rawLines = this.keepLastScalarAssignments(
      cli
      .filter((line): line is string => typeof line === 'string')
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
      .filter((line) => !line.startsWith('#'))
      .filter((line) => !line.startsWith('delete '))
      .filter((line) => line.startsWith('set '))
      .filter((line) => !this.isIgnored(line)),
    );

    const interfaceRangeMembers = new Map<string, string[]>();
    const interfaceRangeApplyGroups = new Map<string, string[]>();
    const groupLines = new Map<string, string[]>();
    const globalApplyGroups = new Set<string>();
    const directLines: string[] = [];

    for (const line of rawLines) {
      const memberMatch = line.match(/^set interfaces interface-range (\S+) member (.+)$/);
      if (memberMatch) {
        const rangeName = memberMatch[1];
        const members = interfaceRangeMembers.get(rangeName) ?? [];
        members.push(...this.expandInterfaceTokens(memberMatch[2]));
        interfaceRangeMembers.set(rangeName, members);
        directLines.push(this.normalizeSpacing(line));
        continue;
      }

      const applyGroupMatch = line.match(/^set interfaces interface-range (\S+) apply-groups (\S+)$/);
      if (applyGroupMatch) {
        const rangeName = applyGroupMatch[1];
        const groupName = applyGroupMatch[2];
        const groups = interfaceRangeApplyGroups.get(rangeName) ?? [];
        groups.push(groupName);
        interfaceRangeApplyGroups.set(rangeName, groups);
        continue;
      }

      const globalApplyMatch = line.match(/^set apply-groups (\S+)$/);
      if (globalApplyMatch) {
        globalApplyGroups.add(globalApplyMatch[1]);
        continue;
      }

      const groupMatch = line.match(/^set groups (\S+) (.+)$/);
      if (groupMatch) {
        const groupName = groupMatch[1];
        const groupBody = groupMatch[2];
        const entries = groupLines.get(groupName) ?? [];
        entries.push(groupBody);
        groupLines.set(groupName, entries);
        continue;
      }

      directLines.push(this.normalizeSpacing(line));
    }

    const expandedLines: string[] = [...directLines];

    for (const groupName of globalApplyGroups) {
      const lines = groupLines.get(groupName) ?? [];
      for (const line of lines) {
        if (line.startsWith('interfaces <*>')) continue;
        expandedLines.push(this.normalizeSpacing(`set ${line}`));
      }
    }

    for (const [rangeName, groups] of interfaceRangeApplyGroups.entries()) {
      const members = interfaceRangeMembers.get(rangeName) ?? [];
      if (members.length === 0) continue;

      for (const groupName of groups) {
        const lines = groupLines.get(groupName) ?? [];
        for (const line of lines) {
          const interfaceTemplateMatch = line.match(/^interfaces <\*> (.+)$/);
          if (!interfaceTemplateMatch) continue;
          const suffix = interfaceTemplateMatch[1];
          for (const member of members) {
            expandedLines.push(this.normalizeSpacing(`set interfaces ${member} ${suffix}`));
          }
        }
      }
    }

    const fullyExpanded = expandedLines.flatMap((line) =>
      this.expandInterfaceRangeReferences(line, interfaceRangeMembers),
    );

    return this.expandBracketArrayLines(fullyExpanded)
      .filter((line) => this.isRelevant(line))
      .filter((line) => !this.isIgnored(line));
  }

  /**
   * Check if a config line is in a relevant category for comparison.
   */
  private isRelevant(line: string): boolean {
    return RELEVANT_PREFIXES.some((prefix) => line.startsWith(prefix));
  }

  /**
   * Check if a config line should be ignored in comparison.
   */
  private isIgnored(line: string): boolean {
    return IGNORE_PATTERNS.some((pattern) => pattern.test(line));
  }

  /**
   * Normalize a config line for comparison (trim whitespace, lowercase, remove trailing semicolons).
   */
  private normalizeLine(line: string): string {
    return line
      .trim()
      .replace(/;+$/, '')
      .replace(/"([^"]+)"/g, '$1')
      .replace(/((?:ge|xe|et|mge)-\d+\/\d+\/\d+)\.0\b/g, '$1')
      .replace(/\s+/g, ' ')
      .toLowerCase();
  }

  /**
   * Expand Junos array-style `set` commands into the per-value lines that
   * `display set` emits on the switch.
   *
   * Example:
   *   set ... vlan members [ guest staff ]
   * becomes:
   *   set ... vlan members guest
   *   set ... vlan members staff
   */
  private expandBracketArrayLines(lines: string[]): string[] {
    return lines.flatMap((line) => this.expandBracketArrayLine(line));
  }

  private expandBracketArrayLine(line: string): string[] {
    const match = line.match(/^(.*)\[\s*([^\]]+?)\s*\](.*)$/);
    if (!match) {
      return [this.normalizeSpacing(line)];
    }

    const prefix = this.normalizeSpacing(match[1]);
    const values = match[2].trim().split(/\s+/).filter(Boolean);
    const suffix = this.normalizeSpacing(match[3]);

    if (values.length === 0) {
      return [this.normalizeSpacing(`${prefix} ${suffix}`)];
    }

    return values.flatMap((value) =>
      this.expandBracketArrayLine(this.normalizeSpacing(`${prefix} ${value} ${suffix}`)),
    );
  }

  private normalizeSpacing(line: string): string {
    return line.trim().replace(/\s+/g, ' ');
  }

  private normalizeToken(token: string): string {
    return token.trim().replace(/^"(.*)"$/, '$1');
  }

  private expandInterfaceTokens(token: string): string[] {
    const normalized = this.normalizeToken(token);
    const bracketRangeMatch = normalized.match(/^((?:ge|xe|et|mge)-\d+\/\d+\/)\[(\d+)-(\d+)\]$/);
    if (bracketRangeMatch) {
      return this.expandPortRange(`${bracketRangeMatch[1]}${bracketRangeMatch[2]}-${bracketRangeMatch[3]}`);
    }
    return this.expandPortRange(normalized);
  }

  private expandInterfaceRangeReferences(line: string, interfaceRangeMembers: Map<string, string[]>): string[] {
    const rstpMatch = line.match(/^set protocols rstp interface (\S+) (.+)$/);
    if (rstpMatch) {
      const members = interfaceRangeMembers.get(rstpMatch[1]);
      if (members && members.length > 0) {
        return members.map((member) =>
          this.normalizeSpacing(`set protocols rstp interface ${member} ${rstpMatch[2]}`),
        );
      }
    }

    const dot1xMatch = line.match(/^set protocols dot1x authenticator interface (\S+) (.+)$/);
    if (dot1xMatch) {
      const members = interfaceRangeMembers.get(dot1xMatch[1]);
      if (members && members.length > 0) {
        return members.map((member) =>
          this.normalizeSpacing(`set protocols dot1x authenticator interface ${member}.0 ${dot1xMatch[2]}`),
        );
      }
    }

    return [this.normalizeSpacing(line)];
  }

  private toUniqueNormalizedMap(lines: string[]): Map<string, string> {
    const map = new Map<string, string>();
    for (const line of lines) {
      map.set(this.normalizeLine(line), line);
    }
    return map;
  }

  private keepLastScalarAssignments(lines: string[]): string[] {
    const singletonPrefixes = [
      'set system host-name ',
      'set system time-zone ',
    ];

    const lastIndexByPrefix = new Map<string, number>();
    lines.forEach((line, index) => {
      const prefix = singletonPrefixes.find((candidate) => line.startsWith(candidate));
      if (prefix) {
        lastIndexByPrefix.set(prefix, index);
      }
    });

    return lines.filter((line, index) => {
      const prefix = singletonPrefixes.find((candidate) => line.startsWith(candidate));
      if (!prefix) return true;
      return lastIndexByPrefix.get(prefix) === index;
    });
  }

  /**
   * Categorize a config line by its hierarchy.
   */
  private categorize(line: string): string {
    if (line.includes('system name-server') || line.includes('system dns')) return 'DNS';
    if (line.includes('system ntp')) return 'NTP';
    if (line.includes('system host-name')) return 'Hostname';
    if (line.includes('system services')) return 'Services';
    if (line.includes('system login')) return 'Authentication';
    if (line.includes('interfaces irb') || line.includes('interfaces vme') || line.includes('interfaces me0')) return 'Management Interface';
    if (line.includes('interfaces ge-') || line.includes('interfaces xe-') || line.includes('interfaces et-') || line.includes('interfaces mge-')) return 'Port Config';
    if (line.includes('vlans')) return 'VLANs';
    if (line.includes('protocols')) return 'Protocols';
    if (line.includes('routing-options')) return 'Routing';
    if (line.includes('groups')) return 'Groups';
    if (line.includes('poe')) return 'PoE';
    return 'Other';
  }

  /**
   * Expand a Mist port range like "ge-0/0/0-11" into individual port names.
   */
  private expandPortRange(range: string): string[] {
    const match = range.match(/^((?:ge|xe|et|mge)-\d+\/\d+\/)(\d+)-(\d+)$/);
    if (match) {
      const prefix = match[1];
      const start = parseInt(match[2], 10);
      const end = parseInt(match[3], 10);
      const ports: string[] = [];
      for (let i = start; i <= end; i++) {
        ports.push(`${prefix}${i}`);
      }
      return ports;
    }
    // Single port
    return [range];
  }

  /**
   * Convert a dotted netmask to CIDR prefix length.
   */
  private netmaskToCidr(mask: string): number {
    const parts = mask.split('.').map(Number);
    let bits = 0;
    for (const part of parts) {
      bits += (part >>> 0).toString(2).split('1').length - 1;
    }
    return bits;
  }
}
