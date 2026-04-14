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
  matchedBy: 'serial' | 'mac' | null;
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

  /**
   * Extract identity information from the connected switch.
   */
  async identify(): Promise<SwitchIdentity> {
    const identity: SwitchIdentity = {
      hostname: null,
      serial: null,
      mac: null,
      model: null,
      junosVersion: null,
    };

    // Get hostname
    const hostnameCmd = await this.runner.execute('show configuration system host-name', 10000);
    if (hostnameCmd.success) {
      const match = hostnameCmd.output.match(/host-name\s+(\S+)/);
      if (match) identity.hostname = match[1].replace(';', '');
    }

    // Get serial number and model from chassis hardware
    const chassisCmd = await this.runner.execute('show chassis hardware | match Chassis', 15000);
    if (chassisCmd.success) {
      // Format: "Chassis        EX2300-C-12P      HW....  Serial-Number"
      const lines = chassisCmd.output.split('\n').filter((l) => /Chassis/i.test(l) && !l.includes('Routing'));
      if (lines.length > 0) {
        const parts = lines[0].trim().split(/\s+/);
        // Serial is typically the last column
        if (parts.length >= 2) {
          identity.serial = parts[parts.length - 1];
        }
        // Model is typically the second column
        if (parts.length >= 3) {
          identity.model = parts[1];
        }
      }
    }

    // Fallback: get serial from show version
    if (!identity.serial) {
      const versionCmd = await this.runner.execute('show version', 15000);
      if (versionCmd.success) {
        const serialMatch = versionCmd.output.match(/(?:Serial number|Chassis)\s*[:=]?\s*(\S+)/i);
        if (serialMatch) identity.serial = serialMatch[1];

        const modelMatch = versionCmd.output.match(/Model:\s*(\S+)/i);
        if (modelMatch) identity.model = modelMatch[1];

        const junosMatch = versionCmd.output.match(/Junos:\s*(\S+)/i) ||
                          versionCmd.output.match(/JUNOS\s+\S+\s+\[(\S+)\]/);
        if (junosMatch) identity.junosVersion = junosMatch[1];
      }
    }

    // Get MAC address
    const macCmd = await this.runner.execute('show chassis mac-addresses', 10000);
    if (macCmd.success) {
      const macMatch = macCmd.output.match(/([0-9a-f]{2}:[0-9a-f]{2}:[0-9a-f]{2}:[0-9a-f]{2}:[0-9a-f]{2}:[0-9a-f]{2})/i);
      if (macMatch) identity.mac = macMatch[1].toLowerCase();
    }

    return identity;
  }

  /**
   * Identify the switch and match it to a device in the Mist inventory.
   * Returns the identity, the matched Mist device, and the Mist config.
   */
  async identifyAndMatch(): Promise<MistMatchResult> {
    const identity = await this.identify();
    let mistDevice: MistInventoryDevice | null = null;
    let matchedBy: 'serial' | 'mac' | null = null;

    if (!this.mistApi.isConfigured) {
      return {
        identity,
        mistDevice: null,
        mistConfig: null,
        matchedBy: null,
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

    // Pull Mist config if we found the device
    let mistConfig: MistDeviceConfig | null = null;
    if (mistDevice && mistDevice.site_id) {
      try {
        mistConfig = await this.mistApi.getDeviceConfig(mistDevice.site_id, mistDevice.id);
      } catch {
        // Config pull failed — device may not be assigned to a site
      }
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

      mistCloudReachableHint =
        mistInventoryConnected === true ||
        (mistStatsStatus != null && /connected/i.test(mistStatsStatus)) ||
        mistRecentlySeen === true;

      mistCloudStatusLine = parts.join(' · ');
    }

    return {
      identity,
      mistDevice,
      mistConfig,
      matchedBy,
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
    if (!this.mistApi.isConfigured || !device.site_id) {
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

    const mistCloudReachableHint =
      mistInventoryConnected === true ||
      (mistStatsStatus != null && /connected/i.test(mistStatsStatus)) ||
      mistRecentlySeen === true;

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
    const cmd = await this.runner.execute('show configuration | display set', 60000, 5000);
    if (!cmd.success) {
      throw new Error(`Failed to get config: ${cmd.error}`);
    }
    return cmd.output;
  }
}
