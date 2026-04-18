# Backend MCP Design

## Purpose

Define a backend MCP server design that exposes:

- live console and session tools
- structured troubleshooting tools
- narrow backend-owned Mist proxy gap tools

This server is intended to complement, not replace, the public Mist MCP.

## Implementation Status

A Phase 1 proof-of-concept is implemented in [`mcp/`](/Users/mdusty/Library/CloudStorage/OneDrive-HewlettPackardEnterprise/Documents/03%20Mist%20Docs/07%20Projects/mist-junos-console/mcp/).

See [`docs/BACKEND-MCP-POC.md`](/Users/mdusty/Library/CloudStorage/OneDrive-HewlettPackardEnterprise/Documents/03%20Mist%20Docs/07%20Projects/mist-junos-console/docs/BACKEND-MCP-POC.md) for:
- which tools are implemented vs stubbed
- how to run the MCP server
- what is deferred and why

This design document describes the intended full architecture. The POC covers the Phase 1 read-only observer slice.

Related docs:

- [`docs/BACKEND-MCP-POC.md`](/Users/mdusty/Library/CloudStorage/OneDrive-HewlettPackardEnterprise/Documents/03%20Mist%20Docs/07%20Projects/mist-junos-console/docs/BACKEND-MCP-POC.md)
- [`docs/AI-AGENT-INTEGRATION.md`](/Users/mdusty/Library/CloudStorage/OneDrive-HewlettPackardEnterprise/Documents/03%20Mist%20Docs/07%20Projects/mist-junos-console/docs/AI-AGENT-INTEGRATION.md:1)
- [`docs/MIST-API-INTEGRATION.md`](/Users/mdusty/Library/CloudStorage/OneDrive-HewlettPackardEnterprise/Documents/03%20Mist%20Docs/07%20Projects/mist-junos-console/docs/MIST-API-INTEGRATION.md:1)
- [`docs/SESSION-LOGGING-DESIGN.md`](/Users/mdusty/Library/CloudStorage/OneDrive-HewlettPackardEnterprise/Documents/03%20Mist%20Docs/07%20Projects/mist-junos-console/docs/SESSION-LOGGING-DESIGN.md:1)
- [`docs/SESSION-EVENT-SCHEMA.md`](/Users/mdusty/Library/CloudStorage/OneDrive-HewlettPackardEnterprise/Documents/03%20Mist%20Docs/07%20Projects/mist-junos-console/docs/SESSION-EVENT-SCHEMA.md:1)

## Architectural Model

Recommended agent integration remains a dual-MCP model:

- public Mist MCP
  - read-only Mist platform context
- private backend MCP
  - live session state
  - controlled console access
  - structured troubleshooting workflows
  - backend-owned Mist proxy gap tools

The backend MCP should mostly expose capability that already exists in the backend:

- WebSocket console relay
- Mist proxy endpoints such as `config_cmd`
- session state and event streams
- troubleshooting and config-sync workflows

The goal is not to invent a second product API. The goal is to provide tool-shaped interfaces over existing backend capability, with clearer trust boundaries.

## Source-Of-Truth Rules

To avoid ambiguity:

- public Mist MCP is the source for Mist-side context
- backend MCP is the source for live session state and controlled action workflows

Recommended source labels in tool outputs:

- `mist_last_known`
- `mist_intended`
- `live_console`
- `switch_reported`
- `disconnect_evidence`

## Trust And Permission Model

The console surface must be tiered from the beginning.

### Tier 1: Read-only safe tools

Examples:

- session summary
- transcript access
- device identity
- JMA connectivity state
- structured check results
- allowed operational `show` commands

These should be safe by default once the operator has enabled agent access.

### Tier 2: Structured bounded workflow tools

Examples:

- run a single diagnostic check
- run the troubleshoot workflow
- collect disconnect evidence
- get config drift summary
- get config sync preview summary

These still do not directly mutate config, but they do trigger execution on the switch.

### Tier 3: State-changing tools

Examples:

- stage config sync
- commit staged config sync
- rollback staged config sync
- apply adoption commands

These must require explicit operator approval and should use names that make the risk obvious.

## Session Ownership Model

The operator remains the owner of the session.

The agent gets a window into the session, not ownership of it.

Recommended enforcement:

- no backend MCP session tools unless the operator has explicitly enabled agent access
- the backend checks session participation state before servicing tool calls
- mutating tools additionally require explicit approval for the specific action

This should mirror the current human support model:

- the operator starts sharing
- support or AI can observe and participate
- the operator remains aware and in control

## Tool Design Principles

### Prefer product-oriented tools over raw proxy or transport tools

Good:

- `get_device_config(site_id, device_id)`
- `get_session_summary()`
- `run_single_check(check_id)`

Avoid:

- `mist_proxy_get(path)`
- `mist_proxy_request(method, path, body)`
- unrestricted `execute_command(command)`

### Prefer structured results over raw text-only results

Good output should include:

- `id`
- `status`
- `summary`
- `detail`
- `remediation`
- `raw_evidence`
- `source_type`
- `timestamp`

This keeps product logic in the product rather than forcing the agent to rediscover it from CLI text.

