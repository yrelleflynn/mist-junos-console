# Session Logging — Implementation Plan

> **Status:** Plan only — no code changes made yet.  
> **Prerequisite reading:** [`SESSION-LOGGING-DESIGN.md`](SESSION-LOGGING-DESIGN.md) · [`SESSION-EVENT-SCHEMA.md`](SESSION-EVENT-SCHEMA.md) · [`SESSION-MASKING-POLICY.md`](SESSION-MASKING-POLICY.md)

The design docs are complete. This document translates them into a phased implementation against the current codebase.

---

## Current State

Session activity is relayed over WebSocket but nothing is persisted.

| Layer | File | Current logging |
|-------|------|-----------------|
| WebSocket relay | `server/index.mjs` | `console.log` only |
| Mist proxy | `server/index.mjs` | `console.log` only |
| MCP agent context | `server/index.mjs` | `console.log` only |
| Frontend terminal | `src/services/serial.service.ts` | None |
| Check results | `src/services/troubleshoot.service.ts` | None |
| Config sync | `src/services/config-sync.service.ts` | None |

---

## Phase 1 — Backend event capture and persistence

### 1.1 Event writer module

**New file:** `server/session-log.mjs`

Responsible for:
- Accepting structured events matching `SESSION-EVENT-SCHEMA.md`
- Applying masking rules from `SESSION-MASKING-POLICY.md`
- Appending masked events to a per-session JSONL file
- Generating the filename per the schema convention:

```
logs/2026-04-15T01-59-11Z__session-<id>__site-<site_id>__device-<serial>__events.jsonl
```

Core API surface:

```js
// session-log.mjs
export function createSessionLog(sessionId, meta = {}) { ... }
// returns { append(event), close(), getPath() }
```

`meta` carries `{ siteId, deviceId, deviceSerial, deviceName, orgId }` — populated progressively as the session learns the device identity.

The `append(event)` function:
1. Stamps `event_id` (UUID), `timestamp` (ISO 8601 UTC), and `sequence` (monotonic counter)
2. Applies masking (see 1.2)
3. Appends the masked event as a single JSON line to the JSONL file

### 1.2 Masking module

**New file:** `server/session-mask.mjs`

Implements the keyword + pattern rules from `SESSION-MASKING-POLICY.md`.

```js
// session-mask.mjs
export function maskEvent(event) { ... }
// Returns { maskedEvent, masking: { masked: bool, rules_applied: string[] } }
```

Initial masking targets (v1):
- Mist API tokens (`Token [A-Za-z0-9]{40,}` → `Token [MASKED_TOKEN]`)
- Password prompt responses (`terminal_tx` where prompt state is `password`)
- Encrypted password hashes (`$6$...`, `$9$...` → `[MASKED_HASH]`)
- RADIUS/TACACS/SNMP secrets (keyword match: `secret`, `community`, `passphrase`)
- Session join tokens

### 1.3 Hook event capture into `server/index.mjs`

Import `createSessionLog` and wire it into the existing WebSocket handlers.

**Session lifecycle:**

```js
// On operator 'join' → session created
const log = createSessionLog(id);
sessionLogs.set(id, log);
log.append({ type: 'session_started', actor_type: 'system', payload: { ... } });

// On ws.on('close') → operator left
log.append({ type: 'session_ended', actor_type: 'system', payload: { reason } });
log.close();
sessionLogs.delete(sessionId);
```

**Participant events:**

```js
// On support 'join'
log.append({ type: 'participant_joined', actor_type: 'human_support', payload: { ... } });

// On support ws close
log.append({ type: 'participant_left', actor_type: 'human_support', payload: { ... } });
```

**Terminal relay:**

```js
// serial-rx (device → operator → support)
log.append({ type: 'terminal_rx', actor_type: 'device', payload: {
  channel: 'serial', text: msg.data, render_in_transcript: true
}});

// serial-tx from operator
log.append({ type: 'terminal_tx', actor_type: 'operator', payload: {
  channel: 'serial', text: msg.data, render_in_transcript: true
}});

// serial-tx from support
log.append({ type: 'terminal_tx', actor_type: 'human_support', payload: {
  channel: 'serial', text: msg.data, render_in_transcript: true
}});
```

**MCP agent context updates** (already structured — easy to log):

```js
// On POST /mcp/agent-context
log.append({ type: 'mist_context_updated', actor_type: 'system', payload: { sessionId, ... } });
```

### 1.4 Log directory

Create `logs/` at project root. Add to `.gitignore`. The writer creates it on first use with `fs.mkdirSync('logs', { recursive: true })`.

---

## Phase 2 — Frontend event emission

The backend relay captures terminal I/O automatically (Phase 1). Phase 2 adds richer structured events from the frontend for workflow activities.

### 2.1 New WebSocket message types

Extend the server's `ws.on('message')` handler in `server/index.mjs` to accept a new message type from the operator frontend:

```js
case 'session-event': {
  // Operator frontend pushes a structured event for logging
  // Validate shape, then log.append(msg.event)
}
```

### 2.2 Frontend event emission

**File:** `src/services/console-session.service.ts`

Add a `logEvent(event: Partial<SessionEvent>)` helper that sends a `session-event` WebSocket message to the backend. Call this from:

| Source | Event type | File |
|--------|-----------|------|
| Serial connect/disconnect | `system_notice` | `serial.service.ts` |
| Device identified | `mist_context_updated` | `switch-identity.service.ts` |
| Check suite started | `test_started` | `troubleshoot.service.ts` |
| Individual check result | `test_result` | `troubleshoot.service.ts` |
| Config sync preview | `config_sync_preview` | `config-sync.service.ts` |
| Config sync commit check | `config_sync_commit_check` | `config-sync.service.ts` |
| Config sync committed | `config_sync_committed` | `config-sync.service.ts` |

### 2.3 Device identity propagation to backend log

When device identity is confirmed (`switch-identity.service.ts`), push an event that carries `deviceSerial`, `siteId`, `deviceName` so the backend can rename the log file (or update sidecar metadata) with the correct identifiers.

---

## Phase 3 — Transcript generation and download endpoint

### 3.1 Backend transcript renderer

**New file:** `server/session-transcript.mjs`

Reads a session's JSONL event file and renders a plain-text transcript per the rules in `SESSION-LOGGING-DESIGN.md`.

```js
export function renderTranscript(events) { ... }
// Returns a plain-text string
```

Rendering rules:
- Only include events where `render_in_transcript: true` (or event type is in the default-render list from the schema)
- Format: `[HH:MM:SS] ACTOR_LABEL: content`
- Use actor labels: `SYSTEM`, `OPERATOR`, `DEVICE`, `SUPPORT`, `AI AGENT`
- For `test_result`: include status badge, detail, and remediation
- For `config_sync_*`: include diff excerpt and status

### 3.2 Download endpoints

Add two routes to `server/index.mjs`:

```
GET /sessions/:sessionId/transcript    → rendered plain-text transcript
GET /sessions/:sessionId/events        → raw JSONL event stream (operator/support use)
GET /sessions                          → list of session metadata
```

These routes read from the `logs/` directory. Active sessions are served from the in-memory event buffer; completed sessions are served from the JSONL file.

### 3.3 Frontend download button

**File:** `src/main.ts`

Add a "Download transcript" button to the session toolbar. Wire it to:

```typescript
async function downloadTranscript() {
  const res = await fetch(`/sessions/${sessionId}/transcript`);
  const text = await res.text();
  const blob = new Blob([text], { type: 'text/plain' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `session-${sessionId}-transcript.txt`;
  a.click();
  URL.revokeObjectURL(url);
}
```

The button should be:
- Available during a live session (downloads events so far)
- Available in a post-session view if one is added later
- Visually consistent with the existing toolbar button style

---

## Phase 4 — Retention and housekeeping

### 4.1 30-day log rotation

**File:** `server/index.mjs` (or a separate `server/log-retention.mjs`)

On server start, delete JSONL and transcript files older than 30 days:

```js
const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

function pruneOldLogs(logDir) {
  for (const file of fs.readdirSync(logDir)) {
    const stat = fs.statSync(path.join(logDir, file));
    if (Date.now() - stat.mtimeMs > MAX_AGE_MS) {
      fs.unlinkSync(path.join(logDir, file));
    }
  }
}
```

Run once on startup. Optionally schedule with `setInterval` every 24 hours.

### 4.2 Session cleanup on abnormal termination

If the server restarts mid-session, any open JSONL file should be closeable. On server startup, scan for JSONL files with no matching `session_ended` event and append a synthetic `session_ended` with `reason: 'server_restart'`.

---

## Implementation Order

| Phase | New files | Modified files | Delivers |
|-------|-----------|----------------|---------|
| 1 — Backend capture | `server/session-log.mjs` · `server/session-mask.mjs` | `server/index.mjs` | Terminal I/O, participant events, MCP context logged to JSONL |
| 2 — Frontend events | — | `src/services/console-session.service.ts` · `troubleshoot.service.ts` · `config-sync.service.ts` | Structured check and config-sync events in the log |
| 3 — Download | `server/session-transcript.mjs` | `server/index.mjs` · `src/main.ts` | "Download transcript" button working end-to-end |
| 4 — Retention | `server/log-retention.mjs` | `server/index.mjs` | Automatic 30-day cleanup |

Phases 1 and 3 deliver the most visible value. Phase 2 enriches the transcript but is not required for a working download. Phase 4 is hygiene.

---

## Open Questions

1. **Live transcript streaming** — Should the "Download" button during a live session poll the backend or should the backend push a rendered snapshot? Polling on click is simplest for v1.
2. **Support-side download** — Should the support participant also get a "Download transcript" button in their view? Likely yes — same endpoint, same session ID.
3. **JSONL vs SQLite** — JSONL is simpler for v1 and aligns with the schema doc. If search requirements grow, SQLite is a natural next step without changing the event model.
4. **Log directory location** — `logs/` at project root is fine for dev. For a deployed instance, make the path configurable via `JUNOS_CONSOLE_LOG_DIR` environment variable.

---

## Related Documents

- [`SESSION-LOGGING-DESIGN.md`](SESSION-LOGGING-DESIGN.md) — design rationale and UX model
- [`SESSION-EVENT-SCHEMA.md`](SESSION-EVENT-SCHEMA.md) — event envelope, types, and payload shapes
- [`SESSION-MASKING-POLICY.md`](SESSION-MASKING-POLICY.md) — masking rules and detection heuristics
