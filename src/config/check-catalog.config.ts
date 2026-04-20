export interface CatalogCheck {
  id: string;
  name: string;
  desc: string;
  requiresCloud: boolean;   // needs MistCloud for endpoint URLs
  requiresMistApi: boolean; // needs siteId+deviceId
}

export interface CatalogGroup {
  id: string;
  name: string;
  checks: CatalogCheck[];
}

export const CATALOG_GROUPS: CatalogGroup[] = [
  {
    id: 'layer2',
    name: 'Layer 2',
    checks: [
      { id: 'lldp',             name: 'LLDP Neighbors',     desc: 'LLDP neighbors and nominated-port match when provided',                      requiresCloud: false, requiresMistApi: false },
      { id: 'upstream-port-config', name: 'Upstream Port Config', desc: 'Mist-managed upstream switch port profile and settings',                requiresCloud: false, requiresMistApi: false },
      { id: 'port-status',      name: 'Uplink Port Status',  desc: 'Physical state and speed of the uplink interface',                            requiresCloud: false, requiresMistApi: false },
      { id: 'interface-errors', name: 'Interface Errors',    desc: 'Error, CRC and drop counters on the uplink interface',                        requiresCloud: false, requiresMistApi: false },
      { id: 'vlan-config',      name: 'VLAN Config',         desc: 'Management VLAN membership on the uplink interface',                          requiresCloud: false, requiresMistApi: false },
      { id: 'uplink-config-compare', name: 'Uplink Config Match', desc: 'Compare local uplink config to the Mist-managed upstream port intent',  requiresCloud: false, requiresMistApi: false },
    ],
  },
  {
    id: 'ip-routing',
    name: 'IP / Routing',
    checks: [
      { id: 'mgmt-ip',        name: 'Interface IP Summary', desc: 'IPv4 interfaces, status, and whether config is static or DHCP', requiresCloud: false, requiresMistApi: false },
      { id: 'dhcp-lease',     name: 'DHCP Lease',      desc: 'Active DHCP binding — server, IP, mask, gateway, DNS',         requiresCloud: false, requiresMistApi: false },
      { id: 'arp',            name: 'Gateway Reachability', desc: 'Ping and ARP evidence for discovered default-route gateways', requiresCloud: false, requiresMistApi: false },
      { id: 'default-route',  name: 'Default Routes',  desc: 'Active default routes in inet.0 and mgmt_junos.inet.0',         requiresCloud: false, requiresMistApi: false },
      { id: 'route-to-mist',  name: 'Route to Mist',  desc: 'Routing table entry for Mist cloud endpoints',                  requiresCloud: true,  requiresMistApi: false },
    ],
  },
  {
    id: 'dns',
    name: 'DNS',
    checks: [
      { id: 'dns-config',               name: 'DNS Config',       desc: 'Name servers configured via DHCP or static',                requiresCloud: false, requiresMistApi: false },
      { id: 'dns-server-reachability',  name: 'DNS Reachability', desc: 'ICMP ping to each configured name server',                  requiresCloud: false, requiresMistApi: false },
      { id: 'dns-resolution',           name: 'DNS Resolution',   desc: 'Resolves Mist endpoints and google.com',                    requiresCloud: true,  requiresMistApi: false },
    ],
  },
  {
    id: 'mist-agent',
    name: 'Mist Agent',
    checks: [
      { id: 'mist-agent',          name: 'Agent Version',            desc: 'Installed Mist agent package and version',                                    requiresCloud: false, requiresMistApi: false },
      { id: 'mist-processes',      name: 'Agent Processes',          desc: 'mcd and jmd daemons are running',                                             requiresCloud: false, requiresMistApi: false },
      { id: 'outbound-ssh-config', name: 'Outbound SSH Config',      desc: 'outbound-ssh client "mist" configured with secret and device-id',             requiresCloud: false, requiresMistApi: false },
      { id: 'cloud-connections',   name: 'Active Cloud Connections', desc: 'Current TCP/443 session state for cloud connectivity',                         requiresCloud: false, requiresMistApi: false },
    ],
  },
  {
    id: 'cloud-reachability',
    name: 'Cloud Reachability',
    checks: [
      { id: 'fw-check',       name: 'Firewall / SSL Policy', desc: 'TCP port reachability and SSL certificate inspection detection', requiresCloud: true,  requiresMistApi: false },
      { id: 'mist-last-seen', name: 'Offline Timeline',      desc: 'Correlate Mist events and switch logs around disconnect time',  requiresCloud: true,  requiresMistApi: true  },
    ],
  },
];

/** All check IDs in catalog order — used for Run All */
export const ALL_CATALOG_CHECK_IDS: string[] = CATALOG_GROUPS.flatMap(g => g.checks.map(c => c.id));

/** Look up a catalog check definition by its ID */
export function getCatalogCheck(id: string): CatalogCheck | undefined {
  return CATALOG_GROUPS.flatMap(g => g.checks).find(c => c.id === id);
}

/** Get the group a catalog check belongs to */
export function getCatalogGroupChecks(groupId: string): CatalogCheck[] {
  return CATALOG_GROUPS.find(g => g.id === groupId)?.checks ?? [];
}

/**
 * Map a raw CheckResult.id (as returned by runRecommendedChecks onProgress)
 * to the catalog row it belongs to.
 * - fw-policy-* and fw-inspect-* → fw-check
 * - mist-last-seen, mist-events, switch-uptime, mist-audit-logs, switch-logs* → mist-last-seen
 */
export function resultIdToCatalogId(resultId: string): string {
  if (resultId.startsWith('fw-policy-') || resultId.startsWith('fw-inspect-')) return 'fw-check';
  const timelineIds = ['mist-last-seen', 'mist-events', 'switch-uptime', 'mist-audit-logs'];
  if (timelineIds.includes(resultId) || resultId.startsWith('switch-logs')) return 'mist-last-seen';
  const skippedMap: Record<string, string> = {
    'skip-dhcp-lease-details': 'dhcp-lease',
    'skip-gateway-reachability': 'arp',
    'skip-default-routes': 'default-route',
    'skip-arp-table': 'arp',
    'skip-default-gateway': 'default-route',
    'skip-dns-configuration': 'dns-config',
    'skip-dns-server-reachability': 'dns-server-reachability',
    'skip-dns-resolution': 'dns-resolution',
    'skip-route-to-mist-endpoints': 'route-to-mist',
    'skip-mist-agent-version': 'mist-agent',
    'skip-mist-agent-processes': 'mist-processes',
    'skip-outbound-ssh-config': 'outbound-ssh-config',
    'skip-active-cloud-connections': 'cloud-connections',
  };
  if (skippedMap[resultId]) return skippedMap[resultId];
  return resultId;
}
