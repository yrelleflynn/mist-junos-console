/**
 * junos-console Backend MCP Server — Observer + bounded action relay
 *
 * Exposes live session and Mist-proxy context as structured MCP tools so an AI
 * agent can safely consume recovery context and trigger a small set of bounded
 * troubleshooting workflows through the operator page.
 *
 * Current tool surface:
 *   get_session_summary         — current session state from the backend
 *   get_device_identity         — switch identity and Mist match result
 *   get_jma_connectivity_state  — switch-reported JMA cloud state
 *   get_check_results           — last troubleshoot workflow results
 *   list_checks / list_check_groups
 *                              — live troubleshooting catalog metadata
 *   run_check / run_check_group / run_all_catalog_checks
 *   run_recommended_checks / run_full_baseline
 *                              — bounded operator-page workflows via action relay
 *   get_device_config           — Mist-intended config via backend proxy (LIVE)
 *
 * Trust boundary:
 *   - operator owns the session; agent gets a bounded, app-mediated window into it
 *   - direct serial command execution is still not exposed
 *   - bounded troubleshoot workflows are relayed through the operator page
 *   - high-risk config mutations (commit, rollback, adoption) remain deferred
 *   - agent access requires the operator to enable remote session / agent context
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

interface PromptState {
  mode: 'operational' | 'config' | 'shell' | 'login' | 'password' | 'unknown';
  operationalVisible: boolean;
  recentConsoleTail: string | null;
}

interface ConsoleTaskState {
  kind: 'background' | 'user' | 'exclusive';
  label: string;
}

interface MistContextState {
  configured: boolean;
  cloudId: string | null;
  cloudName: string | null;
  apiHost: string | null;
  orgId: string | null;
  orgName: string | null;
  siteId: string | null;
  siteName: string | null;
  orgCount: number;
  siteCount: number;
}

interface TroubleshootingState {
  uplinkPort: string | null;
}

interface GuidanceCheck {
  id: string;
  label: string;
  why: string;
}

interface JmaRecommendationState {
  code: number;
  label: string;
  title: string;
  summary: string;
  implication: string;
  severity: 'fail' | 'warn' | 'info' | 'pass';
  workflowRecommendation: 'full' | 'targeted_then_full' | 'targeted' | 'optional' | 'skip';
  workflowNote: string;
  checks: GuidanceCheck[];
  remediation: string[];
}

interface GuidedAnalysisCard {
  eyebrow: string;
  title: string;
  summary: string;
  conclusion?: string;
  findings?: string[];
}

interface GuidanceState {
  jmaRecommendation: JmaRecommendationState | null;
  guidedAnalysis: GuidedAnalysisCard | null;
}

interface ActionState {
  available: boolean;
  reason: string | null;
}

interface ActionsState {
  runRecommendedChecks?: ActionState;
  runFullBaseline?: ActionState;
  dhcpRefresh?: ActionState;
  restartMistAgent?: ActionState;
  configSync?: ActionState;
  adoptSwitch?: ActionState;
  offlineTimeline?: ActionState;
}

interface CatalogCheckState {
  id: string;
  name: string;
  desc: string;
  requiresCloud: boolean;
  requiresMistApi: boolean;
  available: boolean;
  reason: string | null;
}

interface CatalogGroupState {
  id: string;
  name: string;
  available: boolean;
  reason: string | null;
  checks: CatalogCheckState[];
}

interface CheckCatalogState {
  groups: CatalogGroupState[];
  runAllCatalogChecks?: ActionState;
  runFullBaseline?: ActionState;
}

interface BackendSessionState {
  sessionId: string | null;
  agentAccessEnabled: boolean;
  serialConnected: boolean;
  deviceIdentified: boolean;
  mistStatus: string | null;
  configSyncState: string | null;
  prompt?: PromptState | null;
  consoleTask?: ConsoleTaskState | null;
  mistContext?: MistContextState | null;
  troubleshooting?: TroubleshootingState | null;
  guidance?: GuidanceState | null;
  actions?: ActionsState | null;
  checkCatalog?: CheckCatalogState | null;
  identity: DeviceIdentity | null;
  jma: JmaState | null;
  checkResults: CheckResultsBundle | null;
  updatedAt: string | null;
  _stub: boolean;
}

interface McpActionRecord {
  id: string;
  sessionId: string;
  type: string;
  params: Record<string, unknown>;
  status: 'pending' | 'claimed' | 'running' | 'completed' | 'failed';
  createdAt: string;
  updatedAt: string;
  claimedAt?: string;
  startedAt?: string;
  completedAt?: string;
  result?: unknown;
  error?: string | null;
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

async function createMcpAction(
  sessionId: string,
  type: string,
  params: Record<string, unknown> = {},
): Promise<McpActionRecord> {
  const res = await fetch(`${BACKEND_URL}/mcp/actions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sessionId, type, params }),
  });
  if (!res.ok) {
    throw new Error(`Failed to create MCP action (${res.status})`);
  }
  return (await res.json()) as McpActionRecord;
}

async function fetchMcpAction(actionId: string): Promise<McpActionRecord> {
  const res = await fetch(`${BACKEND_URL}/mcp/actions/${actionId}`);
  if (!res.ok) {
    throw new Error(`Failed to fetch MCP action (${res.status})`);
  }
  return (await res.json()) as McpActionRecord;
}

async function waitForMcpActionCompletion(
  actionId: string,
  timeoutMs: number,
): Promise<McpActionRecord> {
  const startedAt = Date.now();
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const action = await fetchMcpAction(actionId);
    if (action.status === 'completed' || action.status === 'failed') {
      return action;
    }
    if (Date.now() - startedAt > timeoutMs) {
      throw new Error(`Timed out waiting for MCP action ${actionId}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
}

function ensureActiveOperatorSession(state: BackendSessionState): { ok: true; sessionId: string } | { ok: false; error: string } {
  if (state._stub || !state.sessionId || !state.agentAccessEnabled) {
    return {
      ok: false,
      error: 'No active operator session is publishing agent context. Enable remote session in the app first.',
    };
  }
  return { ok: true, sessionId: state.sessionId };
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
 * get_console_context
 * Source: live_console / backend_session_state
 * Returns prompt mode, recent console tail, active console owner, and current
 * troubleshooting selections such as the nominated uplink port.
 */
