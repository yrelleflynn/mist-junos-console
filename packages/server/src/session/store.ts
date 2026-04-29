import { randomUUID } from 'node:crypto';
import type { ConsoleSession, MistSession, SessionParticipant } from '@marvis/shared';

interface MutableSession {
  sessionId: string;
  deviceMac: string;
  deviceSerial?: string;
  deviceHostname?: string;
  createdAt: number;
  participants: SessionParticipant[];
  mistSession?: MistSession;
}

function snapshot(s: MutableSession): ConsoleSession {
  return { ...s, participants: [...s.participants] };
}

const sessions = new Map<string, MutableSession>();

export function createSession(
  deviceMac: string,
  opts?: { deviceSerial?: string; deviceHostname?: string; mistSession?: MistSession },
): ConsoleSession {
  const sessionId = randomUUID();
  const s: MutableSession = {
    sessionId,
    deviceMac,
    createdAt: Math.floor(Date.now() / 1000),
    participants: [],
    ...opts,
  };
  sessions.set(sessionId, s);
  return snapshot(s);
}

export function getSession(sessionId: string): ConsoleSession | undefined {
  const s = sessions.get(sessionId);
  return s ? snapshot(s) : undefined;
}

export function listSessions(): ConsoleSession[] {
  return [...sessions.values()].map(snapshot);
}

export function addParticipant(sessionId: string, participant: SessionParticipant): boolean {
  const s = sessions.get(sessionId);
  if (!s) return false;
  if (!s.participants.some((p) => p.participantId === participant.participantId)) {
    s.participants.push(participant);
  }
  return true;
}

export function removeParticipant(sessionId: string, participantId: string): boolean {
  const s = sessions.get(sessionId);
  if (!s) return false;
  s.participants = s.participants.filter((p) => p.participantId !== participantId);
  return true;
}

export function setMistSession(sessionId: string, mistSession: MistSession): boolean {
  const s = sessions.get(sessionId);
  if (!s) return false;
  s.mistSession = mistSession;
  return true;
}

export function destroySession(sessionId: string): boolean {
  return sessions.delete(sessionId);
}
