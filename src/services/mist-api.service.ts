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

export interface MistOrg {
  id: string;
  name: string;
}

// Shape returned by GET /api/v1/self (only the fields we use)
interface MistSelfResponse {
  privileges?: Array<{
    scope?: string;
    org_id?: string;
    org_name?: string;
    name?: string;
    role?: string;
  }>;
  orgs?: Array<{
    id?: string;
    org_id?: string;
    name?: string;
    org_name?: string;
  }>;
  data?: {
    privileges?: Array<{
      scope?: string;
      org_id?: string;
      org_name?: string;
      name?: string;
      role?: string;
    }>;
    orgs?: Array<{
      id?: string;
      org_id?: string;
      name?: string;
      org_name?: string;
    }>;
    organizations?: Array<{
      id?: string;
      org_id?: string;
      name?: string;
      org_name?: string;
    }>;
  };
  organizations?: Array<{
    id?: string;
    org_id?: string;
    name?: string;
    org_name?: string;
  }>;
}

interface MistOrgDetailResponse {
  id?: string;
  name?: string;
}

export interface MistSiteSettings {
  switch_mgmt?: {
    root_password?: string;
  };
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

export interface MistLaunchOverlay {
  siteId?: string | null;
  deviceId?: string | null;
  orgId?: string | null;
  siteName?: string | null;
  orgName?: string | null;
  deviceName?: string | null;
  deviceSerial?: string | null;
  deviceMac?: string | null;
  deviceRootPassword?: string | null;
  deviceConfig?: MistDeviceConfig | null;
  mistMonitor?: {
    mistInventoryConnected?: boolean | null;
    mistStatsStatus?: string | null;
    mistRecentlySeen?: boolean | null;
    mistCloudReachableHint?: boolean | null;
    mistCloudStatusLine?: string | null;
    mistLastSeenUtcIso?: string | null;
    mistLastConfigUtcIso?: string | null;
  } | null;
  deviceEvents?: MistDeviceEvent[] | null;
}

export class MistApiService {
  private proxyBase: string;
  private apiToken: string;
  private apiHost: string;
  private orgId: string;
  private launchOverlay: MistLaunchOverlay | null;

  constructor(proxyBase = '') {
    this.proxyBase = proxyBase;
    this.apiToken = '';
    this.apiHost = '';
    this.orgId = '';
    this.launchOverlay = null;
  }

  configure(apiToken: string, apiHost: string, orgId: string): void {
    this.apiToken = apiToken;
    this.apiHost = apiHost;
    this.orgId = orgId;
  }

  get isConfigured(): boolean {
    return this.apiToken.length > 0 && this.apiHost.length > 0 && this.orgId.length > 0;
  }

  get hasLaunchOverlay(): boolean {
    return !!this.launchOverlay;
  }

  setLaunchOverlay(overlay: MistLaunchOverlay | null): void {
    this.launchOverlay = overlay;
  }

  private matchesLaunchSite(siteId: string): boolean {
    return !!this.launchOverlay?.siteId && this.launchOverlay.siteId === siteId;
  }

  private matchesLaunchDevice(siteId: string, deviceId: string): boolean {
    return this.matchesLaunchSite(siteId) && !!this.launchOverlay?.deviceId && this.launchOverlay.deviceId === deviceId;
  }

  private buildLaunchInventoryDevice(): MistInventoryDevice | null {
    if (!this.launchOverlay?.deviceId || !this.launchOverlay.siteId) return null;
    return {
      id: this.launchOverlay.deviceId,
      mac: this.launchOverlay.deviceMac ?? '',
      serial: this.launchOverlay.deviceSerial ?? '',
      model: '',
      type: 'switch',
      name: this.launchOverlay.deviceName ?? undefined,
      site_id: this.launchOverlay.siteId,
      connected: this.launchOverlay.mistMonitor?.mistInventoryConnected ?? undefined,
    };
  }

  getLaunchInventoryDevice(): MistInventoryDevice | null {
    return this.buildLaunchInventoryDevice();
  }

  /**
   * Make a proxied GET request to the Mist API.
   */
  private async get<T>(path: string): Promise<T> {
    return this.getWithCredentials<T>(this.apiToken, this.apiHost, path);
  }