async function toolGetConsoleContext() {
  const state = await fetchSessionState();
  if (state._stub) {
    return {
      source: 'backend_stub',
      _note:
        'No live console context is available yet. The operator session must push agent-context from the frontend.',
      serialConnected: false,
      prompt: {
        mode: 'unknown',
        operationalVisible: false,
        recentConsoleTail: null,
      },
      consoleTask: null,
      troubleshooting: {
        uplinkPort: null,
      },
    };
  }

  return {
    source: 'live_console',
    serialConnected: state.serialConnected,
    prompt: state.prompt ?? {
      mode: 'unknown',
      operationalVisible: false,
      recentConsoleTail: null,
    },
    consoleTask: state.consoleTask ?? null,
    troubleshooting: state.troubleshooting ?? {
      uplinkPort: null,
    },
  };
}

/**
 * get_mist_context
 * Source: backend_session_state / switch_reported
 * Returns the currently selected Mist cloud/org/site context from the app,
 * along with the current matched Mist device identity when present.
 */
async function toolGetMistContext() {
  const state = await fetchSessionState();
  if (state._stub) {
    return {
      source: 'backend_stub',
      _note:
        'No Mist context is available yet. The operator session must push agent-context from the frontend.',
      mistContext: null,
      mistMatch: null,
    };
  }

  return {
    source: state.identity?.mistMatch?.matched ? 'switch_reported' : 'backend_session_state',
    mistContext: state.mistContext ?? null,
    mistMatch: state.identity?.mistMatch ?? null,
  };
}

/**
 * get_recovery_guidance
 * Source: backend_session_state + live_console
 * Returns the current JMA recommendation, any guided-analysis card from the
 * most recent JMA-driven run, and the UI's current action availability.
 */
