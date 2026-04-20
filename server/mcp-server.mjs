/**
 * mcp-server.mjs — MCP server for Junos console + Mist API
 *
 * Stdio mode (default — for Claude Desktop on the same machine):
 *   node server/mcp-server.mjs
 *
 * HTTP mode (for Claude Desktop on a different machine on the LAN):
 *   node server/mcp-server.mjs --http
 *
 *   Then in Claude Desktop on the remote machine:
 *   { "mcpServers": { "junos-console": { "url": "http://10.100.100.x:3334/mcp" } } }
 *
 * Session access:
 *   All tools require a session_id obtained out-of-band from the local operator.
 *   The operator must also tick "Allow remote access" in the UI before any tool call
 *   will succeed. list_sessions validates and returns info for the given session_id.
 *
 * Environment variables:
 *   MCP_TRANSPORT    "stdio" (default) or "http"
 *   MCP_PORT         HTTP listen port (default 3334)
 *   MCP_HOST         HTTP bind address (default 0.0.0.0)
 *   MCP_ALLOW_CIDR   Comma-separated allowed subnets (default 10.100.100.0/24,192.168.1.0/24); localhost always allowed
 *   HUB_URL          Hub base URL (default http://127.0.0.1:3333)
 *   WS_URL           WebSocket hub URL (default ws://127.0.0.1:3333/ws)
 *   MIST_API_HOST    e.g. api.mist.com (fallback for Mist tools when not supplied per-call)
 *   MIST_API_TOKEN   Mist API token   (fallback for Mist tools when not supplied per-call)
 *   MIST_ORG_ID      Mist org ID      (fallback for Mist tools when not supplied per-call)
 */

import http from 'node:http';
import https from 'node:https';
import { randomUUID } from 'node:crypto';
import { WebSocket } from 'ws';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';

// ── Configuration ──────────────────────────────────────────────────────────

const USE_HTTP = process.env.MCP_TRANSPORT === 'http' || process.argv.includes('--http');
const MCP_PORT = Number(process.env.MCP_PORT || 3334);
const MCP_HOST = process.env.MCP_HOST || '0.0.0.0';
const MCP_ALLOW_CIDRS = (process.env.MCP_ALLOW_CIDR || '10.100.100.0/24,192.168.1.0/24')
  .split(',').map((s) => s.trim()).filter(Boolean);

const HUB_URL = process.env.HUB_URL || 'http://127.0.0.1:3333';
const WS_URL = process.env.WS_URL || 'ws://127.0.0.1:3333/ws';

// Credentials — populated from env vars at startup; overridden by session credentials if absent.
let MIST_API_HOST = process.env.MIST_API_HOST || '';
let MIST_API_TOKEN = process.env.MIST_API_TOKEN || '';
let MIST_ORG_ID = process.env.MIST_ORG_ID || '';

// ── IP allowlist ───────────────────────────────────────────────────────────

/** Convert dotted-decimal IPv4 to a 32-bit unsigned integer. */
function ipToU32(ip) {
  return ip.split('.').reduce((acc, octet) => ((acc << 8) | (parseInt(octet, 10) & 0xff)) >>> 0, 0);
}

/** Return true if `ip` is within the `cidr` subnet (e.g. "10.100.100.0/24"). */
function inSubnet(ip, cidr) {
  const [subnetIp, prefixStr] = cidr.split('/');
  const prefix = parseInt(prefixStr, 10);
  const mask = prefix === 0 ? 0 : (~0 << (32 - prefix)) >>> 0;
  return (ipToU32(ip) & mask) === (ipToU32(subnetIp) & mask);
}

/**
 * Return true if the remote address should be allowed.
 * Accepts raw remoteAddress strings which may include IPv6-mapped IPv4
 * (e.g. "::ffff:10.100.100.5").
 */
function isAllowedIp(remoteAddress) {
  if (!remoteAddress) return false;
  // Strip IPv6-mapped prefix
  const raw = remoteAddress.replace(/^::ffff:/, '');
  // Always allow loopback
  if (raw === '127.0.0.1' || raw === '::1' || raw === 'localhost') return true;
  // Validate it looks like an IPv4 address before subnet check
  if (!/^\d+\.\d+\.\d+\.\d+$/.test(raw)) return false;
  return MCP_ALLOW_CIDRS.some((cidr) => inSubnet(raw, cidr));
}

// ── ANSI stripping ─────────────────────────────────────────────────────────

