# Refactor Cycle 3

## Goal

Reduce orchestration and state concentration in `src/main.ts` without attempting a broad rewrite during the hackathon window.

This cycle is explicitly a **post-hackathon maintainability plan**. It is based on the current shape of the codebase after:

- config sync delivery
- JMA-guided troubleshooting delivery
- cloud status and device identity integration
- remote session and MCP groundwork

The core intent is to make future changes safer by separating:

- feature orchestration
- shared state
- DOM rendering
- console task ownership

## Why This Is the Right Next Refactor

The project has reached the point where `src/main.ts` is acting as:

- composition root
- shared state container
- workflow coordinator
- event hub
- rendering adapter
- concurrency gate

That is workable for a fast-moving hackathon build, but it is now the main source of:

- change friction
- hidden coupling
- concurrency edge cases
- harder testing

The goal of this cycle is **not** to redesign the whole app. The goal is to extract the next repeatable seams while preserving current behavior.

## Scope

### In scope

- extract one or two high-value feature workflows out of `src/main.ts`
- introduce a small shared app-state model for cross-feature flags
- create a clearer console task ownership primitive
- reduce the number of manually coordinated `*InFlight` and pause/resume rules spread across `main.ts`
- keep the existing service layer largely intact

### Out of scope

- framework migration
- full state-management rewrite
- broad store/reducer architecture across the whole app
- redesign of the UI layout
- broad rewrite of `TroubleshootService`
- broad rewrite of config sync or adoption services

## Planning Principle

This cycle should be treated as **structured backlog work**, not as an immediate pre-demo refactor.

### Do before or during demo hardening only if needed

- small workflow guards that reduce live-console collisions
- small enable/disable fixes for console task overlap
- minimal ownership helpers if they directly reduce demo risk

### Do after the hackathon

- controller extraction
- state seam cleanup
- console task ownership / lock manager
- main composition cleanup

## Main Diagnosis

The most important architectural issue now is not just file size. It is that console ownership and workflow state are distributed across local closure state in `src/main.ts`.

Examples of the current shape:

- many cross-cutting flags such as:
  - `identifyInFlight`
  - `localIdentifyInFlight`
  - `cloudStatusRefreshInFlight`
  - `loggedInBootstrapPromise`
  - `lastUserConsoleInputAt`
- many workflow functions that:
  - read DOM
  - manage async state
  - write terminal output
  - update results panels
  - toggle button state
- multiple independent places trying to decide whether the console is “safe” for background work

The single most valuable architectural primitive missing today is:

- **console task ownership / lock management**

That should be the anchor for this cycle.

## Success Criteria

Refactor Cycle 3 is successful if:

1. `src/main.ts` becomes materially more composition-oriented
2. at least one high-value feature workflow is extracted into a dedicated controller/module
3. cross-feature busy/ownership state is no longer mostly implicit closure state
4. console task arbitration is clearer than ad hoc `if` guards and timing checks
5. existing product behavior remains unchanged from an operator perspective

## Recommended Work Order

### Step 1: Introduce a minimal shared app state

Target:

- define only the small set of cross-feature state that multiple workflows already depend on

Recommended first fields:

- `serial.connected`
- `serial.busy`
- `workflow.active`
- `configSync.staged`
- `device.matchResult`
- `mist.configured`
- `console.backgroundWorkAllowed`

Why:

- this removes some of the least explicit closure-state dependencies without forcing a full store architecture
- it makes later controller extraction simpler

Deliverable:

- a small shared state/types module
- enough structure to reduce manual flag scattering

### Step 2: Introduce console task ownership / lock management

Target:

- centralize who is allowed to use the console at any given moment

Recommended responsibilities:

- distinguish:
  - user-driven tasks
  - background tasks
  - long-running workflows
- prevent concurrent background task overlap
- make it obvious when:
  - identify
  - cloud refresh
  - troubleshoot checks
  - config sync
  are allowed to run

Why:

- this is the highest-value refactor item because it directly addresses the kinds of edge cases already seen in live testing
- it improves both correctness and UX

Possible target module:

- `src/app/runtime/console-task-gate.ts`
- or `src/app/runtime/serial-runtime.ts`

Deliverable:

- a small console lock/ownership primitive used by new extractions

### Step 3: Extract the Troubleshoot feature workflow

Target:

- move the troubleshoot-related orchestration out of `src/main.ts`

Recommended responsibilities to extract:

- `runTroubleshoot()`
- `runRecommendedChecksFromJma()`
- `runMistStatus()`
- `runSslCheck()`
- check results rendering coordination
- check modal coordination

Why:

- troubleshooting is now one of the heaviest interactive workflows
- it mixes results rendering, terminal output, button state, and service orchestration
- it is a strong candidate for controller + view separation without rewriting the service layer

Possible target structure:

