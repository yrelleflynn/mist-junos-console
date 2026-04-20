# AI Analysis UI PRD

## Product

`mist-junos-console` AI-assisted analysis panel

## Purpose

Define a lightweight V1 for bringing AI analysis into the product UI in a way
that is useful, safe, and aligned with the current operator-owned session
model.

This document is intentionally narrower than the main PRD. It focuses on the
operator-facing AI analysis experience, the backend orchestration required to
support it, and the safety boundaries for a first implementation.

## Problem Statement

The product already provides strong deterministic guidance:

- live JMA state
- Mist last-known state
- structured troubleshooting checks
- bounded recovery actions
- effective config and targeted logs

That is valuable on its own, but the operator still has to mentally combine the
signals. When the evidence is ambiguous or distributed across multiple sources,
the product should be able to help the operator answer:

- What is most likely happening?
- Why does the product believe that?
- What should I do next?

The goal is not to replace the deterministic workflow. The goal is to add a
layer of interpretation on top of it.

## Vision

Add an in-product AI analysis panel that can:

- summarize the current situation in plain language
- highlight the most important evidence
- explain contradictions between JMA, Mist, and local checks
- recommend the next bounded action
- optionally request operator approval to run a bounded action

The operator remains in control of the session. The AI participates as an
assistant, not the owner.

## Target Users

### Primary user

Field operator or site technician using the existing browser UI to recover a
switch over serial.

### Secondary user

Remote support engineer or JTAC engineer observing or guiding the operator.

### Future user

Operator inside a Mist-native embedded version of this workflow, where device
and org context may already be known.

## Product Principles

### 1. Deterministic workflow first

The base product must remain useful without AI. The AI layer should interpret
existing product signals, not replace the checks/actions UI.

### 2. Operator-owned session

The operator owns the live console session. The AI can read state and recommend
bounded actions. State-changing actions require explicit operator approval.

### 3. Structured evidence over raw transcript

The AI should prefer structured product outputs:

- JMA state
- Mist context
- structured check results
- bounded log excerpts
- effective config excerpts

It should not rely on the full raw console transcript by default.

### 4. Concise, explainable output

The AI should present:

- a short headline
- a short summary
- a small set of findings
- supporting evidence
- one best next step

This should feel like product guidance, not a chat transcript.

## Goals

### Product goals

- Reduce the operator’s cognitive load when multiple signals disagree.
- Make the tool feel more agentic without making it unpredictable.
- Improve confidence in the next best action.
- Demonstrate a credible path from MCP proof-of-concept to in-product AI.

### UX goals

- Keep the UI focused and readable.
- Avoid overwhelming the operator with long free-form AI output.
- Keep action-taking deliberate and approval-gated.

### Technical goals

- Reuse the existing MCP session state and bounded action relay.
- Keep model calls backend-owned.
- Minimize token usage through compact structured context.

## Non-Goals

- Free-form chat as the primary V1 interface
- Fully autonomous remediation
- Arbitrary CLI command generation or execution
- Full transcript reasoning by default
- Complex multi-agent orchestration

## V1 Scope

### Included

- An `AI Analysis` panel in the operator UI
- The same `AI Analysis` state rendered in the support/JTAC view when present
- Automatic analysis after `Run Recommended Checks`
- Optional manual `Analyze` trigger for re-runs
- Backend-owned analysis run using a major LLM API
- Analysis built from current structured session state
- One suggested bounded next action or one clear external investigation focus
- Compact evidence citations with deeper detail elsewhere in the product UI

### Excluded from V1

- Streaming token-by-token UI output
- Persistent chat history
- Multiple suggested actions at once
- Autonomous action execution without approval
- Direct AI-triggered action execution in the initial read-only cut
- Direct config commit or rollback through AI
- General-purpose timeline forensics

## Current Foundations Already Present

The current product already has the key plumbing needed for this feature:

- frontend pushes live session state to the backend via `/mcp/agent-context`
- backend stores session state keyed by session ID
- backend exposes a bounded action relay under `/mcp/actions`
- frontend polls and executes bounded actions in the operator-owned session
- MCP already exposes structured reads and bounded actions for external agents

This means the missing product layer is not raw capability. It is:

- backend AI orchestration
- UI presentation of AI analysis
- approval-gated UI flow for AI-suggested actions

## User Stories

### Story 1: Explain the current issue

As an operator, I want the product to summarize the most likely failure so I do
not have to interpret every check result manually.

### Story 2: Highlight contradictions

As an operator, I want the product to explain when Mist, JMA, and local checks
do not line up, so I know whether I am seeing a current issue or stale cloud
state.

### Story 3: Recommend the next step

As an operator, I want one clear next bounded action so I do not have to choose
from multiple possible checks or remediations under pressure.

### Story 4: Approve a safe action

As an operator, I want to review and approve an AI-suggested bounded action
from the same UI, so I can keep control while still moving quickly.

