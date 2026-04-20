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

## Current Drift Logic Notes

The current config-drift comparison is intentionally closer to a “major intent drift” check than a byte-for-byte textual diff.

### Current sources

- Mist intent source: `GET /api/v1/sites/{site_id}/devices/{device_id}/config_cmd`
- live switch source: `show configuration | display inheritance | display set`

### Current normalization rules

- prefer `config_cmd.cli` when available
- ignore Mist helper comment lines beginning with `#`
- ignore Mist sync helper `delete ...` lines during drift comparison
- expand bracket arrays such as `[ guest home-trusted ]` into per-line `set` commands
- expand bracketed interface members such as `ge-0/0/[10-11]`
- expand Mist `groups` plus `apply-groups` plus `interface-range` intent into explicit inherited switch lines
- expand relevant interface-range usage in `protocols rstp` and `protocols dot1x`
- compare unique canonical lines rather than raw duplicated lines
- when the Mist payload repeats scalar assignments, keep the effective last value

### Intended interpretation

The drift view is meant to highlight meaningful gaps between Mist intent and running config, not every representational difference between:

- grouped Mist intent
- inherited Junos output
- helper cleanup commands used during config sync

### Known residual behavior

A small number of Mist-intended commands may still appear as Mist-only drift if the switch does not accept or realize them on-box even though they appear in `config_cmd`.

That is currently acceptable behavior and should be treated as noteworthy drift rather than automatically hidden.

## Open Design Questions

- Should the diff appear inline, in a drawer, or in a modal?
- How much of the raw diff should be visible before scrolling or expansion?
- How should we present the most recent Mist `via netconf` commit and `config_timestamp`?
- What is the clearest way to show rollback guidance without overwhelming the operator?
