/**
 * mist-api.service.ts — Mist API client (via local proxy)
 *
 * Communicates with the Mist REST API through a local proxy server
 * to avoid CORS restrictions. Provides methods for fetching sites,
 * site settings (including root password), inventory, and device config.
 */

export interface MistSite {
  id: string;
  name: string;
}

export interface MistSiteSettings {
  switch_mgmt?: {
    root_password?: string;
  };
  networktemplate_id?: string;
  sitegroup_ids?: string[];
}

export interface MistSiteGroup {
  id: string;
  name?: string;
  networktemplate_id?: string;
  site_ids?: string[];
}

export interface MistNetworkTemplate {
  id: string;
  name?: string;
  root_password?: string;
  switch_mgmt?: {
    root_password?: string;
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [key: string]: any;
}

export interface MistInventoryDevice {
  id: string;
  mac: string;
  serial: string;
  model: string;
  type: string;
  name?: string;
  site_id?: string;
  connected?: boolean;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [key: string]: any;
}

export interface MistDeviceConfig {
  id: string;
  name?: string;
  site_id?: string;
  type?: string;
  model?: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [key: string]: any;
}

export class MistApiService {
  private proxyBase: string;
  private apiToken: string;
  private apiHost: string;
  private orgId: string;

  constructor(proxyBase = '') {
    this.proxyBase = proxyBase;
    this.apiToken = '';
    this.apiHost = '';
    this.orgId = '';
  }

  configure(apiToken: string, apiHost: string, orgId: string): void {
    this.apiToken = apiToken;
    this.apiHost = apiHost;
    this.orgId = orgId;
  }

  get isConfigured(): boolean {
    return this.apiToken.length > 0 && this.apiHost.length > 0 && this.orgId.length > 0;
  }

