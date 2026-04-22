# Mist Launch Mode

## Current State

Mist Launch Mode is now a real product mode, not just a design direction.

Implemented behavior:

- the browser extension launches `junos-console` from a Mist switch page
- the extension resolves switch context from the authenticated Mist browser session
- the launch payload is exchanged through a short-lived backend token rather than a raw query-string dump
- the frontend persists the launch overlay in session storage and reapplies it after URL cleanup
- the UI shows a dedicated Mist Launch verification card
- checks, actions, config sync, adoption, and trusted cloud state stay locked until the console-connected switch matches the Mist-launched switch
- `Identify Switch` and `Get Root Password` controls are hidden in Mist Launch Mode because the launch flow already provides the expected switch and the preferred login path

Current extension-backed launch context can include:

- device name
- serial
- MAC
- site and org identifiers
- Mist cloud / API host
- `switch_mgmt.root_password`
- `config_cmd`
- monitor / status data used by the app after verification

Manual Mist API setup still exists, but it is now the fallback path for:

- sessions not launched from Mist
- development / test workflows
- extension-unavailable scenarios
- recovery if extension-backed data is unavailable

## Purpose

Define the target user experience when `junos-console` is launched directly
from a Mist switch page via the browser extension.

This reframes the feature away from:

- "populate the Mist API modal better"

and toward:

- "run the app in a Mist-scoped launch mode"

## Why This Matters

Once the operator launches from a specific Mist switch page, the product should
assume:

- the operator already chose the right switch in Mist
- org/site context is already implied by that launch
- the primary next question is whether the **console-connected switch matches
  the Mist-launched switch**

That means the current Mist API modal is no longer the right primary mental
model for this workflow.

## Core Product Decision

In Mist-launched workflows, the app should optimize for:

1. switch verification
2. extension-backed Mist context
3. reduced or eliminated manual API-token handling

Not for:

1. manual org/site display and selection
2. token-paste-first setup

## Target User Experience

## 1. Launch From Mist

Operator flow:

1. open a Mist switch page
2. click `Open in Junos Console`
3. the extension posts the launch payload to the local backend
4. local `junos-console` opens with a short-lived `mistLaunchToken`
5. the app imports the launch context, cleans the URL, and keeps the launch overlay in session storage for the rest of the browser session

The UI should show a compact launch indicator such as:

- `Launched from Mist`
- `Mist switch context imported`

Optional details:

- switch name
- cloud / region

Not required:

- foreground org name
- foreground site name

Those may still be available internally, but they are not the primary value.

## 2. Verify The Console Device

After login and identity discovery, the app compares the console-connected
switch with the Mist launch context.

The product rule is now:

- first priority is verifying that the operator is on the correct switch
- only after verification succeeds should Mist status, switch cloud state, and mutating workflows be trusted

Suggested comparison inputs:

- serial number
- hostname
- MAC / chassis identifier if available
- model as a weaker secondary hint

### Match states

#### Green: Match

Example wording:

- `Matched Mist launch switch`
- `Console device matches Mist switch EX2300-HACK`

#### Red: Mismatch

Example wording:

- `Mismatch: console device does not match Mist launch switch`
- `Mist launch expected serial HW0217390180, but the console session identified a different switch`

#### Neutral: Not yet verified

Before verification succeeds:

- `Waiting to verify console device against Mist launch context`

Current gating behavior while waiting:

- `Mist Status` remains `Unknown`
- `Switch Cloud State` remains `Unknown`
- checks and actions stay disabled
- config sync and adoption stay disabled
- the UI explains that this is intentional until the console session is verified

This becomes the central job of switch identification in Mist-launched mode.

## 3. Mist Context Availability

Instead of showing a token-centric setup experience, the UI should say
something like:

- `Mist-backed context available via browser extension`
- `Mist launch context imported`

If the extension is present but not yet able to provide richer data:

- `Mist launch context imported; richer Mist data still requires extension-backed fetches`

Today the extension-backed path already provides more than simple context
bridging. It can supply:

