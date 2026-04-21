# MCP Phase 2 — Implementation Plan: `run_show_command`

## Purpose

Add `run_show_command` to the MCP server as the first Phase 2 capability. This
gives an AI agent the ability to run any approved read-only Junos operational
command — not just the named catalog checks — while keeping the trust boundary
intact.

## Background

Phase 1 gave the agent:
- read access to all live session state
- the ability to trigger named catalog checks via the relay

Phase 2's `run_show_command` extends this by letting the agent run arbitrary
`show` commands from a validated allowlist. This enables ad-hoc diagnostic
queries that fall outside the fixed check catalog — for example, checking a
specific interface the operator hasn't selected, or querying routing state for
an IP that only emerged from the current session context.

The full allowlist design rationale is in
[`docs/BACKEND-MCP-DESIGN.md`](./BACKEND-MCP-DESIGN.md) (Console Tool Boundary
section). This plan covers only the build steps.

---

## Architecture

The relay pattern used for catalog checks is reused without changes:

```
Agent
  │  run_show_command(command)
  ▼
mcp/server.ts
  │  validates command against allowlist
  │  POST /mcp/actions  { type: 'run_show_command', command }
  ▼
server/index.mjs
  │  enqueues action in session queue
  ▼
src/main.ts  (operator page)
  │  polls GET /mcp/actions/next, claims action
  │  executes command via serial session using runCommand()
  │  POST /mcp/actions/:id/status  { output, exitStatus }
  ▼
mcp/server.ts
  │  receives result, returns to agent
  ▼
Agent
```

Validation happens **in the MCP server before the action is enqueued**. The
frontend also validates the incoming command before executing — defence in
depth.

---

## Allowlist Seed

The initial allowlist is seeded from commands already used in the check catalog.
These are known-safe, already product-approved, and have known output handling.

### Fixed commands (no parameter slots)

```
show lldp neighbors
show lldp local-information
show interfaces terse | match "inet "
show arp no-resolve
show dhcp client binding
show dhcp client binding detail
show system services dhcp client binding
show route table inet.0 0.0.0.0/0
show route table mgmt_junos.inet.0 0.0.0.0/0
show configuration | display set | match mgmt_junos
show configuration groups | display set | match name-server
show configuration system services outbound-ssh
show version | match mist
show system uptime
show system connections | match 443
show log messages | last 200
show vlans
show configuration vlans | display set
```

### Parameterized commands (slot validation required)

| Template | Slot | Validator |
|----------|------|-----------|
| `show interfaces {port} terse` | `port` | port |
| `show interfaces {port}` | `port` | port |
| `show interfaces {port} extensive \| match error` | `port` | port |
| `show vlans interface {port}` | `port` | port |
| `show ethernet-switching interface {port}` | `port` | port |
| `show configuration interfaces {port} \| display set` | `port` | port |
| `show lldp neighbors interface {port} detail` | `port` | port |
| `show host {hostname}` | `hostname` | hostname |
| `show route {ip}` | `ip` | ipv4 |
| `show log {logfile} \| last {count}` | `logfile`, `count` | logfile, count (max 9999) |

### Diagnostic commands (also from catalog)

| Template | Slots | Validators |
|----------|-------|-----------|
| `ping inet {ip} count 1 rapid` | `ip` | ipv4 |
| `traceroute inet {ip} no-resolve wait 1 ttl 15` | `ip` | ipv4 |
| `telnet inet {hostname} port {port_number}` | `hostname`, `port_number` | hostname, count (max 65535) |

Note: `ping`, `traceroute`, and `telnet` are included because they are already
catalog-approved read-only diagnostics. They do not belong in a `show`
allowlist semantically, but they are appropriate to expose through the same
tool at Phase 2 rather than adding a separate tool surface.

### Shell-mode commands — NOT included

`curl`, `ps aux`, `cat /etc/resolv.conf` and similar are **not** exposed via
`run_show_command`. These require `start shell` entry, which represents a
meaningfully different trust surface. They remain accessible only through the
named check relay via `run_check`.

