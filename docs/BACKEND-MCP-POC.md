# Backend MCP — Proof-of-Concept

## What This Is

A minimal, read-only MCP server that lets an AI agent safely consume live session and Mist-proxy context from the `junos-console` backend — without any direct serial access, config mutation, or command execution.

This is a first-slice proof-of-concept, not a full agent integration. Its purpose is to establish the tool shapes, trust boundary, and data paths that a Phase 2 implementation would build on.

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

The backend exposes two new endpoints for this POC:

- `GET /mcp/session-state` — returns the last agent-context state pushed by the frontend
- `POST /mcp/agent-context` — accepts session state pushes from the frontend

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
- **Status**: Tool shape complete. Returns stub until frontend wires up the push.
- **Arguments**: none

### `get_device_config` ★ FULLY WIRED

Fetches the Mist-intended configuration for a specific switch as a list of Junos `set` commands. Calls the Mist API through the existing backend proxy.

- **Source**: `mist_intended` (live Mist API call via `/mist-proxy`)
- **Status**: Fully implemented. Requires `MIST_API_HOST` and `MIST_API_TOKEN` env vars.
- **Arguments**: `siteId` (string), `deviceId` (string)

---

## Stub vs Live Data

| Tool | Data source | Live now? |
|------|------------|-----------|
| `get_session_summary` | Backend session state | No — stub until Phase 2 frontend wiring |
| `get_device_identity` | Backend session state | No — stub until Phase 2 frontend wiring |
| `get_jma_connectivity_state` | Backend session state | No — stub until Phase 2 frontend wiring |
| `get_check_results` | Backend session state | No — stub until Phase 2 frontend wiring |
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

The Phase 1 trust model is explicit in the code and enforced in structure:

**Operator owns the session.**
The agent gets a read-only window into state the operator has chosen to expose. The backend session state is only populated when the frontend POSTs to `/mcp/agent-context` — a step that requires explicit operator action (Phase 2 wiring).

**This phase is read-only.**
All five tools are read-only. There is no tool for command execution, config commit, rollback, or any state-changing action. These are intentionally deferred.

**Agent access requires explicit enablement.**
The `/mcp/session-state` endpoint returns a `_stub: true` response until a session state has been pushed by the frontend. An agent receiving stub responses knows the operator has not enabled agent access for this session.

**Source labeling.**
Every tool response includes a `source` field: `backend_session_state`, `switch_reported`, `live_console`, `mist_intended`, or `backend_stub`. This preserves the data-origin distinction described in `docs/AI-AGENT-INTEGRATION.md` — the agent knows whether it is reading Mist-intended state, switch-reported state, or live console results.

---

## Phase 2 Wiring

The session-state tools return stubs because the frontend has not yet been wired to push state to the backend. Phase 2 would add:

1. A `pushAgentContext(state)` call in `src/main.ts` (or a controller) that fires when:
   - the operator enables agent access in the UI
   - the device identity is established
   - a troubleshoot workflow completes
   - the JMA state updates

2. The payload shape expected by `POST /mcp/agent-context`:

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

3. Session-state cleanup when the operator disconnects or disables agent access (call `DELETE /mcp/agent-context/:sessionId` or re-POST with `agentAccessEnabled: false`).

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