  /**
   * Make a proxied GET request using explicit credentials (for pre-configuration calls
   * such as GET /api/v1/self before orgId is known).
   */
  private async getWithCredentials<T>(token: string, apiHost: string, path: string): Promise<T> {
    const url = `${this.proxyBase}/mist-proxy`;
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        apiHost,
        apiToken: token,
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
   * Make a proxied POST request to the Mist API.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private async post<T>(path: string, body: any): Promise<T> {
    const url = `${this.proxyBase}/mist-proxy`;
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        apiHost: this.apiHost,
        apiToken: this.apiToken,
        method: 'POST',
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

  async getSite(siteId: string): Promise<MistSite> {
    if (this.matchesLaunchSite(siteId) && this.launchOverlay?.siteName) {
      return { id: siteId, name: this.launchOverlay.siteName };
    }
    const site = await this.get<MistSite>(`/api/v1/sites/${siteId}`);
    return { id: site.id, name: site.name };
  }

  /**
   * Fetch the list of orgs accessible to the supplied token via GET /api/v1/self.
   * Uses explicit credentials so this can be called before orgId is configured.
   */
  async getAccessibleOrgs(token: string, apiHost: string): Promise<MistOrg[]> {
    const self = await this.getWithCredentials<MistSelfResponse | MistSelfResponse['privileges']>(token, apiHost, '/api/v1/self');
    const selfObj: MistSelfResponse = Array.isArray(self) ? { privileges: self } : (self ?? {});
    const privileges =
      selfObj.privileges
      ?? selfObj.data?.privileges
      ?? [];
    const topLevelOrgs =
      selfObj.orgs
      ?? selfObj.organizations
      ?? selfObj.data?.orgs
      ?? selfObj.data?.organizations
      ?? [];
    const orgMap = new Map<string, MistOrg>();
    const unresolvedOrgIds = new Set<string>();
    const orgScopedPrivileges = privileges.filter((p) => p.scope === 'org' && p.org_id);
    const fallbackPrivileges = orgScopedPrivileges.length > 0
      ? orgScopedPrivileges
      : privileges.filter((p) => p.org_id);

    for (const p of fallbackPrivileges) {
      if (p.org_id) {
        const name = p.name ?? p.org_name ?? '';
        if (!orgMap.has(p.org_id)) {
          orgMap.set(p.org_id, { id: p.org_id, name: name || p.org_id });
        }
        if (!name) {
          unresolvedOrgIds.add(p.org_id);
        }
      }
    }

    for (const org of topLevelOrgs) {
      const orgId = org.id ?? org.org_id ?? '';
      if (!orgId) continue;
      const name = org.name ?? org.org_name ?? '';
      if (!orgMap.has(orgId)) {
        orgMap.set(orgId, { id: orgId, name: name || orgId });
      }
      if (!name) {
        unresolvedOrgIds.add(orgId);
      }
    }

    await Promise.all(
      Array.from(unresolvedOrgIds).map(async (orgId) => {
        try {
          const org = await this.getWithCredentials<MistOrgDetailResponse>(
            token,
            apiHost,
            `/api/v1/orgs/${orgId}`,
          );
          const resolvedName = org.name?.trim();
          if (resolvedName) {
            orgMap.set(orgId, { id: orgId, name: resolvedName });
          }
        } catch {
          // Keep the org ID fallback if detail lookup is unavailable.
        }
      }),
    );

    return Array.from(orgMap.values());
  }

  /**
   * Fetch site settings, including switch_mgmt.root_password.
   */
  async getSiteSettings(siteId: string): Promise<MistSiteSettings> {
    if (this.matchesLaunchSite(siteId) && this.launchOverlay?.deviceRootPassword) {
      return {
        switch_mgmt: {
          root_password: this.launchOverlay.deviceRootPassword,
        },
      };
    }
    return this.get<MistSiteSettings>(`/api/v1/sites/${siteId}/setting`);
  }

  /**
   * Convenience: get root password for a site's switches.
   */
  async getRootPassword(siteId: string): Promise<string | null> {
    if (this.matchesLaunchSite(siteId) && this.launchOverlay?.deviceRootPassword) {
      return this.launchOverlay.deviceRootPassword;
    }
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
    const launchDevice = this.buildLaunchInventoryDevice();
    if (launchDevice) return [launchDevice];
    return this.get<MistInventoryDevice[]>(`/api/v1/orgs/${this.orgId}/inventory?type=switch`);
  }

  /**
   * Find a device in the Mist inventory by serial number.
   * Uses the targeted serial-filter endpoint for efficiency on large orgs.
   */
  async findDeviceBySerial(serial: string): Promise<MistInventoryDevice | null> {
    const launchDevice = this.buildLaunchInventoryDevice();
    if (launchDevice?.serial?.toLowerCase() === serial.toLowerCase()) {
      return launchDevice;
    }
    try {
      const results = await this.get<MistInventoryDevice[]>(
        `/api/v1/orgs/${this.orgId}/inventory?serial=${encodeURIComponent(serial)}&type=switch`,
      );
      const match = results.find((d) => d.serial?.toLowerCase() === serial.toLowerCase());
      return match ?? null;
    } catch {
      return null;
    }
  }

  /**
   * Find a device in the Mist inventory by MAC address.
   * Falls back to full inventory scan since the API does not support MAC-filter on this endpoint.
   */
  async findDeviceByMac(mac: string): Promise<MistInventoryDevice | null> {
    const launchDevice = this.buildLaunchInventoryDevice();
    if ((launchDevice?.mac ?? '').toLowerCase().replace(/[:-]/g, '') === mac.toLowerCase().replace(/[:-]/g, '')) {
      return launchDevice;
    }
    try {
      const normalized = mac.toLowerCase().replace(/[:-]/g, '');
      const inventory = await this.getInventory();
      const match = inventory.find((d) => {
        const deviceMac = d.mac?.toLowerCase().replace(/[:-]/g, '') || '';
        return deviceMac === normalized;
      });
      return match ?? null;
    } catch {
      return null;
    }
  }

  /**
   * Find a device in the Mist inventory by name (hostname).
   */
  async findDeviceByName(name: string): Promise<MistInventoryDevice | null> {
    const launchDevice = this.buildLaunchInventoryDevice();
    if (launchDevice?.name?.toLowerCase() === name.toLowerCase()) {
      return launchDevice;
    }
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
    if (this.matchesLaunchDevice(siteId, deviceId) && this.launchOverlay?.deviceConfig) {
      return this.launchOverlay.deviceConfig;
    }
    return this.get<MistDeviceConfig>(`/api/v1/sites/${siteId}/devices/${deviceId}/config_cmd`);
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
    if (this.matchesLaunchDevice(siteId, deviceId) && this.launchOverlay?.deviceEvents) {
      return this.launchOverlay.deviceEvents.slice(0, limit);
    }
    try {
      const data = await this.get<{ results?: MistDeviceEvent[] } | MistDeviceEvent[]>(
        `/api/v1/sites/${siteId}/devices/events/search?device_id=${encodeURIComponent(deviceId)}&limit=${limit}`,
      );
      if (Array.isArray(data)) return data;
      if (data && 'results' in data && Array.isArray(data.results)) return data.results;
    } catch {
      try {
        const data = await this.post<{ results?: MistDeviceEvent[] } | MistDeviceEvent[]>(
          `/api/v1/sites/${siteId}/devices/events/search`,
          { device_id: deviceId, limit },
        );
        if (Array.isArray(data)) return data;
        if (data && 'results' in data && Array.isArray(data.results)) return data.results;
      } catch {
        const data = await this.get<{ results?: MistDeviceEvent[] } | MistDeviceEvent[]>(
          `/api/v1/sites/${siteId}/devices/events?device_id=${encodeURIComponent(deviceId)}&limit=${limit}`
        );
        if (Array.isArray(data)) return data;
        if (data && 'results' in data && Array.isArray(data.results)) return data.results;
      }
    }
    return [];
  }

  /**
   * Fetch device stats including last_seen timestamp.
   */
  async getDeviceStats(siteId: string, deviceId: string): Promise<MistDeviceStats | null> {
    if (this.matchesLaunchDevice(siteId, deviceId) && this.launchOverlay?.mistMonitor) {
      const monitor = this.launchOverlay.mistMonitor;
      let lastSeen;
      if (monitor.mistLastSeenUtcIso) {
        const epoch = Math.floor(new Date(monitor.mistLastSeenUtcIso).getTime() / 1000);
        lastSeen = Number.isFinite(epoch) ? epoch : undefined;
      }
      let lastConfig;
      if (monitor.mistLastConfigUtcIso) {
        const epoch = Math.floor(new Date(monitor.mistLastConfigUtcIso).getTime() / 1000);
        lastConfig = Number.isFinite(epoch) ? epoch : undefined;
      }
      return {
        last_seen: lastSeen,
        last_config: lastConfig,
        status: monitor.mistStatsStatus ?? undefined,
      };
    }
    try {
      return await this.get<MistDeviceStats>(`/api/v1/sites/${siteId}/stats/devices/${deviceId}`);
    } catch {
      return null;
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
  /** Unix epoch seconds when Mist last pushed/applied config (when API provides it). */
  last_config?: number;
  status?: string;
  uptime?: number;
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
