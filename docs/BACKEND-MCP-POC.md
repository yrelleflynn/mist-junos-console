# Backend MCP — Proof-of-Concept

## What This Is

A minimal MCP server that lets an AI agent safely consume live session and Mist-proxy context from the `junos-console` backend, and trigger a small set of bounded troubleshooting workflows through the operator page.

This is still a proof-of-concept rather than a full agent integration. Its purpose is to establish the tool shapes, trust boundary, data paths, and bounded action relay that a fuller agent workflow can build on.

Related docs:

- [`docs/BACKEND-MCP-DESIGN.md`](/Users/mdusty/Library/CloudStorage/OneDrive-HewlettPackardEnterprise/Documents/03%20Mist%20Docs/07%20Projects/mist-junos-console/docs/BACKEND-MCP-DESIGN.md) — full design, phased roadmap
- [`docs/AI-AGENT-INTEGRATION.md`](/Users/mdusty/Library/CloudStorage/OneDrive-HewlettPackardEnterprise/Documents/03%20Mist%20Docs/07%20Projects/mist-junos-console/docs/AI-AGENT-INTEGRATION.md) — agent integration model

---

## Architecture

```
AI agent (e.g. Claude)
    │
    │  MCP over stdio
    ▼
mcp/server.ts  (standalone Node process)
    │
    │  HTTP GET /mcp/session-state
    │  HTTP POST /mist-proxy
    ▼
server/index.mjs  (main backend, port 3333)
    │
    │  HTTPS → Mist API (for get_device_config only)
    ▼
Mist cloud
```

The MCP server is a **separate process** that talks to the existing backend over HTTP. It does not have direct access to the serial port, the WebSocket session, or the frontend.

The backend exposes these POC-oriented endpoints:

- `GET /mcp/session-state` — returns the last agent-context state pushed by the frontend
- `POST /mcp/agent-context` — accepts session state pushes from the frontend
- `POST /mcp/actions` — enqueues a bounded operator-page action
- `GET /mcp/actions/next` — lets the operator page claim the next queued action
- `GET /mcp/actions/:id` — lets the MCP server poll action status
- `POST /mcp/actions/:id/status` — lets the operator page report progress / completion

---

## Implemented Tools

### `get_session_summary`

Returns the current session state: serial connection status, device identification, Mist cloud status, JMA state code, config sync state.