- site-backed root password for login
- device config intent (`config_cmd`)
- Mist monitor data used after verification

## What To Do With Org And Site

The operator generally does **not** need to see org and site names during a
cross-launch flow.

Reason:

- they launched from Mist already
- the selected switch page already implies the Mist scope
- showing org/site mostly adds noise unless debugging the integration

Recommended treatment:

- keep org/site internally in state
- only surface them in advanced/debug contexts
- do not make them primary success criteria for Mist-launched UX

Recent product conclusion:

- if org/site names are easy to resolve, they are nice optional enrichment
- if they are awkward or unreliable to resolve from the launch flow, that is
  acceptable
- the product should not hold the launched workflow hostage on getting
  org/site display names perfect

## What To Do With The Mist API Modal

The current Mist API modal should become a fallback path, not the primary path.

### Mist Launch Mode

Preferred mode:

- no required API token paste
- no mandatory org/site selection
- extension-backed context and data
- login should prefer the Mist-launched root password when available
- manual identify/root-password controls should stay out of the way

### Manual Mode

Fallback mode:

- keep current API token flow
- use when:
  - user did not launch from Mist
  - extension is not installed
  - extension cannot provide needed Mist data

This suggests the UI should evolve from:

- `Mist API Integration Setup`

toward something like:

- `Mist Integration`
  - `Mode: Launched from Mist`
  - `Mode: Manual API token`

## Can We Remove The Mist API Key?

### Short answer

Yes, that should be the target for extension-backed workflows.

### Product goal

When the extension is available, the app should avoid asking the operator to
paste a Mist API key into the local UI.

### Why this is better

- better operator experience
- closer to a Mist-native workflow
- less credential friction
- clearer product story
- cleaner separation between browser-authenticated Mist session and local app

## Required Extension Capabilities

To eliminate manual Mist API key entry in the common path, the extension needs
to become a bounded Mist-side broker.

### Minimum extension-provided context

- cloud / region
- Mist switch ID
- optional switch name / serial / model

### Good next extension-provided data

- device stats
  - last seen
  - connected/disconnected
  - IP
- recent device events
- site metadata
- org metadata

### Likely future extension-provided data

- intended config / config_cmd results
- site password lookup if policy allows
- adoption/config-sync helper data

## Recommended Architecture Direction

The extension should own Mist-authenticated browser-side behaviors.

The local app should consume:

- scoped context
- bounded Mist fetch results

Not:

- raw session cookies
- pasted API keys in the primary workflow

Good model:

1. extension uses the authenticated Mist browser session
2. extension fetches specific data needed by `junos-console`
3. extension passes normalized results to the local app
4. local app remains responsible for:
   - serial
   - checks
   - actions
   - verification

## Recommended Phases

## Phase 1: Mist Launch Context

Implemented:

- cross-launch from Mist switch page
- import cloud/org/site/device context
- secure launch token exchange through the backend
- show Mist-launched state
- persist launch context for the session after URL cleanup
- make switch-match verification a first-class state

## Phase 2: Verification-First UX

Add:

- `Launched from Mist` banner
- `Waiting for match` state
- green/red match result after `Identify Switch`

Reduce emphasis on:

- org/site fields
- manual Mist API modal in launched mode

## Phase 3: Extension-Backed Mist Data

Implemented now:

- root password lookup from Mist site settings
- device config intent retrieval
- monitor / status retrieval for trusted post-verification display

Next extension data still worth adding:

- richer event history
- broader page support
- more explicit debugging / operator diagnostics when launch hydration fails

Goal:

- app can show Mist evidence without requiring local token paste

## Phase 4: Token-Free Common Path

Manual API token becomes fallback only.

Common operator path becomes:

1. open switch in Mist
2. launch Junos Console
3. connect serial
4. identify switch
5. verify match
6. troubleshoot with extension-backed Mist context

## Verification-First UX

The key user-facing purpose of `Identify Switch` changes in Mist Launch Mode.

It is no longer primarily:

- "find the switch in Mist"

It becomes:

- "verify that the switch currently connected by console is the same switch the
  operator launched from in Mist"

