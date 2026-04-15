/**
 * mcp-server.mjs — MCP stdio server for Junos console + Mist API
 *
 * Usage:
 *   MIST_API_HOST=api.mist.com MIST_API_TOKEN=xxx MIST_ORG_ID=xxx \
 *   node server/mcp-server.mjs <session-id>
 *
 * The server connects to the WebSocket hub as a "support" client to
 * read/write the operator's console session, and makes direct HTTPS
 * calls to the Mist API using the provided credentials.
 */

import https from 'node:https';
import { WebSocket } from 'ws';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';

// ── Configuration ──────────────────────────────────────────────────────────

const SESSION_ID = process.argv[2] || process.env.MCP_SESSION_ID || '';
const WS_URL = process.env.WS_URL || 'ws://127.0.0.1:3333/ws';

const MIST_API_HOST = process.env.MIST_API_HOST || '';
const MIST_API_TOKEN = process.env.MIST_API_TOKEN || '';
const MIST_ORG_ID = process.env.MIST_ORG_ID || '';

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
  // Merge with any prior partial line
  const combined = rawTail + clean;
  const lines = combined.split('\n');
  // Last element may be a partial line (no trailing \n yet)
  rawTail = lines.pop() ?? '';
  for (const line of lines) {
    outputBuffer.push(line);
    if (outputBuffer.length > MAX_BUFFER_LINES) outputBuffer.shift();
  }
}

// ── Junos prompt detection ─────────────────────────────────────────────────

// Matches: "user@host> ", "user@host# ", "%  " (shell), "login: "
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

/**
 * Returns { blocked: true, reason } or { warned: true, warning } or {}
 */
function checkCommandSafety(command) {
  // Special case: allow "request system reboot" only when force flag set
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

/** Pending send_command resolver: { resolve, reject, collector, timer } | null */
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
        console.error(`[mcp] Joined session ${SESSION_ID} as support`);
        resolve();
        return;
      }

      if (msg.type === 'error') {
        clearTimeout(timeout);
        wsError = msg.message || 'WebSocket error';
        if (!wsReady) { reject(new Error(wsError)); return; }
        // Post-join error: log it
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
          res({ output: collector.join(''), prompt_detected: false });
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
  // Safety check — allow force-reboot override
  if (/^\s*request\s+system\s+reboot\b/i.test(command) && force) {
    // fall through
  } else {
    const safety = checkCommandSafety(command);
    if (safety.blocked) {
      return { isError: true, content: [{ type: 'text', text: `BLOCKED: ${safety.reason}` }] };
    }
    if (!ws || !wsReady) {
      return { isError: true, content: [{ type: 'text', text: wsError || 'Not connected to console session.' }] };
    }
    if (safety.warned) {
      // Proceed but we'll prepend the warning to output
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
      // Shouldn't happen in serial MCP usage, but be safe
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
  // Flush any partial line into buffer snapshot
  const snapshot = rawTail
    ? [...outputBuffer, rawTail]
    : [...outputBuffer];
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
        path: {
          type: 'string',
          description: 'API path, e.g. /api/v1/orgs/{org_id}/sites',
        },
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

// ── MCP server wiring ──────────────────────────────────────────────────────

const server = new Server(
  { name: 'junos-console', version: '1.0.0' },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  const input = args ?? {};

  switch (name) {
    case 'send_command':     return toolSendCommand(input);
    case 'read_output':      return toolReadOutput(input);
    case 'get_session_state': return toolGetSessionState();
    case 'mist_api_get':     return toolMistApiGet(input);
    case 'mist_api_put':     return toolMistApiPut(input);
    case 'list_sites':       return toolListSites();
    case 'get_device_config': return toolGetDeviceConfig(input);
    case 'get_device_stats': return toolGetDeviceStats(input);
    case 'get_inventory':    return toolGetInventory(input);
    case 'get_site_setting': return toolGetSiteSetting(input);
    default:
      return {
        isError: true,
        content: [{ type: 'text', text: `Unknown tool: ${name}` }],
      };
  }
});

// ── Startup ────────────────────────────────────────────────────────────────

async function main() {
  // Connect to console session (non-fatal if no session ID — API-only usage)
  if (SESSION_ID) {
    try {
      await connectWs();
    } catch (err) {
      console.error('[mcp] Console session unavailable:', err.message);
      console.error('[mcp] Console tools will return errors; Mist API tools still work.');
      wsError = err.message;
    }
  } else {
    wsError = 'No session ID provided — console tools disabled. Pass session ID as first argument.';
    console.error('[mcp]', wsError);
  }

  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('[mcp] MCP server running on stdio');
}

main().catch((err) => {
  console.error('[mcp] Fatal:', err);
  process.exit(1);
});
