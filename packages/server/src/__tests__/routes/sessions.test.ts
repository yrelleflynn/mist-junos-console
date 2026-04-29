import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';

// Hub mock — subscribeOutput captures handler; inject calls it with a Juniper prompt
const hubState = vi.hoisted(() => {
  let handler: ((chunk: string) => void) | null = null;
  return {
    set: (h: (chunk: string) => void) => { handler = h; },
    call: (chunk: string) => { handler?.(chunk); },
  };
});

vi.mock('../../ws/hub.js', () => ({
  hub: {
    broadcast: vi.fn(),
    getOutputBuffer: vi.fn().mockReturnValue('buffered output'),
    subscribeOutput: vi.fn((_: string, h: (c: string) => void) => { hubState.set(h); }),
    unsubscribeOutput: vi.fn(),
    inject: vi.fn(() => { hubState.call('switch@host> '); }),
  },
}));

vi.mock('../../session/store.js', () => ({
  listSessions: vi.fn(),
  createSession: vi.fn(),
  getSession: vi.fn(),
  destroySession: vi.fn(),
}));

vi.mock('../../troubleshoot/runner.js', () => ({
  runAllChecks: vi.fn().mockResolvedValue([]),
  runCheck: vi.fn().mockResolvedValue({ checkId: 'ntp-sync', status: 'pass', summary: 'ok' }),
  registerCheck: vi.fn(),
}));

import { sessionsRouter } from '../../routes/sessions.js';
import { listSessions, createSession, getSession, destroySession } from '../../session/store.js';

const app = new Hono().route('/api/sessions', sessionsRouter);

const FAKE_SESSION = {
  sessionId: 'sess-1',
  deviceMac: 'aa:bb:cc:00:00:01',
  createdAt: 1000,
  participants: [],
};

beforeEach(() => {
  vi.mocked(listSessions).mockReturnValue([]);
  vi.mocked(createSession).mockReturnValue(FAKE_SESSION as ReturnType<typeof createSession>);
  vi.mocked(getSession).mockReturnValue(undefined);
  vi.mocked(destroySession).mockReturnValue(false);
});

describe('GET /api/sessions', () => {
  it('returns empty list', async () => {
    const res = await app.request('/api/sessions');
    expect(res.status).toBe(200);
    const body = await res.json() as { success: boolean; data: unknown[] };
    expect(body.success).toBe(true);
    expect(body.data).toEqual([]);
  });

  it('returns all sessions', async () => {
    vi.mocked(listSessions).mockReturnValue([FAKE_SESSION] as ReturnType<typeof listSessions>);
    const res = await app.request('/api/sessions');
    const body = await res.json() as { data: unknown[] };
    expect(body.data).toHaveLength(1);
  });
});

describe('POST /api/sessions', () => {
  it('creates a session and returns 201', async () => {
    const res = await app.request('/api/sessions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ deviceMac: 'aa:bb:cc:00:00:01' }),
    });
    expect(res.status).toBe(201);
    const body = await res.json() as { success: boolean };
    expect(body.success).toBe(true);
  });

  it('returns 400 when deviceMac is missing', async () => {
    const res = await app.request('/api/sessions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
  });
});

describe('GET /api/sessions/:id', () => {
  it('returns 404 for unknown session', async () => {
    const res = await app.request('/api/sessions/unknown');
    expect(res.status).toBe(404);
  });

  it('returns session for known ID', async () => {
    vi.mocked(getSession).mockReturnValue(FAKE_SESSION as ReturnType<typeof getSession>);
    const res = await app.request('/api/sessions/sess-1');
    expect(res.status).toBe(200);
    const body = await res.json() as { data: { sessionId: string } };
    expect(body.data.sessionId).toBe('sess-1');
  });
});

describe('GET /api/sessions/:id/state', () => {
  it('returns 404 for unknown session', async () => {
    const res = await app.request('/api/sessions/unknown/state');
    expect(res.status).toBe(404);
  });

  it('returns participantCount and hasMistSession', async () => {
    vi.mocked(getSession).mockReturnValue(FAKE_SESSION as ReturnType<typeof getSession>);
    const res = await app.request('/api/sessions/sess-1/state');
    const body = await res.json() as { data: { participantCount: number; hasMistSession: boolean } };
    expect(body.data.participantCount).toBe(0);
    expect(body.data.hasMistSession).toBe(false);
  });
});

describe('DELETE /api/sessions/:id', () => {
  it('returns 404 when session does not exist', async () => {
    const res = await app.request('/api/sessions/unknown', { method: 'DELETE' });
    expect(res.status).toBe(404);
  });

  it('returns 200 when session is destroyed', async () => {
    vi.mocked(destroySession).mockReturnValue(true);
    const res = await app.request('/api/sessions/sess-1', { method: 'DELETE' });
    expect(res.status).toBe(200);
  });
});

describe('GET /api/sessions/:id/output', () => {
  it('returns 404 for unknown session', async () => {
    const res = await app.request('/api/sessions/unknown/output');
    expect(res.status).toBe(404);
  });

  it('returns buffered output', async () => {
    vi.mocked(getSession).mockReturnValue(FAKE_SESSION as ReturnType<typeof getSession>);
    const res = await app.request('/api/sessions/sess-1/output');
    expect(res.status).toBe(200);
    const body = await res.json() as { data: { output: string } };
    expect(body.data.output).toBe('buffered output');
  });

  it('passes chars query param to getOutputBuffer', async () => {
    vi.mocked(getSession).mockReturnValue(FAKE_SESSION as ReturnType<typeof getSession>);
    await app.request('/api/sessions/sess-1/output?chars=500');
    const { hub } = await import('../../ws/hub.js');
    expect(vi.mocked(hub.getOutputBuffer)).toHaveBeenCalledWith('sess-1', 500);
  });
});

describe('POST /api/sessions/:id/command', () => {
  it('returns 404 for unknown session', async () => {
    const res = await app.request('/api/sessions/unknown/command', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ command: 'show version' }),
    });
    expect(res.status).toBe(404);
  });

  it('returns 400 when command is missing', async () => {
    vi.mocked(getSession).mockReturnValue(FAKE_SESSION as ReturnType<typeof getSession>);
    const res = await app.request('/api/sessions/sess-1/command', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
  });

  it('runs command and returns output', async () => {
    vi.mocked(getSession).mockReturnValue(FAKE_SESSION as ReturnType<typeof getSession>);
    const res = await app.request('/api/sessions/sess-1/command', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ command: 'show version' }),
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { data: { command: string; output: string } };
    expect(body.data.command).toBe('show version');
    expect(body.data.output).toContain('switch@host>');
  });
});