This is a follow-on capability rather than part of the initial read-only cut.

## UX Model

### Panel placement

The `AI Analysis` panel should sit in the right guidance column, near:

- Mist status
- JMA cloud state
- cloud connectivity guidance

This keeps the AI interpretation close to the state it is interpreting.

The support/JTAC view should render the same analysis state in a support-facing
panel so both participants are working from the same interpretation.

### Panel contents

### Header

- Title: `AI Analysis`
- status pill:
  - `Idle`
  - `Thinking`
  - `Ready`
  - `Action Running`
  - `Error`

### Summary section

- short headline
- short summary paragraph

### Findings section

- 2-5 short findings

### Evidence section

- compact evidence citations such as:
  - `JMA: 106 DNSLookupFailed`
  - `DNS Resolution: failed`
  - `Mist Last Seen: 23m ago`
  - `mcd.log: SetState(106)`

### Suggested action section

- one suggested bounded action or one clear external investigation focus
- reason for suggestion
- no action button in the initial read-only cut
- `Approve and Run` appears in the follow-on approval-gated phase

### Last action result section

- compact result summary after an approved action completes in the follow-on
  approval-gated phase

### UX Tone

The AI panel should use product-like language:

- concise
- evidence-backed
- non-dramatic
- not overconfident

Preferred framing:

- `Most likely issue`
- `What supports that`
- `Suggested next step`

Avoid:

- long speculative paragraphs
- conversational filler
- overclaiming root cause when evidence is partial

## Safety Model

### Default AI capability in the initial V1 cut

The AI may:

- read current structured session state
- interpret structured checks and Mist/JMA context
- recommend one bounded next action
- explain when the operator should investigate something external such as:
  - upstream firewall policy
  - default gateway reachability
  - DNS path or resolver behavior

The AI may not:

- take state-changing action without operator approval
- request action approval in the initial read-only cut
- execute arbitrary CLI commands
- commit config changes directly
- bypass the product’s existing workflow and safety gates

### Allowed bounded actions in the follow-on approval-gated phase

The allowed AI-suggested action set should be limited to existing bounded
product actions such as:

- `run_recommended_checks`
- `run_check`
- `run_check_group`
- `run_dhcp_refresh`
- `run_restart_mist_agent`
- `run_config_sync_preview`

### Excluded actions in V1

- all direct action execution in the initial read-only cut
- `commit_config_sync`
- `rollback_config_sync`
- `adopt_switch`
- arbitrary typed input into the serial console

## Backend Architecture

## Model integration

The AI should run in the backend using a model API or SDK from a major provider
such as:

- OpenAI
- Anthropic
- Google Gemini

This should be API-based, not CLI-based.

### Provider recommendation

The architecture should remain provider-agnostic. For the first backend
prototype, the default plan should be to start with the Gemini API free tier
for development use, then revisit the provider choice once the feature shape
and token profile are better understood.

Why this is the current recommendation:

- there is a free development path, which lowers the cost of experimenting with
  prompt shape and panel behavior
- this feature needs short, structured analysis more than long-form generation
- cost efficiency matters because the analysis may run repeatedly after guided
  troubleshooting flows
- strong structured output behavior is more important here than broad
  multimodal capability

Current official pricing signals I checked on April 20, 2026:

