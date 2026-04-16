# Product Requirements Document

## Product

`mist-junos-console`

Browser-based serial console and guided recovery workspace for Juniper Mist-managed switches running Junos.

## Problem Statement

When a Juniper EX switch is offline, unadopted, misconfigured, or otherwise disconnected from Mist, the operator often has to fall back to a physical console cable and a fragmented workflow:

- local serial terminal access
- tribal-knowledge troubleshooting
- manual lookup of Mist org/site/device context
- ad hoc remediation commands
- support escalation by screenshot or verbal relay

This is slow, inconsistent, and difficult for less experienced operators. The product should make serial-console recovery safe, guided, Mist-aware, and collaborative.

## Vision

Give an operator a single browser-based workspace that can:

- connect to a switch over serial with no local install in production
- identify the device and load Mist context
- run structured diagnostic workflows with clear stop conditions
- explain likely root causes and next actions
- support guided adoption and recovery
- optionally allow a remote support participant to join the session safely
- optionally allow an AI agent to join the session safely under clear policy controls

## Users

### Primary user

Field operator or site technician who has physical access to the switch but may have limited Junos expertise.

### Secondary user

Remote support engineer assisting the field operator during onboarding, outage triage, or recovery.

### Internal stakeholder

Mist product/support teams who may want this flow embedded or linked from Mist in the future.

## Core Use Cases

1. Connect to a physically reachable switch over serial from Chrome or Edge.
2. Identify the switch and correlate it with Mist inventory.
3. Determine why the switch is offline or not connecting to Mist cloud.
4. Compare device state with Mist-intended configuration.
5. Retrieve required management context such as site settings or root password.
6. Apply low-risk guided actions for adoption or remediation.
7. Share the live console with remote support.

## Goals

### Product goals

- Reduce time to diagnose disconnected or unadopted switches.
- Make troubleshooting consistent and usable by non-experts.
- Bring Mist context directly into the console workflow.
- Create a safe path toward assisted remediation and adoption.

### Engineering goals

- Keep the browser focused on Web Serial and UI concerns.
- Move sensitive API interactions and session orchestration to the backend.
- Improve maintainability through modular workflows and testable services.
- Establish a documented development process for future work.

## Non-Goals

- Full terminal emulation beyond the needs of Junos console workflows.
- Fully autonomous high-risk remediation on production switches.
- Broad multi-vendor support in the current phase.
- Public anonymous remote access without authentication and policy controls.

## Current Product Scope

Based on the current implementation, the product already includes:

- Web Serial terminal via xterm
- Mist API integration through a Node proxy
- device identification against Mist inventory
- root password lookup from site settings
- config drift comparison
- adoption command retrieval and guided application
- automated cloud connectivity checks
- remote support console mirroring over WebSocket

## Key User Journeys

### Journey 1: Offline switch diagnosis

1. Operator opens the app in Chrome or Edge.
2. Operator connects to the switch over serial.
3. Operator configures Mist org, site, and API context.
4. Operator identifies the switch.
5. Operator runs troubleshooting checks.
6. Tool highlights critical failures, skipped downstream checks, and remediation.
7. Operator resolves or escalates with supporting evidence.

### Journey 2: Unadopted switch onboarding

1. Operator connects to the switch.
2. Operator retrieves root password guidance if needed.
3. Operator authenticates and verifies operational mode.
4. Tool fetches adoption commands from Mist.
5. Tool applies commands through the console with operator visibility.
6. Operator confirms the switch begins cloud onboarding.

### Journey 3: Assisted support session

1. Operator enables a remote session after serial connection.
2. Operator shares the session ID with support.
3. Support joins a mirrored console.
4. Support observes output and optionally injects keystrokes.
5. Session ends when operator disconnects or disables sharing.

## Functional Requirements

### Terminal and device connection

- The app must connect to serial devices using the Web Serial API.
- The app must expose common serial settings required for Junos console access.
- The terminal must display device output and allow keyboard input.
- The app must handle disconnects and write failures gracefully.

### Mist context

- The app must allow configuration of Mist cloud, API token, org, and site.
- The app must retrieve site lists and relevant device/site data from Mist.
- The app must identify devices by serial, MAC, or hostname where possible.
- The product should use Mist APIs in a layered way: session context first, then device intent and last-known device status after switch identification.
- The UI should distinguish between live console-derived state, Mist intended state, and Mist last-known state.

#### Current vs target Mist auth model

Current state:

- this tool is a separate frontend and backend
- the backend needs an explicit way to call Mist APIs
- the current user-facing cloud, token, org, and site inputs are acceptable as a prototype and development model
- the fact that a user may already be logged into the Mist UI does not automatically give this tool’s backend access to Mist APIs

