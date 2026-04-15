/**
 * mcp-server.mjs — MCP server for Junos console + Mist API
 *
 * Stdio mode (default — for Claude Desktop on the same machine):
 *   MIST_API_HOST=api.mist.com MIST_API_TOKEN=xxx MIST_ORG_ID=xxx \
 *   node server/mcp-server.mjs <session-id>
 *
 * HTTP mode (for Claude Desktop on a different machine on the LAN):
 *   MIST_API_HOST=api.mist.com MIST_API_TOKEN=xxx MIST_ORG_ID=xxx \
 *   MCP_TRANSPORT=http MCP_PORT=3334 \
 *   node server/mcp-server.mjs <session-id>
 *
 *   Then in Claude Desktop on the remote machine:
 *   { "mcpServers": { "junos-console": { "url": "http://10.100.100.x:3334/mcp" } } }
 *
 * Environment variables:
 *   MCP_TRANSPORT    "stdio" (default) or "http"
 *   MCP_PORT         HTTP listen port (default 3334)
 *   MCP_HOST         HTTP bind address (default 0.0.0.0)
 *   MCP_ALLOW_CIDR   Allowed source subnet (default 10.100.100.0/24); localhost always allowed
 *   WS_URL           WebSocket hub URL (default ws://127.0.0.1:3333/ws)
 *   MCP_SESSION_ID   Alternative to positional session-id argument
 *   MIST_API_HOST    e.g. api.mist.com
 *   MIST_API_TOKEN   Mist API token
 *   MIST_ORG_ID      Mist organisation ID
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
const MCP_ALLOW_CIDR = process.env.MCP_ALLOW_CIDR || '10.100.100.0/24';

// Session ID: skip '--http' if it appears as first positional arg
const _args = process.argv.slice(2).filter((a) => a !== '--http');
const SESSION_ID = _args[0] || process.env.MCP_SESSION_ID || '';
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
  return inSubnet(raw, MCP_ALLOW_CIDR);
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
let wsError = null;

/** @type {{ resolve: Function, collector: string[], timer: ReturnType<typeof setTimeout> } | null} */
let pendingCommand = null;

