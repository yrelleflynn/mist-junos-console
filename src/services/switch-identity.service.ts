/**
 * switch-identity.service.ts — Identify the connected switch
 *
 * Extracts the switch serial number, MAC address, hostname, and model
 * from the console, then matches it against the Mist inventory.
 */

import { CommandRunnerService } from './command-runner.service';
import { MistApiService, MistInventoryDevice, MistDeviceConfig } from './mist-api.service';

export interface SwitchIdentity {
  hostname: string | null;
  serial: string | null;
  mac: string | null;
  model: string | null;
  junosVersion: string | null;
}

export interface MistMatchResult {
  identity: SwitchIdentity;
  mistDevice: MistInventoryDevice | null;
  mistConfig: MistDeviceConfig | null;
  matchedBy: 'serial' | 'mac' | 'name' | null;
  mistSiteName?: string | null;
  /**
   * Mist inventory `connected` when the API returns it (fresh from the same inventory fetch as the match).
   */
  mistInventoryConnected?: boolean | null;
  /** `stats/devices` status string when available (e.g. connected / disconnected). */
  mistStatsStatus?: string | null;
  /** True when `last_seen` is within the last 10 minutes (UTC vs API epoch). */
  mistRecentlySeen?: boolean | null;
  /**
   * Best-effort: Mist thinks the switch is reachable on the cloud path (inventory and/or stats).
   * Use for UI hints; console may still disagree if inventory is stale.
   */
  mistCloudReachableHint?: boolean;
  /** One-line summary for operators (inventory + stats). */
  mistCloudStatusLine?: string;
  /** `stats/devices` last_seen as ISO-8601 UTC (when available). */
  mistLastSeenUtcIso?: string | null;
  /** Best-effort last config time from stats or inventory (ISO-8601 UTC). */
  mistLastConfigUtcIso?: string | null;
}

export class SwitchIdentityService {
  private runner: CommandRunnerService;
  private mistApi: MistApiService;

  constructor(runner: CommandRunnerService, mistApi: MistApiService) {
    this.runner = runner;
    this.mistApi = mistApi;
  }

  getLaunchMistDevice(): MistInventoryDevice | null {
    return this.mistApi.getLaunchInventoryDevice();
  }

  private parseChassisHardware(output: string): Pick<SwitchIdentity, 'serial' | 'model'> {
    const lines = output.split('\n');

    for (const rawLine of lines) {
      const line = rawLine.replace(/\r/g, '');
      if (!/^\s*Chassis(?:\s{2,}|\s*$)/i.test(line)) continue;

      const columns = line.trim().split(/\s{2,}/).filter(Boolean);
      if (columns.length >= 3) {
        const candidateModel = this.sanitizeModel(columns[columns.length - 1]);
        const candidateSerial = this.sanitizeSerial(
          columns[columns.length - 2],
          candidateModel,
        );
        if (candidateModel || candidateSerial) {
          return { serial: candidateSerial, model: candidateModel };
        }
      }

      const tokens = line.trim().split(/\s+/).filter(Boolean);
      if (tokens.length >= 3) {
        const candidateModel = this.sanitizeModel(tokens[tokens.length - 1]);
        const candidateSerial = this.sanitizeSerial(tokens[tokens.length - 2], candidateModel);
        if (candidateModel || candidateSerial) {
          return { serial: candidateSerial, model: candidateModel };
        }
      }
    }

    return { serial: null, model: null };
  }

  private looksLikeModel(value: string | null | undefined): boolean {
    if (!value) return false;
    return /^(EX|QFX|SRX|MX|ACX|PTX|NFX|VQFX|VMX|VSRX)/i.test(value.trim());
  }

