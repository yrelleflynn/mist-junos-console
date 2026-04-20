# Mist API Integration

## Purpose

Describe how the product should use Mist APIs to provide session context, intended configuration, and last-known device status without confusing Mist data with live console state.

## Design Principles

- Mist API access should remain backend-owned
- the browser should consume product-oriented backend responses rather than raw API access where possible
- device-specific Mist data should generally be fetched after the switch is identified
- Mist data should be presented as intended state or last-known state, not as guaranteed live state

## API Usage Model

The Mist APIs used by this tool fit into three categories:

1. session context
2. device intent
3. device status and history

## 1. Session Context APIs

These APIs establish where the operator is working.

### `GET /api/v1/self`

Purpose:

- validate that the current auth context works
- determine which orgs the current auth context can access
- bootstrap org selection

Product usage:

- populate the org selector
- support future auto-scoping when launched from Mist

Notes:

- the UI should expose only the org choices and any needed summary information
- raw response details should not be treated as a user-facing feature

### `GET /api/v1/orgs/{org_id}/sites`

Purpose:

- list sites in the selected org
- scope later device lookups and context retrieval

Product usage:

- populate the site selector
- establish site context before device-specific actions
- support future optional target-switch selection within the chosen site

## 2. Device Intent API

These APIs describe what Mist expects the switch configuration to be.

### `GET /api/v1/sites/{site_id}/devices/{device_id}/config_cmd`

Purpose:

- retrieve the intended Junos `set` commands for the device

Product usage:

- config sync preview and apply workflow
- config intent reference during troubleshooting
- possible future config drift comparison input

Notes:

- this endpoint is central to the “console bridge” concept
- it should usually be called only after the switch is identified and matched to a Mist device
- the current known sync model is to prepend the known Mist-managed cleanup delete commands before applying the retrieved `set` commands
- config drift should consume the returned `cli` lines directly when available rather than attempting to reconstruct intent from partial derived fields

## 3. Device Status And History APIs

These APIs describe what Mist last observed about the device.

### `GET /api/v1/sites/{site_id}/stats/devices/{device_id}`

Purpose:

- retrieve key device stats such as:
  - last config time
  - last connected time
  - last known IP or addressing data
  - current or last-known connected state

Product usage:

- device context panel
- offline switch troubleshooting context
- alignment with commit history and config timestamp checks

Notes:

- this data should be labeled as last-known or Mist-observed state where appropriate
- it should not be confused with live console-derived state

### `GET /api/v1/sites/{site_id}/devices/events/search`

Purpose:

- retrieve recent device events

Product usage:

- disconnect evidence collection
- event history context during troubleshooting
- support review and historical correlation

Notes:

- this endpoint is especially valuable when a device is currently offline but Mist has recorded recent transition events

## Recommended Product Flow

### Before device identification

Use only session context APIs:

1. `GET /api/v1/self`
2. `GET /api/v1/orgs/{org_id}/sites`

Why:

- keeps the initial flow lightweight
- avoids unnecessary device-specific fetches before the switch is known

### After device identification

Use device-specific APIs:

1. `GET /api/v1/sites/{site_id}/devices/{device_id}/config_cmd`
2. `GET /api/v1/sites/{site_id}/stats/devices/{device_id}`
3. `GET /api/v1/sites/{site_id}/devices/events/search`

Why:

- the tool can now fetch the specific Mist context that matters for the identified switch
- this aligns API usage with the operator’s troubleshooting progression

## Backend Service Abstraction

Over time, the frontend should depend on product-oriented backend methods rather than generic raw Mist proxy calls.

Suggested service methods:

- `getAccessibleOrgs()`
- `getSitesForOrg(orgId)`
- `getDeviceIntent(siteId, deviceId)`
- `getDeviceStats(siteId, deviceId)`
- `getRecentDeviceEvents(siteId, deviceId)`

Benefits:

- cleaner frontend contracts
- easier auth and retry handling
- better compatibility with future Mist-native deployment
- easier caching and audit behavior in the backend

## Data Interpretation Rules

### Mist intent vs live state

- `config_cmd` represents intended state
- console command output represents live device state
- differences between the two are often the useful troubleshooting surface

### Config drift comparison behavior

The current drift comparison should normalize Mist intent and live Junos output before comparing them.

Current rules:

- fetch intent from `config_cmd`
- fetch live config with `show configuration | display inheritance | display set`
- ignore Mist helper `delete ...` lines and comment lines
- expand array-style Mist `set` commands into explicit per-line commands
- expand Mist `groups`, `apply-groups`, and `interface-range` intent into explicit inherited switch lines where possible
- deduplicate canonical lines before comparison
- keep the effective last value when the Mist payload repeats scalar assignments

This keeps the drift output focused on meaningful intent gaps rather than representation differences between Mist group-based intent and inherited Junos output.

### Mist config sync behavior

The current known Mist sync pattern for this use case is:

1. fetch `config_cmd`
2. prepend the known Mist-managed cleanup delete commands
3. stage the resulting candidate config on the switch
4. inspect the Junos diff via `show | compare`
5. run `commit check`
6. commit after explicit approval

This allows the tool to mirror Mist’s cleanup-and-reapply behavior more closely than a simple append-only `set` workflow.

### Mist last-known state vs live state

- stats and events represent what Mist last observed
- the console session represents current device reality
- the UI should make that distinction explicit

## Current vs Target Auth Context

### Current model

- the tool is a separate frontend and backend
- the backend needs an explicit way to call Mist APIs
- a user being logged into the Mist UI does not automatically grant this backend Mist API access

### Target model

- the tool is launched from or hosted by Mist
- the user should not manually enter API credentials
- trusted auth and context handoff should replace manual token entry
- backend-owned Mist API access remains the preferred architecture

## Risks And Considerations

- stale Mist stats may not reflect current device state
- events may be incomplete or delayed for offline devices
- config intent may be available even when status data is old
- the backend should avoid overfetching device-specific data before identification
- the UI should explicitly distinguish:
  - live console-derived state
  - Mist intended state
  - Mist last-known state

## Summary

Mist API usage in this product should be intentional and layered:

- session context first
- device intent after identification
- last-known status and history after identification

This keeps the product understandable, keeps the backend in control of Mist integration, and aligns well with both the current standalone architecture and the long-term Mist-hosted target state.

## Related Documents

- [`docs/ui/LIVE-SESSION-HEADER.md`](/Users/mdusty/Library/CloudStorage/OneDrive-HewlettPackardEnterprise/Documents/03%20Mist%20Docs/07%20Projects/mist-junos-console/docs/ui/LIVE-SESSION-HEADER.md)
- [`docs/ui/config-sync/NOTES.md`](/Users/mdusty/Library/CloudStorage/OneDrive-HewlettPackardEnterprise/Documents/03%20Mist%20Docs/07%20Projects/mist-junos-console/docs/ui/config-sync/NOTES.md)
