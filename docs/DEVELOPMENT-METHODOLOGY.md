# Development Methodology

## Purpose

This project already has meaningful product value. The goal of this methodology is not to slow development down, but to replace ad hoc changes with a lightweight loop that keeps product intent, code quality, and momentum aligned.

## Source Of Truth

Use these documents together:

- [`docs/PRD.md`](/Users/mdusty/Library/CloudStorage/OneDrive-HewlettPackardEnterprise/Documents/03%20Mist%20Docs/07%20Projects/mist-junos-console/docs/PRD.md) for product scope and goals
- [`docs/ENGINEERING-REVIEW.md`](/Users/mdusty/Library/CloudStorage/OneDrive-HewlettPackardEnterprise/Documents/03%20Mist%20Docs/07%20Projects/mist-junos-console/docs/ENGINEERING-REVIEW.md) for technical findings and refactor priorities
- `README.md` for setup, architecture overview, and reviewer context

## Recommended Workflow

### 1. Define before building

Every meaningful change should start with a short work item that states:

- user problem
- why now
- scope in and scope out
- acceptance criteria
- dependencies or risks

For very small changes, this can be a short issue or note. For larger work, update the PRD or create an ADR.

### 2. Build in vertical slices

Prefer slices that cut through product behavior end to end, for example:

- improve device identification accuracy
- make support sessions safer
- modularize one troubleshooting phase with tests

Avoid broad refactors with unclear user value unless they directly unblock delivery or reduce clear risk.

### 3. Refactor with a named target

Before refactoring, answer:

- what problem does this refactor solve
- what files/modules are in scope
- what will be measurably better afterward

Example: "Extract troubleshooting step registry from `troubleshoot.service.ts` so LLDP and IP checks are independently testable."

### 4. Require a Definition of Ready

Work is ready when:

- the user problem is clear
- acceptance criteria are written
- affected modules are identified
- risks are understood

### 5. Require a Definition of Done

Work is done when:

- acceptance criteria are met
- code paths are verified manually or automatically
- docs are updated if behavior or architecture changed
- follow-up debt is captured explicitly instead of left implicit

## PR Structure

Each PR should answer five questions:

1. What user or engineering problem does this solve?
2. What changed?
3. How was it verified?
4. What risks remain?
5. What follow-up work is intentionally deferred?

## Decision Records

Create a short ADR when a change affects architecture, trust boundaries, or long-term maintenance. Good ADR topics for this repo include:

- backend-owned Mist auth model
- remote support authorization model
- app state management approach
- troubleshooting step plugin/module structure

## Testing Strategy

Adopt tests in this order:

1. Pure parsing and transformation logic
2. Service-level workflow logic with mocked serial and Mist APIs
3. High-value UI/controller integration flows

Do not wait for perfect test infrastructure before adding the first tests. Start where the logic is already most deterministic.

## Backlog Structure

Keep one prioritized backlog with three lanes:

- product features
- refactors and maintainability
- security and production readiness

Each item should include a size estimate and a clear owner or status.

## Recommended Cadence

### Before starting work

- confirm the problem and acceptance criteria
- check whether the PRD or engineering review needs updating

### During implementation

- keep changes scoped
- prefer one refactor axis at a time
- add or extend verification while the context is fresh

### Before merging

- review against acceptance criteria, not just code style
- note remaining risks and next steps

### After merging

- update backlog priorities
- capture any newly discovered architectural debt

## Immediate Next Cycle

For this project, the most productive next cycle is:

1. adopt this docs set as working source of truth
2. stand up a minimal test harness
3. extract the first chunk of `main.ts` into feature controllers or workflows
4. split the first troubleshooting phase into smaller modules
5. only then continue net-new features unless a user-critical gap appears