const ANSI_RE = /\x1b\[[0-9;]*[a-zA-Z]|\x1b\][^\x07]*\x07|\x1b[()][0-9A-B]|\x1b\[[\?]?[0-9;]*[hlm]|\r/g;

function stripAnsi(str) {
  return str.replace(ANSI_RE, '');
}

// ── Rolling output buffer ──────────────────────────────────────────────────

const MAX_BUFFER_LINES = 1000;
/** @type {string[]} */
const outputBuffer = [];
let rawTail = ''; // partial last line accumulator

function pushToBuffer(text) {
  const clean = stripAnsi(text);
  const combined = rawTail + clean;
  const lines = combined.split('\n');
  rawTail = lines.pop() ?? '';
  for (const line of lines) {
    outputBuffer.push(line);
    if (outputBuffer.length > MAX_BUFFER_LINES) outputBuffer.shift();
  }
}

// ── Junos prompt detection ─────────────────────────────────────────────────

const PROMPT_RE = /[>%#]\s*$|login:\s*$/m;

function detectMode(text) {
  const clean = stripAnsi(text);
  if (/login:\s*$/m.test(clean)) return 'login';
  if (/#\s*$/m.test(clean)) return 'config';
  if (/%\s*$/m.test(clean)) return 'shell';
  if (/>\s*$/m.test(clean)) return 'operational';
  return 'unknown';
}

// ── Blocked / warned commands ──────────────────────────────────────────────

const BLOCKED_COMMANDS = [
  /^\s*request\s+system\s+zeroize\b/i,
  /^\s*request\s+system\s+halt\b/i,
  /^\s*request\s+system\s+power-off\b/i,
];

const WARNED_COMMANDS = [
  /^\s*delete\b/i,
  /^\s*commit\b/i,
  /^\s*rollback\b/i,
];

function checkCommandSafety(command) {
  if (/^\s*request\s+system\s+reboot\b/i.test(command)) {
    return {
      blocked: true,
      reason: 'request system reboot is blocked. Use the force parameter if you truly need to reboot.',
    };
  }
  for (const re of BLOCKED_COMMANDS) {
    if (re.test(command)) {
      return { blocked: true, reason: `Command blocked for safety: ${command.trim()}` };
    }
  }
  for (const re of WARNED_COMMANDS) {
    if (re.test(command)) {
      return { warned: true, warning: `Warning: "${command.trim()}" is a potentially destructive command. Proceeding.` };
    }
  }
  return {};
}

// ── WebSocket hub connection ───────────────────────────────────────────────

let ws = null;
let wsReady = false;
let wsConnecting = false; // guard against concurrent connect attempts
/** The session ID we are currently joined to (null if not connected). */
let currentSessionId = null;

/** @type {{ resolve: Function, collector: string[], timer: ReturnType<typeof setTimeout> } | null} */
let pendingCommand = null;

/**
 * Connect the WebSocket to the hub and join the given session as support.
 * @param {string} sessionId
 */
function connectWs(sessionId) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(WS_URL);
    ws = socket;

    const timeout = setTimeout(() => {
      socket.terminate();
      reject(new Error('WebSocket connection timed out.'));
    }, 8000);

    socket.on('open', () => {
      socket.send(JSON.stringify({ type: 'join', role: 'support', sessionId }));
    });

    socket.on('message', (raw) => {
      let msg;
      try { msg = JSON.parse(raw.toString()); } catch { return; }

      if (msg.type === 'joined') {
        clearTimeout(timeout);
        wsReady = true;
        currentSessionId = sessionId;
        // Accept Mist credentials from session if not already set via env vars
        if (msg.mistCredentials && typeof msg.mistCredentials === 'object') {
          const c = msg.mistCredentials;
          if (!MIST_API_HOST && c.apiHost) { MIST_API_HOST = c.apiHost; }
          if (!MIST_API_TOKEN && c.apiToken) { MIST_API_TOKEN = c.apiToken; }
          if (!MIST_ORG_ID && c.orgId) { MIST_ORG_ID = c.orgId; }
          console.error('[mcp] Received Mist credentials from session (env vars take precedence).');
        }
        console.error(`[mcp] Joined session ${sessionId} as support`);
        resolve();
        return;
      }

      if (msg.type === 'error') {
        clearTimeout(timeout);
        const errMsg = msg.message || 'WebSocket error';
        if (!wsReady) { reject(new Error(errMsg)); return; }
        console.error('[mcp] ws error:', errMsg);
        return;
      }

      if (msg.type === 'session-ended') {
        wsReady = false;
        currentSessionId = null;
        const reason = `Session ended: ${msg.reason || 'unknown'}`;
        console.error('[mcp]', reason);
        if (pendingCommand) {
          const { resolve: res, collector, timer } = pendingCommand;
          clearTimeout(timer);
          pendingCommand = null;
          res({ output: stripAnsi(collector.join('')), prompt_detected: false });
        }
        return;
      }

      if (msg.type === 'serial-rx' && typeof msg.data === 'string') {
        const bytes = Buffer.from(msg.data, 'base64');
        const text = bytes.toString('utf8');
        pushToBuffer(text);

        if (pendingCommand) {
          pendingCommand.collector.push(text);
          const collected = pendingCommand.collector.join('');
          if (PROMPT_RE.test(stripAnsi(collected))) {
            clearTimeout(pendingCommand.timer);
            const { resolve: res } = pendingCommand;
            pendingCommand = null;
            res({ output: stripAnsi(collected), prompt_detected: true });
          }
        }
      }
    });

    socket.on('close', () => {
      wsReady = false;
      currentSessionId = null;
      if (pendingCommand) {
        const { resolve: res, collector, timer } = pendingCommand;
        clearTimeout(timer);
        pendingCommand = null;
        res({ output: stripAnsi(collector.join('')), prompt_detected: false });
      }
    });

    socket.on('error', (err) => {
      if (!wsReady) { clearTimeout(timeout); reject(err); }
    });
  });
}