async function toolGetRecoveryGuidance() {
  const state = await fetchSessionState();
  if (state._stub) {
    return {
      source: 'backend_stub',
      _note:
        'No recovery guidance is available yet. The operator session must push agent-context from the frontend.',
      jma: null,
      guidance: null,
      actions: null,
    };
  }

  return {
    source: state.guidance?.guidedAnalysis ? 'live_console' : 'backend_session_state',
    jma: state.jma
      ? {
          stateCode: state.jma.stateCode,
          stateLabel: state.jma.stateLabel,
          stateDescription: state.jma.stateDescription,
        }
      : null,
    guidance: state.guidance ?? null,
    actions: state.actions ?? null,
  };
}

async function toolListRecoveryActions() {
  const state = await fetchSessionState();
  if (state._stub) {
    return {
      source: 'backend_stub',
      _note:
        'No recovery actions are available yet. The operator session must push agent-context from the frontend.',
      actions: [],
    };
  }

  const currentActions = state.actions ?? {};
  const recommendation = state.guidance?.jmaRecommendation ?? null;
  const recommendedIds = new Set(
    Array.isArray(recommendation?.remediation)
      ? recommendation.remediation
          .map((label) => String(label).toLowerCase())
          .flatMap((label) => {
            const mapped: string[] = [];
            if (label.includes('dhcp')) mapped.push('dhcpRefresh');
            if (label.includes('mist agent') || label.includes('restart')) mapped.push('restartMistAgent');
            if (label.includes('config sync')) mapped.push('configSync');
            if (label.includes('adopt')) mapped.push('adoptSwitch');
            return mapped;
          })
      : [],
  );

  const actionMeta = [
    {
      id: 'run_dhcp_refresh',
      stateKey: 'dhcpRefresh',
      label: 'DHCP Refresh',
      description: 'Disable and restore DHCP client interfaces, then compare bindings before and after renewal.',
      category: 'recovery',
    },
    {
      id: 'run_restart_mist_agent',
      stateKey: 'restartMistAgent',
      label: 'Restart Mist Agent',
      description: 'Restart mcd and verify Mist agent process state after it settles.',
      category: 'recovery',
    },
    {
      id: 'run_config_sync_preview',
      stateKey: 'configSync',
      label: 'Config Sync Preview',
      description: 'Stage the Mist-intended candidate config on the switch for review. This does not commit changes.',
      category: 'preview',
    },
    {
      id: 'run_recommended_checks',
      stateKey: 'runRecommendedChecks',
      label: 'Run Recommended Checks',
      description: 'Run the current JMA-targeted troubleshooting flow for the reported cloud state.',
      category: 'guidance',
    },
    {
      id: 'run_full_baseline',
      stateKey: 'runFullBaseline',
      label: 'Run Full Baseline',
      description: 'Run the broader ordered troubleshooting workflow when targeted checks are inconclusive.',
      category: 'guidance',
    },
    {
      id: 'adopt_switch',
      stateKey: 'adoptSwitch',
      label: 'Adopt Switch',
      description: 'Adopt or re-adopt the switch into Mist using the current device context.',
      category: 'recovery',
    },
    {
      id: 'offline_timeline',
      stateKey: 'offlineTimeline',
      label: 'Offline Timeline',
      description: 'Correlate Mist events and switch logs around the disconnect window.',
      category: 'analysis',
    },
  ] as const;

  return {
    source: 'backend_session_state',
    recommendation: recommendation
      ? {
          code: recommendation.code,
          label: recommendation.label,
          title: recommendation.title,
        }
      : null,
    actions: actionMeta.map((action) => {
      const availability = currentActions[action.stateKey] ?? { available: false, reason: null };
      return {
        id: action.id,
        label: action.label,
        description: action.description,
        category: action.category,
        available: Boolean(availability.available),
        reason: availability.reason ?? null,
        recommended: recommendedIds.has(action.stateKey),
      };
    }),
  };
}

