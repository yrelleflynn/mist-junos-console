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

// ---------------------------------------------------------------------------
// MCP session-state store
// Receives agent-context pushes from the operator frontend (Phase 2 wiring),
// and exposes them to the backend MCP server via GET /mcp/session-state.
// See docs/BACKEND-MCP-POC.md for the full design.
// ---------------------------------------------------------------------------

/**
 * In-memory state pushed by the frontend when agent access is enabled.
 * Key: sessionId (the WebSocket session UUID).
 * @type {Map<string, Record<string, unknown>>}
 */
const mcpSessionStates = new Map();
/** @type {Map<string, string[]>} */
const mcpActionQueues = new Map();
/**
 * @typedef {'pending' | 'claimed' | 'running' | 'completed' | 'failed'} McpActionStatus
 */
/**
 * @typedef {{
 *   id: string;
 *   sessionId: string;
 *   type: string;
 *   params: Record<string, unknown>;
 *   status: McpActionStatus;
 *   createdAt: string;
 *   updatedAt: string;
 *   claimedAt?: string;
 *   startedAt?: string;
 *   completedAt?: string;
 *   result?: unknown;
 *   error?: string | null;
 * }} McpActionRecord
 */
/** @type {Map<string, McpActionRecord>} */
const mcpActions = new Map();

function latestMcpStubState() {
  return {
    sessionId: null,
    agentAccessEnabled: false,
    serialConnected: false,
    deviceIdentified: false,
    mistStatus: null,
    configSyncState: null,
    identity: null,
    jma: null,
    checkResults: null,
    updatedAt: null,
    _stub: true,
  };
}

/**
 * @param {string} sessionId
 * @returns {McpActionRecord | null}
 */
function claimNextMcpAction(sessionId) {
  const queue = mcpActionQueues.get(sessionId);
  if (!queue?.length) return null;

  while (queue.length > 0) {
    const nextId = queue[0];
    const action = mcpActions.get(nextId);
    if (!action) {
      queue.shift();
      continue;
    }
    if (action.status !== 'pending') {
      queue.shift();
      continue;
    }
    const now = new Date().toISOString();
    action.status = 'claimed';
    action.claimedAt = now;
    action.updatedAt = now;
    queue.shift();
    return action;
  }

  return null;
}

/**
 * Handle MCP-oriented read-only and push endpoints under /mcp/.
 * These are intentionally separate from the Mist proxy and WebSocket paths.
 * @param {http.IncomingMessage} req
 * @param {http.ServerResponse} res
 */
