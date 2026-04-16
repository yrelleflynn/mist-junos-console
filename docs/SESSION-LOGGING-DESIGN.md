# Session Logging Design

## Purpose

Define how session logging should work so the product stays simple for operators while remaining maintainable, searchable, and safe in the backend.

## Core Decision

The product should present a single unified session history to the operator, but store session activity internally as a structured event stream.

This means:

- the operator sees one chronological console or session history
- the operator downloads one plain-text transcript
- the backend stores structured masked events for each session

## Why This Model

### Product and UX reasons

- operators usually want one readable story of what happened
- the current tool already behaves like a unified console log
- a single timeline is easier to understand during troubleshooting
- this stays consistent with the current direction of the tool and with familiar remote console UX

### Engineering reasons

- structured events are easier to search and filter
- actor attribution is clearer for operator, human support, AI agent, and system actions
- masking is safer and easier before rendering
- backend support tooling becomes easier to build later
- future exports or alternate views can be generated without changing capture logic

## Recommended Model

### 1. Canonical session event stream

Each session should be captured as an ordered stream of structured events.

Examples:

- `session_started`
- `session_ended`
- `participant_joined`
- `participant_left`
- `terminal_tx`
- `terminal_rx`
- `system_notice`
- `mist_api_call`
- `test_started`
- `test_result`
- `config_sync_preview`
- `config_sync_commit_check`
- `config_sync_committed`
- `error`

Each event should include standard metadata where relevant:

- timestamp
- session ID
- actor type
- actor ID or role if available
- device ID if known
- site ID if known
- payload

### 2. Rendered operator transcript

The operator-facing transcript should be generated from the canonical event stream.

The transcript should:

- be plain text
- be available for download during a live session
- be available after the session ends
- present one chronological narrative
- use clear markers for non-terminal entries such as system notices and test results

### Visible vs silent actions

The live terminal should prioritize operator comprehension, not raw exhaust from every internal action.

Recommended rule:

- operator-invoked actions should remain visible in the live terminal
- lightweight background monitoring or bootstrap actions may run silently in the live terminal
- silent background actions should still be captured in the backend event stream as system or backend events
- if silent actions are ever exposed in transcript rendering, they should be clearly labeled as system-generated rather than operator-entered terminal traffic

## What Counts As A Transcript Entry

The transcript should include any event that helps the operator understand the session story.

This includes:

- terminal input and output
- session start and end
- participant join and leave events
- key system notices
- user-invoked workflow commands and their meaningful output
- troubleshooting workflow start and result entries
- config sync preview, commit check, and commit result entries
- meaningful errors and warnings

## What Counts As A Backend Event

The backend event stream includes everything needed to reconstruct and search the session, including items that may be rendered more simply in the transcript.

This includes:

- all transcript-visible events
- Mist API actions relevant to the session
- structured workflow metadata
- silent background monitoring and bootstrap actions
- actor attribution for human support and AI agent participants
- backend-only metadata needed for support search or future analytics

## UI Recommendation

The product should keep one main console or history view rather than separate transcript and event panes.

Non-terminal entries should be visually distinct in the unified history, for example:

- `SYSTEM`
- `TEST`
- `TEST RESULT`
- `SUPPORT`
- `AI AGENT`

If the history becomes too noisy later, add filters such as:

- `All`
- `Terminal`
- `System`
- `Tests`
- `Config Sync`

Do not split the user-facing experience into multiple logs by default in v1.

## Masking Strategy

Mask sensitive values before persistence and before transcript rendering.

Recommended flow:

1. capture event
2. apply masking rules
3. persist masked canonical event
4. render transcript from masked event data

This avoids storing raw secrets in backend session logs.

### Sensitive values to mask

- Mist API tokens
- passwords entered at prompts
- root password retrieval output
- sensitive secret values in config
- other credentials or secrets detected in system actions

## Searchability

Backend logs should be searchable by:

- session ID
- device
- site
- timestamp

The initial implementation may use file names and metadata conventions to support this, as long as the structure can evolve later.

## Retention

Backend logs should be retained for 30 days.

## Design Principles

- one operator-facing session history
- one plain-text transcript export
- structured events in the backend
- explicit actor attribution
- masking before storage
- future-friendly search and support workflows

## Example Rendering

```text
[10:14:02] SYSTEM: Session started
[10:14:10] OPERATOR: show interfaces terse
[10:14:11] DEVICE:
ge-0/0/0 up up
ge-0/0/1 down down

[10:14:30] TEST: Cloud connectivity check started
[10:14:33] TEST RESULT: Default route - FAIL
Reason: No default route found
Remediation: Check DHCP or static gateway configuration

[10:16:02] SUPPORT: Human support joined session
```

## Consequence

This model keeps the UI simple, avoids over-complicating the operator experience, and gives the backend the structure needed for support, troubleshooting, auditability, and future AI-assisted workflows.

## Related Documents

- [`docs/SESSION-EVENT-SCHEMA.md`](/Users/mdusty/Library/CloudStorage/OneDrive-HewlettPackardEnterprise/Documents/03%20Mist%20Docs/07%20Projects/mist-junos-console/docs/SESSION-EVENT-SCHEMA.md)
- [`docs/SESSION-MASKING-POLICY.md`](/Users/mdusty/Library/CloudStorage/OneDrive-HewlettPackardEnterprise/Documents/03%20Mist%20Docs/07%20Projects/mist-junos-console/docs/SESSION-MASKING-POLICY.md)