async function toolDescribeAgentReads() {
  return {
    source: 'backend_session_state',
    tools: [
      {
        id: 'get_check_results',
        label: 'Check Results',
        description:
          'Fetch the structured results of the most recent troubleshoot workflow run, including workflow status, per-check summaries, remediation, and bounded raw excerpts.',
      },
      {
        id: 'list_log_files',
        label: 'List Log Files',
        description:
          'List current and rotated log filenames for the mcd, jmd, or messages log family so the agent can target a specific rollover file.',
      },
      {
        id: 'get_effective_config',
        label: 'Effective Config',
        description:
          'Fetch the current switch configuration as set commands including inherited configuration, without staging a config sync candidate.',
      },
      {
        id: 'search_log_file',
        label: 'Search Log File',
        description:
          'Read a bounded window from a current or rotated mcd, jmd, or messages log file, optionally anchored at the first matching line.',
      },
    ],
  };
}

async function toolListChecks() {
  const state = await fetchSessionState();
  if (state._stub || !state.checkCatalog) {
    return {
      source: 'backend_stub',
      _note:
        'No live check catalog is available yet. The operator session must push agent-context from the frontend.',
      checks: [],
    };
  }

  return {
    source: 'backend_session_state',
    checks: state.checkCatalog.groups.flatMap((group) =>
      group.checks.map((check) => ({
        ...check,
        groupId: group.id,
        groupName: group.name,
      })),
    ),
  };
}

async function toolListCheckGroups() {
  const state = await fetchSessionState();
  if (state._stub || !state.checkCatalog) {
    return {
      source: 'backend_stub',
      _note:
        'No live check group catalog is available yet. The operator session must push agent-context from the frontend.',
      groups: [],
      runAllCatalogChecks: { available: false, reason: 'No active operator session.' },
      runFullBaseline: { available: false, reason: 'No active operator session.' },
    };
  }

  return {
    source: 'backend_session_state',
    groups: state.checkCatalog.groups.map((group) => ({
      id: group.id,
      name: group.name,
      available: group.available,
      reason: group.reason,
      checkIds: group.checks.map((check) => check.id),
    })),
    runAllCatalogChecks: state.checkCatalog.runAllCatalogChecks ?? { available: false, reason: null },
    runFullBaseline: state.checkCatalog.runFullBaseline ?? { available: false, reason: null },
  };
}

