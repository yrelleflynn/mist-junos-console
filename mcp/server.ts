/**
 * junos-console Backend MCP Server — Phase 1 (read-only observer)
 *
 * Exposes live session and Mist-proxy context as structured MCP tools so an AI
 * agent can safely consume recovery context without direct serial or config
 * mutation access.
 *
 * Phase 1 tools (all read-only):
 *   get_session_summary         — current session state from the backend
 *   get_device_identity         — switch identity and Mist match result
 *   get_jma_connectivity_state  — switch-reported JMA cloud state
 *   get_check_results           — last troubleshoot workflow results
 *   get_device_config           — Mist-intended config via backend proxy (LIVE)
 *
 * Trust boundary:
 *   - operator owns the session; agent gets a read-only window into it
 *   - no command execution, no config mutation in this phase
 *   - mutating tools (commit, rollback, adoption) are intentionally deferred
 *   - agent access to session state requires the operator to POST to
 *     /mcp/agent-context (frontend wiring is a Phase 2 task)
 *
 * Environment variables:
 *   BACKEND_URL      — backend server base URL (default: http://127.0.0.1:3333)
 *   MIST_API_HOST    — Mist API hostname (e.g. api.mist.com)
 *   MIST_API_TOKEN   — Mist API token (required for get_device_config)
 *
 * Run:
 *   cd mcp && npm install && npm run dev
 *
 * Or after build:
 *   cd mcp && npm run build && npm start
 *
 * Related docs:
 *   docs/BACKEND-MCP-POC.md
 *   docs/BACKEND-MCP-DESIGN.md
 *   docs/AI-AGENT-INTEGRATION.md
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const BACKEND_URL = process.env.BACKEND_URL ?? 'http://127.0.0.1:3333';
const MIST_API_HOST = process.env.MIST_API_HOST ?? '';
const MIST_API_TOKEN = process.env.MIST_API_TOKEN ?? '';

// ---------------------------------------------------------------------------
// Types — match the shapes described in docs/SESSION-EVENT-SCHEMA.md and
//         the backend /mcp/session-state response.
// ---------------------------------------------------------------------------

interface JmaState {
  stateCode: number | null;
  stateLabel: string | null;
  stateDescription: string | null;
  rawValue: string | null;
  checkedAt: string | null;
}

interface MistMatch {
  matched: boolean;
  matchConfidence: 'serial' | 'mac' | 'hostname' | 'none';
  orgId: string | null;
  siteId: string | null;
  deviceId: string | null;
  deviceName: string | null;
}

interface DeviceIdentity {
  hostname: string | null;
  serial: string | null;
  mac: string | null;
  model: string | null;
  junosVersion: string | null;
  mistMatch: MistMatch;
}

interface CheckResult {
  id: string;
  name: string;
  status: 'pass' | 'fail' | 'warn' | 'skip' | 'info';
  summary: string;
  remediation: string | null;
  rawExcerpt: string | null;
}

interface CheckResultsBundle {
  workflowStatus: 'not_run' | 'running' | 'completed' | 'failed';
  runAt: string | null;
  checks: CheckResult[];
}

interface BackendSessionState {
  sessionId: string | null;
  agentAccessEnabled: boolean;
  serialConnected: boolean;
  deviceIdentified: boolean;
  mistStatus: string | null;
  configSyncState: string | null;
  identity: DeviceIdentity | null;
  jma: JmaState | null;
  checkResults: CheckResultsBundle | null;
  updatedAt: string | null;
  _stub: boolean;
}

// ---------------------------------------------------------------------------
// Backend HTTP helpers
// ---------------------------------------------------------------------------

/** Fetch the current session state from the backend's /mcp/session-state. */
async function fetchSessionState(): Promise<BackendSessionState> {
  try {
    const res = await fetch(`${BACKEND_URL}/mcp/session-state`);
    if (!res.ok) {
      throw new Error(`Backend returned ${res.status}`);
    }
    return (await res.json()) as BackendSessionState;
  } catch (err) {
    // Return a clear stub so the agent knows why data is absent.
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
}

/** Call the Mist API through the backend proxy. */
async function mistProxyCall(
  method: string,
  path: string,
  body?: unknown,
): Promise<{ ok: boolean; status: number; data: unknown }> {
  if (!MIST_API_HOST || !MIST_API_TOKEN) {
    return {
      ok: false,
      status: 0,
      data: {
        error:
          'MIST_API_HOST and MIST_API_TOKEN environment variables are required for this tool.',
      },
    };
  }

  const payload: Record<string, unknown> = {
    apiHost: MIST_API_HOST,
    apiToken: MIST_API_TOKEN,
    method,
    path,
  };
  if (body != null) payload.body = body;

  try {
    const res = await fetch(`${BACKEND_URL}/mist-proxy`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    return { ok: res.ok, status: res.status, data };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, status: 0, data: { error: message } };
  }
}

// ---------------------------------------------------------------------------
// Tool implementations
// ---------------------------------------------------------------------------

/**
 * get_session_summary
 * Source: backend_session_state (pushed from frontend via /mcp/agent-context)
 * Phase 1: returns stub until frontend wires up the agent-context push.
 */
async function toolGetSessionSummary() {
  const state = await fetchSessionState();
  return {
    source: state._stub ? 'backend_stub' : 'backend_session_state',
    _note: state._stub
      ? 'No active session state. The frontend must POST to /mcp/agent-context when the operator enables agent access. See docs/BACKEND-MCP-POC.md.'
      : undefined,
    sessionId: state.sessionId,
    agentAccessEnabled: state.agentAccessEnabled,
    serialConnected: state.serialConnected,
    deviceIdentified: state.deviceIdentified,
    mistStatus: state.mistStatus,
    configSyncState: state.configSyncState,
    jmaStateCode: state.jma?.stateCode ?? null,
    jmaStateLabel: state.jma?.stateLabel ?? null,
    updatedAt: state.updatedAt,
  };
}

/**
 * get_device_identity
 * Source: switch_reported (via backend session state)
 * Phase 1: returns stub until frontend wires up the agent-context push.
 */
async function toolGetDeviceIdentity() {
  const state = await fetchSessionState();
  if (state._stub || !state.identity) {
    return {
      source: 'backend_stub',
      _note:
        'No device identity available. Session state has not been pushed from the frontend. See docs/BACKEND-MCP-POC.md.',
      hostname: null,
      serial: null,
      mac: null,
      model: null,
      junosVersion: null,
      mistMatch: {
        matched: false,
        matchConfidence: 'none',
        orgId: null,
        siteId: null,
        deviceId: null,
        deviceName: null,
      },
    };
  }
  return {
    source: 'switch_reported',
    hostname: state.identity.hostname,
    serial: state.identity.serial,
    mac: state.identity.mac,
    model: state.identity.model,
    junosVersion: state.identity.junosVersion,
    mistMatch: state.identity.mistMatch,
  };
}

/**
 * get_jma_connectivity_state
 * Source: switch_reported — the JMA cc-state the switch itself reports.
 * This is distinct from Mist last-known connected state.
 * Phase 1: returns stub until frontend wires up the agent-context push.
 */
async function toolGetJmaConnectivityState() {
  const state = await fetchSessionState();
  if (state._stub || !state.jma) {
    return {
      source: 'backend_stub',
      _note:
        'No JMA state available. Session state has not been pushed from the frontend. See docs/BACKEND-MCP-POC.md.',
      stateCode: null,
      stateLabel: null,
      stateDescription: null,
      rawValue: null,
      checkedAt: null,
    };
  }
  return {
    source: 'switch_reported',
    stateCode: state.jma.stateCode,
    stateLabel: state.jma.stateLabel,
    stateDescription: state.jma.stateDescription,
    rawValue: state.jma.rawValue,
    checkedAt: state.jma.checkedAt,
  };
}

/**
 * get_check_results
 * Source: live_console (results of the last troubleshoot workflow run)
 * Phase 1: returns stub until frontend wires up the agent-context push.
 */
async function toolGetCheckResults() {
  const state = await fetchSessionState();
  if (state._stub || !state.checkResults) {
    return {
      source: 'backend_stub',
      _note:
        'No check results available. Either no troubleshoot workflow has been run in this session, or session state has not been pushed from the frontend. See docs/BACKEND-MCP-POC.md.',
      workflowStatus: 'not_run',
      runAt: null,
      checks: [],
    };
  }
  return {
    source: 'live_console',
    workflowStatus: state.checkResults.workflowStatus,
    runAt: state.checkResults.runAt,
    checks: state.checkResults.checks,
  };
}

/**
 * get_device_config
 * Source: mist_intended — fetches the Mist-intended set commands for this device.
 * This tool is FULLY WIRED — it calls the backend Mist proxy directly.
 * Requires MIST_API_HOST and MIST_API_TOKEN environment variables.
 */
async function toolGetDeviceConfig(siteId: string, deviceId: string) {
  if (!siteId || !deviceId) {
    return {
      source: 'mist_intended',
      error: 'siteId and deviceId are required.',
      configLines: null,
      lineCount: null,
      fetchedAt: null,
    };
  }

  const path = `/api/v1/sites/${siteId}/devices/${deviceId}/config_cmd`;
  const result = await mistProxyCall('GET', path);

  const fetchedAt = new Date().toISOString();

  if (!result.ok) {
    return {
      source: 'mist_intended',
      siteId,
      deviceId,
      error: `Mist API returned status ${result.status}`,
      detail: result.data,
      configLines: null,
      lineCount: null,
      fetchedAt,
    };
  }

  // The config_cmd endpoint returns { cli: "set system...\nset interfaces...\n" }
  const data = result.data as Record<string, unknown>;
  const cli = typeof data.cli === 'string' ? data.cli : null;
  const configLines = cli
    ? cli
        .split('\n')
        .map((l) => l.trim())
        .filter((l) => l.length > 0 && !l.startsWith('#'))
    : null;

  return {
    source: 'mist_intended',
    siteId,
    deviceId,
    configLines,
    lineCount: configLines?.length ?? null,
    fetchedAt,
  };
}

// ---------------------------------------------------------------------------
// Tool definitions — MCP schema
// ---------------------------------------------------------------------------

const TOOLS = [
  {
    name: 'get_session_summary',
    description:
      'Return a summary of the current operator console session state, including serial connection status, device identification state, Mist cloud status, JMA connectivity state code, and config sync state. Source: backend_session_state. Returns stub data until the frontend wires up agent-context pushes.',
    inputSchema: {
      type: 'object' as const,
      properties: {},
      required: [],
    },
  },
  {
    name: 'get_device_identity',
    description:
      'Return the identity of the switch currently connected in the console session — hostname, serial, MAC, model, Junos version, and Mist inventory match result. Source: switch_reported. Returns stub until frontend wires up agent-context pushes.',
    inputSchema: {
      type: 'object' as const,
      properties: {},
      required: [],
    },
  },
  {
    name: 'get_jma_connectivity_state',
    description:
      'Return the JMA Connectivity State as self-reported by the switch. This is the switch\'s own view of why it cannot connect to Mist cloud — distinct from Mist\'s last-known device status. ' +
      'Key codes: 102=NoIPAddress, 103=NoDefaultGateway, 104=DefaultGatewayUnreachable, 105=NoDNS, 106=DNSLookupFailed, 108=CloudUnreachable, 109=CloudAuthFailure, 110=ServiceDown, 111=Connected, 112=HealthIssue, 113=NoDNSResponse, 114=EmptyDNSResponse, 115=SoftwareDownloadFailure, 116=SoftwareUpgradeFailure, 119=CloudReady, 151=DuplicateIPAddress. ' +
      'Source: switch_reported. Returns stub until frontend wires up agent-context pushes.',
    inputSchema: {
      type: 'object' as const,
      properties: {},
      required: [],
    },
  },
  {
    name: 'get_check_results',
    description:
      'Return the structured results of the last cloud connectivity troubleshoot workflow run in the current session — 14 ordered checks covering L1/L2, DHCP, routing, DNS, cloud path, SSL inspection, and Mist agent health. Each result includes status, summary, remediation guidance, and raw evidence excerpt. Source: live_console. Returns stub until frontend wires up agent-context pushes.',
    inputSchema: {
      type: 'object' as const,
      properties: {},
      required: [],
    },
  },
  {
    name: 'get_device_config',
    description:
      'Fetch the Mist-intended configuration for a specific switch as a list of Junos set commands. This is what Mist expects the device configuration to be — use it alongside get_check_results or live console output to identify config drift. Source: mist_intended. FULLY WIRED — requires MIST_API_HOST and MIST_API_TOKEN environment variables.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        siteId: {
          type: 'string',
          description: 'Mist site ID (UUID) for the device.',
        },
        deviceId: {
          type: 'string',
          description: 'Mist device ID (UUID) for the switch.',
        },
      },
      required: ['siteId', 'deviceId'],
    },
  },
] as const;

