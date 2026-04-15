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

### 3. No automated tests

- no test files were found in `src/` or `server/`

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

## Feature Delivery Backlog

### Next feature priority

1. Sync disconnected switch to Mist intended config
2. Live switch front panel view

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

## Exit Criteria For Refactor Phase

The refactor phase can be considered successful when:

- `main.ts` is reduced to app bootstrap and high-level composition
- troubleshooting checks are modular and individually testable
- a baseline automated test suite exists
- the backend clearly owns sensitive integration concerns
