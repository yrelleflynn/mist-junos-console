# AI Analysis Implementation Plan

## Purpose

Turn the product requirements in
[docs/AI-ANALYSIS-PRD.md](/Users/mdusty/Library/CloudStorage/OneDrive-HewlettPackardEnterprise/Documents/03%20Mist%20Docs/07%20Projects/mist-junos-console/docs/AI-ANALYSIS-PRD.md)
into a concrete build plan by milestone, file, and acceptance criteria.

This plan assumes the agreed V1 shape:

- read-only first
- automatic analysis after `Run Recommended Checks`
- optional manual `Analyze` button
- one recommended next step
- compact evidence citations
- same analysis state visible to both operator and support/JTAC views
- backend-owned LLM integration

## Implementation Strategy

Build this in three layers:

1. backend agent state and orchestration
2. operator UI rendering and trigger flow
3. support-view rendering of the same analysis state

Do not start with action approval or chat UI.

## Milestone 1: Backend Agent State And Analysis Trigger

### Goal

Create the backend structures needed to request analysis, store the result, and
serve UI-ready analysis state to the frontend.

### Files

#### [server/index.mjs](/Users/mdusty/Library/CloudStorage/OneDrive-HewlettPackardEnterprise/Documents/03%20Mist%20Docs/07%20Projects/mist-junos-console/server/index.mjs)

Add:

- `agentStates: Map<string, AgentUiState>`
- `GET /agent/state?sessionId=...`
- `POST /agent/analyze`

Responsibilities:

- validate `sessionId`
- read current session context from `mcpSessionStates`
- return `idle` if no analysis exists yet
- mark analysis state as `thinking` when a run starts
- invoke a new backend analysis service asynchronously
- persist the normalized result into `agentStates`

Do not add `POST /agent/approve-action` in this milestone.

#### [server/agent-service.mjs](/Users/mdusty/Library/CloudStorage/OneDrive-HewlettPackardEnterprise/Documents/03%20Mist%20Docs/07%20Projects/mist-junos-console/server/agent-service.mjs)

Create this new file.

Responsibilities:

- build compact analysis input from current session state
- call the selected LLM provider through a small provider adapter
- normalize the response into `AgentUiState`

Suggested functions:

- `buildAgentInput(sessionState)`
- `runAgentAnalysis(sessionState)`
- `normalizeAgentResponse(modelResponse, sessionState)`

#### [server/llm-client.mjs](/Users/mdusty/Library/CloudStorage/OneDrive-HewlettPackardEnterprise/Documents/03%20Mist%20Docs/07%20Projects/mist-junos-console/server/llm-client.mjs)

Create this new file if you want provider logic isolated from orchestration.

Responsibilities:

- read provider env vars
- expose one analysis-oriented function such as:
  - `analyzeTroubleshootingContext(input)`

Keep this file provider-thin and app-logic-light.

Recommended initial provider posture:

- start with Gemini API for development prototyping
- keep the interface provider-agnostic
- treat OpenAI mini-class models as the first fallback if Gemini free-tier rate
  limits or output behavior become a blocker

### Context rules for Milestone 1

Only send compact structured context:

- session summary
- JMA state
- Mist status summary
- switch identity
- current structured check results
- bounded action availability
- short recent console tail when useful

Do not send:

- full transcript
- full config
- full log files

### Suggested response shape

```ts
type AgentUiState = {
  sessionId: string;
  status: 'idle' | 'thinking' | 'ready' | 'error';
  updatedAt: string;
  headline: string | null;
  summary: string | null;
  findings: string[];
  evidence: Array<{
    source: 'jma' | 'mist' | 'checks' | 'mcd_log' | 'jmd_log' | 'config';
    label: string;
    detail: string;
  }>;
  suggestedAction: {
    kind: 'bounded_action' | 'external_investigation';
    id: string | null;
    label: string;
    reason: string;
  } | null;
  error?: string | null;
};
```

### Acceptance criteria

- backend can return `idle`, `thinking`, `ready`, and `error`
- backend analysis calls are async and do not block the HTTP request thread
- analysis can be triggered for a live session with no UI changes yet

## Milestone 2: Operator UI Panel

### Goal

Render the AI analysis in the operator UI and support both automatic and manual
triggering.

### Files

#### [index.html](/Users/mdusty/Library/CloudStorage/OneDrive-HewlettPackardEnterprise/Documents/03%20Mist%20Docs/07%20Projects/mist-junos-console/index.html)

Add a new right-column card:

