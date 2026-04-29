export type GroupId =
  | 'connectivity'
  | 'routing'
  | 'dns'
  | 'mist-cloud'
  | 'history';

export type CheckId =
  // connectivity (6)
  | 'uplink-port-status'
  | 'uplink-port-errors'
  | 'mgmt-ip-assigned'
  | 'mgmt-vlan-reachable'
  | 'default-gateway-ping'
  | 'mtu-check'
  // routing (5)
  | 'default-route-present'
  | 'default-route-via-gateway'
  | 'routing-table-size'
  | 'arp-gateway'
  | 'arp-mist-ep'
  // dns (3)
  | 'dns-resolution'
  | 'dns-mist-ep'
  | 'dns-ntp'
  // mist-cloud (4)
  | 'jma-state'
  | 'mist-ep-reachable'
  | 'ntp-sync'
  | 'mist-websocket'
  // history (3)
  | 'mist-last-seen'
  | 'mcd-logs-at-offline'
  | 'config-changes-at-offline';

export type CheckStatus =
  | 'pass'
  | 'fail'
  | 'warn'
  | 'skip'
  | 'pending'
  | 'running'
  | 'error';

export interface CheckResult {
  readonly checkId: CheckId;
  readonly status: CheckStatus;
  readonly summary: string;
  readonly detail?: string;
  readonly skipReason?: string;
  readonly rawOutput?: string;
  readonly durationMs?: number;
}

export interface GroupResult {
  readonly groupId: GroupId;
  readonly status: CheckStatus;
  readonly checks: readonly CheckResult[];
}
