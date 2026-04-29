import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { serveStatic } from '@hono/node-server/serve-static';
import { WebSocketServer, type WebSocket } from 'ws';
import { randomUUID } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import { loadConfig } from './config.js';
import './troubleshoot/checks/index.js';
import { sessionsRouter } from './routes/sessions.js';
import { createMistRouter } from './routes/mist.js';
import { hub } from './ws/hub.js';
import { addParticipant } from './session/store.js';

const config = loadConfig();

const app = new Hono();

app.route('/api/sessions', sessionsRouter);
app.route('/api/mist', createMistRouter(config));

app.get('/api/health', (c) =>
  c.json({ success: true, data: { status: 'ok', ts: Date.now() } }),
);

app.use('/*', serveStatic({ root: './public' }));

const server = serve({ fetch: app.fetch, port: config.port }, (info) => {
  console.log(`[server] listening on http://localhost:${info.port}`);
});

const wss = new WebSocketServer({ noServer: true });

server.on('upgrade', (req: IncomingMessage, socket, head) => {
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
  if (url.pathname !== '/ws') {
    socket.destroy();
    return;
  }
  wss.handleUpgrade(req, socket, head, (ws) => {
    wss.emit('connection', ws, req);
  });
});

wss.on('connection', (ws: WebSocket, req: IncomingMessage) => {
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
  const sessionId = url.searchParams.get('sessionId');
  const role = url.searchParams.get('role') ?? 'viewer';

  if (!sessionId) {
    ws.close(1008, 'Missing sessionId query parameter');
    return;
  }

  const participantId = randomUUID();
  const mappedRole = role === 'automation' ? 'automation' : role === 'support' ? 'support' : 'operator';
  addParticipant(sessionId, { participantId, role: mappedRole, joinedAt: Math.floor(Date.now() / 1000) });
  ws.on('error', (err) => {
    console.error('[ws] socket error:', err);
    hub.leave(sessionId, participantId);
  });

  hub.join(sessionId, participantId, ws);

  hub.send(sessionId, participantId, {
    type: 'session:state',
    sessionId,
    participantId,
    participantCount: hub.sessionSize(sessionId),
  });
});

process.on('SIGTERM', () => {
  console.log('[server] SIGTERM received — shutting down');
  wss.close(() => {
    process.exit(0);
  });
});
