import { describe, it, expect, afterEach } from 'vitest';
import {
  createSession,
  getSession,
  listSessions,
  addParticipant,
  removeParticipant,
  setMistSession,
  destroySession,
} from '../session/store.js';
import type { MistSession } from '@marvis/shared';

const TEST_MAC = 'aa:bb:cc:dd:ee:ff';
const MIST_SESSION: MistSession = {
  cloud: 'global01',
  csrfToken: 'test-csrf',
  sessionId: 'test-sid',
  acquiredAt: 1000,
};

const created: string[] = [];

function make(mac = TEST_MAC) {
  const s = createSession(mac);
  created.push(s.sessionId);
  return s;
}

afterEach(() => {
  for (const id of created) destroySession(id);
  created.length = 0;
});

describe('createSession', () => {
  it('creates a session with the given MAC', () => {
    const s = make();
    expect(s.deviceMac).toBe(TEST_MAC);
  });

  it('assigns unique sessionIds', () => {
    const a = make('aa:bb:cc:00:00:01');
    const b = make('aa:bb:cc:00:00:02');
    expect(a.sessionId).not.toBe(b.sessionId);
  });

  it('sets createdAt as a recent unix timestamp', () => {
    const before = Math.floor(Date.now() / 1000) - 1;
    const s = make();
    expect(s.createdAt).toBeGreaterThanOrEqual(before);
  });

  it('starts with empty participants array', () => {
    expect(make().participants).toEqual([]);
  });

  it('accepts optional hostname', () => {
    const s = createSession(TEST_MAC, { deviceHostname: 'switch-1' });
    created.push(s.sessionId);
    expect(s.deviceHostname).toBe('switch-1');
  });

  it('accepts optional serial', () => {
    const s = createSession(TEST_MAC, { deviceSerial: 'SN123' });
    created.push(s.sessionId);
    expect(s.deviceSerial).toBe('SN123');
  });

  it('accepts optional mistSession', () => {
    const s = createSession(TEST_MAC, { mistSession: MIST_SESSION });
    created.push(s.sessionId);
    expect(s.mistSession).toEqual(MIST_SESSION);
  });
});

describe('getSession', () => {
  it('returns the session for a valid ID', () => {
    const s = make();
    expect(getSession(s.sessionId)?.sessionId).toBe(s.sessionId);
  });

  it('returns undefined for an unknown ID', () => {
    expect(getSession('does-not-exist')).toBeUndefined();
  });

  it('returns an isolated snapshot', () => {
    const s = make();
    const snap = getSession(s.sessionId)!;
    (snap as { deviceMac: string }).deviceMac = 'mutated';
    expect(getSession(s.sessionId)!.deviceMac).toBe(TEST_MAC);
  });
});

describe('listSessions', () => {
  it('returns empty array when no sessions', () => {
    expect(listSessions()).toEqual([]);
  });

  it('returns all created sessions', () => {
    const a = make('aa:bb:cc:11:00:01');
    const b = make('aa:bb:cc:11:00:02');
    const ids = listSessions().map((s) => s.sessionId);
    expect(ids).toContain(a.sessionId);
    expect(ids).toContain(b.sessionId);
  });
});

describe('addParticipant', () => {
  it('adds a participant', () => {
    const s = make();
    expect(addParticipant(s.sessionId, { participantId: 'p1', role: 'operator', joinedAt: 1000 })).toBe(true);
    expect(getSession(s.sessionId)!.participants).toHaveLength(1);
  });

  it('ignores duplicate participantId', () => {
    const s = make();
    addParticipant(s.sessionId, { participantId: 'p1', role: 'operator', joinedAt: 1000 });
    addParticipant(s.sessionId, { participantId: 'p1', role: 'operator', joinedAt: 1001 });
    expect(getSession(s.sessionId)!.participants).toHaveLength(1);
  });

  it('returns false for unknown session', () => {
    expect(addParticipant('no-such', { participantId: 'p1', role: 'operator', joinedAt: 1000 })).toBe(false);
  });
});

describe('removeParticipant', () => {
  it('removes a participant', () => {
    const s = make();
    addParticipant(s.sessionId, { participantId: 'p1', role: 'operator', joinedAt: 1000 });
    expect(removeParticipant(s.sessionId, 'p1')).toBe(true);
    expect(getSession(s.sessionId)!.participants).toHaveLength(0);
  });

  it('returns false for unknown session', () => {
    expect(removeParticipant('no-such', 'p1')).toBe(false);
  });

  it('is a no-op for unknown participant', () => {
    const s = make();
    removeParticipant(s.sessionId, 'ghost');
    expect(getSession(s.sessionId)!.participants).toHaveLength(0);
  });
});

describe('setMistSession', () => {
  it('attaches a Mist session', () => {
    const s = make();
    expect(setMistSession(s.sessionId, MIST_SESSION)).toBe(true);
    expect(getSession(s.sessionId)!.mistSession).toEqual(MIST_SESSION);
  });

  it('returns false for unknown session', () => {
    expect(setMistSession('no-such', MIST_SESSION)).toBe(false);
  });
});

describe('destroySession', () => {
  it('removes the session', () => {
    const s = createSession(TEST_MAC);
    expect(destroySession(s.sessionId)).toBe(true);
    expect(getSession(s.sessionId)).toBeUndefined();
  });

  it('returns false for unknown session', () => {
    expect(destroySession('no-such')).toBe(false);
  });
});