/**
 * Ensure the WebSocket is connected and joined to the given session.
 * - Already connected to that session → reuse.
 * - Connected to a different session → disconnect, clear buffer, reconnect.
 * - Not connected → connect fresh.
 *
 * @param {string} sessionId
 * @returns {Promise<string|null>} null on success, error message string on failure.
 */
async function ensureConnectedTo(sessionId) {
  if (!sessionId) return 'session_id is required.';

  // Already on the right session
  if (wsReady && currentSessionId === sessionId) return null;

  if (wsConnecting) return 'Connection attempt already in progress — try again shortly.';

  // Disconnect from old session (different session or stale socket)
  if (ws) {
    try { ws.terminate(); } catch { /* ignore */ }
    ws = null;
    wsReady = false;
    currentSessionId = null;
    // Clear buffered output — it belongs to the old session
    outputBuffer.length = 0;
    rawTail = '';
  }

  wsConnecting = true;
  try {
    await connectWs(sessionId);
    return null;
  } catch (err) {
    return err.message;
  } finally {
    wsConnecting = false;
  }
}

function sendSerial(text) {
  if (!ws || !wsReady) throw new Error('Not connected to console session.');
  const encoded = Buffer.from(text, 'utf8').toString('base64');
  ws.send(JSON.stringify({ type: 'serial-tx', source: 'support', data: encoded }));
}

// ── Mist API helper ────────────────────────────────────────────────────────

/**
 * Resolve Mist credentials for a tool call.
 * Per-call parameters take priority; module-level env vars are the fallback.
 *
 * @param {object} input - tool input (may contain api_host, api_token, org_id)
 * @returns {{ apiHost: string, apiToken: string, orgId: string } | { error: string }}
 */
function resolveMistCreds(input = {}) {
  const apiHost  = (input.api_host  || MIST_API_HOST  || '').trim();
  const apiToken = (input.api_token || MIST_API_TOKEN || '').trim();
  const orgId    = (input.org_id    || MIST_ORG_ID    || '').trim();
  if (!apiHost || !apiToken) {
    return {
      error: 'Mist API credentials not configured. ' +
             'Provide api_host, api_token, and org_id parameters, ' +
             'or set MIST_API_HOST / MIST_API_TOKEN / MIST_ORG_ID env vars.',
    };
  }
  return { apiHost, apiToken, orgId };
}

/**
 * Make an HTTPS request to the Mist API.
 *
 * @param {string} method
 * @param {string} path
 * @param {object|null} body
 * @param {string} apiHost
 * @param {string} apiToken
 */
function mistRequest(method, path, body, apiHost, apiToken) {
  return new Promise((resolve, reject) => {
    const requestBody = body != null ? JSON.stringify(body) : null;
    const headers = {
      Authorization: `Token ${apiToken}`,
      'Content-Type': 'application/json',
    };
    if (requestBody) headers['Content-Length'] = Buffer.byteLength(requestBody);

    const req = https.request(
      { hostname: apiHost, path, method, headers },
      (res) => {
        let data = '';
        res.on('data', (c) => { data += c; });
        res.on('end', () => {
          let parsed;
          try { parsed = JSON.parse(data); } catch { parsed = data; }
          resolve({ status: res.statusCode, body: parsed });
        });
      }
    );

    req.on('error', reject);
    if (requestBody) req.write(requestBody);
    req.end();
  });
}