- **Source**: `backend_session_state` (pushed from frontend)
- **Status**: Tool shape complete. Returns stub until frontend wires up the push. See [Phase 2 wiring](#phase-2-wiring) below.
- **Arguments**: none

### `get_device_identity`

Returns switch identity: hostname, serial, MAC, model, Junos version, and Mist inventory match result.

- **Source**: `switch_reported` (via backend session state)
- **Status**: Tool shape complete. Returns stub until frontend wires up the push.
- **Arguments**: none

### `get_jma_connectivity_state`

Returns the JMA Connectivity State as self-reported by the switch — the switch's own view of why it cannot connect to Mist cloud. Distinct from Mist's last-known device status.

- **Source**: `switch_reported` (via backend session state)
- **Status**: Tool shape complete. Returns stub until frontend wires up the push.
- **Arguments**: none

### `get_check_results`

Returns structured results from the last cloud-connectivity troubleshoot workflow run in the current session. Each check includes status, summary, remediation guidance, and raw evidence excerpt.

- **Source**: `live_console` (via backend session state)
- **Status**: Live when the operator has enabled agent access for the current session.
- **Arguments**: none

### `get_console_context`

Returns the current console-oriented context for the operator session:

- prompt mode
- whether an operational prompt is visible
- a bounded recent console tail
- the current console task owner if any
- the nominated uplink port used by troubleshooting

- **Source**: `live_console` / `backend_session_state`
- **Status**: Live when the operator has enabled agent access for the current session.
- **Arguments**: none

### `get_mist_context`

Returns the currently selected Mist cloud, org, and site context from the app, along with the current matched Mist device identity when available.

- **Source**: `backend_session_state` / `switch_reported`
- **Status**: Live when the operator has enabled agent access for the current session.
- **Arguments**: none

### `get_recovery_guidance`

Returns the current JMA-driven recovery guidance:

- the switch-reported JMA state
- the current deterministic recommendation shown in the UI
- the latest guided-analysis card from a JMA-driven run
- which bounded remediation actions are currently available

- **Source**: `backend_session_state` / `live_console`
- **Status**: Live when the operator has enabled agent access for the current session.
- **Arguments**: none

### `list_checks`

Returns the live troubleshooting catalog as currently available in the operator UI, including:

- check id / name / description
- group membership
- current availability
- requirement flags such as `requiresCloud` and `requiresMistApi`

- **Source**: `backend_session_state`
- **Status**: Live when the operator has enabled agent access for the current session.
- **Arguments**: none

### `list_check_groups`

Returns the live troubleshooting groups currently exposed in the UI, including group-level availability and the current state of `Run All Catalog Checks` and `Run Full Baseline`.

- **Source**: `backend_session_state`
- **Status**: Live when the operator has enabled agent access for the current session.
- **Arguments**: none

### Bounded Run Tools

The MCP server now exposes bounded execution tools that enqueue an action in the backend relay, wait for the operator page to claim it, and return the completion result:

- `list_agent_reads`
- `run_check`
- `run_check_group`
- `run_all_catalog_checks`
- `run_recommended_checks`
- `run_full_baseline`
- `list_recovery_actions`
- `run_dhcp_refresh`
- `run_restart_mist_agent`
- `run_config_sync_preview`
- `get_effective_config`
- `list_log_files`
- `search_log_file`

These do **not** execute serial commands directly from the MCP server. Instead, they instruct the already-open operator page to run the corresponding in-app workflow.

- **Source**: operator page via backend action relay
- **Status**: Live when the operator has enabled agent access for the current session.
- **Arguments**:
  - `run_check`: `checkId`
  - `run_check_group`: `groupId`
  - others: none

### `get_device_config` ★ FULLY WIRED

Fetches the Mist-intended configuration for a specific switch as a list of Junos `set` commands. Calls the Mist API through the existing backend proxy.

- **Source**: `mist_intended` (live Mist API call via `/mist-proxy`)
- **Status**: Fully implemented. Requires `MIST_API_HOST` and `MIST_API_TOKEN` env vars.
- **Arguments**: `siteId` (string), `deviceId` (string)

---

## Stub vs Live Data

| Tool | Data source | Live now? |
|------|------------|-----------|
| `get_session_summary` | Backend session state | Yes — when operator enables agent access |
| `get_device_identity` | Backend session state | Yes — when operator enables agent access |
| `get_jma_connectivity_state` | Backend session state | Yes — when operator enables agent access |
| `get_check_results` | Backend session state | Yes — when operator enables agent access |
| `get_console_context` | Backend session state | Yes — when operator enables agent access |
| `get_mist_context` | Backend session state | Yes — when operator enables agent access |
| `get_recovery_guidance` | Backend session state | Yes — when operator enables agent access |
| `list_checks` | Backend session state | Yes — when operator enables agent access |
| `list_check_groups` | Backend session state | Yes — when operator enables agent access |
| `run_check*` / `run_*` | Operator page via action relay | Yes — when operator enables agent access |
| `get_device_config` | Mist API via proxy | **Yes** — fully wired |

When stub data is returned, the tool response includes a `source: "backend_stub"` field and a `_note` explaining why the data is absent and what is needed to wire it up. The agent can use this signal to communicate the missing context rather than silently working from null values.

---

## How to Run

The MCP server is standalone. It does **not** participate in the main project build.

**Prerequisites:**

- Main backend running: `npm run dev:server` or `npm start` (in the project root)
- For `get_device_config`: `MIST_API_HOST` and `MIST_API_TOKEN` env vars set

**First-time setup:**

```bash
cd mcp
npm install
```

**Development (auto-reloads):**

```bash
cd mcp
npm run dev
```

This uses `tsx` to run `server.ts` directly over stdio.

**Production build:**

```bash
cd mcp
npm run build   # compiles to dist/server.js
npm start       # runs dist/server.js
```

**MCP client config (for Claude Desktop or similar):**

```json
{
  "mcpServers": {
    "junos-console": {
      "command": "node",
      "args": ["/path/to/mist-junos-console/mcp/dist/server.js"],
      "env": {
        "BACKEND_URL": "http://127.0.0.1:3333",
        "MIST_API_HOST": "api.mist.com",
        "MIST_API_TOKEN": "your-token-here"
      }
    }
  }
}
```

Or with `tsx` for development:

```json
{
  "mcpServers": {
    "junos-console": {
      "command": "npx",
      "args": ["tsx", "/path/to/mist-junos-console/mcp/server.ts"],
      "env": {
        "BACKEND_URL": "http://127.0.0.1:3333",
        "MIST_API_HOST": "api.mist.com",
        "MIST_API_TOKEN": "your-token-here"
      }
    }
  }
}
```

---

## Trust Boundary

The trust model is explicit in the code and enforced in structure:

**Operator owns the session.**
The agent gets a read-only window into state the operator has chosen to expose. The backend session state is only populated when the frontend POSTs to `/mcp/agent-context` — a step that requires explicit operator action (Phase 2 wiring).

**The MCP server still has no direct serial control.**
Even the new run tools do not inject commands straight into the console. They enqueue a bounded action, and the already-open operator page decides how to execute that workflow.

**High-risk config mutation remains deferred.**
The action relay currently targets bounded troubleshooting workflows only. Direct config commit / rollback / adoption mutation through MCP remains intentionally deferred.

**Agent access requires explicit enablement.**
The `/mcp/session-state` endpoint returns a `_stub: true` response until a session state has been pushed by the frontend. An agent receiving stub responses knows the operator has not enabled agent access for this session.

**Source labeling.**
Every tool response includes a `source` field: `backend_session_state`, `switch_reported`, `live_console`, `mist_intended`, or `backend_stub`. This preserves the data-origin distinction described in `docs/AI-AGENT-INTEGRATION.md` — the agent knows whether it is reading Mist-intended state, switch-reported state, or live console results.

---

## Current Agent-Context Wiring

The frontend now pushes live agent context to the backend when agent access is enabled. The pushed state includes:

- session and serial state
- switch identity and Mist match
- current JMA state
- current Mist selection context
- bounded check results from the latest run
- prompt mode and recent console tail
- current guided recovery recommendation and action availability

The payload shape accepted by `POST /mcp/agent-context` is:

```json
{
  "sessionId": "uuid-from-ws-session",
  "agentAccessEnabled": true,
  "serialConnected": true,
  "deviceIdentified": true,
  "mistStatus": "connected",
  "configSyncState": "idle",
  "identity": {
    "hostname": "EX2300-C-12T-01",
    "serial": "DE0720430001",
    "mac": "a8:d0:e5:ab:cd:ef",
    "model": "EX2300-C-12T",
    "junosVersion": "21.4R3.15",
    "mistMatch": {
      "matched": true,
      "matchConfidence": "serial",
      "orgId": "...",
      "siteId": "...",
      "deviceId": "...",
      "deviceName": "sw-main-01"
    }
  },
  "jma": {
    "stateCode": 111,
    "stateLabel": "Connected",
    "stateDescription": "Switch is healthy and connected to Mist cloud",
    "rawValue": "111",
    "checkedAt": "2026-04-17T22:00:00Z"
  },
  "checkResults": {
    "workflowStatus": "completed",
    "runAt": "2026-04-17T22:00:00Z",
    "checks": [
      {
        "id": "default-route",
        "name": "Default Gateway",
        "status": "fail",
        "summary": "No default route found in inet.0",
        "remediation": "Check DHCP lease or static gateway configuration",
        "rawExcerpt": "inet.0: no default route"
      }
    ]
  }
}
```

Session-state is also cleared when the operator WebSocket session ends, so stale MCP summaries do not survive reloads or disconnects.

---

## Intentionally Deferred

The following are explicitly not implemented in this phase:

| Capability | Reason deferred |
|-----------|----------------|
| `run_single_check` | Requires trusted command execution over the serial session |
| `run_troubleshoot_workflow` | Same — triggers live CLI workflows |
| `get_transcript_slice` | Needs session transcript infrastructure (see `docs/SESSION-LOGGING-DESIGN.md`) |
| `preview_config_sync` | Approval-gate workflow — Phase 3 |
| `commit_staged_config_sync` | State-changing — Phase 3, requires operator approval model |
| `rollback_staged_config_sync` | State-changing — Phase 3 |
| `apply_adoption_commands` | State-changing — Phase 3 |
| `run_show_command` | Allowlisted command execution — Phase 2 consideration |
| Operator approval model | Not needed for read-only Phase 1 |
| Session audit logging | Structured logging not yet implemented (see `docs/SESSION-LOGGING-DESIGN.md`) |

---

## What This Supports for the Hackathon

An agent connected to this MCP can:

- Ask for the current session state and device identity
- Ask for the switch's JMA connectivity state and understand why it believes it cannot reach Mist
- Ask for the structured check results from the last troubleshoot run
- Ask for the Mist-intended config for any device by site and device ID
- Combine those signals to reason about the likely root cause and suggest corrective actions

What it explicitly cannot do:

- Execute commands
- Commit or rollback config
- Access the raw serial stream
- Take any state-changing action

The agent is a read-only diagnostic observer. That is the correct and safe starting point.

---

## Files in `mcp/`

```
mcp/
  server.ts       — MCP server entry point, all 5 tools, trust boundary enforcement
  package.json    — standalone package (not part of main build)
  tsconfig.json   — TypeScript config, compiles to dist/
  dist/           — compiled output (after npm run build)
  node_modules/   — dependencies (after npm install)
```

The `mcp/` directory is intentionally standalone. It is not referenced by the root `package.json` or `vite.config.ts`. Running `npm run build` in the project root does not compile or validate the MCP server.
