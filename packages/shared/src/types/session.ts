export type MistCloud =
  | 'global01'
  | 'global02'
  | 'global03'
  | 'global04'
  | 'global05'
  | 'emea01'
  | 'apac01'
  | 'us-gov-1'
  | 'us-gov-2';

export type MistSessionSource = 'extension' | 'url-params' | 'manual';

export interface MistSession {
  readonly orgId?: string;
  readonly cloud: MistCloud;
  readonly csrfToken: string;
  readonly sessionId: string;
  readonly source?: MistSessionSource;
  readonly acquiredAt: number; // unix seconds
}

export type ParticipantRole = 'operator' | 'support' | 'automation';

export interface SessionParticipant {
  readonly participantId: string;
  readonly role: ParticipantRole;
  readonly joinedAt: number; // unix seconds
}

export interface ConsoleSession {
  readonly sessionId: string;
  readonly deviceMac: string;
  readonly deviceSerial?: string;
  readonly deviceHostname?: string;
  readonly createdAt: number; // unix seconds
  readonly participants: readonly SessionParticipant[];
  readonly mistSession?: MistSession;
}