- `#agent-analysis-card`
- `#agent-analysis-status`
- `#agent-analysis-headline`
- `#agent-analysis-summary`
- `#agent-analysis-findings`
- `#agent-analysis-evidence`
- `#agent-analysis-next-step`
- `#btn-agent-analyze`

Recommended placement:

- below the current cloud connectivity guidance panel
- above optional operator guidance / future controls

#### [src/styles/main.css](/Users/mdusty/Library/CloudStorage/OneDrive-HewlettPackardEnterprise/Documents/03%20Mist%20Docs/07%20Projects/mist-junos-console/src/styles/main.css)

Add styles for:

- analysis card container
- status pill variants
- findings list
- compact evidence citations
- suggested next-step block

Match the visual language of the existing right-column panels.

#### [src/main.ts](/Users/mdusty/Library/CloudStorage/OneDrive-HewlettPackardEnterprise/Documents/03%20Mist%20Docs/07%20Projects/mist-junos-console/src/main.ts)

Add:

- DOM refs for the AI analysis panel
- local UI state for latest analysis
- `fetchAgentState(sessionId)`
- `renderAgentAnalysis(state)`
- `requestAgentAnalysis()`
- polling logic for `thinking` state

Wire analysis into two trigger paths:

1. automatic trigger after `Run Recommended Checks` completes
2. manual trigger from `#btn-agent-analyze`

Do not auto-run after `Run Full Baseline` in the first cut.

### Acceptance criteria

- operator sees `AI Analysis` panel in the right column
- `Run Recommended Checks` triggers analysis automatically
- manual `Analyze` button re-runs analysis
- panel shows concise summary, findings, citations, and one next step
- panel handles `idle`, `thinking`, `ready`, and `error` cleanly

## Milestone 3: Support / JTAC View

### Goal

Render the same analysis state in the support console so operator and support
are looking at the same interpretation.

### Files

#### [src/support-main.ts](/Users/mdusty/Library/CloudStorage/OneDrive-HewlettPackardEnterprise/Documents/03%20Mist%20Docs/07%20Projects/mist-junos-console/src/support-main.ts)

Add support-side polling and rendering for:

- current session’s AI analysis state
- status
- summary
- findings
- evidence citations
- suggested next step

This is render-only in the first cut.

#### [support.html](/Users/mdusty/Library/CloudStorage/OneDrive-HewlettPackardEnterprise/Documents/03%20Mist%20Docs/07%20Projects/mist-junos-console/support.html)

Add a support-facing analysis panel container if needed.

#### [src/styles/main.css](/Users/mdusty/Library/CloudStorage/OneDrive-HewlettPackardEnterprise/Documents/03%20Mist%20Docs/07%20Projects/mist-junos-console/src/styles/main.css)

Add support-view styles.

Recommendation:

- keep the support version slimmer than the operator version
- show the same content, but optimize for reading alongside the mirrored
  terminal

### Acceptance criteria

- support view renders the same analysis state as operator view
- analysis updates when the operator session re-runs analysis
- support view remains read-only

## Milestone 4: Prompt Quality And Evidence Discipline

### Goal

Make the analysis reliable enough to feel product-like rather than chat-like.

### Files

#### [server/agent-service.mjs](/Users/mdusty/Library/CloudStorage/OneDrive-HewlettPackardEnterprise/Documents/03%20Mist%20Docs/07%20Projects/mist-junos-console/server/agent-service.mjs)

Refine:

- prompt structure
- evidence selection
- normalization rules
- direct operator wording for external investigations

### Prompt behavior requirements

The model should:

- summarize the most likely current issue
- identify the supporting evidence
- explain key contradictions when relevant
- recommend exactly one next step

The model should not:

- produce long prose
- invent raw evidence
- present multiple competing action candidates in V1
- imply it has executed anything

### Direct wording requirement

External investigation recommendations should be direct:

- `Check upstream firewall policy`
- `Check default gateway reachability upstream of the switch`
- `Check upstream DNS path and resolver policy`

### Acceptance criteria

- analysis reads like product guidance, not a generic assistant
- output length is compact and consistent
- evidence labels map back cleanly to visible product state

## Milestone 5: Observability And Guardrails

### Goal

Make the feature operationally sane before adding action approval.

### Files

#### [server/index.mjs](/Users/mdusty/Library/CloudStorage/OneDrive-HewlettPackardEnterprise/Documents/03%20Mist%20Docs/07%20Projects/mist-junos-console/server/index.mjs)

Add lightweight logging for:

- analysis requested
- analysis completed
- analysis failed
- provider timeout / backend timeout