async function runBoundedOperatorAction(
  type: string,
  params: Record<string, unknown>,
  timeoutMs: number,
) {
  const state = await fetchSessionState();
  const active = ensureActiveOperatorSession(state);
  if (!active.ok) {
    return { error: active.error };
  }

  const action = await createMcpAction(active.sessionId, type, params);
  const completed = await waitForMcpActionCompletion(action.id, timeoutMs);
  return {
    source: 'operator_action',
    action: {
      id: completed.id,
      type: completed.type,
      status: completed.status,
      createdAt: completed.createdAt,
      startedAt: completed.startedAt ?? null,
      completedAt: completed.completedAt ?? null,
    },
    result: completed.result ?? null,
    error: completed.error ?? null,
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
    name: 'get_console_context',
    description:
      'Return live console context for the current operator session: prompt mode, whether an operational prompt is visible, a bounded recent console tail, the current console task owner if any, and the nominated uplink port used by troubleshooting flows. Source: live_console / backend_session_state. Returns stub until the frontend wires up agent-context pushes.',
    inputSchema: {
      type: 'object' as const,
      properties: {},
      required: [],
    },
  },
  {
    name: 'get_mist_context',
    description:
      'Return the currently selected Mist cloud, organization, and site context from the app, along with the current matched Mist device identity when available. Use this to correlate the operator-selected Mist scope with the live switch session. Source: backend_session_state and switch_reported. Returns stub until the frontend wires up agent-context pushes.',
    inputSchema: {
      type: 'object' as const,
      properties: {},
      required: [],
    },
  },
  {
    name: 'get_recovery_guidance',
    description:
      'Return the current JMA-driven recovery guidance for the session: the switch-reported JMA state, the current rule-driven recommendation shown in the UI, any guided-analysis card from the most recent JMA-triggered check run, and which bounded recovery actions are currently available. Source: backend_session_state and live_console. Returns stub until the frontend wires up agent-context pushes.',
    inputSchema: {
      type: 'object' as const,
      properties: {},
      required: [],
    },
  },
  {
    name: 'list_recovery_actions',
    description:
      'Return the currently available bounded recovery and guidance actions from the operator UI, including DHCP Refresh, Restart Mist Agent, Config Sync Preview, and whether each is currently available.',
    inputSchema: {
      type: 'object' as const,
      properties: {},
      required: [],
    },
  },
  {
    name: 'list_agent_reads',
    description:
      'Describe the bounded read-only agent data fetch tools available for live troubleshooting, including effective config fetch and targeted log searches.',
    inputSchema: {
      type: 'object' as const,
      properties: {},
      required: [],
    },
  },
  {
    name: 'list_checks',
    description:
      'Return the live troubleshooting check catalog currently available in the operator UI, including per-check group membership, requirements, and whether each check is runnable in the current session context.',
    inputSchema: {
      type: 'object' as const,
      properties: {},
      required: [],
    },
  },
  {
    name: 'list_check_groups',
    description:
      'Return the live troubleshooting check groups currently available in the operator UI, including the checks in each group and whether each group, Run All Catalog Checks, and Run Full Baseline are currently runnable.',
    inputSchema: {
      type: 'object' as const,
      properties: {},
      required: [],
    },
  },
  {
    name: 'run_check',
    description:
      'Run one bounded troubleshooting check in the operator UI by catalog check id and wait for completion. Requires an active operator session with agent access enabled.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        checkId: {
          type: 'string',
          description: 'Catalog check id, for example dns-resolution or cloud-connections.',
        },
      },
      required: ['checkId'],
    },
  },
  {
    name: 'run_check_group',
    description:
      'Run one bounded troubleshooting check group in the operator UI by group id and wait for completion. Requires an active operator session with agent access enabled.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        groupId: {
          type: 'string',
          description: 'Catalog group id, for example dns or mist-agent.',
        },
      },
      required: ['groupId'],
    },
  },
  {
    name: 'run_all_catalog_checks',
    description:
      'Run all catalog checks in the operator UI and wait for completion. This is the catalog-wide runner, not the ordered full baseline workflow.',
    inputSchema: {
      type: 'object' as const,
      properties: {},
      required: [],
    },
  },
  {
    name: 'run_recommended_checks',
    description:
      'Run the current JMA-recommended targeted checks in the operator UI and wait for completion. Requires an active operator session with agent access enabled.',
    inputSchema: {
      type: 'object' as const,
      properties: {},
      required: [],
    },
  },
  {
    name: 'run_full_baseline',
    description:
      'Run the ordered full baseline troubleshooting workflow in the operator UI and wait for completion. Requires an active operator session with agent access enabled.',
    inputSchema: {
      type: 'object' as const,
      properties: {},
      required: [],
    },
  },
  {
    name: 'run_dhcp_refresh',
    description:
      'Run the DHCP Refresh recovery action in the operator UI and wait for completion. Requires an active operator session with agent access enabled.',
    inputSchema: {
      type: 'object' as const,
      properties: {},
      required: [],
    },
  },
  {
    name: 'run_restart_mist_agent',
    description:
      'Run the Restart Mist Agent recovery action in the operator UI and wait for completion. Requires an active operator session with agent access enabled.',
    inputSchema: {
      type: 'object' as const,
      properties: {},
      required: [],
    },
  },
  {
    name: 'run_config_sync_preview',
    description:
      'Run the Config Sync Preview recovery action in the operator UI and wait for completion. This stages the candidate config for review but does not commit it. Requires an active operator session with agent access enabled.',
    inputSchema: {
      type: 'object' as const,
      properties: {},
      required: [],
    },
  },
  {
    name: 'get_effective_config',
    description:
      'Fetch the current switch configuration as `show configuration | display set | display inheritance` through the operator UI and return the raw output.',
    inputSchema: {
      type: 'object' as const,
      properties: {},
      required: [],
    },
  },
  {
    name: 'search_log_file',
    description:
      'Read a bounded log window through the operator UI. With `findText`, it returns the first N lines starting at the first matching line. Without `findText`, it returns the last N lines of the file. N defaults to 20 and is capped at 100.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        logFile: {
          type: 'string',
          description: 'Log file to search: mcd.log, jmd.log, or messages.',
        },
        findText: {
          type: 'string',
          description: 'Optional single-line text to anchor the returned log window, for example 2026/04/18 21.',
        },
        maxLines: {
          type: 'number',
          description: 'Optional number of lines to return. Defaults to 20 and is capped at 100.',
        },
      },
      required: ['logFile'],
    },
  },
  {
    name: 'list_log_files',
    description:
      'List current and rotated filenames for a log family such as mcd, jmd, or messages through the operator UI.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        family: {
          type: 'string',
          description: 'Log family to enumerate: mcd, jmd, or messages.',
        },
      },
      required: ['family'],
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

    case 'get_console_context':
      result = await toolGetConsoleContext();
      break;

    case 'get_mist_context':
      result = await toolGetMistContext();
      break;

    case 'get_recovery_guidance':
      result = await toolGetRecoveryGuidance();
      break;

    case 'list_recovery_actions':
      result = await toolListRecoveryActions();
      break;

    case 'list_agent_reads':
      result = await toolDescribeAgentReads();
      break;

    case 'list_checks':
      result = await toolListChecks();
      break;

    case 'list_check_groups':
      result = await toolListCheckGroups();
      break;

    case 'run_check': {
      const checkId = typeof toolArgs.checkId === 'string' ? toolArgs.checkId : '';
      result = await runBoundedOperatorAction('run_check', { checkId }, 120000);
      break;
    }

    case 'run_check_group': {
      const groupId = typeof toolArgs.groupId === 'string' ? toolArgs.groupId : '';
      result = await runBoundedOperatorAction('run_check_group', { groupId }, 120000);
      break;
    }

    case 'run_all_catalog_checks':
      result = await runBoundedOperatorAction('run_all_catalog_checks', {}, 180000);
      break;

    case 'run_recommended_checks':
      result = await runBoundedOperatorAction('run_recommended_checks', {}, 120000);
      break;

    case 'run_full_baseline':
      result = await runBoundedOperatorAction('run_full_baseline', {}, 240000);
      break;

    case 'run_dhcp_refresh':
      result = await runBoundedOperatorAction('run_dhcp_refresh', {}, 180000);
      break;

    case 'run_restart_mist_agent':
      result = await runBoundedOperatorAction('run_restart_mist_agent', {}, 180000);
      break;

    case 'run_config_sync_preview':
      result = await runBoundedOperatorAction('run_config_sync_preview', {}, 180000);
      break;

    case 'get_effective_config':
      result = await runBoundedOperatorAction('get_effective_config', {}, 120000);
      break;

    case 'search_log_file': {
      const logFile = typeof toolArgs.logFile === 'string' ? toolArgs.logFile : '';
      const findText = typeof toolArgs.findText === 'string' ? toolArgs.findText : '';
      const maxLines = typeof toolArgs.maxLines === 'number' ? toolArgs.maxLines : undefined;
      result = await runBoundedOperatorAction('search_log_file', { logFile, findText, maxLines }, 120000);
      break;
    }

    case 'list_log_files': {
      const family = typeof toolArgs.family === 'string' ? toolArgs.family : '';
      result = await runBoundedOperatorAction('list_log_files', { family }, 60000);
      break;
    }

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
    isError: Boolean(
      result
      && typeof result === 'object'
      && 'error' in result
      && typeof (result as { error?: unknown }).error === 'string'
      && (result as { error?: string | null }).error,
    ),
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
