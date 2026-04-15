# AI Agent Integration

## Purpose

Describe how an AI agent should interact with this tool in a way that is useful, safe, and aligned with the product architecture.

## Core Recommendation

Use a layered integration model:

- public Mist MCP for read-only Mist platform context
- this tool's backend or MCP layer for live session state, transcript access, troubleshooting workflows, and controlled actions

Do not expose only raw serial or raw tests directly to the agent as the primary model.

## Why This Approach

The agent needs access to two different kinds of truth:

1. Mist-side context
2. live console and session context

These are related, but they should not be collapsed into one undifferentiated tool surface.

## Dual MCP Model

### 1. Public Mist MCP

Recommended use:

- read-only Mist context
- org and site context
- device stats
- recent device events
- intended config metadata where available
- Mist last-known device status

Why it makes sense:

- avoids rebuilding read-only platform context tools unnecessarily
- aligns with Mist-owned auth and permission boundaries
- gives the agent direct access to relevant Mist-side information

### 2. Private Tool MCP Or Backend Tool Surface

Recommended use:

- current session summary
- live console transcript and event access
- structured troubleshooting results
- safe test execution
- config sync preview
- approval-gated workflows
- session participation state
- support and AI audit visibility

Why it is still required:

The public Mist MCP will not know:

- the current console session
- live device output
- the transcript or session event model
- the operator approval state
- the human support vs AI participant model
- the tool’s internal troubleshooting workflow state

## Source-Of-Truth Rules

To avoid confusion, the agent integration should follow clear data ownership rules:

- public Mist MCP is the source for Mist-side context
- this tool’s backend is the source for live session state and action workflows

The product should label data clearly as:

- `live_console`
- `mist_intended`
- `mist_last_known`

This should apply both in the UI and in agent-facing tool outputs.

## Recommended Agent Capability Levels

### Level 1: Read-only observer

The agent can:

- read session transcript
- read session events
- read device identity
- read Mist context
- read check results

The agent cannot:

- inject commands
- change config
- commit changes

This is the recommended starting point.

### Level 2: Diagnostic assistant

The agent can:

- trigger approved read-only checks
- correlate live state with Mist intended and last-known state
- suggest likely causes and next actions

The agent still cannot perform state-changing actions on its own.

### Level 3: Guided actor

The agent can:

- prepare config previews
- request operator approval for bounded actions
- assist with structured workflows

This level should be introduced only after logging, approval, and policy boundaries are mature.

## Recommended Tool Surface

The agent should consume product-level tools rather than raw transport-level tools where possible.

Recommended private tool surface:

- `get_session_summary`
- `get_session_events`
- `get_transcript`
- `get_device_identity`
- `run_troubleshoot_workflow`
- `run_single_check`
- `get_check_results`
- `get_config_sync_preview`
- `get_recent_device_timeline`
- `collect_disconnect_evidence`
- `get_jma_connectivity_state`

Possible later tools:

- `request_action_plan`
- `request_operator_approval`
- `apply_approved_action`

Avoid starting with:

- arbitrary raw serial injection
- arbitrary config commit tools
- unrestricted shell-like action tools

## Structured Output Guidance

The agent should receive structured results, not just raw CLI text.

For example, instead of only returning:

- raw output of `show route 0.0.0.0/0`

Prefer returning:

- check ID
- status
- summary
- remediation guidance
- raw evidence
- source type
- timestamps

This improves reliability and keeps domain logic in the product rather than forcing the agent to rediscover it.

The JMA cloud connectivity state is a particularly good example of a structured agent-facing signal because it already encodes where the switch believes the cloud-connection process is failing.

## Safety And Control Model

### Required controls

- explicit operator awareness that an AI agent is present
- explicit distinction between human support and AI agent participants
- logging of agent participation, requests, and actions
- operator approval for state-changing actions
- backend-owned policy boundaries

### Recommended initial posture

- start read-only
- allow diagnostic suggestions
- delay command execution or config changes until policy and audit controls are stronger

## Relationship To Session Logging

All meaningful AI agent interactions should be captured in the session event stream, including:

- AI agent join and leave
- agent-requested checks
- agent-generated recommendations
- approval requests
- approved or denied actions

This aligns with the session logging design and preserves accountability.

## Relationship To Mist API Integration

This model aligns with the broader Mist API strategy:

- backend-owned Mist access remains the preferred architecture for this tool
- public Mist MCP can still be used as a read-only context source for the agent
- the tool backend remains responsible for live session state and controlled actions

## Disconnect Evidence As An AI-Focused Workflow

Disconnect analysis is a strong candidate for AI assistance because:

- disconnect timing is approximate
- relevant daemon logs may have rotated
- evidence often needs interpretation rather than simple display

Recommended model:

- the product collects a bounded evidence bundle
- the AI agent interprets that bundle
- the UI presents collected evidence and agent reasoning separately where appropriate

This is preferable to presenting an overly deterministic “offline timeline” based only on a single inferred timestamp.

## Summary

The recommended agent architecture is a dual-MCP model:

- public Mist MCP for read-only Mist platform context
- private tool MCP or backend tool layer for live session state, workflows, and approval-gated actions

This gives the agent useful context without collapsing trust boundaries or duplicating the tool’s domain logic.
