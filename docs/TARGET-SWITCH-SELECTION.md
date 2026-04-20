# Target Switch Selection

## Status

Backlog item. Not required for the current hackathon demo.

## Problem

The Mist modal currently stops at:

- cloud
- org
- site

That is enough to load site context and fetch the site-level root password, but it
still leaves ambiguity when multiple switches exist at the selected site.

This affects:

- preselecting the exact switch the operator intends to work on
- verifying that the live console session matches the intended Mist target
- making timeline, config sync, and device-specific status/history workflows feel
  more deliberate
- explaining the root-password behavior clearly

## Root Password Scope

Mist appears to expose root password in two places:

- site-level settings:
  - `GET /api/v1/sites/{site_id}/setting`
  - `switch_mgmt.root_password`
- device-level settings:
  - `GET /api/v1/sites/{site_id}/devices/{device_id}`
  - `switch_mgmt.root_password`

That means target switch selection can improve both:

- target scoping
- password specificity

The product should prefer the most specific password available.

## Goal

Extend the Mist modal so the operator can optionally select a specific switch at
the chosen site before interacting with the live console workflow.

## Proposed UX

Add a new optional field below `Site`:

- `Target Switch (optional)`

Behavior:

1. Operator selects cloud, org, and site.
2. App loads switches for the selected site.
3. App populates a dropdown with site switches.
4. Operator may select a target switch before saving.

Recommended switch label format:

- hostname if present
- model
- serial
- maybe MAC or device name if hostname is missing

Example:

- `EX2300-C-12T-01 · EX2300-C-12T · HW0217390180`

## Product Behavior

When a target switch is selected:

- store it as the intended Mist target for the session
- show that target in the UI before or alongside live identity details
- compare it to the identified console switch once identification succeeds

Possible states:

- no target selected
- target selected, not yet validated against console
- target matches identified console switch
- target does not match identified console switch

## Why This Helps

This improves:

- operator confidence
- multi-switch site workflows
- remote-support handoff clarity
- config sync safety
- timeline/status queries against the intended device
- root password retrieval from the specific matched/selected switch when available

## Root Password Semantics

The UI should be explicit about which password source was used.

Suggested wording:

- `Device Root Password`
- `Site Root Password`
- `Uses the root password configured for the matched Mist switch.`
- `Falling back to the Mist site root password.`

Suggested precedence:

1. matched or selected device `switch_mgmt.root_password`
2. site `switch_mgmt.root_password`
3. manual/operator entry

## Suggested Flow Changes

### Mist modal

Current:

- cloud
- org
- site

Proposed:

- cloud
- org
- site
- target switch (optional)

### Device workflow

If a target switch is selected:

- `Login to Switch` should prefer the selected or matched device root password
- if device root password is absent, fall back to the site root password
- `Identify Switch` should compare the live console identity against the selected target
- `Config Sync`, timeline, and Mist status/history should prefer the selected target when appropriate

If no target switch is selected:

- current behavior remains

## Validation UX

After identification, show one of:

- `Matched selected Mist target`
- `Console switch does not match selected Mist target`
- `No target switch selected`

If there is a mismatch:

- config sync should probably be blocked or require an explicit override
- timeline and device-specific history should warn that the selected Mist target
  does not match the live console identity

## API Notes

Likely endpoint additions:

- list site devices/switches for the selected site
- fetch selected device details when a target switch is chosen

Likely password sources:

- `GET /api/v1/sites/{site_id}/devices/{device_id}`
- fallback: `GET /api/v1/sites/{site_id}/setting`

## Data Model

Likely new Mist context state:

- `targetSwitchId`
- `targetSwitchName`
- `targetSwitchSerial`
- `targetSwitchMac`
- `targetSwitchSiteId`

- `targetSwitchDevicePasswordAvailable`
- `targetSwitchPasswordSource`

Likely new backend/frontend API usage:

- list switches/devices for the selected site
- fetch selected device details for device-level root password and context
- probably filter to switch models/types only

## Acceptance Criteria

1. Mist modal supports optional target switch selection after site selection.
2. Switch list is scoped to the selected site.
3. Selected target persists for the current session.
4. After live identification, the app shows whether the console switch matches the selected target.
5. Root password language clearly stays site-level.
6. Device-specific workflows can prefer the selected target when safe.
7. Mismatch states are visible and do not silently continue as if the target matched.

## Deferred

- per-switch credentials, if Mist ever exposes them
- automatic preselection from launch context deep links
- support-side target selection
- agent-assisted target disambiguation

## Recommended Priority

Medium.

Useful after the hackathon because it improves clarity and safety, but it is not
as urgent as core workflow stability.
