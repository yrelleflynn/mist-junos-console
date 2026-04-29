# Marvis Console — Claude Code Project Context

## Project Overview

Marvis Console is a portable network switch diagnostic tool for Juniper Mist-managed switches.
It provides a serial console interface combined with automated troubleshooting checks, Mist API
correlation, and Claude Desktop integration via MCP.

**Problem it solves:** When a Mist-managed switch goes offline, diagnosing the root cause
requires simultaneously accessing the switch console, querying the Mist cloud API, and
cross-referencing log files. This tool unifies all three into a single session that can be
driven interactively by an operator or autonomously by Claude.

---

## Architecture

### Three-Machine Deployment

```
┌─────────────────────┐     HTTP/WS      ┌──────────────────────┐
│  Console Machine    │ ◄──────────────► │   Server Machine      │
│  Chrome + USB cable │  port 3000        │   Node.js server      │
│  Web Serial API     │                  │   Mist API proxy      │
└─────────────────────┘                  │   WebSocket hub       │
                                         └──────────┬───────────┘
┌─────────────────────┐     HTTP                    │
│  Claude Desktop     │ ◄───────────────────────────┘
│  MCP client         │  CONSOLE_SERVER_URL
└─────────────────────┘
```

- **Console Machine**: Chrome browser with USB-to-serial adapter. Runs the Web Serial API
  to talk to the switch over the console cable. Only needs a browser — no local server required.
- **Server Machine**: Runs `packages/server`. Serves the SPA, proxies Mist API calls,
  and hosts the WebSocket session hub. Everything is on port 3000.
- **Claude Desktop Machine**: Runs `packages/mcp`. Connects to the server via the
  `CONSOLE_SERVER_URL` environment variable. Claude can read switch output and send commands.

### Monorepo Package Structure

```
packages/
├── shared/      Pure types, catalog metadata, cloud config. Zero runtime dependencies.
├── server/      Hono HTTP server. Mist proxy, WebSocket hub, session store, static files.
├── client/      Vite SPA. Web Serial API, session providers, troubleshoot UI.
├── mcp/         MCP stdio server for Claude Desktop integration.
└── extension/   Chrome extension. Passive Mist session bridge only.
```

---

## packages/shared

The single source of truth for all type definitions and catalog metadata. No implementation
logic lives here — only types, interfaces, and static data arrays. All other packages
depend on this one; it depends on nothing.

### Key Files

| File | Purpose |
|------|---------|
| `src/types/check.ts` | `CheckId` (21 values), `GroupId` (5 values), `CheckStatus`, `CheckResult` |
| `src/types/device.ts` | `DeviceIdentity`, `MistDeviceMatch`, `MistEvent`, `JmaStateCode` enum |
| `src/types/session.ts` | `MistSession`, `ConsoleSession`, `SessionParticipant`, `MistCloud` |
| `src/types/ws-protocol.ts` | `WsClientMessage` / `WsServerMessage` discriminated unions |
| `src/catalog/check-definition.types.ts` | `CheckDefinition` and `ContextResolverDefinition` interfaces |
| `src/catalog/troubleshoot-context.ts` | `TroubleshootContext` — all fields resolvers can populate |
| `src/catalog/groups.ts` | 5 group definitions in display order |
| `src/catalog/resolvers.ts` | 8 resolver definitions with `provides` and `needs` declared |
| `src/catalog/checks.ts` | 21 check definitions with `gates` and `needs` declared |
| `src/config/mist-clouds.ts` | 9 Mist cloud region configs + `cloudFromCookieDomain()` |

---

## packages/server

Hono TypeScript HTTP server. Single port (default 3000) serves everything.

### Responsibilities

- **Static files**: Serves the compiled client SPA from `public/`. The client's Vite
  `outDir` is set to `packages/server/public/` so a single `npm run build` produces
  a fully self-contained server directory.
- **Session store**: In-memory map of `sessionId → ConsoleSession`. Sessions are created
  when the operator opens a console connection and destroyed on disconnect.
- **Mist API proxy**: `GET/POST /api/mist/*` — strips auth headers from the client request,
  re-attaches them as cookies on the outgoing Mist API request. Credentials never appear
  in localStorage or URLs.
