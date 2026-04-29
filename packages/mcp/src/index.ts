import { CHECKS } from '@marvis/shared';
import type { CheckResult, ConsoleSession } from '@marvis/shared';

const SERVER_URL = process.env['CONSOLE_SERVER_URL'] ?? 'http://localhost:3000';

// --- Minimal MCP stdio protocol implementation ---

interface McpRequest {
  jsonrpc: '2.0';
  id: number | string;
  method: string;
  params?: unknown;
}

interface McpResponse {
  jsonrpc: '2.0';
  id: number | string;
  result?: unknown;
  error?: { code: number; message: string };
}

function respond(id: number | string, result: unknown): void {
  const res: McpResponse = { jsonrpc: '2.0', id, result };
  process.stdout.write(JSON.stringify(res) + '\n');
}

function respondError(id: number | string, code: number, message: string): void {
  const res: McpResponse = { jsonrpc: '2.0', id, error: { code, message } };
  process.stdout.write(JSON.stringify(res) + '\n');
}

async function apiGet<T>(path: string): Promise<T> {
  const res = await fetch(`${SERVER_URL}${path}`);
  const json = await res.json() as { success: boolean; data?: T; error?: string };
  if (!json.success) throw new Error(json.error ?? 'API error');
  return json.data as T;
}

async function apiPost<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${SERVER_URL}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    ...(body !== undefined && { body: JSON.stringify(body) }),
  });
  const json = await res.json() as { success: boolean; data?: T; error?: string };
  if (!json.success) throw new Error(json.error ?? 'API error');
  return json.data as T;
}

// --- Tool definitions ---

const TOOLS = [
  {
    name: 'list_sessions',
    description: 'List all active Marvis Console troubleshooting sessions.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'get_session',
    description: 'Get details of a specific session including device info and Mist connection status.',
    inputSchema: {
      type: 'object',
      properties: { sessionId: { type: 'string', description: 'The session ID' } },
      required: ['sessionId'],
    },
  },
  {
    name: 'run_all_checks',
    description: 'Run all diagnostic checks for a session. Returns results for all 21 checks.',
    inputSchema: {
      type: 'object',
      properties: { sessionId: { type: 'string', description: 'The session ID' } },
      required: ['sessionId'],
    },
  },
  {
    name: 'run_check',
    description: `Run a single diagnostic check. Available check IDs: ${CHECKS.map((c) => c.id).join(', ')}`,
    inputSchema: {
      type: 'object',
      properties: {
        sessionId: { type: 'string', description: 'The session ID' },
        checkId: { type: 'string', description: 'The check ID to run' },
      },
      required: ['sessionId', 'checkId'],
    },
  },
  {
    name: 'list_checks',
    description: 'List all available diagnostic checks with descriptions and group membership.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'read_output',
    description: 'Return recent terminal output from the switch console for a session.',
    inputSchema: {
      type: 'object',
      properties: {
        sessionId: { type: 'string', description: 'The session ID' },
        chars: { type: 'number', description: 'Max characters to return (default: 10000)' },
      },
      required: ['sessionId'],
    },
  },
  {
    name: 'send_command',
    description: 'Send a CLI command to the switch console and return its output.',
    inputSchema: {
      type: 'object',
      properties: {
        sessionId: { type: 'string', description: 'The session ID' },
        command: { type: 'string', description: 'The CLI command to run on the switch' },
        timeoutMs: { type: 'number', description: 'Timeout in milliseconds (default: 15000)' },
      },
      required: ['sessionId', 'command'],
    },
  },
];

// --- Exported dispatch function (testable without I/O) ---

export async function dispatchTool(
  name: string,
  args: Record<string, string>,
): Promise<string> {
  if (name === 'list_sessions') {
    const sessions = await apiGet<ConsoleSession[]>('/api/sessions');
    return JSON.stringify(sessions, null, 2);
  }

  if (name === 'get_session') {
    const session = await apiGet<ConsoleSession>(`/api/sessions/${args['sessionId']}/state`);
    return JSON.stringify(session, null, 2);
  }

  if (name === 'run_all_checks') {
    const results = await apiPost<CheckResult[]>(`/api/sessions/${args['sessionId']}/checks/run`);
    return results
      .map((r) => `[${r.status.toUpperCase().padEnd(5)}] ${r.checkId}: ${r.summary}`)
      .join('\n');
  }

  if (name === 'run_check') {
    const result = await apiPost<CheckResult>(
      `/api/sessions/${args['sessionId']}/checks/${args['checkId']}/run`,
    );
    return JSON.stringify(result, null, 2);
  }

  if (name === 'list_checks') {
    return CHECKS.map((c) => `${c.id} (${c.groupId}): ${c.description}`).join('\n');
  }

  if (name === 'read_output') {
    const chars = args['chars'] ? parseInt(args['chars'], 10) : undefined;
    const path = `/api/sessions/${args['sessionId']}/output${chars ? `?chars=${chars}` : ''}`;
    const data = await apiGet<{ sessionId: string; output: string }>(path);
    return data.output || '(no output buffered)';
  }

  if (name === 'send_command') {
    const body: Record<string, unknown> = { command: args['command'] };
    if (args['timeoutMs']) body['timeoutMs'] = parseInt(args['timeoutMs'], 10);
    const data = await apiPost<{ sessionId: string; command: string; output: string }>(
      `/api/sessions/${args['sessionId']}/command`,
      body,
    );
    return data.output || '(no output)';
  }

  throw new Error(`Unknown tool: ${name}`);
}

// --- Request handlers ---

async function handleToolCall(
  id: number | string,
  name: string,
  args: Record<string, string>,
): Promise<void> {
  try {
    const text = await dispatchTool(name, args);
    respond(id, { content: [{ type: 'text', text }] });
  } catch (err) {
    respondError(id, -32603, err instanceof Error ? err.message : String(err));
  }
}

function handleRequest(req: McpRequest): void {
  if (req.method === 'initialize') {
    respond(req.id, {
      protocolVersion: '2024-11-05',
      capabilities: { tools: {} },
      serverInfo: { name: 'marvis-mcp', version: '0.1.0' },
    });
    return;
  }

  if (req.method === 'tools/list') {
    respond(req.id, { tools: TOOLS });
    return;
  }

  if (req.method === 'tools/call') {
    const params = req.params as { name: string; arguments?: Record<string, string> };
    handleToolCall(req.id, params.name, params.arguments ?? {});
    return;
  }

  if (req.method === 'notifications/initialized') {
    return;
  }

  respondError(req.id, -32601, `Method not found: ${req.method}`);
}

// --- Stdio loop ---

let buffer = '';

process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk: string) => {
  buffer += chunk;
  const lines = buffer.split('\n');
  buffer = lines.pop() ?? '';
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const req = JSON.parse(trimmed) as McpRequest;
      handleRequest(req);
    } catch {
      // ignore parse errors on malformed input
    }
  }
});

process.stdin.on('end', () => process.exit(0));