- `src/features/troubleshoot/troubleshoot.controller.ts`
- `src/features/troubleshoot/troubleshoot.view.ts`
- `src/features/troubleshoot/check-modal.view.ts`

Deliverable:

- a dedicated feature controller
- `main.ts` only wires events to controller methods

### Step 4: Extract the Adoption workflow

Target:

- move the adoption flow and adoption-specific UI rendering out of `src/main.ts`

Why:

- adoption is a self-contained, high-impact workflow
- it includes fetch/apply/commit behavior and is easier to reason about when separated
- it will benefit from the same console ownership rules as troubleshoot and config sync

Possible target structure:

- `src/features/adoption/adoption.controller.ts`
- `src/features/adoption/adoption.view.ts`

Deliverable:

- adoption orchestration no longer lives mainly in `src/main.ts`

### Step 5: Extract connection/session workflow

Target:

- move connect/disconnect, serial event handling, and remote-session orchestration into a dedicated feature

Why:

- connection state is another cross-cutting concern
- this extraction becomes safer once console ownership rules exist

Possible target structure:

- `src/features/connection/connection.controller.ts`
- `src/features/connection/connection.view.ts`

Deliverable:

- clearer connection lifecycle and fewer direct serial-related side effects in `main.ts`

## What Not To Do In This Cycle

Do not:

- rewrite the whole app around a new framework
- build a large Redux-like store just because state exists
- pause feature delivery for a purely aesthetic refactor
- move logic into controllers if they still directly own HTML construction
- attempt to solve every `main.ts` concern in one pass

This cycle should remain incremental and behavior-preserving.

## Proposed File-Level Direction

Suggested target structure:

- `src/app/bootstrap.ts`
- `src/app/state/app-state.ts`
- `src/app/state/app-store.ts`
- `src/app/runtime/console-task-gate.ts`
- `src/dom/ui-refs.ts`
- `src/dom/formatters.ts`
- `src/features/troubleshoot/`
- `src/features/adoption/`
- `src/features/connection/`

This should be adopted gradually. It is a direction, not an all-at-once migration requirement.

## Priority Order

### Highest value

1. console task ownership / lock management
2. troubleshoot workflow extraction

### Medium value

3. adoption workflow extraction
4. minimal shared app-state module
5. baseline-only troubleshooting polish

### Lower value

6. connection/session extraction
7. broader `main.ts` composition cleanup

## Focused Backlog Item: Baseline-Only Troubleshooting Polish

### Problem

The checks catalog now supports three useful modes:

- JMA-driven recommended checks
- individual catalog checks
- full baseline workflow

That is the right product shape, but the **full baseline** path still does not map perfectly into the catalog UI.

Current issues:

- some baseline-only or workflow-generated results are clearer in the terminal than in the checks pane
- skip and prerequisite results do not always read naturally in the catalog
- the catalog summary model is optimized for individually-invoked checks, not for a broader ordered baseline run
- operators may not always understand what the baseline found versus what was skipped for dependency reasons

### Goal

Polish the checks-pane representation of the full baseline workflow so it feels as coherent as:

- recommended JMA subsets
- individually run checks

without removing the catalog model.

### Desired outcomes

- baseline-only results land on meaningful catalog rows wherever possible
- prerequisite-driven skips read clearly in the UI
- operators can tell the difference between:
  - not run
  - skipped due to dependency failure
  - passed
  - failed
- the checks pane communicates the broader “baseline snapshot” meaning more clearly

### Candidate improvements

- improve mapping of workflow-generated result IDs into catalog rows
- improve skip/result wording for baseline-specific prerequisite failures
- add a small baseline run summary or banner in the checks pane
- visually distinguish baseline-generated skips from manual omissions
- review whether some baseline-only evidence should appear in an aggregate summary area rather than only per-row

### Priority

Post-hackathon, medium priority.

This is not a blocker for the current product direction, but it is worth doing once the catalog and full-baseline split settles.

## Suggested Milestones

### Milestone A: Demo-safe hardening

Small changes only if needed before or immediately after the hackathon:

- better console busy gating
- clearer ownership checks for background tasks
- no structural extraction unless it directly reduces operator-visible risk

### Milestone B: Post-hackathon extraction start

First real refactor pass:

- introduce minimal app state
- add console task gate
- extract troubleshoot workflow

### Milestone C: Second cleanup pass

- extract adoption
- extract connection/session behavior
- further reduce `src/main.ts`

## Verification

At the end of each increment, verify:

- `npm run build` passes
- `npm test` passes
- troubleshoot still behaves the same
- config sync still behaves the same
- connection/login behavior is not regressed
- no new console task overlap is introduced

## Exit Decision

This cycle is complete enough when:

- console ownership is easier to reason about
- the biggest workflow logic is no longer concentrated in `src/main.ts`
- new features no longer require editing the same dense orchestration block for every change

If those conditions are met, the next architectural step should be:

- targeted extraction of remaining feature workflows
- not another broad redesign wave