function mcpHandler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Content-Type', 'application/json');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  const reqUrl = new URL(req.url, 'http://127.0.0.1');

  // GET /mcp/session-state — return the most recently pushed session context.
  // The backend MCP server polls this to build tool responses.
  if (req.method === 'GET' && reqUrl.pathname === '/mcp/session-state') {
    const states = [...mcpSessionStates.values()];
    const latest = states.at(-1);
    if (!latest) {
      res.writeHead(200);
      res.end(JSON.stringify(latestMcpStubState()));
      return;
    }
    res.writeHead(200);
    res.end(JSON.stringify({ ...latest, _stub: false }));
    return;
  }

  // GET /mcp/actions/next?sessionId=... — operator frontend claims next queued agent action.
  if (req.method === 'GET' && reqUrl.pathname === '/mcp/actions/next') {
    const sessionId = reqUrl.searchParams.get('sessionId');
    if (!sessionId) {
      res.writeHead(400);
      res.end(JSON.stringify({ error: 'Missing sessionId' }));
      return;
    }
    const next = claimNextMcpAction(sessionId);
    res.writeHead(200);
    res.end(JSON.stringify(next ? { action: next } : { action: null }));
    return;
  }

  // GET /mcp/actions/:id — return action status/result for MCP polling.
  if (req.method === 'GET' && reqUrl.pathname.startsWith('/mcp/actions/')) {
    const actionId = reqUrl.pathname.slice('/mcp/actions/'.length);
    if (!actionId) {
      res.writeHead(400);
      res.end(JSON.stringify({ error: 'Missing action id' }));
      return;
    }
    const action = mcpActions.get(actionId);
    if (!action) {
      res.writeHead(404);
      res.end(JSON.stringify({ error: 'Unknown action' }));
      return;
    }
    res.writeHead(200);
    res.end(JSON.stringify(action));
    return;
  }

  // POST /mcp/agent-context — frontend pushes session state when operator
  // enables agent access. Phase 2: wire this from the operator UI.
  if (req.method === 'POST' && reqUrl.pathname === '/mcp/agent-context') {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      try {
        const state = JSON.parse(body);
        if (!state.sessionId || typeof state.sessionId !== 'string') {
          res.writeHead(400);
          res.end(JSON.stringify({ error: 'Missing or invalid sessionId' }));
          return;
        }
        mcpSessionStates.set(state.sessionId, {
          ...state,
          updatedAt: new Date().toISOString(),
        });
        console.log('[mcp] agent-context updated for session', state.sessionId);
        res.writeHead(200);
        res.end(JSON.stringify({ ok: true }));
      } catch {
        res.writeHead(400);
        res.end(JSON.stringify({ error: 'Invalid JSON body' }));
      }
    });
    return;
  }

  // POST /mcp/actions — enqueue a bounded agent action for the operator session.
  if (req.method === 'POST' && reqUrl.pathname === '/mcp/actions') {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      try {
        const payload = JSON.parse(body);
        const sessionId = typeof payload.sessionId === 'string' ? payload.sessionId : '';
        const type = typeof payload.type === 'string' ? payload.type : '';
        const params = (payload.params && typeof payload.params === 'object')
          ? payload.params
          : {};

        if (!sessionId) {
          res.writeHead(400);
          res.end(JSON.stringify({ error: 'Missing or invalid sessionId' }));
          return;
        }
        if (!type) {
          res.writeHead(400);
          res.end(JSON.stringify({ error: 'Missing or invalid action type' }));
          return;
        }

        const id = randomUUID();
        const now = new Date().toISOString();
        /** @type {McpActionRecord} */
        const action = {
          id,
          sessionId,
          type,
          params,
          status: 'pending',
          createdAt: now,
          updatedAt: now,
          error: null,
        };
        mcpActions.set(id, action);
        const queue = mcpActionQueues.get(sessionId) ?? [];
        queue.push(id);
        mcpActionQueues.set(sessionId, queue);
        res.writeHead(200);
        res.end(JSON.stringify(action));
      } catch {
        res.writeHead(400);
        res.end(JSON.stringify({ error: 'Invalid JSON body' }));
      }
    });
    return;
  }

  // POST /mcp/actions/:id/status — operator frontend reports progress/result.
  if (req.method === 'POST' && reqUrl.pathname.startsWith('/mcp/actions/') && reqUrl.pathname.endsWith('/status')) {
    const prefix = '/mcp/actions/';
    const actionId = reqUrl.pathname.slice(prefix.length, -'/status'.length);
    if (!actionId) {
      res.writeHead(400);
      res.end(JSON.stringify({ error: 'Missing action id' }));
      return;
    }
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      try {
        const payload = JSON.parse(body);
        const action = mcpActions.get(actionId);
        if (!action) {
          res.writeHead(404);
          res.end(JSON.stringify({ error: 'Unknown action' }));
          return;
        }
        const status = typeof payload.status === 'string' ? payload.status : '';
        if (!['running', 'completed', 'failed'].includes(status)) {
          res.writeHead(400);
          res.end(JSON.stringify({ error: 'Invalid status' }));
          return;
        }
        const now = new Date().toISOString();
        action.status = /** @type {McpActionStatus} */ (status);
        action.updatedAt = now;
        if (status === 'running') {
          action.startedAt = now;
        }
        if (status === 'completed' || status === 'failed') {
          action.completedAt = now;
        }
        if ('result' in payload) {
          action.result = payload.result;
        }
        if ('error' in payload) {
          action.error = typeof payload.error === 'string' ? payload.error : null;
        }
        res.writeHead(200);
        res.end(JSON.stringify(action));
      } catch {
        res.writeHead(400);
        res.end(JSON.stringify({ error: 'Invalid JSON body' }));
      }
    });
    return;
  }

  res.writeHead(404);
  res.end(JSON.stringify({ error: 'Not found' }));
}

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
  if (req.url?.startsWith('/mcp/')) {
    mcpHandler(req, res);
    return;
  }
  res.writeHead(404);
  res.end('Not found');
});

const wss = new WebSocketServer({
  noServer: true,
  perMessageDeflate: {
    zlibDeflateOptions: { level: 6 },
    threshold: 256,
  },
});

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
      mcpSessionStates.delete(sessionId);
      mcpActionQueues.delete(sessionId);
      for (const [actionId, action] of mcpActions.entries()) {
        if (action.sessionId === sessionId) {
          mcpActions.delete(actionId);
        }
      }
      console.log('[ws] session closed (operator left)', sessionId);
    } else if (sess.members.length === 0) {
      sessions.delete(sessionId);
    }
  });
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`[junos-console-server] http://127.0.0.1:${PORT}`);
  console.log(`[junos-console-server] POST /mist-proxy  GET /health  WS /ws`);
  console.log(`[junos-console-server] GET /mcp/session-state  POST /mcp/agent-context  (MCP POC — see docs/BACKEND-MCP-POC.md)`);
});