- OpenAI lists GPT-5 mini at `$0.25 / 1M` input and `$2.00 / 1M` output on one
  official pricing page, with a newer OpenAI pricing page also listing GPT-5.4
  mini at `$0.75 / 1M` input and `$4.50 / 1M` output
  ([OpenAI pricing](https://openai.com/api/pricing),
  [OpenAI pricing, newer page](https://openai.com/api/pricing/))
- Anthropic lists Claude Sonnet 4 at `$3 / MTok` input and `$15 / MTok`
  output
  ([Anthropic pricing](https://docs.anthropic.com/es/docs/about-claude/pricing))
- Google Vertex AI lists Gemini 3 Flash Preview at `$0.5 / 1M` input and
  `$3 / 1M` output
  ([Vertex AI Gemini pricing](https://cloud.google.com/vertex-ai/generative-ai/pricing))
- Google Gemini API documentation also describes a free tier for eligible
  development usage, with separate billing and rate-limit guidance
  ([Gemini API billing](https://ai.google.dev/gemini-api/docs/billing),
  [Gemini API rate limits](https://ai.google.dev/gemini-api/docs/quota))

Inference from those sources:

- Anthropic looks materially more expensive for this narrow analysis use case
- Gemini is the best prototyping default because of the available free
  development path
- OpenAI mini-class models remain a strong fallback if Gemini rate limits or
  output quality become a problem

The backend should own:

- API credentials
- prompt/context construction
- retries and timeouts
- structured output handling
- action approval boundaries

## New backend responsibilities

Add a backend `agent analysis` layer alongside the current MCP session and
action relay.

### Suggested components

1. `agent state store`
- in-memory latest AI analysis per session

2. `agent orchestration service`
- builds compact analysis input
- calls the model API
- stores analysis result

3. `approval bridge`
- converts approved AI suggestions into existing bounded actions

## Proposed backend endpoints

### `GET /agent/state?sessionId=...`

Returns the latest UI-ready AI analysis state for the current session.

### `POST /agent/analyze`

Triggers one analysis run for a session.

Request body:

```json
{
  "sessionId": "uuid",
  "mode": "summary"
}
```

### `POST /agent/approve-action`

Approves an AI-suggested bounded action and queues it through the existing
action relay.

This endpoint belongs to the follow-on approval-gated phase rather than the
initial read-only cut.

Request body:

```json
{
  "sessionId": "uuid",
  "actionId": "run_dhcp_refresh"
}
```

## Data Model

### Agent UI state

```ts
type AgentUiState = {
  sessionId: string;
  status: 'idle' | 'thinking' | 'ready' | 'awaiting_approval' | 'running_action' | 'done' | 'error';
  updatedAt: string;
  headline: string | null;
  summary: string | null;
  conclusion: string | null;
  findings: string[];
  evidence: Array<{
    source: 'jma' | 'mist' | 'checks' | 'mcd_log' | 'jmd_log' | 'config';
    label: string;
    detail: string;
  }>;
  suggestedAction: {
    id: string;
    label: string;
    reason: string;
    requiresApproval: boolean;
  } | null;
  lastActionResult?: {
    id: string;
    label: string;
    outcome: 'success' | 'warn' | 'error';
    summary: string;
  } | null;
  error?: string | null;
};
```

## Prompt and token strategy

V1 should use compact structured context first.

### Always include

- JMA state and summary
- Mist status summary
- switch identity
- structured check results
- bounded recovery action availability
- short recent console tail when useful

### Include only on demand

- bounded `mcd` excerpt
- bounded `jmd` excerpt
- effective config excerpt
- recent Mist events

### Avoid by default

- full transcript
- full config
- full log files
- repeated unchanged context on every run

## Analysis behavior

The AI should:

- identify the most likely current issue
- distinguish between current blocker and earlier trigger when possible
- cite the evidence it used
- recommend one bounded next step or one clear external investigation focus

For external investigation recommendations, the wording should be direct and
operator-actionable, for example:

- `Check upstream firewall policy`
- `Check default gateway reachability upstream of the switch`
- `Check upstream DNS path and resolver policy`

The AI should not:

- claim certainty where the data is ambiguous
- invent evidence not present in the product state
- recommend unsafe actions outside the allowed action set

## Suggested V1 flow

1. Operator opens the UI and reaches a usable state.
2. Operator runs `Run Recommended Checks`.
3. Backend builds compact structured context and calls the model automatically
   after the recommended-check run completes.
4. UI polls `GET /agent/state`.
5. Panel updates with:
   - headline
   - summary
   - findings
   - evidence
   - suggested action
6. Operator uses the recommendation manually in the initial read-only cut.
7. Optional manual `Analyze` allows the operator to re-run the interpretation
   without rerunning the full workflow.

## Success Criteria

### Operator success

- The operator can understand the AI panel quickly without reading a long
  narrative.
- The AI recommendation feels evidence-backed rather than magical.
- The operator can approve or decline the AI-suggested action confidently.

### Product success

- The panel adds value beyond the deterministic guidance.
- The AI uses existing product outputs rather than bypassing them.
- The feature demonstrates a credible path from MCP proof-of-concept to
  integrated product capability.

### Engineering success

- The feature reuses current session state and bounded action infrastructure.
- The prompt stays compact and predictable.
- The feature remains safe if the model is wrong.

## Implementation Phases

### Phase 1: Read-only analysis panel

- Add backend `agent state`
- Auto-run after `Run Recommended Checks`
- Add optional manual `Analyze` trigger
- Render AI summary, findings, evidence citations, and one recommended next
  step in the UI
- No action approval yet

### Phase 2: Approval-gated bounded action

- Add `Approve and Run`
- Reuse the current action relay
- Show the last action result in the AI panel

### Phase 3: Auto-refresh

- Re-run analysis automatically after:
  - recommended checks finish
  - approved action completes
  - selected future state changes as needed

## Remaining Open Questions

These are the main product decisions still worth confirming before
implementation hardens:

1. Whether the support/JTAC panel should be visually identical to the operator
   panel or use a slimmer support-oriented layout.
2. Whether the first implementation should include any lightweight confidence
   indicator in the panel, or keep confidence implicit in the evidence and
   wording.

## Recommendation

The recommended first product cut is:

- one panel
- automatic analysis after `Run Recommended Checks`
- optional manual re-run trigger
- one concise AI summary
- one recommended next step
- read-only first
- compact evidence citations with deeper details elsewhere

That is enough to feel real, prove the architecture, and keep the safety model
clear.
