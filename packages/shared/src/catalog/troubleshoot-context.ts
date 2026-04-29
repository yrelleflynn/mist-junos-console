import type { MistDeviceMatch, MistEvent } from '../types/device.js';
import type { MistSession } from '../types/session.js';

/**
 * Shared context populated by resolvers before checks run.
 * Each field is optional — resolvers set them; checks declare which they need.
 * The runner guarantees all declared needs are populated before a check executes.
 */
export interface TroubleshootContext {
  // --- session ---
  readonly mistSession?: MistSession;
  readonly deviceMatch?: MistDeviceMatch;

  // --- uplink / layer-2 ---
  readonly uplinkPort?: string;
  readonly uplinkPortStatus?: 'up' | 'down' | 'unknown';
  readonly uplinkPortErrors?: { input: number; output: number };

  // --- layer-3 ---
  readonly managementIp?: string;
  readonly managementPrefix?: number;
  readonly managementVlan?: number;
  readonly defaultGateway?: string;

  // --- dns ---
  readonly dnsServers?: readonly string[];

  // --- mist connectivity ---
  readonly jmaState?: number;
  readonly mistEndpoint?: string;

  // --- mcd log ---
  readonly mcdLogFile?: string; // e.g. 'jmd.log' or 'mist.log'
  readonly mcdLogLines?: readonly string[];

  // --- history (mist-last-seen check) ---
  readonly offlineAt?: number; // unix seconds — when device last went offline
  readonly mistLastSeen?: number; // unix seconds — Mist API last_seen field
  readonly mistEventsNearOffline?: readonly MistEvent[]; // config change events ±15 min of offlineAt
}