// ── Tool implementations ───────────────────────────────────────────────────

async function toolSendCommand({ command, session_id, timeout_ms = 15000, force = false }) {
  const authErr = await checkAuthorization(session_id);
  if (authErr) return { isError: true, content: [{ type: 'text', text: authErr }] };

  // Safety checks run before attempting connection (no need to be online to block a command)
  const isForceReboot = /^\s*request\s+system\s+reboot\b/i.test(command) && force;
  let warnMsg = null;

  if (!isForceReboot) {
    const safety = checkCommandSafety(command);
    if (safety.blocked) {
      return { isError: true, content: [{ type: 'text', text: `BLOCKED: ${safety.reason}` }] };
    }
    if (safety.warned) warnMsg = safety.warning;
  }

  const connErr = await ensureConnectedTo(session_id);
  if (connErr) {
    return { isError: true, content: [{ type: 'text', text: connErr }] };
  }

  const result = await runCommand(command, timeout_ms);
  const payload = warnMsg ? { ...result, warning: warnMsg } : result;
  return { content: [{ type: 'text', text: JSON.stringify(payload) }] };
}

function runCommand(command, timeout_ms) {
  return new Promise((resolve) => {
    if (pendingCommand) {
      resolve({ output: '', prompt_detected: false, error: 'Another command is already in flight' });
      return;
    }

    const collector = [];
    const timer = setTimeout(() => {
      pendingCommand = null;
      resolve({ output: stripAnsi(collector.join('')), prompt_detected: false });
    }, timeout_ms);

    pendingCommand = { resolve, collector, timer };
    try {
      sendSerial(command + '\n');
    } catch (err) {
      clearTimeout(timer);
      pendingCommand = null;
      resolve({ output: '', prompt_detected: false, error: err.message });
    }
  });
}

async function toolReadOutput({ session_id, lines = 50 }) {
  const authErr = await checkAuthorization(session_id);
  if (authErr) return { isError: true, content: [{ type: 'text', text: authErr }] };

  const snapshot = rawTail ? [...outputBuffer, rawTail] : [...outputBuffer];
  const slice = snapshot.slice(-lines);
  return {
    content: [{
      type: 'text',
      text: JSON.stringify({ output: slice.join('\n'), total_lines: snapshot.length }),
    }],
  };
}

async function toolGetSessionState({ session_id }) {
  const authErr = await checkAuthorization(session_id);
  if (authErr) return { isError: true, content: [{ type: 'text', text: authErr }] };

  const connErr = await ensureConnectedTo(session_id);
  if (connErr) {
    return { isError: true, content: [{ type: 'text', text: connErr }] };
  }
  const result = await runCommand('', 5000);
  const mode = detectMode(result.output);
  return { content: [{ type: 'text', text: JSON.stringify({ mode, session_id }) }] };
}

async function toolListSessions({ session_id } = {}) {
  const authErr = await checkAuthorization(session_id);
  if (authErr) return { isError: true, content: [{ type: 'text', text: authErr }] };

  return new Promise((resolve) => {
    const req = http.get(`${HUB_URL}/sessions`, (res) => {
      let data = '';
      res.on('data', (c) => { data += c; });
      res.on('end', () => {
        try {
          const sessions = JSON.parse(data);
          if (session_id) {
            // HTTP mode: return only the caller's own session (prevents enumeration).
            const session = sessions.find((s) => s.session_id === session_id);
            if (!session) {
              resolve({ isError: true, content: [{ type: 'text', text: 'Error: Invalid or unauthorized session_id' }] });
            } else {
              resolve({ content: [{ type: 'text', text: JSON.stringify([session]) }] });
            }
          } else {
            // stdio mode (no session_id): local operator can see all sessions.
            resolve({ content: [{ type: 'text', text: JSON.stringify(sessions) }] });
          }
        } catch (err) {
          resolve({ isError: true, content: [{ type: 'text', text: `Failed to parse sessions response: ${err.message}` }] });
        }
      });
    });
    req.on('error', (err) => {
      resolve({ isError: true, content: [{ type: 'text', text: `Hub unreachable at ${HUB_URL} — is the server running? (${err.message})` }] });
    });
    req.end();
  });
}

