import type { MistMatchResult } from '../services/switch-identity.service';

export type CloudMonitorSeverity = 'pass' | 'warn' | 'fail' | 'info' | 'unknown';
export type CloudMonitorPillState = 'connected' | 'disconnected' | 'degraded' | 'unknown';

export interface MistMonitorStatus {
  pillState: CloudMonitorPillState;
  label: string;
  detail: string;
  lastSeenUtcIso: string | null;
  lastConfigUtcIso: string | null;
}

export interface JmaConnectivityStatus {
  code: number | null;
  name: string;
  severity: CloudMonitorSeverity;
  label: string;
  message: string;
  errno: number | null;
  detail: string;
}

export interface CloudStatusState {
  matchResult: MistMatchResult | null;
  mist: MistMonitorStatus;
  jma: JmaConnectivityStatus;
  lastUpdatedUtcIso: string | null;
}

export const EMPTY_MIST_MONITOR_STATUS: MistMonitorStatus = {
  pillState: 'unknown',
  label: 'Unknown',
  detail: 'Identify the switch to compare against Mist state.',
  lastSeenUtcIso: null,
  lastConfigUtcIso: null,
};

export const EMPTY_JMA_CONNECTIVITY_STATUS: JmaConnectivityStatus = {
  code: null,
  name: 'Unknown',
  severity: 'unknown',
  label: 'Unknown',
  message: '',
  errno: null,
  detail: 'Connect and identify the switch to read the switch-reported cloud connectivity state.',
};

export const EMPTY_CLOUD_STATUS_STATE: CloudStatusState = {
  matchResult: null,
  mist: { ...EMPTY_MIST_MONITOR_STATUS },
  jma: { ...EMPTY_JMA_CONNECTIVITY_STATUS },
  lastUpdatedUtcIso: null,
};