---

## Implementation Steps

### Step 1 — Allowlist module (`mcp/src/show-command-allowlist.ts`)

Create a new file in the MCP package that exports:

- the `AllowlistEntry` type
- the `ParamValidator` union type
- the `SHOW_COMMAND_ALLOWLIST` array (seeded from above)
- `validateShowCommand(command: string): { valid: true; built: string } | { valid: false; reason: string }`

The validator:
1. Normalises whitespace in the input command
2. Checks the input against each allowlist template by trying to extract slot values
3. Validates each extracted slot value against its type rule
4. If a match is found and all slots pass, returns `{ valid: true, built: normalised_command }`
5. If no template matches or any slot fails, returns `{ valid: false, reason }`

Param validator implementations:

```typescript
// port: ge-N/N/N, xe-N/N/N, et-N/N/N, ae\d+, me0, irb, irb.\d+, vme, lo0
const PORT_RE = /^(ge|xe|et)-\d+\/\d+\/\d+$|^ae\d{1,3}$|^(me0|irb(\.\d+)?|vme|lo0)$/;

// IPv4 address or CIDR
const IPV4_RE = /^(\d{1,3}\.){3}\d{1,3}(\/\d{1,2})?$/;

// RFC-1123 hostname or FQDN (no spaces, no shell metacharacters)
const HOSTNAME_RE = /^[a-zA-Z0-9]([a-zA-Z0-9\-]{0,61}[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9\-]{0,61}[a-zA-Z0-9])?)*$/;

// Log file names — fixed set only
const ALLOWED_LOGFILES = new Set([
  'messages', 'mcd', 'jmd', 'daemon', 'interactive-commands',
  'commit', 'chassisd', 'authd', 'cosd'
]);

// Count — positive integer
function validateCount(value: string, max: number): boolean {
  const n = parseInt(value, 10);
  return !isNaN(n) && n > 0 && n <= max && String(n) === value;
}
```

**Pipe expression handling:** The allowlist templates include pipe expressions as
literal parts of the template (e.g. `show vlans interface {port}` has no pipe,
but `show log {logfile} | last {count}` does). Pipe expressions that appear in
templates are validated as part of the template. The agent may **not** append
additional pipe expressions beyond what the template defines — the command must
match the template exactly after slot substitution.

### Step 2 — MCP tool (`mcp/server.ts`)

Add `run_show_command` to the MCP server's tool list:

```typescript
{
  name: 'run_show_command',
  description: `Run an allowlisted read-only Junos operational command on the connected switch.
Only commands from the approved allowlist are accepted. Parameters (port names,
IP addresses, hostnames, log file names) are validated before the command is sent.
Shell-mode commands (curl, ps, cat) are not available through this tool.
Returns raw command output plus exit status. Requires agent access to be enabled.`,
  inputSchema: {
    type: 'object',
    properties: {
      command: {
        type: 'string',
        description: 'The full Junos operational command to run, including any parameters. Must match an allowlist template exactly.'
      }
    },
    required: ['command']
  }
}
```

Handler logic:

1. Check stub guard — if `state._stub`, return stub response explaining agent access is not enabled
2. Call `validateShowCommand(args.command)` from the allowlist module
3. If invalid, return `{ error: true, reason: validation.reason }` without enqueuing
4. Enqueue `{ type: 'run_show_command', command: validation.built }` via the action relay
5. Wait for the operator page to claim, execute, and report back (same polling pattern as `run_check`)
6. Return the result:

```typescript
{
  command: string;
  output: string;
  exitStatus: 'ok' | 'error' | 'timeout';
  executedAt: string;
  source: 'live_console';
}
```

### Step 3 — Backend relay support (`server/index.mjs`)

The existing `POST /mcp/actions` endpoint and action relay infrastructure
handles `run_show_command` without modification to the queue or status
endpoints. The only addition needed is accepting `run_show_command` as a valid
action `type` in the existing action schema validation (if type is checked).