#### [docs/SESSION-EVENT-SCHEMA.md](/Users/mdusty/Library/CloudStorage/OneDrive-HewlettPackardEnterprise/Documents/03%20Mist%20Docs/07%20Projects/mist-junos-console/docs/SESSION-EVENT-SCHEMA.md)

Later, extend event definitions for:

- AI analysis requested
- AI analysis completed
- AI recommendation produced

This can start as a documentation/update item rather than a hard dependency for
the prototype.

### Acceptance criteria

- backend failures degrade to a visible `error` state rather than silent no-op
- analysis requests are debuggable in logs
- the UI never implies analysis is fresh if it is stale

## Follow-On Phase: Approval-Gated Bounded Actions

This is explicitly out of the first cut, but it should be planned in a way that
does not require redesign.

### Files

#### [server/index.mjs](/Users/mdusty/Library/CloudStorage/OneDrive-HewlettPackardEnterprise/Documents/03%20Mist%20Docs/07%20Projects/mist-junos-console/server/index.mjs)

Later add:

- `POST /agent/approve-action`

#### [src/main.ts](/Users/mdusty/Library/CloudStorage/OneDrive-HewlettPackardEnterprise/Documents/03%20Mist%20Docs/07%20Projects/mist-junos-console/src/main.ts)

Later add:

- `Approve and Run` UI
- rendering of last approved action result

### Allowed bounded actions for follow-on phase

- `run_recommended_checks`
- `run_check`
- `run_check_group`
- `run_dhcp_refresh`
- `run_restart_mist_agent`
- `run_config_sync_preview`

### Still excluded

- config commit
- config rollback
- adopt
- arbitrary CLI injection

## File Checklist

### New files likely required

- [server/agent-service.mjs](/Users/mdusty/Library/CloudStorage/OneDrive-HewlettPackardEnterprise/Documents/03%20Mist%20Docs/07%20Projects/mist-junos-console/server/agent-service.mjs)
- [server/llm-client.mjs](/Users/mdusty/Library/CloudStorage/OneDrive-HewlettPackardEnterprise/Documents/03%20Mist%20Docs/07%20Projects/mist-junos-console/server/llm-client.mjs)
- [src/types/agent-ui.types.ts](/Users/mdusty/Library/CloudStorage/OneDrive-HewlettPackardEnterprise/Documents/03%20Mist%20Docs/07%20Projects/mist-junos-console/src/types/agent-ui.types.ts)

### Existing files expected to change

- [server/index.mjs](/Users/mdusty/Library/CloudStorage/OneDrive-HewlettPackardEnterprise/Documents/03%20Mist%20Docs/07%20Projects/mist-junos-console/server/index.mjs)
- [index.html](/Users/mdusty/Library/CloudStorage/OneDrive-HewlettPackardEnterprise/Documents/03%20Mist%20Docs/07%20Projects/mist-junos-console/index.html)
- [support.html](/Users/mdusty/Library/CloudStorage/OneDrive-HewlettPackardEnterprise/Documents/03%20Mist%20Docs/07%20Projects/mist-junos-console/support.html)
- [src/main.ts](/Users/mdusty/Library/CloudStorage/OneDrive-HewlettPackardEnterprise/Documents/03%20Mist%20Docs/07%20Projects/mist-junos-console/src/main.ts)
- [src/support-main.ts](/Users/mdusty/Library/CloudStorage/OneDrive-HewlettPackardEnterprise/Documents/03%20Mist%20Docs/07%20Projects/mist-junos-console/src/support-main.ts)
- [src/styles/main.css](/Users/mdusty/Library/CloudStorage/OneDrive-HewlettPackardEnterprise/Documents/03%20Mist%20Docs/07%20Projects/mist-junos-console/src/styles/main.css)

## Recommended Build Order

1. backend state endpoints in `server/index.mjs`
2. `agent-service.mjs` with mocked output shape
3. operator panel in `index.html` + `src/main.ts`
4. switch mocked output to real provider-backed output
5. support panel in `support.html` + `src/support-main.ts`
6. prompt and output tightening

## Suggested First Deliverable

The best first vertical slice is:

- `POST /agent/analyze`
- `GET /agent/state`
- a mocked or rule-based backend response
- operator UI card
- auto-run after `Run Recommended Checks`

That gives a real product seam before spending time on provider integration and
prompt tuning.

## Suggested Second Deliverable

After the mocked/rule-based slice works, the next step should be:

- wire `server/llm-client.mjs` to Gemini API using development credentials
- keep prompts compact and read-only
- verify the output quality before adding support-view rendering or any future
  approval-gated action flow
