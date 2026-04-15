# Config Sync Design Notes

## Feature

Name: Sync Disconnected Switch To Mist Intended Config

PRD reference:

- [`docs/PRD.md`](/Users/mdusty/Library/CloudStorage/OneDrive-HewlettPackardEnterprise/Documents/03%20Mist%20Docs/07%20Projects/mist-junos-console/docs/PRD.md)

## Initial Design Goal

Design a safe, Mist-aligned workflow that lets an operator:

1. fetch the full intended config from Mist
2. preview the resulting Junos diff
3. run `commit check`
4. explicitly confirm final apply
5. understand rollback guidance after commit

## Suggested First Stitch Scope

Start with one end-to-end flow, not every possible screen variation:

1. entry point from the current console tool
2. preview screen or panel showing:
   - intended config source
   - Junos-style diff
   - warnings or prerequisites
3. `commit check` result state
4. final confirmation step
5. success state with post-commit guidance
6. failure state with clear next actions

## UX Priorities

- operator confidence over speed
- clear separation between preview, validation, and apply
- visible trust and risk messaging
- Junos-native terminology where helpful

## Open Design Questions

- Should the diff appear inline, in a drawer, or in a modal?
- How much of the raw diff should be visible before scrolling or expansion?
- How should we present the most recent Mist `via netconf` commit and `config_timestamp`?
- What is the clearest way to show rollback guidance without overwhelming the operator?