async function toolMistApiGet(input) {
  const authErr = await checkAuthorization(input.session_id);
  if (authErr) return { isError: true, content: [{ type: 'text', text: authErr }] };

  const creds = resolveMistCreds(input);
  if (creds.error) return { isError: true, content: [{ type: 'text', text: creds.error }] };
  try {
    const result = await mistRequest('GET', input.path, null, creds.apiHost, creds.apiToken);
    return { content: [{ type: 'text', text: JSON.stringify(result) }] };
  } catch (err) {
    return { isError: true, content: [{ type: 'text', text: err.message }] };
  }
}

async function toolMistApiPut(input) {
  const authErr = await checkAuthorization(input.session_id);
  if (authErr) return { isError: true, content: [{ type: 'text', text: authErr }] };

  const creds = resolveMistCreds(input);
  if (creds.error) return { isError: true, content: [{ type: 'text', text: creds.error }] };
  try {
    const result = await mistRequest('PUT', input.path, input.body, creds.apiHost, creds.apiToken);
    return { content: [{ type: 'text', text: JSON.stringify(result) }] };
  } catch (err) {
    return { isError: true, content: [{ type: 'text', text: err.message }] };
  }
}

async function toolListSites(input = {}) {
  const authErr = await checkAuthorization(input.session_id);
  if (authErr) return { isError: true, content: [{ type: 'text', text: authErr }] };

  const creds = resolveMistCreds(input);
  if (creds.error) return { isError: true, content: [{ type: 'text', text: creds.error }] };
  if (!creds.orgId) {
    return { isError: true, content: [{ type: 'text', text: 'org_id is required for list_sites.' }] };
  }
  try {
    const result = await mistRequest('GET', `/api/v1/orgs/${creds.orgId}/sites`, null, creds.apiHost, creds.apiToken);
    const sites = Array.isArray(result.body)
      ? result.body.map((s) => ({ id: s.id, name: s.name }))
      : result.body;
    return { content: [{ type: 'text', text: JSON.stringify({ sites }) }] };
  } catch (err) {
    return { isError: true, content: [{ type: 'text', text: err.message }] };
  }
}

async function toolGetDeviceConfig(input) {
  const authErr = await checkAuthorization(input.session_id);
  if (authErr) return { isError: true, content: [{ type: 'text', text: authErr }] };

  const creds = resolveMistCreds(input);
  if (creds.error) return { isError: true, content: [{ type: 'text', text: creds.error }] };
  try {
    const result = await mistRequest('GET', `/api/v1/sites/${input.site_id}/devices/${input.device_id}`, null, creds.apiHost, creds.apiToken);
    return { content: [{ type: 'text', text: JSON.stringify(result) }] };
  } catch (err) {
    return { isError: true, content: [{ type: 'text', text: err.message }] };
  }
}

async function toolGetDeviceStats(input) {
  const authErr = await checkAuthorization(input.session_id);
  if (authErr) return { isError: true, content: [{ type: 'text', text: authErr }] };

  const creds = resolveMistCreds(input);
  if (creds.error) return { isError: true, content: [{ type: 'text', text: creds.error }] };
  try {
    const result = await mistRequest('GET', `/api/v1/sites/${input.site_id}/stats/devices/${input.device_id}`, null, creds.apiHost, creds.apiToken);
    return { content: [{ type: 'text', text: JSON.stringify(result) }] };
  } catch (err) {
    return { isError: true, content: [{ type: 'text', text: err.message }] };
  }
}

async function toolGetInventory(input = {}) {
  const authErr = await checkAuthorization(input.session_id);
  if (authErr) return { isError: true, content: [{ type: 'text', text: authErr }] };

  const creds = resolveMistCreds(input);
  if (creds.error) return { isError: true, content: [{ type: 'text', text: creds.error }] };
  if (!creds.orgId) {
    return { isError: true, content: [{ type: 'text', text: 'org_id is required for get_inventory.' }] };
  }
  try {
    const result = await mistRequest('GET', `/api/v1/orgs/${creds.orgId}/inventory?type=switch`, null, creds.apiHost, creds.apiToken);
    let devices = Array.isArray(result.body) ? result.body : [];
    if (input.site_id) devices = devices.filter((d) => d.site_id === input.site_id);
    const mapped = devices.map((d) => ({
      id: d.id,
      name: d.name,
      mac: d.mac,
      serial: d.serial,
      model: d.model,
      site_id: d.site_id,
    }));
    return { content: [{ type: 'text', text: JSON.stringify(mapped) }] };
  } catch (err) {
    return { isError: true, content: [{ type: 'text', text: err.message }] };
  }
}