Target state:

- this tool should eventually be launched from or hosted by Mist
- the user should not need to manually enter Mist API credentials
- the tool should inherit user, org, and site context through trusted Mist authentication and backend integration
- backend-owned Mist API access should remain the architectural pattern, even when the user-facing credential step disappears

Design implication:

- do not design around directly reusing an arbitrary browser Mist session as the primary long-term model
- design around a trusted auth and context handoff from Mist to this tool, with the backend continuing to own Mist API interactions

See [`docs/MIST-API-INTEGRATION.md`](/Users/mdusty/Library/CloudStorage/OneDrive-HewlettPackardEnterprise/Documents/03%20Mist%20Docs/07%20Projects/mist-junos-console/docs/MIST-API-INTEGRATION.md) for the detailed endpoint usage model.

### Troubleshooting

- The app must run ordered troubleshooting checks over the serial console.
- Checks must support stop conditions for missing prerequisites such as no management IP or no default route.
- Each check must produce a status, explanation, raw evidence, and remediation guidance where applicable.
- The troubleshooting flow must remain understandable to non-expert operators.
- For disconnect investigation, the product should prefer collecting and presenting evidence over making overconfident claims about exact root cause.
- The troubleshooting flow should incorporate high-signal device-native status indicators where available, including the JMA cloud connectivity state reported by the switch.
- The UI should keep both Mist device connected state and switch-reported JMA connectivity state visible as separate but related indicators.
- The product should periodically refresh lightweight status indicators such as Mist device status and JMA connectivity state while the session is active.
- Lightweight background monitoring or bootstrap actions may run silently so they do not pollute the operator terminal.
- Operator-invoked workflows such as explicit identify, troubleshooting, config comparison, and guided remediation should remain visible in the terminal so the operator can follow what the tool is doing.

### Config comparison

- The app must retrieve Mist device config and compare it to running config.
- The app must make config drift understandable and actionable.

### Adoption

- The app must fetch Mist adoption commands from the backend.
- The app must validate login state before attempting adoption.
- The app must present commands and actions clearly before execution.

### Remote support

- The app must allow an operator to start a support session.
- The app must allow a human support user to join by session ID or a future authenticated equivalent.
- The app may allow an AI agent to join a session under explicit operator consent and policy controls.
- The app must mirror RX and TX traffic appropriately.
- The product must make the trust boundary obvious to the operator.
- The product must clearly indicate whether a session participant is a human support user or an AI agent.
- AI agent integration should prefer read-only Mist context plus backend-owned live session/workflow tools rather than unrestricted raw command access.

## Non-Functional Requirements

### Security

- Mist API tokens should not remain a browser-side concern long term.
- Remote sessions require authentication, authorization, auditability, and expiry before production rollout.
- Session identifiers must be treated as secrets until replaced by authenticated access controls.
- Human support joins and AI agent joins must each have explicit consent, identity, and audit controls.

### Reliability

- Long-running CLI workflows should recover cleanly from prompt-detection or timeout failures.
- Terminal and troubleshooting flows should degrade gracefully when Mist APIs are unavailable.

### Usability

- The operator must be able to follow the workflow without deep Junos knowledge.
- Results should distinguish between pass, fail, warn, info, and skip states.

### Maintainability

- Core workflows should be modular and testable.
- Product logic should not be concentrated in a single orchestration file.

## Success Metrics

### Product metrics

- Mean time to identify root cause for an offline switch
- Mean time to adoption for new or stranded switches
- Percentage of sessions completed without escalation
- Percentage of troubleshooting runs that produce a clear actionable outcome

### Engineering metrics

- Test coverage for service-level logic and parsing-heavy flows
- Reduced size and responsibility of `src/main.ts`
- Reduced size and complexity of `src/services/troubleshoot.service.ts`
- Number of critical flows executable with mocked serial and Mist dependencies

## Current Gaps

The current codebase is functionally promising but not yet structured for sustained development:

- `src/main.ts` is a very large DOM-centric orchestrator
- `src/services/troubleshoot.service.ts` contains too much workflow and parsing logic in one file
- there is no automated test suite
- security-sensitive product assumptions are documented but not yet enforced
- the README is stronger than the engineering process around it

## Risks and Constraints

- Web Serial is browser-limited and requires Chrome or Edge
- production deployment will need HTTPS and browser-compatible origin setup
- current remote support model is not production-safe without auth and auditing
- human support participants introduce risks around unauthorized access, mistaken operator trust, and interactive changes without sufficient audit controls
- AI agent participants introduce additional risks around over-broad automation, unsafe command injection, unclear accountability, and operator over-trust in generated actions
- Mist token handling needs a backend-first design
- Junos CLI parsing can be brittle across prompt, pagination, and software-version variations