### Match signals

Primary signals:

- chassis MAC / Mist device ID correlation
- hostname

Secondary signals:

- model
- serial if available from the extension in future

### UI states

#### Pre-identify

- `Waiting to verify console device against Mist launch context`

#### Match

- green
- `Matched Mist switch`

#### Mismatch

- red
- `Mismatch: console device does not match Mist launch switch`

This verification state should become more prominent than org/site display.

## Gated Workflow Model

In Mist Launch Mode, the product should treat switch verification as a hard
gate, not just an informational step.

Until the console-connected switch is verified against the Mist launch context,
the app should keep the main operational workflow unavailable.

### Locked until verified

Before match is confirmed, the following should be unavailable:

- troubleshooting checks
- grouped/baseline runs
- recovery actions
- config sync actions
- adoption workflow
- agent-driven actions
- general console workflows beyond the minimum needed to authenticate and verify

The UI should make it obvious that this is intentional, for example:

- `Waiting for switch verification`
- `Checks and actions unlock after the connected switch matches the Mist launch context`

### Allowed before verification

Only the minimum path needed to authenticate and verify should remain enabled:

- serial connection
- login / authentication
- identify switch
- view the raw console session if needed for login progress

This reduces the risk of running actions against the wrong switch after a
cross-launch from Mist.

## Login Assumption In Mist Launch Mode

The product assumption should be:

- if launched from Mist, the app should be able to obtain what it needs to log
  in and verify the switch without asking the operator for a separate manual
  API token

If Mist can provide or derive the root/admin credential through the extension
or extension-backed fetches, the intended happy-path becomes:

1. launch from Mist
2. connect serial
3. log in
4. identify switch
5. verify match
6. unlock troubleshooting and actions

### Implication

This strengthens the case that manual Mist API key entry should not be central
to Mist Launch Mode.

Instead, the extension-backed integration should provide enough data to support:

- authentication assistance where policy allows
- switch verification
- Mist-backed status/history/config context after verification

## Removing The API Key From The Common Path

The long-term product answer should be:

- **yes, remove manual Mist API key entry from the common launched workflow**

The local app should only ask for an API key in:

- manual mode
- development/testing fallback
- extension-unavailable scenarios

### What the extension must provide

To remove the API key from the common path, the extension needs to act as a
bounded Mist-side broker and provide either:

- launch context
- or bounded Mist fetch results

Good early fetches:

- device stats
- recent events
- site metadata
- org metadata

Later fetches:

- intended config
- site password / root-password lookup if allowed

### Product implication

The current `Mist API Integration Setup` modal is the wrong primary shape for
Mist Launch Mode.

Instead, the product should move toward:

- `Mist Integration`
  - `Mode: Launched from Mist`
  - `Extension-backed`
  - `Manual API token` as fallback only

## Immediate Product Recommendation

The next concrete UX shift should be:

1. treat extension launch as a dedicated mode
2. stop optimizing around displaying org/site names
3. make `Identify Switch` primarily a Mist-launch verification step
4. plan to remove manual Mist API key entry from the common launched flow

## Related Docs

- [docs/MIST-EXTENSION-INTEGRATION.md](/Users/mdusty/Library/CloudStorage/OneDrive-HewlettPackardEnterprise/Documents/03%20Mist%20Docs/07%20Projects/mist-junos-console/docs/MIST-EXTENSION-INTEGRATION.md)
- [docs/JUNOS-CONSOLE-EXTENSION-V1-FLOW.md](/Users/mdusty/Library/CloudStorage/OneDrive-HewlettPackardEnterprise/Documents/03%20Mist%20Docs/07%20Projects/mist-junos-console/docs/JUNOS-CONSOLE-EXTENSION-V1-FLOW.md)
- [docs/MIST-API-INTEGRATION.md](/Users/mdusty/Library/CloudStorage/OneDrive-HewlettPackardEnterprise/Documents/03%20Mist%20Docs/07%20Projects/mist-junos-console/docs/MIST-API-INTEGRATION.md)