async function toolGetSiteSetting(input) {
  const authErr = await checkAuthorization(input.session_id);
  if (authErr) return { isError: true, content: [{ type: 'text', text: authErr }] };

  const creds = resolveMistCreds(input);
  if (creds.error) return { isError: true, content: [{ type: 'text', text: creds.error }] };
  try {
    const result = await mistRequest('GET', `/api/v1/sites/${input.site_id}/setting`, null, creds.apiHost, creds.apiToken);
    return { content: [{ type: 'text', text: JSON.stringify(result) }] };
  } catch (err) {
    return { isError: true, content: [{ type: 'text', text: err.message }] };
  }
}

// ── Tool definitions ───────────────────────────────────────────────────────

/**
 * Verify that session_id has been authorized for remote access by the local operator.
 * Returns null if authorized, or an error message string if not.
 * @param {string | undefined} session_id
 * @returns {Promise<string | null>}
 */
function checkAuthorization(session_id) {
  // stdio mode = local operator = always trusted; auth only applies to remote HTTP clients.
  if (!USE_HTTP) return Promise.resolve(null);
  if (!session_id) return Promise.resolve('session_id is required.');
  return new Promise((resolve) => {
    const req = http.get(`${HUB_URL}/sessions`, (res) => {
      let data = '';
      res.on('data', (c) => { data += c; });
      res.on('end', () => {
        try {
          const list = JSON.parse(data);
          const session = list.find((s) => s.session_id === session_id);
          if (!session || !session.remote_access_enabled) {
            resolve('Error: Invalid or unauthorized session_id');
          } else {
            resolve(null);
          }
        } catch (err) {
          resolve(`Failed to verify authorization: ${err.message}`);
        }
      });
    });
    req.on('error', (err) => {
      resolve(`Hub unreachable — cannot verify authorization: ${err.message}`);
    });
    req.end();
  });
}

/** Optional per-call Mist credential properties, shared across all Mist API tool schemas. */
const MIST_CRED_PROPS = {
  api_host: {
    type: 'string',
    description: 'Mist API host (e.g. api.gc1.mist.com). Falls back to MIST_API_HOST env var.',
  },
  api_token: {
    type: 'string',
    description: 'Mist API token. Falls back to MIST_API_TOKEN env var.',
  },
  org_id: {
    type: 'string',
    description: 'Mist organization ID. Falls back to MIST_ORG_ID env var.',
  },
};

/** session_id property used as an auth token on all tools. */
const SESSION_AUTH_PROP = {
  session_id: {
    type: 'string',
    description: 'Authorized session ID — provided by the local operator and required for authentication.',
  },
};

