export interface DeviceIdentity {
  readonly mac: string;
  readonly serial?: string;
  readonly hostname?: string;
  readonly model?: string;
}

export interface MistDeviceMatch {
  readonly siteId: string;
  readonly deviceId: string;
  readonly mac: string;
  readonly serial: string;
  readonly hostname: string;
  readonly model: string;
  readonly lastSeen: number; // unix seconds
  readonly upSince?: number; // unix seconds
  readonly ip?: string;
}

export interface MistEvent {
  readonly type: string;
  readonly timestamp: number; // unix seconds
  readonly text: string;
  readonly siteId?: string;
  readonly deviceId?: string;
}

/** Switch self-reported JMA cloud connectivity state codes */
export enum JmaStateCode {
  NoIPAddress = 102,
  NoDefaultGateway = 103,
  DNSLookupFailed = 106,
  NTPSyncFailed = 107,
  CloudUnreachable = 108,
  WebsocketConnecting = 109,
  WebsocketConnected = 110,
  Connected = 111,
}

export function jmaStateLabel(code: number): string {
  const label = JmaStateCode[code as JmaStateCode];
  return label ?? `Unknown(${code})`;
}