- **WebSocket hub**: `WS /ws?sessionId=<id>&role=<role>` — multiplexes serial RX/TX between all
  participants (operator, support, automation/MCP) keyed by session ID.
- **Check runner**: `POST /api/sessions/:sessionId/checks/run` — executes the troubleshoot
  check catalog against the current session's console and Mist API context.
- **Session state API**: `GET /api/sessions/:sessionId/state` — returns current session
  metadata including participant count and whether a Mist session is attached.
- **Output buffer**: `GET /api/sessions/:sessionId/output?chars=N` — returns the last N chars
  (default 10,000) of buffered terminal output. Buffer holds up to 50,000 chars per session.
- **Command injection**: `POST /api/sessions/:sessionId/command` — injects a CLI command into
  the switch console via the browser's serial port and returns the output when the Juniper
  prompt is detected (or after a configurable timeout).

### Environment Variables

```
PORT=3000                  HTTP listen port (default: 3000)
MIST_PROXY_TIMEOUT=30000   Timeout in ms for proxied Mist API calls (default: 30000)
```

---

## packages/client

Vite + TypeScript SPA. In production it is served as static files by the server.
In development it runs on its own dev server with the Vite proxy forwarding API calls.

### Session Provider Pattern

The app never asks the user to enter API keys or cloud region manually. Three providers
are tried in priority order:

1. **ExtensionSessionProvider** — calls `chrome.runtime.sendMessage(EXTENSION_ID, { type: 'get-mist-session' })`.
   Returns a `MistSession` if the Marvis extension is installed and the user is logged in to Mist.
2. **UrlParamsSessionProvider** — reads `?cloud=&csrf=&sid=` from the URL query string.
   Used when Mist dashboard launches the tool with injected parameters.
3. **ManualSessionProvider** — last-resort fallback. The `SessionSetup` component shows a form
   prompting for device MAC, cloud region, CSRF token, and Mist session ID.

All three implement the same `MistSessionProvider` interface. The app uses the first one
that successfully resolves a session.

### Web Serial API

The `useSerial` hook wraps `navigator.serial`. Key constraints:
- **Chrome/Edge only** — Firefox and Safari do not support Web Serial.
- **HTTPS or localhost required** — the browser blocks it on plain HTTP.
- **User gesture required** — a button click must trigger `requestPort()`.
- **Cannot be server-side** — this API is browser-only by design.

Serial data streams as raw bytes. An xterm.js terminal emulator renders them as a
full VT100-compatible console.

---

## packages/mcp

Stdio MCP server for Claude Desktop. Communicates with `packages/server` over HTTP.

### Tools Exposed to Claude

| Tool | Description |
|------|-------------|
| `list_sessions` | Lists all active console sessions with device identity |
| `get_session` | Returns session metadata and whether a Mist session is attached |
| `read_output` | Returns recent serial terminal output from the session's ring buffer |
| `send_command` | Sends a CLI command to the switch and returns its output |
| `run_check` | Runs a single named diagnostic check and returns its result |
| `run_all_checks` | Runs all 21 checks and returns a formatted summary |
| `list_checks` | Lists all available check IDs with descriptions and groups |

### Claude Desktop Configuration

```json
{
  "mcpServers": {
    "marvis-console": {
      "command": "node",
      "args": ["/absolute/path/to/packages/mcp/dist/index.js"],
      "env": {
        "CONSOLE_SERVER_URL": "http://192.168.1.100:3000"
      }
    }
  }
}
```

---

## packages/extension

Chrome extension acting as a **passive Mist session bridge**. It does not modify any
Mist pages, inject scripts, or alter browser behaviour.

### How It Works

The extension declares `externally_connectable` in its manifest, allowing any web page
to call `chrome.runtime.sendMessage(EXTENSION_ID, message)` directly — no content script
needed. When the Marvis Console app sends `{ type: 'GET_MIST_SESSION' }`:

1. The extension service worker calls `browser.cookies.getAll({})`.
2. It finds `csrftoken` and `sessionid` cookies matching known Mist domains.
3. It reads the active tab URL and extracts `org_id` using the Mist management URL regex.
4. It maps the cookie domain to a `MistCloud` value via `cloudFromCookieDomain()`.
5. It returns `{ orgId, cloud, csrfToken, sessionId }` to the requesting page.

The extension holds no state, stores no credentials, and makes no network requests.

### Long-Term Integration Path

The intended production deployment is within the Mist dashboard itself:

- The switch settings dropdown launches Marvis Console as an embedded page.
- Mist injects session parameters as URL query params.
- `UrlParamsSessionProvider` handles them automatically.
- No extension, no separate server needed on the client machine.

The extension and local server exist for development and field use before Mist integration.

---

## Design Patterns

### Resolver Pattern

The troubleshoot engine separates data collection from diagnostic logic:

```
Phase 1 — Resolvers (run once, results cached in TroubleshootContext)
  uplink-port      → uplinkPort, uplinkPortStatus, uplinkPortErrors
  management-ip    → managementIp, managementPrefix, managementVlan
  default-gateway  → defaultGateway
  dns-servers      → dnsServers
  jma-state        → jmaState, mistEndpoint
  mcd-log-file     → mcdLogFile
  mcd-logs         → mcdLogLines  (needs: mcdLogFile, offlineAt)
  mist-last-seen   → mistLastSeen, offlineAt, mistEventsNearOffline (needs: mistSession, deviceMatch)

Phase 2 — Checks (pure functions over TroubleshootContext + CLI output)
  Each check declares needs: (keyof TroubleshootContext)[]
  Runner guarantees all declared fields are populated before the check runs.
  Checks never call other checks. Checks never know about each other.
```

### Check Independence

Each check is a self-contained module. To add a check:
1. Add `CheckId` value to `shared/src/types/check.ts`
2. Add `CheckDefinition` entry to `shared/src/catalog/checks.ts`
3. Create `server/src/troubleshoot/checks/<id>.ts` with the implementation

No registration, no wiring. The runner discovers checks via the catalog.

### Critical Gates

If a gate check fails, all checks that declare it in their `gates` array skip
automatically with a human-readable `skipReason`. This prevents confusing cascades:

```
mgmt-ip-assigned fails
  → mgmt-vlan-reachable  SKIP (management IP not assigned)
  → default-gateway-ping SKIP (management IP not assigned)
    → dns-resolution      SKIP (gateway unreachable)
    → mist-ep-reachable   SKIP (DNS check skipped)
    → ntp-sync            SKIP (DNS check skipped)
    → mist-websocket      SKIP (NTP and endpoint checks skipped)
```

### JMA State Codes

The switch self-reports cloud connectivity state via `show system jma`:

| Code | Constant | Meaning |
|------|----------|---------|
| 102 | `NoIPAddress` | No IP on management interface |
| 103 | `NoDefaultGateway` | No default route |
| 106 | `DNSLookupFailed` | Cannot resolve Mist endpoint |
| 107 | `NTPSyncFailed` | Clock skew too large for TLS |
| 108 | `CloudUnreachable` | Mist IP not reachable |
| 109 | `WebsocketConnecting` | TCP connected, WS handshake pending |
| 110 | `WebsocketConnected` | WS open, awaiting auth |
| 111 | `Connected` | Fully connected and authenticated |

---

## Development Workflow

```bash
npm install              # Install all workspace dependencies
npm run build:shared     # Must build shared before others
npm run dev              # Server + client hot-reload dev mode
npm run build            # Production build (all packages)
npm run typecheck        # TypeScript check all packages
npm test                 # Run all package test suites
```

## Extending the Project

### Adding a New Check
1. Add to `CheckId` union in `shared/src/types/check.ts`
2. Add `CheckDefinition` in `shared/src/catalog/checks.ts` — declare `needs` and `gates`
3. Add the implementation at `server/src/troubleshoot/checks/<check-id>.ts`
4. If new context data is needed, add to `TroubleshootContext` and add/extend a resolver

### Adding a New Mist Cloud Region
1. Add the union value to `MistCloud` in `shared/src/types/session.ts`
2. Add an entry to `MIST_CLOUDS` in `shared/src/config/mist-clouds.ts`