const TOOLS = [
  {
    name: 'list_sessions',
    description:
      'List active console sessions. In HTTP mode (remote access), session_id is required and ' +
      'only that specific session is returned — prevents enumeration. In stdio mode (local), ' +
      'session_id is optional and all sessions are returned when omitted.',
    inputSchema: {
      type: 'object',
      properties: { ...SESSION_AUTH_PROP },
    },
  },
  {
    name: 'send_command',
    description:
      'Send a command to the Junos switch console and wait for the response. ' +
      'Dangerous commands (zeroize, halt, power-off, reboot) are blocked. ' +
      'Destructive commands (delete, commit, rollback) emit a warning but are sent.',
    inputSchema: {
      type: 'object',
      properties: {
        session_id: { type: 'string', description: 'Console session ID (from list_sessions).' },
        command: { type: 'string', description: 'The Junos CLI command to send.' },
        timeout_ms: {
          type: 'number',
          description: 'Milliseconds to wait for a prompt (default 15000).',
          default: 15000,
        },
        force: {
          type: 'boolean',
          description: 'Set true to allow "request system reboot" (normally blocked).',
          default: false,
        },
      },
      required: ['session_id', 'command'],
    },
  },
  {
    name: 'read_output',
    description: 'Read the last N lines from the console output buffer (ANSI-stripped) for the currently connected session.',
    inputSchema: {
      type: 'object',
      properties: {
        ...SESSION_AUTH_PROP,
        lines: {
          type: 'number',
          description: 'Number of lines to return (default 50).',
          default: 50,
        },
      },
      required: ['session_id'],
    },
  },
  {
    name: 'get_session_state',
    description:
      'Send a newline to the switch and detect the current CLI mode: ' +
      'operational (>), config (#), shell (%), login, or unknown.',
    inputSchema: {
      type: 'object',
      properties: {
        session_id: { type: 'string', description: 'Console session ID (from list_sessions).' },
      },
      required: ['session_id'],
    },
  },
  {
    name: 'mist_api_get',
    description: 'Make a GET request to the Mist API. Credentials fall back to server env vars if not supplied.',
    inputSchema: {
      type: 'object',
      properties: {
        ...SESSION_AUTH_PROP,
        path: { type: 'string', description: 'API path, e.g. /api/v1/orgs/{org_id}/sites' },
        ...MIST_CRED_PROPS,
      },
      required: ['session_id', 'path'],
    },
  },
  {
    name: 'mist_api_put',
    description: 'Make a PUT request to the Mist API. Credentials fall back to server env vars if not supplied.',
    inputSchema: {
      type: 'object',
      properties: {
        ...SESSION_AUTH_PROP,
        path: { type: 'string', description: 'API path.' },
        body: { type: 'object', description: 'JSON body to send.' },
        ...MIST_CRED_PROPS,
      },
      required: ['session_id', 'path', 'body'],
    },
  },
  {
    name: 'list_sites',
    description: 'List all sites in the Mist org. Returns id and name for each site. Credentials fall back to server env vars if not supplied.',
    inputSchema: {
      type: 'object',
      properties: { ...SESSION_AUTH_PROP, ...MIST_CRED_PROPS },
      required: ['session_id'],
    },
  },
  {
    name: 'get_device_config',
    description: 'Get the full device configuration from Mist for a specific switch. Credentials fall back to server env vars if not supplied.',
    inputSchema: {
      type: 'object',
      properties: {
        ...SESSION_AUTH_PROP,
        site_id: { type: 'string', description: 'Mist site ID.' },
        device_id: { type: 'string', description: 'Mist device ID.' },
        ...MIST_CRED_PROPS,
      },
      required: ['session_id', 'site_id', 'device_id'],
    },
  },
  {
    name: 'get_device_stats',
    description: 'Get live device stats (including port_stat) from Mist for a specific switch. Credentials fall back to server env vars if not supplied.',
    inputSchema: {
      type: 'object',
      properties: {
        ...SESSION_AUTH_PROP,
        site_id: { type: 'string', description: 'Mist site ID.' },
        device_id: { type: 'string', description: 'Mist device ID.' },
        ...MIST_CRED_PROPS,
      },
      required: ['session_id', 'site_id', 'device_id'],
    },
  },
  {
    name: 'get_inventory',
    description: 'Get the switch inventory for a Mist org, optionally filtered by site. Credentials fall back to server env vars if not supplied.',
    inputSchema: {
      type: 'object',
      properties: {
        ...SESSION_AUTH_PROP,
        site_id: { type: 'string', description: 'If provided, only return devices assigned to this site.' },
        ...MIST_CRED_PROPS,
      },
      required: ['session_id'],
    },
  },
  {
    name: 'get_site_setting',
    description: 'Get site settings from Mist, including switch_mgmt.root_password. Credentials fall back to server env vars if not supplied.',
    inputSchema: {
      type: 'object',
      properties: {
        ...SESSION_AUTH_PROP,
        site_id: { type: 'string', description: 'Mist site ID.' },
        ...MIST_CRED_PROPS,
      },
      required: ['session_id', 'site_id'],
    },
  },
];

// ── MCP Server factory ─────────────────────────────────────────────────────

function createMcpServer() {
  const s = new Server(
    { name: 'junos-console', version: '1.0.0' },
    { capabilities: { tools: {} } },
  );

  s.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

  s.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    const input = args ?? {};

    switch (name) {
      case 'list_sessions':     return toolListSessions(input);
      case 'send_command':      return toolSendCommand(input);
      case 'read_output':       return toolReadOutput(input);
      case 'get_session_state': return toolGetSessionState(input);
      case 'mist_api_get':      return toolMistApiGet(input);
      case 'mist_api_put':      return toolMistApiPut(input);
      case 'list_sites':        return toolListSites(input);
      case 'get_device_config': return toolGetDeviceConfig(input);
      case 'get_device_stats':  return toolGetDeviceStats(input);
      case 'get_inventory':     return toolGetInventory(input);
      case 'get_site_setting':  return toolGetSiteSetting(input);
      default:
        return {
          isError: true,
          content: [{ type: 'text', text: `Unknown tool: ${name}` }],
        };
    }
  });

  return s;
}

// ── Body parser helper ─────────────────────────────────────────────────────