No new endpoints are required.

### Step 4 — Frontend handler (`src/main.ts`)

Add a `run_show_command` case to `executePendingAgentAction()`:

```typescript
case 'run_show_command': {
  const command = action.params?.command as string;
  if (!command || typeof command !== 'string') {
    await postAgentActionStatus(action.id, 'failed', { error: 'missing command' });
    return;
  }

  // Defence-in-depth: validate the command on the frontend too
  // before sending it to the serial port
  const validation = validateShowCommand(command);
  if (!validation.valid) {
    await postAgentActionStatus(action.id, 'failed', {
      error: `Command rejected by frontend allowlist: ${validation.reason}`
    });
    return;
  }

  await postAgentActionStatus(action.id, 'running', {});

  try {
    const output = await runCommand(validation.built, { timeout: 15000 });
    await postAgentActionStatus(action.id, 'completed', {
      command: validation.built,
      output,
      exitStatus: 'ok',
      executedAt: new Date().toISOString()
    });
  } catch (err) {
    await postAgentActionStatus(action.id, 'failed', {
      command: validation.built,
      output: String(err),
      exitStatus: 'timeout',
      executedAt: new Date().toISOString()
    });
  }
  break;
}
```

The frontend imports the same allowlist module. Since the MCP server is a
separate process, the allowlist module should live in a location both can
import — either a shared `src/lib/` path (with a path alias in tsconfig), or
duplicated in `mcp/src/` for now and consolidated later.

For the initial implementation, **duplicate in `mcp/src/show-command-allowlist.ts`
and `src/lib/show-command-allowlist.ts`** and keep them in sync. Consolidation
into a shared package is a follow-on refactor.

### Step 5 — Tool description update (`mcp/server.ts`)

Update `list_agent_reads` to include `run_show_command` in its description of
available tools, so the agent knows it can request ad-hoc show commands.

---

## Acceptance Criteria

- Agent can call `run_show_command('show lldp neighbors')` and receive the raw output
- Agent can call `run_show_command('show interfaces ge-0/0/1 terse')` with a valid port name
- Agent receives a clear rejection (not an exception) when calling with a disallowed command such as `configure terminal` or `show interfaces eth0`
- Agent receives a clear rejection when a slot value fails validation (e.g. a port name with a shell metacharacter)
- Frontend does not execute a command that fails the allowlist check, even if the MCP server validation is bypassed
- `get_session_summary` stub guard applies — `run_show_command` returns stub if agent access is not enabled
- TypeScript compiles cleanly across both `mcp/` and the main project

---

## What Stays Deferred

| Capability | Reason |
|-----------|--------|
| Expanding the allowlist beyond the catalog seed | Deliberate — add new entries as specific agent use cases are identified, not speculatively |
| Shell-mode commands via MCP | Kept on relay-only path; the named check relay is the right gate |
| `get_transcript_slice` | Needs session transcript infrastructure |
| Phase 3 approval-gated tools | Not started until approval model is implemented |

---

## Files Affected

| File | Change |
|------|--------|
| `mcp/src/show-command-allowlist.ts` | **New** — allowlist module |
| `src/lib/show-command-allowlist.ts` | **New** — frontend copy of allowlist module |
| `mcp/server.ts` | Add `run_show_command` tool, import allowlist, update `list_agent_reads` |
| `src/main.ts` | Add `run_show_command` case to `executePendingAgentAction`, import allowlist |
| `server/index.mjs` | Minor — accept `run_show_command` as valid action type if type is validated |

---

## Suggested Build Order

1. Write and unit-test the allowlist module (`mcp/src/show-command-allowlist.ts`)
2. Copy to `src/lib/` and verify TypeScript compiles in both contexts
3. Add the MCP tool stub (returns a fixed mock output) — confirm the relay round-trip works end-to-end
4. Wire the real `executePendingAgentAction` case in the frontend
5. Test with a live session: fixed command → parameterised command → rejected command
6. Update `list_agent_reads`
