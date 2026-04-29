import { describe, it, expect, vi, afterEach } from 'vitest';
import { hub } from '../ws/hub.js';
import type { WebSocket } from 'ws';

type FakeWs = {
  readyState: number;
  send: ReturnType<typeof vi.fn>;
  on: (event: string, handler: (...args: unknown[]) => void) => void;
  emit: (event: string, ...args: unknown[]) => void;
};

function makeFakeWs(): FakeWs {
  const handlers = new Map<string, ((...args: unknown[]) => void)[]>();
  return {
    readyState: 1,
    send: vi.fn(),
    on(event, handler) {
      if (!handlers.has(event)) handlers.set(event, []);
      handlers.get(event)!.push(handler);
    },
    emit(event, ...args) {
      for (const h of handlers.get(event) ?? []) h(...args);
    },
  };
}

const S = 'hub-test-session';
const P1 = 'participant-1';
const P2 = 'participant-2';

afterEach(() => {
  hub.leave(S, P1);
  hub.leave(S, P2);
});

describe('output buffer', () => {
  it('starts empty for an unknown session', () => {
    expect(hub.getOutputBuffer(S)).toBe('');
  });

  it('accumulates serial:write chunks', () => {
    const ws = makeFakeWs() as unknown as WebSocket;
    hub.join(S, P1, ws);
    (ws as unknown as FakeWs).emit('message', JSON.stringify({ type: 'serial:write', sessionId: S, data: 'hello ' }));
    (ws as unknown as FakeWs).emit('message', JSON.stringify({ type: 'serial:write', sessionId: S, data: 'world' }));
    expect(hub.getOutputBuffer(S)).toBe('hello world');
  });

  it('trims to the last 50 000 chars on overflow', () => {
    const ws = makeFakeWs() as unknown as WebSocket;
    hub.join(S, P1, ws);
    const big = 'x'.repeat(51_000);
    (ws as unknown as FakeWs).emit('message', JSON.stringify({ type: 'serial:write', sessionId: S, data: big }));
    expect(hub.getOutputBuffer(S, 50_000).length).toBe(50_000);
  });

  it('getOutputBuffer returns the last N chars', () => {
    const ws = makeFakeWs() as unknown as WebSocket;
    hub.join(S, P1, ws);
    (ws as unknown as FakeWs).emit('message', JSON.stringify({ type: 'serial:write', sessionId: S, data: 'abcdefghij' }));
    expect(hub.getOutputBuffer(S, 3)).toBe('hij');
  });

  it('returns full buffer when maxChars exceeds length', () => {
    const ws = makeFakeWs() as unknown as WebSocket;
    hub.join(S, P1, ws);
    (ws as unknown as FakeWs).emit('message', JSON.stringify({ type: 'serial:write', sessionId: S, data: 'abc' }));
    expect(hub.getOutputBuffer(S, 9999)).toBe('abc');
  });

  it('deletes buffer when last participant leaves', () => {
    const ws = makeFakeWs() as unknown as WebSocket;
    hub.join(S, P1, ws);
    (ws as unknown as FakeWs).emit('message', JSON.stringify({ type: 'serial:write', sessionId: S, data: 'data' }));
    hub.leave(S, P1);
    expect(hub.getOutputBuffer(S)).toBe('');
  });
});

describe('subscribeOutput / unsubscribeOutput', () => {
  it('calls handler on serial:write', () => {
    const ws = makeFakeWs() as unknown as WebSocket;
    hub.join(S, P1, ws);
    const handler = vi.fn();
    hub.subscribeOutput(S, handler);
    (ws as unknown as FakeWs).emit('message', JSON.stringify({ type: 'serial:write', sessionId: S, data: 'chunk' }));
    expect(handler).toHaveBeenCalledWith('chunk');
    hub.unsubscribeOutput(S, handler);
  });

  it('does not call handler after unsubscribe', () => {
    const ws = makeFakeWs() as unknown as WebSocket;
    hub.join(S, P1, ws);
    const handler = vi.fn();
    hub.subscribeOutput(S, handler);
    hub.unsubscribeOutput(S, handler);
    (ws as unknown as FakeWs).emit('message', JSON.stringify({ type: 'serial:write', sessionId: S, data: 'chunk' }));
    expect(handler).not.toHaveBeenCalled();
  });

  it('clears output subscribers when last participant leaves', () => {
    const ws = makeFakeWs() as unknown as WebSocket;
    hub.join(S, P1, ws);
    const handler = vi.fn();
    hub.subscribeOutput(S, handler);
    hub.leave(S, P1);

    // New participant — writing should not trigger the old handler
    const ws2 = makeFakeWs() as unknown as WebSocket;
    hub.join(S, P2, ws2);
    (ws2 as unknown as FakeWs).emit('message', JSON.stringify({ type: 'serial:write', sessionId: S, data: 'new' }));
    expect(handler).not.toHaveBeenCalled();
    hub.leave(S, P2);
  });
});

describe('broadcast', () => {
  it('sends to all participants except the excluded sender', () => {
    const ws1 = makeFakeWs() as unknown as WebSocket;
    const ws2 = makeFakeWs() as unknown as WebSocket;
    hub.join(S, P1, ws1);
    hub.join(S, P2, ws2);
    hub.broadcast(S, { type: 'check:complete', sessionId: S }, P1);
    expect((ws1 as unknown as FakeWs).send).not.toHaveBeenCalled();
    expect((ws2 as unknown as FakeWs).send).toHaveBeenCalledOnce();
    hub.leave(S, P2);
  });

  it('sends to all when no exclusion is specified', () => {
    const ws1 = makeFakeWs() as unknown as WebSocket;
    const ws2 = makeFakeWs() as unknown as WebSocket;
    hub.join(S, P1, ws1);
    hub.join(S, P2, ws2);
    hub.broadcast(S, { type: 'check:complete', sessionId: S });
    expect((ws1 as unknown as FakeWs).send).toHaveBeenCalledOnce();
    expect((ws2 as unknown as FakeWs).send).toHaveBeenCalledOnce();
    hub.leave(S, P2);
  });

  it('skips sockets that are not OPEN (readyState !== 1)', () => {
    const ws = makeFakeWs() as unknown as WebSocket;
    (ws as unknown as FakeWs).readyState = 3;
    hub.join(S, P1, ws);
    hub.broadcast(S, { type: 'check:complete', sessionId: S });
    expect((ws as unknown as FakeWs).send).not.toHaveBeenCalled();
  });

  it('is a no-op for unknown session', () => {
    expect(() => hub.broadcast('no-such', { type: 'check:complete', sessionId: 'no-such' })).not.toThrow();
  });
});

describe('sessionSize', () => {
  it('returns 0 for unknown session', () => {
    expect(hub.sessionSize('unknown-session')).toBe(0);
  });

  it('tracks participant count correctly', () => {
    const ws1 = makeFakeWs() as unknown as WebSocket;
    const ws2 = makeFakeWs() as unknown as WebSocket;
    hub.join(S, P1, ws1);
    hub.join(S, P2, ws2);
    expect(hub.sessionSize(S)).toBe(2);
    hub.leave(S, P2);
    expect(hub.sessionSize(S)).toBe(1);
  });
});
