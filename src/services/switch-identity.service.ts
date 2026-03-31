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
      return { identity, mistDevice: null, mistConfig: null, matchedBy: null };
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

    return { identity, mistDevice, mistConfig, matchedBy };
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
