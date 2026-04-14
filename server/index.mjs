/**
 * Junos Console backend — Mist API forwarder + WebSocket console session hub.
 * Dev: Vite proxies /mist-proxy and /ws here (default port 3333).
 */

import http from 'node:http';
import https from 'node:https';
import { randomUUID } from 'node:crypto';
import { WebSocketServer } from 'ws';

const PORT = Number(process.env.JUNOS_CONSOLE_SERVER_PORT || 3333);

/** @type {Map<string, { members: { ws: import('ws').WebSocket, role: 'operator' | 'support' }[] }>} */
const sessions = new Map();

function mistProxyHandler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  if (req.method !== 'POST') {
    res.writeHead(405);
    res.end('Method not allowed');
    return;
  }

  let body = '';
  req.on('data', (chunk) => { body += chunk; });
  req.on('end', () => {
    try {
      const parsed = JSON.parse(body);
      const { apiHost, apiToken, method, path } = parsed;
      const requestBody = parsed.body != null ? JSON.stringify(parsed.body) : null;

      if (!apiHost || !apiToken || !path) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Missing apiHost, apiToken, or path' }));
        return;
      }

      const url = `https://${apiHost}${path}`;
      const httpMethod = method || 'GET';
      console.log(`[mist-proxy] ${httpMethod} ${url}${requestBody ? ` (${requestBody.length} bytes)` : ''}`);

      const headers = {
        Authorization: `Token ${apiToken}`,
        'Content-Type': 'application/json',
      };
      if (requestBody) {
        headers['Content-Length'] = Buffer.byteLength(requestBody);
      }

      const proxyReq = https.request(url, { method: httpMethod, headers }, (proxyRes) => {
        let proxyBody = '';
        proxyRes.on('data', (chunk) => { proxyBody += chunk.toString(); });
        proxyRes.on('end', () => {
          res.writeHead(proxyRes.statusCode || 500, { 'Content-Type': 'application/json' });
          res.end(proxyBody);
        });
      });

      proxyReq.on('error', (err) => {
        console.error('[mist-proxy]', err.message);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      });

      if (requestBody) proxyReq.write(requestBody);
      proxyReq.end();
    } catch {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Invalid JSON body' }));
    }
  });
}

const server = http.createServer((req, res) => {
  if (req.method === 'GET' && req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok' }));
    return;
  }
  if (req.url === '/mist-proxy' || req.url?.startsWith('/mist-proxy?')) {
    mistProxyHandler(req, res);
    return;
  }
  res.writeHead(404);
  res.end('Not found');
});

const wss = new WebSocketServer({ noServer: true });

server.on('upgrade', (request, socket, head) => {
  const path = request.url?.split('?')[0];
  if (path !== '/ws') {
    socket.destroy();
    return;
  }
  wss.handleUpgrade(request, socket, head, (ws) => {
    wss.emit('connection', ws, request);
  });
});

/**
 * @param {string} sessionId
 * @param {object} msg
 * @param {import('ws').WebSocket} [except]
 */
function broadcastToSupport(sessionId, msg, except) {
  const sess = sessions.get(sessionId);
  if (!sess) return;
  const payload = JSON.stringify(msg);
  for (const m of sess.members) {
    if (m.role !== 'support' || m.ws === except) continue;
    if (m.ws.readyState === 1) m.ws.send(payload);
  }
}

/**
 * @param {string} sessionId
 * @param {object} msg
 */
function sendToOperators(sessionId, msg) {
  const sess = sessions.get(sessionId);
  if (!sess) return;
  const payload = JSON.stringify(msg);
  for (const m of sess.members) {
    if (m.role !== 'operator') continue;
    if (m.ws.readyState === 1) m.ws.send(payload);
  }
}

wss.on('connection', (ws) => {
  /** @type {string | null} */
  let sessionId = null;
  /** @type {'operator' | 'support' | null} */
  let role = null;

  ws.on('message', (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      ws.send(JSON.stringify({ type: 'error', message: 'Invalid JSON' }));
      return;
    }

    switch (msg.type) {
      case 'join': {
        const r = msg.role;
        if (r !== 'operator' && r !== 'support') {
          ws.send(JSON.stringify({ type: 'error', message: 'Invalid role' }));
          return;
        }
        if (r === 'operator') {
          if (msg.sessionId) {
            ws.send(JSON.stringify({ type: 'error', message: 'Operator cannot join existing session' }));
            return;
          }
          const id = randomUUID();
          sessions.set(id, { members: [{ ws, role: 'operator' }] });
          sessionId = id;
          role = 'operator';
          ws.send(JSON.stringify({ type: 'joined', sessionId: id, role: 'operator' }));
          console.log('[ws] operator created session', id);
          return;
        }
        const sid = msg.sessionId;
        if (!sid || typeof sid !== 'string') {
          ws.send(JSON.stringify({ type: 'error', message: 'support requires sessionId' }));
          return;
        }
        const sess = sessions.get(sid);
        if (!sess) {
          ws.send(JSON.stringify({ type: 'error', message: 'Unknown session' }));
          return;
        }
        const hasOp = sess.members.some((m) => m.role === 'operator');
        if (!hasOp) {
          ws.send(JSON.stringify({ type: 'error', message: 'Session has no operator' }));
          return;
        }
        sess.members.push({ ws, role: 'support' });
        sessionId = sid;
        role = 'support';
        ws.send(JSON.stringify({ type: 'joined', sessionId: sid, role: 'support' }));
        console.log('[ws] support joined', sid);
        return;
      }

      case 'serial-rx':
      case 'serial-tx': {
        if (!sessionId || !role) {
          ws.send(JSON.stringify({ type: 'error', message: 'Join a session first' }));
          return;
        }
        if (typeof msg.data !== 'string') {
          ws.send(JSON.stringify({ type: 'error', message: 'Missing data' }));
          return;
        }
        if (msg.type === 'serial-rx') {
          if (role !== 'operator') {
            ws.send(JSON.stringify({ type: 'error', message: 'Only operator sends serial-rx' }));
            return;
          }
          broadcastToSupport(sessionId, { type: 'serial-rx', data: msg.data });
          return;
        }
        const src = msg.source;
        if (src !== 'operator' && src !== 'support') {
          ws.send(JSON.stringify({ type: 'error', message: 'Invalid source' }));
          return;
        }
        if (src === 'operator' && role === 'operator') {
          broadcastToSupport(sessionId, { type: 'serial-tx', source: 'operator', data: msg.data });
          return;
        }
        if (src === 'support' && role === 'support') {
          sendToOperators(sessionId, { type: 'serial-tx', source: 'support', data: msg.data });
          return;
        }
        ws.send(JSON.stringify({ type: 'error', message: 'Source/role mismatch' }));
        return;
      }

      default:
        ws.send(JSON.stringify({ type: 'error', message: `Unknown type: ${msg.type}` }));
    }
  });

  ws.on('close', () => {
    if (!sessionId || !role) return;
    const sess = sessions.get(sessionId);
    if (!sess) return;
    sess.members = sess.members.filter((m) => m.ws !== ws);

    if (role === 'operator') {
      for (const m of sess.members) {
        if (m.ws.readyState === 1) {
          m.ws.send(JSON.stringify({ type: 'session-ended', reason: 'operator-disconnected' }));
        }
      }
      sessions.delete(sessionId);
      console.log('[ws] session closed (operator left)', sessionId);
    } else if (sess.members.length === 0) {
      sessions.delete(sessionId);
    }
  });
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`[junos-console-server] http://127.0.0.1:${PORT}`);
  console.log(`[junos-console-server] POST /mist-proxy  GET /health  WS /ws`);
});
