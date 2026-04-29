import type { WebSocket } from 'ws';
import type { WsServerMessage, WsClientMessage } from '@marvis/shared';
import { removeParticipant } from '../session/store.js';

type MessageHandler = (
  sessionId: string,
  participantId: string,
  message: WsClientMessage,
) => void;

// sessionId → participantId → WebSocket
const connections = new Map<string, Map<string, WebSocket>>();
const messageHandlers: MessageHandler[] = [];

// Output subscriptions for CLI executor
type OutputHandler = (chunk: string) => void;
const outputSubscribers = new Map<string, Set<OutputHandler>>();

// Ring buffer: last 50,000 chars of terminal output per session
const OUTPUT_BUFFER_MAX = 50_000;
const outputBuffers = new Map<string, string>();

export const hub = {
  join(sessionId: string, participantId: string, ws: WebSocket): void {
    if (!connections.has(sessionId)) {
      connections.set(sessionId, new Map());
    }
    connections.get(sessionId)!.set(participantId, ws);

    ws.on('message', (raw) => {
      let msg: WsClientMessage;
      try {
        msg = JSON.parse(raw.toString()) as WsClientMessage;
      } catch {
        return;
      }

      // Relay serial output from the console browser to all other participants
      // and notify CLI executor subscribers.
      if (msg.type === 'serial:write') {
        const chunk = msg.data;

        // Append to ring buffer, trimming oldest chars when over the cap.
        const prev = outputBuffers.get(sessionId) ?? '';
        const next = prev + chunk;
        outputBuffers.set(sessionId, next.length > OUTPUT_BUFFER_MAX ? next.slice(-OUTPUT_BUFFER_MAX) : next);

        const subs = outputSubscribers.get(sessionId);
        if (subs) {
          for (const handler of subs) handler(chunk);
        }
        hub.broadcast(sessionId, { type: 'serial:data', sessionId, data: chunk }, participantId);
      }

      for (const handler of messageHandlers) {
        handler(sessionId, participantId, msg);
      }
    });

    ws.on('close', () => {
      hub.leave(sessionId, participantId);
    });
  },

  leave(sessionId: string, participantId: string): void {
    const sessionConns = connections.get(sessionId);
    if (sessionConns) {
      sessionConns.delete(participantId);
      if (sessionConns.size === 0) {
        connections.delete(sessionId);
        outputBuffers.delete(sessionId);
        outputSubscribers.delete(sessionId);
      }
    }
    removeParticipant(sessionId, participantId);
  },

  broadcast(sessionId: string, message: WsServerMessage, excludeParticipantId?: string): void {
    const sessionConns = connections.get(sessionId);
    if (!sessionConns) return;
    const payload = JSON.stringify(message);
    for (const [pid, ws] of sessionConns) {
      if (pid !== excludeParticipantId && ws.readyState === 1 /* OPEN */) {
        ws.send(payload);
      }
    }
  },

  send(sessionId: string, participantId: string, message: WsServerMessage): boolean {
    const ws = connections.get(sessionId)?.get(participantId);
    if (!ws || ws.readyState !== 1) return false;
    ws.send(JSON.stringify(message));
    return true;
  },

  onMessage(handler: MessageHandler): void {
    messageHandlers.push(handler);
  },

  sessionSize(sessionId: string): number {
    return connections.get(sessionId)?.size ?? 0;
  },

  // Send a CLI command to the switch via the console browser's serial port.
  inject(sessionId: string, data: string): void {
    hub.broadcast(sessionId, { type: 'serial:inject', sessionId, data });
  },

  subscribeOutput(sessionId: string, handler: OutputHandler): void {
    if (!outputSubscribers.has(sessionId)) {
      outputSubscribers.set(sessionId, new Set());
    }
    outputSubscribers.get(sessionId)!.add(handler);
  },

  unsubscribeOutput(sessionId: string, handler: OutputHandler): void {
    outputSubscribers.get(sessionId)?.delete(handler);
  },

  getOutputBuffer(sessionId: string, maxChars = 10_000): string {
    const buf = outputBuffers.get(sessionId) ?? '';
    return buf.length > maxChars ? buf.slice(-maxChars) : buf;
  },
};