## Release Priorities

### Phase 1: Stabilize foundation

- document product scope and development methodology
- add tests around parsing and command execution seams
- reduce orchestration complexity in `main.ts`

### Phase 2: Secure and modularize

- move Mist credential handling decisively server-side
- split troubleshooting steps into modular units
- formalize session policy and support controls

### Phase 3: Continue feature development

- improve remediation workflows
- add safer guided actions
- prepare for Mist-linked or hosted deployment

## Planned Features

### Priority Feature A: Sync Disconnected Switch To Mist Intended Config

#### Summary

Allow the console tool to retrieve the full Mist-intended Junos configuration for a switch, preview the resulting change, and apply it over the serial console so a disconnected switch can be brought back into alignment with Mist.

#### Why it matters

This directly supports the core objective of the tool: helping a disconnected switch receive the configuration that Mist intends, even when Mist cloud cannot currently push that configuration itself.

#### User story

As an operator recovering a disconnected switch, I want to preview and apply the Mist-intended configuration over console, so that changes made in Mist can still reach the device even while it is offline.

#### Intended behavior

1. The tool identifies the switch and matches it to the correct Mist device.
2. The tool fetches the full intended config from Mist, for example via `config_cmd`.
3. The tool prepends the known Mist-managed cleanup delete commands before the retrieved `set` commands.
4. The tool stages the candidate config in Junos configuration mode.
5. The tool generates a preview diff where possible using Junos-native comparison such as `show | compare`.
6. The user explicitly approves the final apply step.
7. The tool runs `commit check`.
8. If `commit check` succeeds, the tool performs the final commit with a clear comment, for example:
   `commit comment "junos console bridge Mist UI config sync"`
9. The tool shows post-commit verification and rollback guidance.

#### Scope decisions

- v1 should sync the whole intended config
- preview-first is required
- preview should show a Junos-style diff if possible
- the workflow should rely on `commit check` before final commit
- rollback should be manual but guided
- unmanaged config should be preserved
- Mist-managed config should be cleared using the known Mist cleanup delete commands before the intended `set` commands are applied

#### Safety and rollback model

- the user must explicitly confirm before final commit
- the tool must run `commit check` before commit
- the final commit must include a tool-specific comment
- the tool should guide the user to inspect `show system commit`
- the tool should help the user identify:
  - the most recent tool-driven commit
  - the most recent Mist `via netconf` commit
  - the correct rollback number if a revert is needed

#### Mist alignment requirement

The workflow should mirror Mist behavior as closely as possible. The current known model is:

1. apply the Mist-managed cleanup delete commands
2. apply the intended `set` commands from `config_cmd`
3. run `commit check`
4. commit

The last Mist `via netconf` commit should align with the Mist device `config_timestamp` or “last config” time when detectable.

#### Acceptance criteria

- feature is available only after successful device identification and Mist matching
- tool fetches the full intended Mist config
- tool prepends the known Mist cleanup delete commands before the intended `set` commands
- tool stages the config and produces a Junos-style diff preview where possible
- user must explicitly approve before final commit
- tool runs `commit check` before final commit
- tool commits only if `commit check` succeeds
- final commit includes a clear tool-specific comment
- tool preserves unmanaged config outside Mist-managed scope
- tool shows post-commit verification guidance using `show system commit`
- tool can point to the most recent Mist-driven config timestamp when available

#### Current known cleanup domains

The current known Mist cleanup step deletes the following managed configuration domains before applying the intended `set` commands:

- `delete protocols`
- `delete interfaces`
- `delete apply-groups`
- `delete groups`
- `delete vlans`
- `delete system syslog`
- `delete snmp`
- `delete firewall`
- `delete routing-instances`
- `delete forwarding-options`
- `delete policy-options`
- `delete system ntp`
- `delete system name-server`
- `delete routing-options`
- `delete system time-zone`
- `delete system host-name`
- `delete virtual-chassis`
- `delete class-of-service`
- `delete access`
- `delete system processes dhcp-service traceoptions`

This should be treated as the current known Mist-managed cleanup list and verified over time against Mist behavior.

### Priority Feature B: Live Switch Front Panel View

#### Summary

Add a Mist-aligned front panel view inside the console tool that displays the live switch state, including clickable ports, VLAN information, and device IP information in a format familiar to Mist users.

#### Why it matters

This makes troubleshooting more intuitive by presenting the switch visually instead of forcing users to interpret raw CLI output.

#### User story

As an operator troubleshooting a switch over console, I want a live front panel view similar to Mist so I can quickly understand port state and switch addressing without reading raw CLI.

#### Scope decisions

