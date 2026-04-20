# Feature Design Template

## Purpose

Use this template before or alongside Stitch work for a UI-heavy feature. It keeps the design effort anchored to the PRD and gives implementation a clean handoff path.

## Feature

Name:

PRD reference:

Priority:

Owner:

## User Problem

What user problem are we solving?

## User Story

As a ...
I want ...
So that ...

## Scope

### In scope

- 

### Out of scope

- 

## Key States

- empty state
- loading state
- success state
- warning state
- error state

Add feature-specific states here:

- 

## Data Needed

- 

## Interaction Notes

- primary user actions
- navigation or modal behavior
- confirmations or dangerous actions
- support or AI participant indicators if relevant

## Stitch Prompt Notes

Describe the design intent you want Stitch to explore.

Examples:

- “Design a Mist-aligned front panel view for a Juniper switch with clickable ports and a side detail panel.”
- “Design a safe config sync preview flow with diff review, commit check result, and explicit apply confirmation.”

## Design Review Checklist

- Does the design satisfy the PRD user story?
- Are loading, empty, warning, and error states visible?
- Are risky actions clearly gated?
- Does the design imply any backend behavior we have not agreed yet?
- Are operator, support, and AI roles visually clear when relevant?
- Is the design specific enough to implement without guessing?

## Implementation Notes

- components likely needed
- backend dependencies
- data transformations
- testing considerations

## Open Questions

- 
