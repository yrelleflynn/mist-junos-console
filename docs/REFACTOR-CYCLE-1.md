# Refactor Cycle 1

## Goal

Create safer seams for future feature work without attempting a full rewrite.

This cycle should reduce risk in the current codebase and prepare the project for:

- config sync implementation
- session logging implementation
- richer UI workflows

## Scope

This cycle is intentionally limited.

### In scope

- add a minimal automated test harness
- introduce the first tests around stable service-level logic
- extract one workflow-focused controller or module from `src/main.ts`
- modularize one contained slice of troubleshooting logic
- preserve current user-visible behavior as much as possible

### Out of scope

- broad UI redesign
- complete rewrite of `main.ts`
- complete rewrite of `troubleshoot.service.ts`
- backend auth redesign
- full session logging implementation
- full config sync implementation

## Why Now

The project now has enough product clarity and architectural direction to refactor deliberately. Waiting longer will make upcoming features more expensive to implement and harder to validate safely.

## Success Criteria

Refactor Cycle 1 is successful if:

1. a test runner exists and can run at least a small baseline suite
2. at least one meaningful service seam has tests
3. one workflow is extracted out of `src/main.ts`
4. one troubleshooting slice is moved toward modular structure
5. existing primary flows still build and behave as expected

## Recommended Work Order

### Step 1: Add the minimum viable test harness

Target:

- choose a lightweight TypeScript-friendly test runner
- add test scripts to `package.json`
- prove tests can run locally in this repo

Recommended first test targets:

- `CommandRunnerService` prompt detection and pagination handling
- pure parsing helpers extracted from troubleshooting logic

Deliverable:

- baseline test setup committed and runnable

### Step 2: Create fixtures for repeatable logic

Target:

- add representative Junos CLI output fixtures
- use them to test parsing and workflow behavior without a browser or serial device

Candidate fixture areas:

- prompt and login behavior
- LLDP output
- interface state output
- route and DNS output

Deliverable:

- fixture files or inline fixtures used by tests

### Step 3: Extract one workflow from `src/main.ts`

Target:

- move one cohesive workflow into a dedicated controller or module

Recommended candidate:

- remote session workflow

Why:

- it already has clearer boundaries than some other areas
- it touches UI, serial mirroring, and session state in a contained way
- it supports future human support and AI agent evolution

Alternative candidates:

- Mist configuration workflow
- config sync or adoption workflow if it becomes more active soon

Deliverable:

- `src/main.ts` becomes smaller and more composition-oriented

### Step 4: Modularize one troubleshooting slice

Target:

- extract a contained part of troubleshooting into smaller helpers or step modules while preserving the external service contract

Recommended candidate:

- LLDP and uplink detection slice

Why:

- it is domain-important
- it has relatively clear inputs and outputs
- it is a good first candidate for step extraction and parser isolation

Deliverable:

- one troubleshooting slice moved into smaller units
- regression tests added where practical

### Step 5: Add lightweight shared state types

Target:

- define a few shared state shapes instead of passing ad hoc state implicitly

Recommended types:

- Mist context
- identified device context
- session state

Deliverable:

- clearer contracts between controllers and services

## Proposed File-Level Direction

Possible first-pass structure:

- `src/controllers/remote-session.controller.ts`
- `src/types/session.types.ts`
- `src/services/troubleshoot/`
- `src/services/troubleshoot/parsers/`
- `src/services/troubleshoot/steps/`
- `tests/` or `src/**/*.test.ts`

This does not need to be completed in one pass. The main goal is to establish the pattern.

## Verification

At the end of the cycle, verify:

- `npm run build` still succeeds
- the new tests pass
- remote session behavior still works
- migrated troubleshooting behavior still matches current expectations

## Exit Decision

Only move into major feature delivery after this cycle if:

- the new seams feel usable
- the extracted pattern looks repeatable
- the test harness is actually helping, not just present

If those conditions are met, the next logical feature is config sync.