function readBody(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', (chunk) => { raw += chunk.toString(); });
    req.on('end', () => {
      if (!raw) { resolve(undefined); return; }
      try { resolve(JSON.parse(raw)); } catch { resolve(raw); }
    });
    req.on('error', reject);
  });
}

// ── Transport: stdio ───────────────────────────────────────────────────────

async function startStdio() {
  const s = createMcpServer();
  const transport = new StdioServerTransport();
  await s.connect(transport);
  console.error('[mcp] MCP server running on stdio');
}

// ── Transport: HTTP (Streamable HTTP — MCP 2025-03-26 spec) ───────────────

/**
 * In stateful HTTP mode each MCP client session gets its own transport.
 * The session ID is negotiated in headers (mcp-session-id).
 * All sessions share the same WebSocket console connection and tool implementations.
 *
 * @type {Map<string, { transport: StreamableHTTPServerTransport, server: Server }>}
 */
const httpSessions = new Map();

async function startHttp() {
  const httpServer = http.createServer(async (req, res) => {
    // ── IP allowlist ──
    const remoteIp = req.socket.remoteAddress || '';
    if (!isAllowedIp(remoteIp)) {
      console.error(`[mcp] Rejected connection from ${remoteIp}`);
      res.writeHead(403, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Forbidden: source IP not in allowed range.' }));
      return;
    }

    // ── Health check ──
    if (req.method === 'GET' && req.url === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        status: 'ok',
        transport: 'http',
        wsReady,
        currentSessionId: currentSessionId || null,
        activeMcpSessions: httpSessions.size,
      }));
      return;
    }

    // ── MCP endpoint ──
    if (req.url !== '/mcp') {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Not found. Use POST/GET /mcp.' }));
      return;
    }

    // Route to existing session or create new one
    const sessionId = req.headers['mcp-session-id'];
    let entry = typeof sessionId === 'string' ? httpSessions.get(sessionId) : undefined;

    if (!entry) {
      // New MCP client session
      let assignedId;
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => {
          assignedId = randomUUID();
          return assignedId;
        },
      });
      const s = createMcpServer();
      await s.connect(transport);

      transport.onclose = () => {
        if (assignedId) {
          httpSessions.delete(assignedId);
          console.error(`[mcp] HTTP session closed: ${assignedId} (${httpSessions.size} remaining)`);
        }
      };

      // Register before handleRequest so the onclose above can find it
      // assignedId is set synchronously inside sessionIdGenerator during handleRequest
      entry = { transport, server: s };
    }

    try {
      const body = await readBody(req);
      await entry.transport.handleRequest(req, res, body);

      // After the first handleRequest the transport has a sessionId — store it
      const tid = entry.transport.sessionId;
      if (tid && !httpSessions.has(tid)) {
        httpSessions.set(tid, entry);
        console.error(`[mcp] New HTTP session: ${tid} from ${remoteIp} (${httpSessions.size} total)`);
      }
    } catch (err) {
      console.error('[mcp] HTTP request error:', err.message);
      if (!res.headersSent) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
    }
  });

  httpServer.listen(MCP_PORT, MCP_HOST, () => {
    console.error(`[mcp] HTTP MCP server listening on ${MCP_HOST}:${MCP_PORT}`);
    console.error(`[mcp]   Endpoint : http://<host>:${MCP_PORT}/mcp`);
    console.error(`[mcp]   Health   : http://<host>:${MCP_PORT}/health`);
    console.error(`[mcp]   Allowed  : 127.0.0.1 + ${MCP_ALLOW_CIDRS.join(', ')}`);
  });

  httpServer.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.error(`[mcp] ERROR: Port ${MCP_PORT} is already in use.`);
      console.error(`[mcp] Kill the existing process first:`);
      console.error(`[mcp]   Windows: for /f "tokens=5" %a in ('netstat -ano ^| findstr :${MCP_PORT}') do taskkill /PID %a /F`);
      console.error(`[mcp]   Linux/Mac: lsof -ti:${MCP_PORT} | xargs kill -9`);
    } else {
      console.error('[mcp] HTTP server error:', err.message);
    }
    process.exit(1);
  });
}

// ── Startup ────────────────────────────────────────────────────────────────

async function main() {
  // All tool calls require a session_id provided out-of-band by the local operator.
  if (USE_HTTP) {
    await startHttp();
  } else {
    await startStdio();
  }
}

main().catch((err) => {
  console.error('[mcp] Fatal:', err);
  process.exit(1);
});