function connectWs() {
  return new Promise((resolve, reject) => {
    if (!SESSION_ID) {
      wsError = 'No session ID provided. Pass session ID as first argument.';
      reject(new Error(wsError));
      return;
    }

    const socket = new WebSocket(WS_URL);
    ws = socket;

    const timeout = setTimeout(() => {
      socket.terminate();
      wsError = 'WebSocket connection timed out.';
      reject(new Error(wsError));
    }, 8000);

    socket.on('open', () => {
      socket.send(JSON.stringify({ type: 'join', role: 'support', sessionId: SESSION_ID }));
    });

    socket.on('message', (raw) => {
      let msg;
      try { msg = JSON.parse(raw.toString()); } catch { return; }

      if (msg.type === 'joined') {
        clearTimeout(timeout);
        wsReady = true;
        // Accept Mist credentials from session if not already set via env vars
        if (msg.mistCredentials && typeof msg.mistCredentials === 'object') {
          const c = msg.mistCredentials;
          if (!MIST_API_HOST && c.apiHost) { MIST_API_HOST = c.apiHost; }
          if (!MIST_API_TOKEN && c.apiToken) { MIST_API_TOKEN = c.apiToken; }
          if (!MIST_ORG_ID && c.orgId) { MIST_ORG_ID = c.orgId; }
          console.error('[mcp] Received Mist credentials from session (env vars take precedence).');
        }
        console.error(`[mcp] Joined session ${SESSION_ID} as support`);
        resolve();
        return;
      }

      if (msg.type === 'error') {
        clearTimeout(timeout);
        wsError = msg.message || 'WebSocket error';
        if (!wsReady) { reject(new Error(wsError)); return; }
        console.error('[mcp] ws error:', wsError);
        return;
      }

      if (msg.type === 'session-ended') {
        wsReady = false;
        wsError = `Session ended: ${msg.reason || 'unknown'}`;
        console.error('[mcp]', wsError);
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
      wsError = 'WebSocket disconnected.';
      if (pendingCommand) {
        const { resolve: res, collector, timer } = pendingCommand;
        clearTimeout(timer);
        pendingCommand = null;
        res({ output: stripAnsi(collector.join('')), prompt_detected: false });
      }
    });

    socket.on('error', (err) => {
      wsError = err.message;
      if (!wsReady) { clearTimeout(timeout); reject(err); }
    });
  });
}

function sendSerial(text) {
  if (!ws || !wsReady) throw new Error('Not connected to console session.');
  const encoded = Buffer.from(text, 'utf8').toString('base64');
  ws.send(JSON.stringify({ type: 'serial-tx', source: 'support', data: encoded }));
}

// ── Mist API helper ────────────────────────────────────────────────────────

function mistRequest(method, path, body) {
  return new Promise((resolve, reject) => {
    if (!MIST_API_HOST || !MIST_API_TOKEN) {
      reject(new Error('Mist API credentials not configured (MIST_API_HOST, MIST_API_TOKEN).'));
      return;
    }

    const requestBody = body != null ? JSON.stringify(body) : null;
    const headers = {
      Authorization: `Token ${MIST_API_TOKEN}`,
      'Content-Type': 'application/json',
    };
    if (requestBody) headers['Content-Length'] = Buffer.byteLength(requestBody);

    const req = https.request(
      { hostname: MIST_API_HOST, path, method, headers },
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

async function toolSendCommand({ command, timeout_ms = 15000, force = false }) {
  if (/^\s*request\s+system\s+reboot\b/i.test(command) && force) {
    // force-reboot: skip safety check, fall through
  } else {
    const safety = checkCommandSafety(command);
    if (safety.blocked) {
      return { isError: true, content: [{ type: 'text', text: `BLOCKED: ${safety.reason}` }] };
    }
    if (!ws || !wsReady) {
      return { isError: true, content: [{ type: 'text', text: wsError || 'Not connected to console session.' }] };
    }
    if (safety.warned) {
      const result = await runCommand(command, timeout_ms);
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({ ...result, warning: safety.warning }),
        }],
      };
    }
  }

  if (!ws || !wsReady) {
    return { isError: true, content: [{ type: 'text', text: wsError || 'Not connected to console session.' }] };
  }

  const result = await runCommand(command, timeout_ms);
  return { content: [{ type: 'text', text: JSON.stringify(result) }] };
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

async function toolReadOutput({ lines = 50 }) {
  const snapshot = rawTail ? [...outputBuffer, rawTail] : [...outputBuffer];
  const slice = snapshot.slice(-lines);
  return {
    content: [{
      type: 'text',
      text: JSON.stringify({ output: slice.join('\n'), total_lines: snapshot.length }),
    }],
  };
}

async function toolGetSessionState() {
  if (!ws || !wsReady) {
    return { isError: true, content: [{ type: 'text', text: wsError || 'Not connected to console session.' }] };
  }
  const result = await runCommand('', 5000);
  const mode = detectMode(result.output);
  return { content: [{ type: 'text', text: JSON.stringify({ mode }) }] };
}

async function toolMistApiGet({ path }) {
  try {
    const result = await mistRequest('GET', path, null);
    return { content: [{ type: 'text', text: JSON.stringify(result) }] };
  } catch (err) {
    return { isError: true, content: [{ type: 'text', text: err.message }] };
  }
}

async function toolMistApiPut({ path, body }) {
  try {
    const result = await mistRequest('PUT', path, body);
    return { content: [{ type: 'text', text: JSON.stringify(result) }] };
  } catch (err) {
    return { isError: true, content: [{ type: 'text', text: err.message }] };
  }
}

async function toolListSites() {
  if (!MIST_ORG_ID) {
    return { isError: true, content: [{ type: 'text', text: 'MIST_ORG_ID not configured.' }] };
  }
  try {
    const result = await mistRequest('GET', `/api/v1/orgs/${MIST_ORG_ID}/sites`, null);
    const sites = Array.isArray(result.body)
      ? result.body.map((s) => ({ id: s.id, name: s.name }))
      : result.body;
    return { content: [{ type: 'text', text: JSON.stringify({ sites }) }] };
  } catch (err) {
    return { isError: true, content: [{ type: 'text', text: err.message }] };
  }
}

async function toolGetDeviceConfig({ site_id, device_id }) {
  try {
    const result = await mistRequest('GET', `/api/v1/sites/${site_id}/devices/${device_id}`, null);
    return { content: [{ type: 'text', text: JSON.stringify(result) }] };
  } catch (err) {
    return { isError: true, content: [{ type: 'text', text: err.message }] };
  }
}

async function toolGetDeviceStats({ site_id, device_id }) {
  try {
    const result = await mistRequest('GET', `/api/v1/sites/${site_id}/stats/devices/${device_id}`, null);
    return { content: [{ type: 'text', text: JSON.stringify(result) }] };
  } catch (err) {
    return { isError: true, content: [{ type: 'text', text: err.message }] };
  }
}

async function toolGetInventory({ site_id } = {}) {
  if (!MIST_ORG_ID) {
    return { isError: true, content: [{ type: 'text', text: 'MIST_ORG_ID not configured.' }] };
  }
  try {
    const result = await mistRequest('GET', `/api/v1/orgs/${MIST_ORG_ID}/inventory?type=switch`, null);
    let devices = Array.isArray(result.body) ? result.body : [];
    if (site_id) devices = devices.filter((d) => d.site_id === site_id);
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

async function toolGetSiteSetting({ site_id }) {
  try {
    const result = await mistRequest('GET', `/api/v1/sites/${site_id}/setting`, null);
    return { content: [{ type: 'text', text: JSON.stringify(result) }] };
  } catch (err) {
    return { isError: true, content: [{ type: 'text', text: err.message }] };
  }
}

// ── Tool definitions ───────────────────────────────────────────────────────

const TOOLS = [
  {
    name: 'send_command',
    description:
      'Send a command to the Junos switch console and wait for the response. ' +
      'Dangerous commands (zeroize, halt, power-off, reboot) are blocked. ' +
      'Destructive commands (delete, commit, rollback) emit a warning but are sent.',
    inputSchema: {
      type: 'object',
      properties: {
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
      required: ['command'],
    },
  },
  {
    name: 'read_output',
    description: 'Read the last N lines from the console output buffer (ANSI-stripped).',
    inputSchema: {
      type: 'object',
      properties: {
        lines: {
          type: 'number',
          description: 'Number of lines to return (default 50).',
          default: 50,
        },
      },
    },
  },
  {
    name: 'get_session_state',
    description:
      'Send a newline to the switch and detect the current CLI mode: ' +
      'operational (>), config (#), shell (%), login, or unknown.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'mist_api_get',
    description: 'Make a GET request to the Mist API.',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'API path, e.g. /api/v1/orgs/{org_id}/sites' },
      },
      required: ['path'],
    },
  },
  {
    name: 'mist_api_put',
    description: 'Make a PUT request to the Mist API.',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'API path.' },
        body: { type: 'object', description: 'JSON body to send.' },
      },
      required: ['path', 'body'],
    },
  },
  {
    name: 'list_sites',
    description: 'List all sites in the configured Mist org. Returns id and name for each site.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'get_device_config',
    description: 'Get the full device configuration from Mist for a specific switch.',
    inputSchema: {
      type: 'object',
      properties: {
        site_id: { type: 'string', description: 'Mist site ID.' },
        device_id: { type: 'string', description: 'Mist device ID.' },
      },
      required: ['site_id', 'device_id'],
    },
  },
  {
    name: 'get_device_stats',
    description: 'Get live device stats (including port_stat) from Mist for a specific switch.',
    inputSchema: {
      type: 'object',
      properties: {
        site_id: { type: 'string', description: 'Mist site ID.' },
        device_id: { type: 'string', description: 'Mist device ID.' },
      },
      required: ['site_id', 'device_id'],
    },
  },
  {
    name: 'get_inventory',
    description: 'Get the switch inventory for the configured Mist org, optionally filtered by site.',
    inputSchema: {
      type: 'object',
      properties: {
        site_id: {
          type: 'string',
          description: 'If provided, only return devices assigned to this site.',
        },
      },
    },
  },
  {
    name: 'get_site_setting',
    description: 'Get site settings from Mist, including switch_mgmt.root_password.',
    inputSchema: {
      type: 'object',
      properties: {
        site_id: { type: 'string', description: 'Mist site ID.' },
      },
      required: ['site_id'],
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
      case 'send_command':      return toolSendCommand(input);
      case 'read_output':       return toolReadOutput(input);
      case 'get_session_state': return toolGetSessionState();
      case 'mist_api_get':      return toolMistApiGet(input);
      case 'mist_api_put':      return toolMistApiPut(input);
      case 'list_sites':        return toolListSites();
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
        sessionId: SESSION_ID || null,
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
    console.error(`[mcp]   Allowed  : 127.0.0.1 + ${MCP_ALLOW_CIDR}`);
  });
}

// ── Startup ────────────────────────────────────────────────────────────────

async function main() {
  // Connect to console session (non-fatal — API-only usage still works)
  if (SESSION_ID) {
    try {
      await connectWs();
    } catch (err) {
      console.error('[mcp] Console session unavailable:', err.message);
      console.error('[mcp] Console tools will return errors; Mist API tools still work.');
      wsError = err.message;
    }
  } else {
    wsError = 'No session ID provided — console tools disabled. Pass session ID as first argument or set MCP_SESSION_ID.';
    console.error('[mcp]', wsError);
  }

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