### Make risk visible in tool names

Examples:

- `run_show_command`
- `preview_config_sync`
- `commit_staged_config_sync`
- `rollback_staged_config_sync`

The name itself should help communicate trust level.

## Recommended Tool Surface

### Session and context

- `get_session_summary`
  - serial connected state
  - prompt state
  - config mode state
  - current device identity
  - Mist org/site/device match
  - Mist and JMA cloud status

- `get_session_state`
  - participant state
  - operator approval state
  - staged config sync state if any

- `get_recent_session_events`
  - bounded event feed for agent reasoning

- `get_transcript_slice`
  - controlled transcript window, not an endless raw stream dump

- `get_device_identity`
  - current local identity and matched Mist identity

### Read-only console tools

- `run_show_command(command)`
  - allowlisted operational commands only
  - no config mode
  - no `set`, `delete`, `edit`, `configure`, `clear`, `request system`, shell escapes, or arbitrary pipes

- `get_prompt_state`
  - operational, shell, login, config, unknown

- `get_config_mode_state`
  - whether config mode is active
  - whether a config sync candidate is staged

### Structured troubleshooting tools

- `run_troubleshoot_workflow(profile?)`
  - full or profile-based run

- `run_single_check(check_id)`
  - targeted execution of one check

- `get_check_results`
  - most recent structured troubleshooting results

- `get_jma_connectivity_state`
  - structured switch-reported cloud state

- `collect_disconnect_evidence`
  - bounded evidence bundle for AI or support interpretation

- `get_firewall_policy_check`
  - targeted endpoint and SSL inspection evidence

- `get_config_drift_summary`
  - summary only, not raw full diff unless explicitly requested

### Mist proxy gap tools

These exist because the backend already owns the relevant Mist proxy behavior and some endpoints may not exist in the public Mist MCP.

- `get_device_config(site_id, device_id)`
  - backend-owned wrapper for `config_cmd`

- `get_adoption_commands(device_id?)`
  - only if the backend already exposes this behavior

- `get_site_root_password(site_id)`
  - only if this remains a backend-owned product feature

The important rule:

- expose named product methods, not a generic Mist pass-through

## Console Tool Boundary

This distinction should be enforced in the schema and backend policy, not left only to prompt instructions.

### Recommended read-only allowlist

Likely acceptable:

- `show ...`
- `ping ...`
- `traceroute ...`
- bounded file/log display commands that are already product-approved

Likely disallowed from the generic read-only tool:

- `configure`
- `edit`
- `set`
- `delete`
- `clear`
- `restart`
- shell access
- anything that changes state

If needed later, mutating commands should be exposed only through explicit workflow tools rather than a generic execute surface.

## Approval Model For Mutating Tools

Mutating tools should require:

1. operator enabled agent participation
2. operator approval for the specific action
3. backend audit logging of:
   - request
   - approval/denial
   - execution
   - result

Examples:

- `preview_config_sync`
- `commit_staged_config_sync`
- `commit_confirmed_staged_config_sync`
- `rollback_staged_config_sync`
- `apply_adoption_commands`

## Session Event Logging Requirements

All meaningful backend MCP interactions should be logged in the session event stream, including:

- agent joined / left
- agent requested a check
- backend executed a check
- agent requested an approval-gated action
- operator approved or denied
- backend applied, committed, or rolled back a config workflow

This keeps human support and AI participation under the same audit model.

## Recommended Rollout Phases

### Phase 1: Read-only observer

Expose:

- `get_session_summary`
- `get_session_state`
- `get_device_identity`
- `get_recent_session_events`
- `get_transcript_slice`
- `get_jma_connectivity_state`
- `get_check_results`
- `get_device_config`

No command execution yet.

### Phase 2: Diagnostic assistant

Expose:

- `run_single_check`
- `run_troubleshoot_workflow`
- `collect_disconnect_evidence`
- `run_show_command` with allowlisted operational commands

Still no config mutation.

### Phase 3: Guided actor

Expose approval-gated workflow tools such as:

- `preview_config_sync`
- `commit_staged_config_sync`
- `commit_confirmed_staged_config_sync`
- `rollback_staged_config_sync`
- `apply_adoption_commands`

Only after approval, audit, and staged-session ownership rules are mature.

## Suggested First Implementation Slice

If implementation starts soon, the most pragmatic first backend MCP slice is:

- `get_session_summary`
- `get_device_identity`
- `get_jma_connectivity_state`
- `get_check_results`
- `get_transcript_slice`
- `get_device_config`

This provides immediate value to an AI agent while keeping the trust boundary conservative.

## Open Design Questions

- whether transcript access should be pull-based only or support bounded streaming subscriptions
- whether `run_show_command` belongs in phase 1 or phase 2
- whether approval state should be embedded in each tool response or exposed only through `get_session_state`
- whether config-sync and adoption actions should be separate MCP namespaces or simply separate tools

## Summary

The backend MCP should be:

- narrow
- product-oriented
- backend-owned
- approval-aware
- session-audited

It should complement the public Mist MCP rather than trying to replace it, and it should preserve the core trust rule that the operator owns the session while the agent participates only within explicit policy boundaries.
