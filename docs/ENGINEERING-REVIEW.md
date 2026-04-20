# Engineering Review And Refactor Plan

## Summary

The project already demonstrates strong product intuition and meaningful end-user value. The main issue is not lack of features; it is that the implementation has accumulated in a few oversized files without the engineering scaffolding needed to keep building confidently.

## Current Findings

### 1. UI orchestration is too concentrated

- `src/main.ts` is about 1,581 lines
- it mixes DOM wiring, workflow orchestration, Mist configuration, login handling, troubleshooting flow, config drift flow, and adoption flow

Impact:

- hard to reason about changes safely
- hard to test without a browser-shaped setup
- easy for unrelated features to couple together

### 2. Troubleshooting logic is too concentrated

- `src/services/troubleshoot.service.ts` is about 2,643 lines
- it contains step sequencing, parsing, domain decisions, and remediation generation in one place

Impact:

- difficult to test individual checks
- difficult to evolve per-check behavior without regressions
- hard to support multiple device families or troubleshooting modes later

### 3. Automated tests are still limited

- the current suite still has major gaps in parser and workflow coverage

Impact:

- parsing-heavy and stateful flows are fragile
- refactoring will feel risky
- bug fixes will be slower to validate

### 4. Security boundary is still transitional

- the current model still relies on browser-provided Mist credentials
- remote support sessions are session-ID based without authentication

Impact:

- acceptable for prototype/hackathon phases
- not acceptable as-is for broader production rollout

### 5. Backend is promising but still thin

- `server/index.mjs` combines Mist proxying and WebSocket hub in one file
- it currently acts more as an adapter than a true application backend

Impact:

- good starting point
- more server-owned policy, auth, and session logic will be needed

## Refactor Principles

- preserve working behavior while extracting seams
- refactor around workflows, not arbitrary layers
- introduce tests before or alongside major structural changes
- move sensitive logic toward the backend over time

## Recommended Target Architecture

### Frontend

Split by feature workflow:

- `app/` or `features/connection`
- `features/mist-config`
- `features/identify-switch`
- `features/troubleshoot`
- `features/config-drift`
- `features/adoption`
- `features/remote-session`

Introduce a thin application coordinator rather than keeping everything in `main.ts`.

### Troubleshooting domain

Break troubleshooting into:

- step definitions
- parsers
- remediation rules
- workflow runner

This will allow each check to be tested independently.

### Backend

Split backend responsibilities into:

- Mist client
- session service
- WebSocket handlers
- request handlers

That can happen incrementally while keeping the current runtime model.

## Prioritized Backlog

### Priority 0: Establish safety rails

1. Add a test runner and basic service-level tests.
2. Create fixtures for representative Junos command outputs.
3. Add tests for prompt detection, pagination, and a few troubleshooting parsers.

### Priority 1: Reduce the biggest bottleneck

1. Extract `main.ts` into smaller workflow modules.
2. Keep DOM lookup centralized, but move feature behavior into dedicated controllers.
3. Introduce shared state/types for current Mist context, identified device, and session state.

### Priority 2: Modularize troubleshooting

1. Split LLDP, uplink, IP, routing, DNS, and cloud checks into separate modules.
2. Move output parsing into pure helper functions.
3. Keep the current public `TroubleshootService` contract stable during extraction.

### Priority 3: Strengthen backend ownership

1. Introduce a real Mist API server module instead of a generic pass-through proxy.
2. Define a secure credential/session model.
3. Add audit-friendly remote support session controls and expiration.

## Suggested Execution Order

### Wave 1

- add test tooling
- test `CommandRunnerService`
- extract one controller from `main.ts`

### Wave 2

- carve out troubleshooting parsers and step modules
- keep behavior identical where possible
- add regression tests for migrated checks

### Wave 3

- redesign Mist credential handling
- redesign remote session trust model

## Refactor Cycle 1

The project is ready for a first bounded refactor cycle before major new feature delivery.

Primary goals:

1. add a minimal test harness
2. extract one workflow from `src/main.ts`
3. modularize one contained troubleshooting slice
4. preserve current behavior while creating reusable seams

Recommended first targets:

- `CommandRunnerService` tests
- remote session workflow extraction
- LLDP/uplink troubleshooting slice extraction

See [`docs/REFACTOR-CYCLE-1.md`](/Users/mdusty/Library/CloudStorage/OneDrive-HewlettPackardEnterprise/Documents/03%20Mist%20Docs/07%20Projects/mist-junos-console/docs/REFACTOR-CYCLE-1.md) for the concrete scope, work order, and exit criteria.

## Refactor Cycle 2

After Cycle 1, the next bounded refactor should focus on context and state seams rather than additional parser-first cleanup.

Primary goals:

1. extract Mist context workflow from `src/main.ts`
2. introduce shared Mist and device context state types
3. extract device identity workflow from `src/main.ts`
4. add focused tests around the new controller or state seam

Why this is the right next move:

- the next feature set depends on cleaner shared state
- Mist status, JMA status, config sync, and AI summary features all rely on context-heavy flows
- `main.ts` still holds too much orchestration and implicit state

See [`docs/REFACTOR-CYCLE-2.md`](/Users/mdusty/Library/CloudStorage/OneDrive-HewlettPackardEnterprise/Documents/03%20Mist%20Docs/07%20Projects/mist-junos-console/docs/REFACTOR-CYCLE-2.md) for the concrete scope, work order, and exit criteria.

## Feature Delivery Backlog

### Next feature priority

1. Sync disconnected switch to Mist intended config
2. Live switch front panel view
3. Session logging and export

### Feature 1: Sync disconnected switch to Mist intended config