  /**
   * Make a proxied GET request to the Mist API.
   */
  private async get<T>(path: string): Promise<T> {
    const url = `${this.proxyBase}/mist-proxy`;
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        apiHost: this.apiHost,
        apiToken: this.apiToken,
        method: 'GET',
        path,
      }),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Mist API error ${response.status}: ${text}`);
    }

    return response.json() as Promise<T>;
  }

  /**
   * Make a proxied PUT request to the Mist API.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private async put<T>(path: string, body: any): Promise<T> {
    const url = `${this.proxyBase}/mist-proxy`;
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        apiHost: this.apiHost,
        apiToken: this.apiToken,
        method: 'PUT',
        path,
        body,
      }),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Mist API error ${response.status}: ${text}`);
    }

    return response.json() as Promise<T>;
  }

  /**
   * Fetch all sites in the org.
   */
  async listSites(): Promise<MistSite[]> {
    const data = await this.get<MistSite[]>(`/api/v1/orgs/${this.orgId}/sites`);
    return data.map((s) => ({ id: s.id, name: s.name }));
  }

  /**
   * Fetch site settings (local overrides only).
   */
  async getSiteSettings(siteId: string): Promise<MistSiteSettings> {
    return this.get<MistSiteSettings>(`/api/v1/sites/${siteId}/setting`);
  }

  /**
   * Fetch derived site settings — the effective merged config including
   * settings inherited from site groups and org level.
   * Use this to reliably find networktemplate_id even when assigned via a site group.
   */
  async getSiteDerivedSettings(siteId: string): Promise<MistSiteSettings> {
    return this.get<MistSiteSettings>(`/api/v1/sites/${siteId}/setting/derived`);
  }

  /**
   * Fetch a network (switch) template by ID.
   * Throws on API error so callers can surface the failure reason.
   */
  async getNetworkTemplate(templateId: string): Promise<MistNetworkTemplate> {
    return this.get<MistNetworkTemplate>(`/api/v1/orgs/${this.orgId}/networktemplates/${templateId}`);
  }

  /**
   * Fetch all site groups for the org.
   * Used to find network templates assigned at the site-group level.
   */
  async getOrgSiteGroups(): Promise<MistSiteGroup[]> {
    return this.get<MistSiteGroup[]>(`/api/v1/orgs/${this.orgId}/sitegroups`);
  }

  /**
   * Convenience: get root password for a site's switches.
   */
  async getRootPassword(siteId: string): Promise<string | null> {
    try {
      const settings = await this.getSiteSettings(siteId);
      return settings.switch_mgmt?.root_password ?? null;
    } catch {
      return null;
    }
  }

  /**
   * Fetch org inventory (all devices).
   */
  async getInventory(): Promise<MistInventoryDevice[]> {
    return this.get<MistInventoryDevice[]>(`/api/v1/orgs/${this.orgId}/inventory?type=switch`);
  }

  /**
   * Find a device in the Mist inventory by serial number.
   */
  async findDeviceBySerial(serial: string): Promise<MistInventoryDevice | null> {
    try {
      const inventory = await this.getInventory();
      const match = inventory.find((d) =>
        d.serial?.toLowerCase() === serial.toLowerCase()
      );
      return match || null;
    } catch {
      return null;
    }
  }

  /**
   * Find a device in the Mist inventory by MAC address.
   */
  async findDeviceByMac(mac: string): Promise<MistInventoryDevice | null> {
    try {
      const normalized = mac.toLowerCase().replace(/[:-]/g, '');
      const inventory = await this.getInventory();
      const match = inventory.find((d) => {
        const deviceMac = d.mac?.toLowerCase().replace(/[:-]/g, '') || '';
        return deviceMac === normalized;
      });
      return match || null;
    } catch {
      return null;
    }
  }

  /**
   * Find a device in the Mist inventory by name (hostname).
   */
  async findDeviceByName(name: string): Promise<MistInventoryDevice | null> {
    try {
      const inventory = await this.getInventory();
      const match = inventory.find((d) =>
        d.name?.toLowerCase() === name.toLowerCase()
      );
      return match || null;
    } catch {
      return null;
    }
  }

  /**
   * Fetch the Mist device configuration (intended config).
   */
  async getDeviceConfig(siteId: string, deviceId: string): Promise<MistDeviceConfig> {
    return this.get<MistDeviceConfig>(`/api/v1/sites/${siteId}/devices/${deviceId}`);
  }

  /**
   * Update the device-level port_config and/or port_usages via PUT.
   * This applies device-level overrides in Mist.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async updateDeviceConfig(siteId: string, deviceId: string, update: Record<string, any>): Promise<MistDeviceConfig> {
    return this.put<MistDeviceConfig>(`/api/v1/sites/${siteId}/devices/${deviceId}`, update);
  }

  /**
   * Assign a device (by MAC) to a site in the org inventory.
   */
  async assignDeviceToSite(mac: string, siteId: string): Promise<void> {
    await this.put(`/api/v1/orgs/${this.orgId}/inventory`, {
      op: 'assign',
      site_id: siteId,
      macs: [mac],
      managed: true,
    });
  }

  /**
   * Fetch the switch adoption CLI commands for this org.
   * Returns the raw 'set' commands string that can be pasted into the switch console.
   */
  async getAdoptionCommands(): Promise<string> {
    // The API may return a JSON object with a 'cmd' field, or raw text
    const data = await this.get<{ cmd?: string } | string>(
      `/api/v1/orgs/${this.orgId}/ocdevices/outbound_ssh_cmd`
    );

    if (typeof data === 'string') {
      return data;
    }
    if (data && typeof data === 'object') {
      // Try common field names
      if ('cmd' in data && typeof data.cmd === 'string') return data.cmd;
      // If the response is an object, try to extract any string value
      const values = Object.values(data);
      for (const val of values) {
        if (typeof val === 'string' && val.includes('set system')) return val;
      }
      // Last resort — stringify the response
      return JSON.stringify(data, null, 2);
    }
    throw new Error('Unexpected response format from adoption commands endpoint');
  }

  /**
   * Fetch device events (connect/disconnect, config changes, etc.)
   */
  async getDeviceEvents(siteId: string, deviceId: string, limit = 20): Promise<MistDeviceEvent[]> {
    const data = await this.get<{ results?: MistDeviceEvent[] } | MistDeviceEvent[]>(
      `/api/v1/sites/${siteId}/devices/events?device_id=${deviceId}&limit=${limit}`
    );
    if (Array.isArray(data)) return data;
    if (data && 'results' in data && Array.isArray(data.results)) return data.results;
    return [];
  }

  /**
   * Fetch device stats including last_seen timestamp.
   */
  async getDeviceStats(siteId: string, deviceId: string): Promise<MistDeviceStats | null> {
    try {
      return await this.get<MistDeviceStats>(`/api/v1/sites/${siteId}/stats/devices/${deviceId}`);
    } catch {
      return null;
    }
  }

  /**
   * Fetch the rendered CLI configuration for a managed switch.
   * Endpoint: GET /api/v1/sites/{site_id}/devices/{device_id}/config_cmd
   * Returns the Junos "set" commands Mist would push to the device.
   */
  async getDeviceConfigCmd(siteId: string, deviceId: string): Promise<string> {
    try {
      const data = await this.get<{ cmd?: string; config?: string } | string>(
        `/api/v1/sites/${siteId}/devices/${deviceId}/config_cmd`,
      );
      if (typeof data === 'string') return data;
      if (data && typeof data === 'object') {
        if ('cmd' in data && typeof data.cmd === 'string') return data.cmd;
        if ('config' in data && typeof data.config === 'string') return data.config;
        // Last resort — return first string value found
        for (const val of Object.values(data)) {
          if (typeof val === 'string' && val.length > 0) return val;
        }
      }
      return '';
    } catch {
      return '';
    }
  }

  /**
   * Fetch per-port stats for a switch using the org-level port search endpoint.
   * Returns an array of port stat objects, each containing port_id and stp_state.
   * Endpoint: GET /api/v1/orgs/{org_id}/stats/ports/search?site_id={site_id}&mac={switch_mac}
   */
  async getPortStats(siteId: string, switchMac: string): Promise<MistPortStat[]> {
    try {
      const mac = switchMac.toLowerCase().replace(/[:-]/g, '');
      const data = await this.get<{ results?: MistPortStat[] } | MistPortStat[]>(
        `/api/v1/orgs/${this.orgId}/stats/ports/search?site_id=${siteId}&mac=${mac}`,
      );
      if (Array.isArray(data)) return data;
      if (data && 'results' in data && Array.isArray(data.results)) return data.results;
      return [];
    } catch {
      return [];
    }
  }

  /**
   * Fetch org-level audit logs.
   * Optionally filter by time range (Unix timestamps in seconds).
   */
  async getAuditLogs(start?: number, end?: number, limit = 100): Promise<MistAuditLog[]> {
    let path = `/api/v1/orgs/${this.orgId}/logs?limit=${limit}`;
    if (start) path += `&start=${start}`;
    if (end) path += `&end=${end}`;
    try {
      const data = await this.get<{ results?: MistAuditLog[] } | MistAuditLog[]>(path);
      if (Array.isArray(data)) return data;
      if (data && 'results' in data && Array.isArray(data.results)) return data.results;
      return [];
    } catch {
      return [];
    }
  }
}

export interface MistDeviceEvent {
  timestamp?: number;
  type?: string;
  text?: string;
  reason?: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [key: string]: any;
}

export interface MistDeviceStats {
  last_seen?: number;
  status?: string;
  uptime?: number;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [key: string]: any;
}

export interface MistPortStat {
  port_id: string;
  stp_state?: string;
  up?: boolean;
  port_disabled?: boolean;
  rx_bytes?: number;
  tx_bytes?: number;
  mac?: string;
  site_id?: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [key: string]: any;
}

export interface MistAuditLog {
  timestamp?: number;
  admin_name?: string;
  message?: string;
  site_id?: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [key: string]: any;
}