  private sanitizeHostname(value: string | null | undefined): string | null {
    if (!value) return null;
    const cleaned = value.trim().replace(/[;,\]:]+$/, '');
    if (!cleaned) return null;
    const lowered = cleaned.toLowerCase();
    if (lowered === 'host-name' || lowered === 'hostname') return null;
    return cleaned;
  }

  private sanitizeModel(value: string | null | undefined): string | null {
    if (!value) return null;
    const cleaned = value.trim().replace(/[;,\]]+$/, '').toUpperCase();
    return this.looksLikeModel(cleaned) ? cleaned : null;
  }

  private sanitizeSerial(value: string | null | undefined, model: string | null): string | null {
    if (!value) return null;
    const cleaned = value.trim().replace(/[;,\]]+$/, '');
    if (!cleaned) return null;
    if (model && cleaned.toUpperCase() === model.toUpperCase()) return null;
    if (this.looksLikeModel(cleaned)) return null;
    return cleaned;
  }

  private parseShowVersion(output: string): Pick<SwitchIdentity, 'hostname' | 'serial' | 'model' | 'junosVersion'> {
    let hostname: string | null = null;
    let serial: string | null = null;
    let model: string | null = null;
    let junosVersion: string | null = null;

    const lines = output
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0);

    for (const line of lines) {
      let match = line.match(/^Hostname:\s*(\S+)/i);
      if (match) {
        hostname = this.sanitizeHostname(match[1]);
        continue;
      }

      match = line.match(/^Model:\s*(\S+)/i);
      if (match) {
        model = this.sanitizeModel(match[1]);
        continue;
      }

      match = line.match(/^(?:System\s+serial\s+number|Serial number)\s*:\s*(\S+)/i);
      if (match) {
        serial = this.sanitizeSerial(match[1], model);
        continue;
      }

      match = line.match(/^Junos:\s*(\S+)/i);
      if (match) {
        junosVersion = match[1];
        continue;
      }

      match = line.match(/^JUNOS\s+\S+\s+\[(\S+)\]/i);
      if (match) {
        junosVersion = match[1];
      }
    }

    return { hostname, serial, model, junosVersion };
  }

  private parsePromptHostname(output: string): string | null {
    const promptMatches = [...output.matchAll(/[\w.-]+@([A-Za-z0-9._:-]+)[>#%]/g)];
    const lastMatch = promptMatches[promptMatches.length - 1];
    return this.sanitizeHostname(lastMatch?.[1] ?? null);
  }

  private parseMacAddress(output: string): string | null {
    const lines = output
      .split('\n')
      .map((line) => line.replace(/\r/g, '').trim())
      .filter((line) => line.length > 0);

    for (const line of lines) {
      if (!/^(?:Private\s+)?Base address\b/i.test(line)) continue;
      const match = line.match(/([0-9a-f]{2}(?::[0-9a-f]{2}){5})/i);
      if (match) {
        return match[1].toLowerCase();
      }
    }

    const uniqueMacs = [...new Set(
      lines.flatMap((line) => line.match(/([0-9a-f]{2}(?::[0-9a-f]{2}){5})/ig) ?? [])
    )];

    if (uniqueMacs.length === 1) {
      return uniqueMacs[0].toLowerCase();
    }

    return null;
  }

  private computeMistReachableHint(
    mistInventoryConnected: boolean | null,
    mistStatsStatus: string | null,
    mistRecentlySeen: boolean | null,
  ): boolean {
    const explicitlyDisconnected =
      mistInventoryConnected === false ||
      (mistStatsStatus != null && /disconnect|offline|unreachable|down|lost/i.test(mistStatsStatus));

    if (explicitlyDisconnected) return false;

    return (
      mistInventoryConnected === true ||
      (mistStatsStatus != null && /connected/i.test(mistStatsStatus)) ||
      mistRecentlySeen === true
    );
  }

  /**
   * Extract identity information from the connected switch.
   */
  async identify(options: { silent?: boolean } = {}): Promise<SwitchIdentity> {
    const identity: SwitchIdentity = {
      hostname: null,
      serial: null,
      mac: null,
      model: null,
      junosVersion: null,
    };

    // Prefer the live CLI prompt as the hostname source.
    const promptResult = await this.runner.sendAndWaitFor('\n', />\s*$|#\s*$|%\s*$/, 3000, {
      silent: options.silent,
    });
    if (promptResult.matched) {
      identity.hostname = this.parsePromptHostname(promptResult.output);
    }

    // Chassis hardware is the most reliable source for model/serial.
    const filteredChassisCmd = await this.runner.execute(
      'show chassis hardware | match "^Chassis"',
      15000,
      2000,
      { silent: options.silent },
    );
    if (filteredChassisCmd.success) {
      const parsed = this.parseChassisHardware(filteredChassisCmd.output);
      identity.serial = this.sanitizeSerial(parsed.serial, identity.model);
      identity.model = this.sanitizeModel(parsed.model);
    }

    if (!identity.serial || !identity.model) {
      const chassisCmd = await this.runner.execute('show chassis hardware', 15000, 2000, {
        silent: options.silent,
      });
      if (chassisCmd.success) {
        const parsed = this.parseChassisHardware(chassisCmd.output);
        identity.serial = identity.serial ?? this.sanitizeSerial(parsed.serial, identity.model);
        identity.model = identity.model ?? this.sanitizeModel(parsed.model);
      }
    }

    // Filtered version output is now mainly for Junos version and secondary fallback.
    const filteredVersionCmd = await this.runner.execute(
      'show version | match "^(Hostname:|Model:|Junos:|System serial number:|Serial number:)"',
      15000,
      2000,
      { silent: options.silent },
    );
    if (filteredVersionCmd.success) {
      const parsed = this.parseShowVersion(filteredVersionCmd.output);
      identity.hostname = identity.hostname ?? parsed.hostname;
      identity.serial = identity.serial ?? parsed.serial;
      identity.model = identity.model ?? parsed.model;
      identity.junosVersion = parsed.junosVersion;
    }

    if (!identity.hostname || !identity.serial || !identity.model || !identity.junosVersion) {
      const versionCmd = await this.runner.execute('show version', 15000, 2000, {
        silent: options.silent,
      });
      if (versionCmd.success) {
        const parsed = this.parseShowVersion(versionCmd.output);
        identity.hostname = identity.hostname ?? parsed.hostname;
        identity.serial = identity.serial ?? parsed.serial;
        identity.model = identity.model ?? parsed.model;
        identity.junosVersion = identity.junosVersion ?? parsed.junosVersion;
      }
    }

    if (!identity.hostname) {
      const hostnameCmd = await this.runner.execute('show configuration system host-name | display set', 10000, 2000, {
        silent: options.silent,
      });
      if (hostnameCmd.success) {
        const match = hostnameCmd.output.match(/(?:^|\n)\s*(?:set\s+system\s+)?host-name\s+(\S+)/m);
        if (match) identity.hostname = this.sanitizeHostname(match[1]);
      }
    }

    // Get MAC address
    const filteredMacCmd = await this.runner.execute(
      'show chassis mac-addresses | match "Base address"',
      10000,
      2000,
      { silent: options.silent },
    );
    if (filteredMacCmd.success) {
      identity.mac = this.parseMacAddress(filteredMacCmd.output);
    }
    if (!identity.mac) {
      const macCmd = await this.runner.execute('show chassis mac-addresses', 10000, 2000, {
        silent: options.silent,
      });
      if (macCmd.success) {
        identity.mac = this.parseMacAddress(macCmd.output);
      }
    }

    return identity;
  }

  /**
   * Identify the switch and match it to a device in the Mist inventory.
   * Returns the identity, the matched Mist device, and the Mist config.
   */
  async identifyAndMatch(options: { silent?: boolean } = {}): Promise<MistMatchResult> {
    const identity = await this.identify(options);
    let mistDevice: MistInventoryDevice | null = null;
    let matchedBy: 'serial' | 'mac' | 'name' | null = null;

    if (!this.mistApi.isConfigured && !this.mistApi.hasLaunchOverlay) {
      return {
        identity,
        mistDevice: null,
        mistConfig: null,
        matchedBy: null,
        mistSiteName: null,
        mistCloudReachableHint: false,
        mistLastSeenUtcIso: null,
        mistLastConfigUtcIso: null,
      };
    }

    // Try matching by serial first
    if (identity.serial) {
      mistDevice = await this.mistApi.findDeviceBySerial(identity.serial);
      if (mistDevice) matchedBy = 'serial';
    }

    // Fallback to MAC
    if (!mistDevice && identity.mac) {
      mistDevice = await this.mistApi.findDeviceByMac(identity.mac);
      if (mistDevice) matchedBy = 'mac';
    }

    if (!mistDevice && identity.hostname) {
      mistDevice = await this.mistApi.findDeviceByName(identity.hostname);
      if (mistDevice) matchedBy = 'name';
    }

    // Pull Mist config if we found the device
    let mistConfig: MistDeviceConfig | null = null;
    let mistSiteName: string | null = null;
    if (mistDevice && mistDevice.site_id) {
      try {
        mistConfig = await this.mistApi.getDeviceConfig(mistDevice.site_id, mistDevice.id);
      } catch {
        // Config pull failed — device may not be assigned to a site
      }
      try {
        const site = await this.mistApi.getSite(mistDevice.site_id);
        mistSiteName = site.name;
      } catch {
        // Site detail lookup failed — keep null and let the UI fall back if needed.
      }
    }

    if (mistDevice) {
      const mistName = typeof mistDevice.name === 'string' ? mistDevice.name : null;
      const mistHostname = typeof mistDevice.hostname === 'string' ? mistDevice.hostname : null;
      const mistSerial = typeof mistDevice.serial === 'string'
        ? mistDevice.serial
        : (typeof mistDevice.chassis_serial === 'string' ? mistDevice.chassis_serial : null);
      const mistModel = typeof mistDevice.model === 'string'
        ? mistDevice.model
        : (typeof mistDevice.chassis_model === 'string' ? mistDevice.chassis_model : null);

      identity.hostname = identity.hostname ?? this.sanitizeHostname(mistName ?? mistHostname);
      identity.serial = identity.serial ?? this.sanitizeSerial(mistSerial, identity.model);
      identity.model = identity.model ?? this.sanitizeModel(mistModel);
    }

    let mistInventoryConnected: boolean | null = null;
    let mistStatsStatus: string | null = null;
    let mistRecentlySeen: boolean | null = null;
    let mistCloudReachableHint = false;
    let mistCloudStatusLine = '';
    let mistLastSeenUtcIso: string | null = null;
    let mistLastConfigUtcIso: string | null = null;

    if (mistDevice) {
      if (typeof mistDevice.connected === 'boolean') {
        mistInventoryConnected = mistDevice.connected;
      }

      const devCfg = (mistDevice as Record<string, unknown>).last_config;
      if (typeof devCfg === 'number') {
        mistLastConfigUtcIso = new Date(devCfg * 1000).toISOString();
      }

      if (mistDevice.site_id) {
        const stats = await this.mistApi.getDeviceStats(mistDevice.site_id, mistDevice.id);
        if (stats) {
          if (typeof stats.status === 'string') mistStatsStatus = stats.status;
          if (typeof stats.last_seen === 'number') {
            mistLastSeenUtcIso = new Date(stats.last_seen * 1000).toISOString();
            const ageSec = Date.now() / 1000 - stats.last_seen;
            mistRecentlySeen = ageSec >= 0 && ageSec < 600;
          }
          const stCfg = (stats as Record<string, unknown>).last_config;
          if (typeof stCfg === 'number') {
            mistLastConfigUtcIso = new Date(stCfg * 1000).toISOString();
          }
        }
      }

      const parts: string[] = [];
      if (mistInventoryConnected === true) parts.push('inventory: connected');
      else if (mistInventoryConnected === false) parts.push('inventory: not connected');
      else parts.push('inventory: unknown');

      if (mistStatsStatus) parts.push(`stats: ${mistStatsStatus}`);
      if (mistRecentlySeen === true) parts.push('recent last_seen (<10m)');
      else if (mistRecentlySeen === false && mistDevice.site_id) parts.push('no recent last_seen');

      mistCloudReachableHint = this.computeMistReachableHint(
        mistInventoryConnected,
        mistStatsStatus,
        mistRecentlySeen,
      );

      mistCloudStatusLine = parts.join(' · ');
    }

    return {
      identity,
      mistDevice,
      mistConfig,
      matchedBy,
      mistSiteName,
      mistInventoryConnected,
      mistStatsStatus,
      mistRecentlySeen,
      mistCloudReachableHint,
      mistCloudStatusLine,
      mistLastSeenUtcIso,
      mistLastConfigUtcIso,
    };
  }

  /**
   * Re-query Mist for cloud reachability after remediation (adoption, config push, etc.).
   * Same heuristics as identify; does not re-run console identity commands.
   */
  async refreshMistCloudStatus(device: MistInventoryDevice): Promise<Pick<
    MistMatchResult,
    | 'mistInventoryConnected'
    | 'mistStatsStatus'
    | 'mistRecentlySeen'
    | 'mistCloudReachableHint'
    | 'mistCloudStatusLine'
    | 'mistLastSeenUtcIso'
    | 'mistLastConfigUtcIso'
  >> {
    if ((!this.mistApi.isConfigured && !this.mistApi.hasLaunchOverlay) || !device.site_id) {
      return {
        mistInventoryConnected: typeof device.connected === 'boolean' ? device.connected : null,
        mistStatsStatus: null,
        mistRecentlySeen: null,
        mistCloudReachableHint: device.connected === true,
        mistCloudStatusLine: 'API not configured or device has no site',
        mistLastSeenUtcIso: null,
        mistLastConfigUtcIso: null,
      };
    }

    let fresh: MistInventoryDevice | null = null;
    if (device.serial) {
      fresh = await this.mistApi.findDeviceBySerial(device.serial);
    }
    if (!fresh && device.mac) {
      fresh = await this.mistApi.findDeviceByMac(device.mac);
    }
    const d = fresh || device;
    let mistInventoryConnected: boolean | null =
      typeof d.connected === 'boolean' ? d.connected : null;

    let mistLastSeenUtcIso: string | null = null;
    let mistLastConfigUtcIso: string | null = null;
    const devCfg = (d as Record<string, unknown>).last_config;
    if (typeof devCfg === 'number') {
      mistLastConfigUtcIso = new Date(devCfg * 1000).toISOString();
    }

    const stats = await this.mistApi.getDeviceStats(d.site_id!, d.id);
    let mistStatsStatus: string | null = null;
    let mistRecentlySeen: boolean | null = null;
    if (stats) {
      if (typeof stats.status === 'string') mistStatsStatus = stats.status;
      if (typeof stats.last_seen === 'number') {
        mistLastSeenUtcIso = new Date(stats.last_seen * 1000).toISOString();
        const ageSec = Date.now() / 1000 - stats.last_seen;
        mistRecentlySeen = ageSec >= 0 && ageSec < 600;
      }
      const stCfg = (stats as Record<string, unknown>).last_config;
      if (typeof stCfg === 'number') {
        mistLastConfigUtcIso = new Date(stCfg * 1000).toISOString();
      }
    }

    const mistCloudReachableHint = this.computeMistReachableHint(
      mistInventoryConnected,
      mistStatsStatus,
      mistRecentlySeen,
    );

    const parts: string[] = [];
    if (mistInventoryConnected === true) parts.push('inventory: connected');
    else if (mistInventoryConnected === false) parts.push('inventory: not connected');
    else parts.push('inventory: unknown');
    if (mistStatsStatus) parts.push(`stats: ${mistStatsStatus}`);
    if (mistRecentlySeen === true) parts.push('recent last_seen (<10m)');

    return {
      mistInventoryConnected,
      mistStatsStatus,
      mistRecentlySeen,
      mistCloudReachableHint,
      mistCloudStatusLine: parts.join(' · '),
      mistLastSeenUtcIso,
      mistLastConfigUtcIso,
    };
  }

  /**
   * Pull the full Junos running config from the console as 'set' commands.
   */
  async getRunningConfig(): Promise<string> {
    // This can be a very large output — increase timeout significantly
    const cmd = await this.runner.execute('show configuration | display inheritance | display set', 60000, 5000);
    if (!cmd.success) {
      throw new Error(`Failed to get config: ${cmd.error}`);
    }
    return cmd.output;
  }
}
