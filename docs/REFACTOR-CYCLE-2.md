# Refactor Cycle 2

## Goal

Create cleaner state and workflow seams for the next product phase without turning the app into a broad rewrite.

This cycle should prepare the codebase for:

- visible Mist status and JMA status monitoring
- config sync implementation
- richer device context UI
- session and AI summary flows

## Scope

### In scope

- extract Mist context workflow from `src/main.ts`
- introduce shared state types for Mist context and identified device context
- extract device identity and related state transitions from `src/main.ts`
- add focused tests for the extracted controller or state logic

### Out of scope

- full config sync implementation
- full status polling implementation
- full session logging implementation
- broad redesign of the troubleshooting service
- broad UI rewrite

## Why Now

Cycle 1 created safer test seams around command parsing, LLDP parsing, and remote session control.

The next feature set now depends more on clean shared state and controller boundaries than on additional parser extraction alone.

## Success Criteria

Refactor Cycle 2 is successful if:

1. Mist context logic is no longer mostly embedded in `src/main.ts`
2. identified device state has a clearer shared shape
3. at least one extracted controller or state module has focused tests
4. `src/main.ts` becomes more composition-oriented again
5. current user-visible behavior remains intact

## Recommended Work Order

### Step 1: Introduce shared state types

Target:

- define state shapes that future controllers can share instead of holding ad hoc local state in `main.ts`

Recommended types:

- `MistContextState`
- `DeviceContextState`
- optional `CloudStatusState`

Suggested fields:

`MistContextState`

- selected cloud
- auth/session readiness
- org ID
- site ID
- site name
- site list load state

`DeviceContextState`

- Mist device match result
- device ID
- site ID
- serial
- hostname
- connected or last-known state

Deliverable:

- a small shared state/types module

### Step 2: Extract Mist context workflow

Target:

- move Mist setup and selection behavior out of `main.ts`

Likely responsibilities:

- load accessible sites for selected org
- open, close, save, and validate Mist settings UI state
- update Mist API status text
- own current Mist context state transitions

Possible target module:

- `src/controllers/mist-context.controller.ts`

Deliverable:

- `main.ts` delegates Mist workflow behavior to a controller

### Step 3: Extract device identity workflow

Target:

- move switch identification and resulting device-state updates out of `main.ts`

Likely responsibilities:

- run identify workflow
- store current identified device context
- update downstream feature enablement based on identification success
- provide a seam for future status monitor and config sync features

Possible target module:

- `src/controllers/device-context.controller.ts`

Deliverable:

- identified device state is no longer primarily implicit in `main.ts`

### Step 4: Add focused tests

Target:

- test extracted controller or state behavior without depending on the DOM where possible

Good candidates:

- Mist context state transitions
- site-loading workflow
- device identification success/failure state updates

Deliverable:

- baseline tests around the new controller/state seam

## Proposed File-Level Direction

Possible first-pass structure:

- `src/controllers/mist-context.controller.ts`
- `src/controllers/device-context.controller.ts`
- `src/types/mist-context.types.ts`
- `src/types/device-context.types.ts`

This should establish a repeatable pattern for later extractions such as status monitoring and config sync.

## Verification

At the end of the cycle, verify:

- `npm test` passes
- `npm run build` passes
- Mist site loading still works
- switch identification still works
- downstream UI enablement still behaves correctly

## Exit Decision

Move into the next feature implementation phase only if:

- Mist context and device context are easier to reason about than before
- the new state shapes look stable enough to reuse
- `main.ts` is materially simpler and less state-heavy

If those conditions are met, the next likely feature seam is a lightweight live status monitor for Mist state plus JMA connectivity state.
