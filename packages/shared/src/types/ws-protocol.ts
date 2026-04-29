import type { CheckId, CheckResult, CheckStatus } from './check.js';

/** Messages sent from browser client → server */
export type WsClientMessage =
  | { type: 'serial:write'; sessionId: string; data: string }
  | { type: 'serial:resize'; sessionId: string; cols: number; rows: number }
  | { type: 'ping'; sessionId: string }
  | { type: 'session:join'; sessionId: string; role: 'operator' | 'support' | 'automation' }
  | { type: 'session:leave'; sessionId: string }
  | { type: 'check:run'; sessionId: string; checkId: CheckId }
  | { type: 'check:run-all'; sessionId: string };

/** Messages sent from server → browser client */
export type WsServerMessage =
  | { type: 'serial:data'; sessionId: string; data: string }
  | { type: 'serial:inject'; sessionId: string; data: string }
  | { type: 'pong'; sessionId: string; timestamp: number }
  | { type: 'session:state'; sessionId: string; participantId: string; participantCount: number }
  | { type: 'check:progress'; sessionId: string; checkId: CheckId; status: CheckStatus; summary: string }
  | { type: 'check:result'; sessionId: string; checkId: CheckId; result: CheckResult }
  | { type: 'check:complete'; sessionId: string }
  | { type: 'error'; sessionId: string; code: string; message: string };