- the view should show live switch state only
- the interaction model should be visually aligned with the Mist front panel view
- each port should be clickable with a detail panel or popover
- the device view should show all relevant IP addresses
- the implementation should support multiple switch form factors through a model-driven layout approach

#### Minimum v1 data

- per-port up/down status
- per-port tagged VLANs
- per-port untagged VLAN
- all relevant switch IP addresses shown in a Mist-like presentation

#### Modeling direction

The data/model layer should support multiple switch form factors from the beginning. Junos naming conventions such as `ge-0/0/0` can be used to interpret chassis, slot, and port ordering, with ports rendered left to right and top to bottom.

#### Acceptance criteria

- front panel reflects live switch state
- each port is clickable
- each port shows up/down state
- each port shows tagged VLANs
- each port shows untagged VLAN
- device view shows all relevant IP addresses
- UI is visually aligned with Mist’s front-panel mental model
- architecture supports multiple switch form factors through model-driven layout definitions

### Priority Feature C: Session Logging And Export

#### Summary

Capture both terminal transcript data and session or event activity, allow the operator to download logs during or after the session, and store masked backend logs for support and troubleshooting.

#### Why it matters

Session logs create a durable record of what happened during troubleshooting and recovery. They help operators share outcomes, help support reconstruct issues accurately, and provide a foundation for auditability and future AI-assisted analysis.

#### User story

As an operator or support engineer, I want a complete record of a troubleshooting session so I can review what happened, share it, and support follow-up troubleshooting.

#### Product direction

Use two related logging outputs:

1. Terminal transcript
2. Event and system log

The operator experience should still present a single unified session history, with the transcript and event/system entries rendered together chronologically using clear markers for non-terminal actions.

#### Terminal transcript

- human-readable
- plain text
- downloadable by the operator
- available during the live session and after it ends
- intended to reflect the session transcript without requiring backend log access

#### Event and system log

- stored in the backend
- includes timestamps and markers
- includes UI, system, session, and workflow events
- reserved for support or admin use in v1

#### Scope decisions

- users can download the terminal transcript at any point during a session
- users can also download the transcript after the session ends
- the terminal transcript should remain plain text
- the event and system log should include timestamps and markers
- secrets should be masked
- backend logs should be retained for 30 days
- backend logs should be searchable by session ID, device, site, or timestamp
- the initial backend implementation may use file naming conventions to support that searchability
- backend logs should not be directly exposed to end users in v1

#### What should be captured

Terminal transcript:

- console RX and TX stream
- actor-labeled input where applicable

Event and system log:

- session start and end
- operator connect and disconnect
- human support join and leave
- AI agent join and leave
- Mist API actions
- troubleshooting runs
- config sync preview and apply events
- commit and `commit check` outcomes
- major system notices, warnings, and errors

#### Security and privacy behavior

- sensitive values must be masked in exported and stored logs
- logs should not expose passwords, API tokens, or other sensitive secrets
- the UI should make it clear that session activity is being logged
- backend log access should be restricted to support or admin workflows

#### Acceptance criteria

- the operator can download the terminal transcript during an active session
- the operator can download the terminal transcript after the session ends
- the downloadable terminal transcript is plain text
- backend stores a masked terminal transcript and event or system log for each session
- backend logs are retained for 30 days
- backend logs can be searched by session ID, device, site, or timestamp
- sensitive values are masked in both exported and stored logs
- backend logs are not directly exposed to end users in v1

#### Design note

See [`docs/SESSION-LOGGING-DESIGN.md`](/Users/mdusty/Library/CloudStorage/OneDrive-HewlettPackardEnterprise/Documents/03%20Mist%20Docs/07%20Projects/mist-junos-console/docs/SESSION-LOGGING-DESIGN.md) for the session model decision: one unified operator-facing history backed by a structured backend event stream.
Implementation details for the first-pass schema and masking rules live in [`docs/SESSION-EVENT-SCHEMA.md`](/Users/mdusty/Library/CloudStorage/OneDrive-HewlettPackardEnterprise/Documents/03%20Mist%20Docs/07%20Projects/mist-junos-console/docs/SESSION-EVENT-SCHEMA.md) and [`docs/SESSION-MASKING-POLICY.md`](/Users/mdusty/Library/CloudStorage/OneDrive-HewlettPackardEnterprise/Documents/03%20Mist%20Docs/07%20Projects/mist-junos-console/docs/SESSION-MASKING-POLICY.md).

## Acceptance Criteria For The Next Development Cycle

1. The team has one maintained PRD and one prioritized refactor backlog.
2. New work is defined against explicit user problems, scope, and acceptance criteria.
3. The next refactor wave reduces code concentration in `src/main.ts` and `src/services/troubleshoot.service.ts`.
4. At least one critical workflow gains automated tests before new major features are added.