This is the highest-value next feature because it directly supports recovery of disconnected switches.

Recommended implementation slices:

1. Add Mist API support for fetching full intended config payloads such as `config_cmd`.
2. Define the boundary of “Mist-managed” config so unmanaged config is preserved.
3. Build a console-side staging workflow that can load intended config safely.
4. Generate a Junos-native preview using `show | compare` where possible.
5. Require `commit check` before final commit.
6. Add guided post-commit verification using `show system commit`.
7. Correlate the latest Mist `via netconf` commit with the Mist `config_timestamp` when available.

Key risks:

- matching Mist cleanup/delete semantics accurately
- preserving unmanaged local config
- handling large intended configs over serial reliably

### Feature 2: Live switch front panel view

This feature improves troubleshooting usability and should follow the config sync work.

Recommended implementation slices:

1. Create a switch model metadata layer for physical layout definitions.
2. Normalize live switch port data into a view model.
3. Render a front panel layout that supports multiple form factors.
4. Add per-port click interactions and detail popovers.
5. Add device-level IP address presentation aligned with Mist’s mental model.

Key risks:

- accurately modeling multiple hardware layouts
- keeping the UI Mist-familiar without copying implementation details too literally
- deriving complete live port state from CLI output consistently across models

### Feature 3: Session logging and export

This feature strengthens supportability, troubleshooting continuity, and future audit and AI workflows.

Recommended implementation slices:

1. Define a session log schema that separates transcript content from event or system logging.
2. Capture terminal RX and TX plus actor attribution where applicable.
3. Capture session lifecycle, participant, Mist action, troubleshooting, and config-apply events.
4. Add secret masking for both exported and stored logs.
5. Add UI support to download the current accumulated transcript during an active session.
6. Persist backend logs with search-friendly metadata such as session ID, device, site, and timestamp.
7. Apply a 30-day retention policy to backend logs.
8. Render a single operator-facing transcript from the structured event stream rather than treating UI output as the source of truth.

Key risks:

- masking secrets reliably without corrupting useful troubleshooting context
- keeping live-session download responsive while logs continue to grow
- defining a backend log format that is simple now but extensible later

### Feature 4: Disconnect evidence collection

This feature should collect useful evidence related to a switch going offline rather than over-claiming deterministic root-cause identification.

Recommended implementation slices:

1. Reframe the mental model from “offline timeline” to “disconnect evidence” or equivalent.
2. Define an anchor model based on Mist disconnect event or `last_seen`, with explicit confidence.
3. Prioritize UTC-native `jmd.log` and `mcd.log` as primary evidence sources.
4. Add candidate rotated-log selection heuristics rather than assuming the active log is sufficient.
5. Present collected evidence with explicit source labels such as `mist_last_known`, `mist_event`, and `live_log`.
6. Treat AI/support interpretation as a first-class consumer of the collected evidence bundle.

Key risks:

- log rotation may hide relevant evidence in older files
- disconnect timing is approximate rather than definitive
- overconfident UI wording can mislead users about causality
- system `messages` timezone handling is noisier than UTC-native daemon logs

### Troubleshooting enhancement: JMA cloud connectivity state

Add a planned troubleshooting check that reads the switch-reported JMA connectivity state from:

- `show lldp local-information`

Purpose:

- surface the switch’s own interpreted cloud-connectivity state via `cc-state`, `cc-message`, and `cc-errno`
- provide a high-signal summary of where the Mist connectivity flow is failing

Recommended placement in the troubleshooting flow:

- as the first visible diagnostic check in the troubleshooting flow
- followed by lower-level checks that validate and explain the state

Recommended implementation slices:

1. Parse `cc-state`, `cc-message`, and `cc-errno` from command output.
2. Maintain a code-owned lookup table for known states such as:
   - `102 NoIPAddress`
   - `103 NoDefaultGateway`
   - `104 DefaultGatewayUnreachable`
   - `105 NoDNS`
   - `106 DNSLookupFailed`
   - `108 CloudUnreachable`
   - `109 CloudAuthFailure`
   - `111 Connected`
3. Map states into product statuses such as `pass`, `warn`, `fail`, or `info`.
4. Use the parsed state as a structured signal in both operator-facing troubleshooting and future AI-assisted diagnosis.

Why it matters:

- it provides a switch-native connectivity assessment rather than relying only on inferred checks
- it is a compact, high-value signal for both operators and AI agents
- it pairs naturally with Mist last-known connected state as a live status monitor

Key risk:

- the implementation should not depend on the explanatory state-reference text always being present in command output; the numeric state mapping should live in code

See [`docs/JMA-CONNECTIVITY-STATE.md`](/Users/mdusty/Library/CloudStorage/OneDrive-HewlettPackardEnterprise/Documents/03%20Mist%20Docs/07%20Projects/mist-junos-console/docs/JMA-CONNECTIVITY-STATE.md) for the proposed state mapping, related checks, remediation guidance, and mismatch handling model.

### Status monitor refinement

The UI should show two related but distinct status indicators:

1. Mist device connected state
2. switch-reported JMA connectivity state

Recommended behavior:

- keep both visible in the UI while a session is active
- refresh both periodically using lightweight polling
- show the last refresh time
- pause or defer polling during heavy workflows if needed

Why it matters:

- the difference between Mist last-known state and current switch-reported state is often diagnostically valuable
- this gives operators and AI agents a live recovery signal without rerunning the full troubleshooting suite

## Exit Criteria For Refactor Phase

The refactor phase can be considered successful when:

- `main.ts` is reduced to app bootstrap and high-level composition
- troubleshooting checks are modular and individually testable
- a baseline automated test suite exists
- the backend clearly owns sensitive integration concerns
