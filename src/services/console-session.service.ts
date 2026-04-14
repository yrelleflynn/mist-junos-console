/**
 * console-session.service.ts — WebSocket client for shared console sessions
 *
 * Operators mirror RX/TX to the backend; support viewers receive RX and operator TX,
 * and can inject TX (forwarded to the operator browser only).
 */

export type ConsoleSessionRole = 'operator' | 'support';

function uint8ToBase64(data: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < data.length; i++) {
    binary += String.fromCharCode(data[i]);
  }
  return btoa(binary);
}

function base64ToUint8(b64: string): Uint8Array {
  const binary = atob(b64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    out[i] = binary.charCodeAt(i);
  }
  return out;
}

/**
 * WebSocket URL for the console session hub.
 * In dev, connect straight to the Node server. Vite's HTTP `/ws` proxy is unreliable for
 * upgrades to `ws` (browser often only reports a generic WebSocket error).
 */
function websocketUrlFromLocation(): string {
  if (import.meta.env.DEV) {
    const port = import.meta.env.VITE_CONSOLE_SERVER_PORT || '3333';
    return `ws://127.0.0.1:${port}/ws`;
  }
  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${proto}//${window.location.host}/ws`;
}

export class ConsoleSessionService {
  private ws: WebSocket | null = null;
  private sessionId: string | null = null;
  private role: ConsoleSessionRole | null = null;
  private pendingSupportSessionId: string | null = null;
  private pendingOperatorJoin = false;

  onJoined: ((sessionId: string, role: ConsoleSessionRole) => void) | null = null;
  onRemoteSerialTx: ((data: Uint8Array) => void) | null = null;
  onRemoteSerialRx: ((data: Uint8Array) => void) | null = null;
  onRemoteOperatorTx: ((data: Uint8Array) => void) | null = null;
  onSessionEnded: ((reason: string) => void) | null = null;
  onError: ((message: string) => void) | null = null;

  get isOpen(): boolean {
    return this.ws !== null && this.ws.readyState === WebSocket.OPEN;
  }

  get id(): string | null {
    return this.sessionId;
  }

  get clientRole(): ConsoleSessionRole | null {
    return this.role;
  }

  /** Operator: open socket and create a new session. */
  startAsOperator(): void {
    this.close();
    this.pendingOperatorJoin = true;
    this.pendingSupportSessionId = null;
    this.openSocket();
  }

  /** Support: open socket and join an existing session. */
  startAsSupport(sessionId: string): void {
    this.close();
    this.pendingOperatorJoin = false;
    this.pendingSupportSessionId = sessionId.trim();
    this.openSocket();
  }

  private openSocket(): void {
    const ws = new WebSocket(websocketUrlFromLocation());
    this.ws = ws;

    ws.onopen = () => {
      if (this.pendingOperatorJoin) {
        ws.send(JSON.stringify({ type: 'join', role: 'operator' }));
      } else if (this.pendingSupportSessionId) {
        ws.send(
          JSON.stringify({
            type: 'join',
            role: 'support',
            sessionId: this.pendingSupportSessionId,
          }),
        );
      }
    };

    ws.onmessage = (ev) => {
      let msg: Record<string, unknown>;
      try {
        msg = JSON.parse(String(ev.data));
      } catch {
        this.onError?.('Invalid message from server');
        return;
      }
      const t = msg.type;
      if (t === 'joined') {
        const sid = msg.sessionId as string;
        const role = msg.role as ConsoleSessionRole;
        this.sessionId = sid;
        this.role = role;
        this.onJoined?.(sid, role);
        return;
      }
      if (t === 'serial-rx') {
        const data = msg.data as string;
        this.onRemoteSerialRx?.(base64ToUint8(data));
        return;
      }
      if (t === 'serial-tx') {
        const data = base64ToUint8(msg.data as string);
        const source = msg.source as string;
        if (source === 'support') {
          this.onRemoteSerialTx?.(data);
        } else if (source === 'operator') {
          this.onRemoteOperatorTx?.(data);
        }
        return;
      }
      if (t === 'session-ended') {
        const reason = (msg.reason as string) || 'ended';
        this.onSessionEnded?.(reason);
        this.close(false);
        return;
      }
      if (t === 'error') {
        const m = (msg.message as string) || 'Unknown error';
        this.onError?.(m);
        this.close(false);
        return;
      }
    };

    ws.onclose = () => {
      this.ws = null;
    };

    ws.onerror = () => {
      const hint = import.meta.env.DEV
        ? `Check that the backend is running (e.g. ws://127.0.0.1:${import.meta.env.VITE_CONSOLE_SERVER_PORT || '3333'}/ws).`
        : 'Check that /ws is reachable on this host.';
      this.onError?.(`WebSocket error — ${hint}`);
    };
  }

  sendSerialRx(data: Uint8Array): void {
    if (!this.isOpen || this.role !== 'operator') return;
    this.ws?.send(
      JSON.stringify({ type: 'serial-rx', data: uint8ToBase64(data) }),
    );
  }

  sendSerialTx(source: ConsoleSessionRole, data: Uint8Array): void {
    if (!this.isOpen) return;
    this.ws?.send(
      JSON.stringify({
        type: 'serial-tx',
        source,
        data: uint8ToBase64(data),
      }),
    );
  }

  /** @param sendCloseToServer — unused; closing client is enough for server cleanup on operator. */
  close(sendCloseToServer = true): void {
    void sendCloseToServer;
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.sessionId = null;
    this.role = null;
    this.pendingOperatorJoin = false;
    this.pendingSupportSessionId = null;
  }
}