// ---------------------------------------------------------------------------
// MCP Server
// ---------------------------------------------------------------------------

const server = new Server(
  {
    name: 'junos-console-mcp',
    version: '0.1.0',
  },
  {
    capabilities: {
      tools: {},
    },
  },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: TOOLS as unknown as typeof TOOLS[number][],
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  const toolArgs = (args ?? {}) as Record<string, unknown>;

  let result: unknown;

  switch (name) {
    case 'get_session_summary':
      result = await toolGetSessionSummary();
      break;

    case 'get_device_identity':
      result = await toolGetDeviceIdentity();
      break;

    case 'get_jma_connectivity_state':
      result = await toolGetJmaConnectivityState();
      break;

    case 'get_check_results':
      result = await toolGetCheckResults();
      break;

    case 'get_device_config': {
      const siteId = typeof toolArgs.siteId === 'string' ? toolArgs.siteId : '';
      const deviceId = typeof toolArgs.deviceId === 'string' ? toolArgs.deviceId : '';
      result = await toolGetDeviceConfig(siteId, deviceId);
      break;
    }

    default:
      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify({ error: `Unknown tool: ${name}` }),
          },
        ],
        isError: true,
      };
  }

  return {
    content: [
      {
        type: 'text' as const,
        text: JSON.stringify(result, null, 2),
      },
    ],
  };
});

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  // Intentionally no console.log here — stdout is the MCP wire.
}

main().catch((err) => {
  process.stderr.write(`[junos-console-mcp] Fatal error: ${err}\n`);
  process.exit(1);
});
