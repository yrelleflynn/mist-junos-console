import { useCallback, useEffect, useRef, useState } from 'react';
import type { WsClientMessage, WsServerMessage } from '@marvis/shared';

export type WsStatus = 'disconnected' | 'connecting' | 'connected';

interface UseConsoleWsResult {
  status: WsStatus;
  lastMessage: WsServerMessage | null;
  send: (msg: WsClientMessage) => void;
}

export function useConsoleWs(sessionId: string | null, role: string): UseConsoleWsResult {
  const [status, setStatus] = useState<WsStatus>('disconnected');
  const [lastMessage, setLastMessage] = useState<WsServerMessage | null>(null);
  const wsRef = useRef<WebSocket | null>(null);

  const send = useCallback((msg: WsClientMessage) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(msg));
    }
  }, []);

  useEffect(() => {
    if (!sessionId) return;

    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const url = `${proto}://${location.host}/ws?sessionId=${encodeURIComponent(sessionId)}&role=${encodeURIComponent(role)}`;
    setStatus('connecting');
    const ws = new WebSocket(url);
    wsRef.current = ws;

    ws.onopen = () => setStatus('connected');

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data as string) as WsServerMessage;
        setLastMessage(msg);
      } catch {
        // ignore malformed frames
      }
    };

    ws.onclose = () => {
      setStatus('disconnected');
      wsRef.current = null;
    };

    ws.onerror = () => {
      setStatus('disconnected');
    };

    return () => {
      ws.close();
    };
  }, [sessionId, role]);

  return { status, lastMessage, send };
}
