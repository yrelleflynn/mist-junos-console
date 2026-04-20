# Session Event Schema

## Purpose

Define the first-pass backend event model for session logging so implementation can begin with a stable structure for capture, masking, storage, rendering, and search.

## Scope

This schema is intended for backend session logging and transcript rendering.

It should support:

- operator sessions
- human support participants
- AI agent participants
- terminal transcript rendering
- support search and troubleshooting
- masked storage for 30-day retention

## Core Design

Each session is captured as an ordered stream of events.

Each event has:

- a common envelope
- an event type
- type-specific payload

The transcript shown to users is rendered from these events.

## Event Envelope

Each event should contain the following top-level fields.

| Field | Type | Required | Notes |
|---|---|---|---|
| `event_id` | string | yes | Unique ID for the event |
| `session_id` | string | yes | Session identifier |
| `timestamp` | string | yes | ISO 8601 UTC timestamp |
| `sequence` | number | yes | Monotonic sequence within the session |
| `type` | string | yes | Event type |
| `actor_type` | string | yes | `operator`, `human_support`, `ai_agent`, `system`, `device`, `backend` |
| `actor_id` | string \| null | no | User ID, support ID, agent ID, or null |
| `actor_label` | string \| null | no | Friendly label for transcript rendering |
| `org_id` | string \| null | no | Mist org if known |
| `site_id` | string \| null | no | Mist site if known |
| `device_id` | string \| null | no | Mist device ID if known |
| `device_serial` | string \| null | no | Device serial if known |
| `device_name` | string \| null | no | Hostname or Mist device name if known |
| `severity` | string \| null | no | `info`, `warn`, `error` when relevant |
| `payload` | object | yes | Type-specific content |
| `masking` | object | yes | Masking metadata |
| `tags` | string[] | no | Search and grouping hints |

## Event Types

### Session lifecycle

- `session_started`
- `session_ended`
- `session_recording_enabled`
- `session_recording_disabled`

### Participant lifecycle

- `participant_joined`
- `participant_left`
- `participant_permission_changed`

### Terminal activity

- `terminal_tx`
- `terminal_rx`
- `terminal_resize`

Note:

- terminal events should represent what the operator meaningfully sees or types in the live terminal
- silent background commands should not be mislabeled as normal operator terminal traffic
- if a background action needs to be captured, prefer a `system_notice`, workflow event, or a terminal event with explicit transcript suppression metadata

### System and UI

- `system_notice`
- `ui_action`
- `error`

### Mist integration

- `mist_api_call`
- `mist_api_result`
- `mist_context_updated`

### Troubleshooting workflow

- `test_started`
- `test_result`
- `workflow_started`
- `workflow_completed`

### Config sync workflow

- `config_sync_started`
- `config_sync_preview`
- `config_sync_commit_check`
- `config_sync_committed`
- `config_sync_failed`

## Event Payload Shapes

### `session_started`

```json
{
  "entrypoint": "operator_ui",
  "client_version": "0.8.0",
  "recording_enabled": true
}
```

### `participant_joined`

```json
{
  "participant_type": "human_support",
  "participant_mode": "interactive",
  "display_name": "Support Engineer",
  "consent_source": "operator_toggle"
}
```

### `terminal_tx`

```json
{
  "channel": "serial",
  "text": "show interfaces terse\n",
  "encoding": "utf-8",
  "byte_length": 22,
  "render_in_transcript": true
}
```

Visible user-invoked commands should normally use `render_in_transcript: true`.
Silent background commands should generally use `render_in_transcript: false` and carry tags or payload metadata that make their system-generated nature explicit.

### `terminal_rx`

```json
{
  "channel": "serial",
  "text": "ge-0/0/0 up up\nge-0/0/1 down down\n",
  "encoding": "utf-8",
  "byte_length": 38,
  "render_in_transcript": true
}
```

### `system_notice`

```json
{
  "code": "REMOTE_SESSION_STARTED",
  "message": "Human support joined session",
  "render_style": "system"
}
```

### `mist_api_call`

```json
{
  "operation": "get_device_config_cmd",
  "path": "/api/v1/sites/{site_id}/devices/{device_id}/config_cmd",
  "method": "GET",
  "request_summary": "Fetch intended config",
  "render_in_transcript": false
}
```

### `test_result`

```json
{
  "test_id": "default-route",
  "test_name": "Default Gateway",
  "status": "fail",
  "detail": "No default route found",
  "remediation": "Check DHCP or static gateway configuration",
  "raw_excerpt": "inet.0: no default route",
  "render_in_transcript": true
}
```

### `config_sync_preview`

```json
{
  "source": "mist_config_cmd",
  "preview_type": "show_compare",
  "line_count": 42,
  "diff_text": "[edit system]\n+ host-name EX2300-C-12T-01\n",
  "render_in_transcript": true
}
```

### `config_sync_commit_check`

```json
{
  "status": "pass",
  "output": "configuration check succeeds",
  "render_in_transcript": true
}
```

### `config_sync_committed`

```json
{
  "status": "success",
  "commit_comment": "junos console config sync",
  "commit_reference": "0",
  "mist_config_timestamp": 1776214677,
  "render_in_transcript": true
}
```

## Transcript Rendering Rules

Not every backend event must render directly into the downloadable transcript.

### Should render by default

- `session_started`
- `session_ended`
- `participant_joined`
- `participant_left`
- `terminal_tx`
- `terminal_rx`
- `system_notice`
- `test_started`
- `test_result`
- `config_sync_preview`
- `config_sync_commit_check`
- `config_sync_committed`
- `config_sync_failed`
- meaningful `error` events

### Should not render by default

- low-level backend-only metadata
- routine `mist_api_call` events unless needed for user comprehension
- purely internal correlation tags
- silent background polling or bootstrap terminal activity that would distract from the operator narrative

## Searchable Metadata

The backend should be able to locate session logs by:

- `session_id`
- `site_id`
- `device_id`
- `device_serial`
- `timestamp`

The initial file-based implementation may encode these values in filenames or sidecar metadata.

## Storage Shape

Recommended per-session storage:

- one event file containing structured masked events
- one optional rendered transcript artifact or on-demand transcript generation

Suggested first-pass filenames:

- `2026-04-15T01-59-11Z__session-<session_id>__site-<site_id>__device-<device_serial>__events.jsonl`
- `2026-04-15T01-59-11Z__session-<session_id>__site-<site_id>__device-<device_serial>__transcript.txt`

## Versioning

Include a schema version in the stored session file header or each event batch.

Suggested starting value:

- `session_event_schema_version: 1`

## Design Notes

- keep payloads human-debuggable
- avoid over-normalizing too early
- store enough structure for future support tools
- keep transcript rendering separate from event capture
