# Mist UI Session And Extension Integration

## Implemented Now

The integration is no longer purely conceptual.

Current implemented flow:

1. operator opens a Mist switch page
2. browser extension resolves switch context from the authenticated Mist browser session
3. extension posts the launch payload to the local backend
4. backend stores it behind a short-lived `/extension-launch/<token>` entry
5. local app opens with `mistLaunchToken`
6. frontend imports the launch context, cleans the URL, persists the launch overlay in session storage, and enters Mist Launch Mode

Current launch-backed data can include:

- cloud / API host
- org, site, and device identifiers
- device name
- serial
- MAC
- `switch_mgmt.root_password`
- `config_cmd`
- monitor / status data

Current app behavior after launch:

- verification of the console-connected switch becomes the first priority
- `Mist Status` and `Switch Cloud State` remain `Unknown` until verification succeeds
- checks, actions, config sync, and adoption stay gated until the console-connected switch matches the Mist-launched switch
- manual Mist API setup remains fallback only

## Purpose

Describe how `junos-console` could integrate with the authenticated Mist browser
session and Mist UI context without requiring the local app to directly own or
read Mist session cookies.

This document focuses on:

- using the browser extension as the integration bridge
- reducing or eliminating manual Mist API token entry
- inheriting Mist org/site/device context from the Mist UI
- keeping the security boundary cleaner than a raw localhost-cookie model

Related docs:

- [docs/MIST-API-INTEGRATION.md](/Users/mdusty/Library/CloudStorage/OneDrive-HewlettPackardEnterprise/Documents/03%20Mist%20Docs/07%20Projects/mist-junos-console/docs/MIST-API-INTEGRATION.md)
- [docs/MIST-LAUNCH-MODE.md](/Users/mdusty/Library/CloudStorage/OneDrive-HewlettPackardEnterprise/Documents/03%20Mist%20Docs/07%20Projects/mist-junos-console/docs/MIST-LAUNCH-MODE.md)
- [docs/PROTOTYPE-TO-PRODUCTION-ARCHITECTURE.md](/Users/mdusty/Library/CloudStorage/OneDrive-HewlettPackardEnterprise/Documents/03%20Mist%20Docs/07%20Projects/mist-junos-console/docs/PROTOTYPE-TO-PRODUCTION-ARCHITECTURE.md)
- [docs/SECURITY.md](/Users/mdusty/Library/CloudStorage/OneDrive-HewlettPackardEnterprise/Documents/03%20Mist%20Docs/07%20Projects/mist-junos-console/docs/SECURITY.md)

## Short Answer

Yes: the natural product shape is a **Junos Console Chrome/Edge extension**.

That extension could either be:

- a dedicated `Junos Console` extension, or
- an evolution of the existing Mist browser extension if that is operationally
  easier inside the Mist ecosystem

The better long-term pattern is:

- Mist UI session stays in the browser
- the extension uses Mist context and session-aware capabilities
- the extension passes safe scoped context or results to the local app

Not:

- the localhost app directly reading or depending on raw Mist cookies

## Why Use The Extension

The extension solves two major product issues:

### 1. No manual token paste

Instead of asking the operator to paste a Mist API token into the local app,
the extension can bootstrap Mist context from the browser environment the user
is already authenticated in.

### 2. Native org/site/device context

If the operator launched from a Mist device page, or if the extension can read
current Mist UI context, the app can start with:

- cloud / region
- org
- site
- device

already known.

That is a much more natural Mist-native experience than asking the user to
manually select everything.

## Design Principle

The extension should be the bridge between Mist UI and the local app.

Good model:

- Mist session lives in the browser
- extension reads safe Mist context or performs bounded Mist-side fetches
- local app receives scoped context or results

Bad model:

- localhost app tries to directly consume browser session cookies
- raw Mist session material is copied into the local app or local backend

## Roles And Responsibilities

## Browser Extension Responsibilities

The extension should own browser/Mist-specific behaviors:

- detect whether the user is logged into Mist
- determine current Mist cloud / region
- capture current org/site/device context when available
- optionally launch the local app with that context
- optionally perform bounded Mist-side context fetches
- pass normalized context to the local app

### Good initial extension-provided context

- `cloud`
- `orgId`
- `orgName`
- `siteId`
- `siteName`
- `deviceId`
- `deviceName`
- `deviceSerial`

### Optional early extension-fetched data

- Mist `last_seen`
- recent device events
- device match metadata

## Local App Responsibilities

The local app should continue owning:

- serial session handling
- operator/support remote session
- bounded troubleshooting checks
- bounded recovery actions
- local UI state and session orchestration

The local app should consume Mist-aware context, not try to become the Mist
session owner.

## Backend Responsibilities

The backend should remain responsible for:

- bounded product APIs
- local workflow orchestration
- remote-session relay
- future AI analysis
- optionally server-side Mist integration where appropriate

In the longer term, the backend may also validate extension-provided context or
exchange it for a short-lived scoped service token.

## Recommended Integration Levels

## Level 1: Context Bridging

This is the simplest and best first step.

Extension provides:

- cloud
- org/site/device context

Local app uses that to:

- prefill or skip the Mist API modal
- show Mist-aware context immediately
- scope device matching and troubleshooting automatically

This already improves the product a lot.

## Level 2: Extension-Assisted Mist Fetches

The extension performs bounded Mist-side lookups from the authenticated browser
environment, then passes the results to the local app.

Good candidates:

- `self` / org list
- site list
- current device page context
- recent events
- device status summary

This can remove even more need for manual token entry during local development
or extension-first deployment.

## Level 3: Scoped Backend Exchange

This is the best long-term production model.

Flow:

1. User is authenticated in Mist UI
2. Extension obtains current Mist context and authenticated proof
3. Backend validates or exchanges that for a short-lived scoped backend token
4. Backend uses that scoped identity for Mist-side operations

Benefits:

- cleaner security model
- less trust in the local page
- better tenant scoping
- easier auditability
- stronger fit with Mist-native architecture

## Candidate User Flow

### Option A: Launch from Mist

1. Operator is on a Mist site or device page
2. Operator clicks `Open in Junos Console`
3. Extension opens the local app
4. Extension provides:
   - cloud
   - org/site/device context
5. Local app opens already scoped to the relevant device/site

### Option B: Launch from local app

1. Operator opens local `junos-console`
2. Extension detects Mist-authenticated browser context
3. App offers:
   - `Use current Mist context`
4. Context is injected into the local app

This is weaker than launch-from-Mist, but still far better than manual token
entry.

## Security Model

### What the extension may safely pass

- cloud / region
- org/site/device identifiers
- normalized device metadata
- bounded fetch results such as recent events or last-seen summaries

### What the extension should avoid passing directly

- raw Mist session cookies
- long-lived auth secrets
- anything equivalent to browser-session exfiltration

The goal is to let the extension act as:

- a context bridge
- or a bounded Mist-aware helper

not a cookie-export tool.

## Suggested Message Flow

```text
Mist UI tab
   │
   ▼
Junos Console Extension
   │
   ├── reads Mist page/session-aware context
   ├── optionally performs bounded Mist-side fetches
   │
   ▼
Local Junos Console app
   │
   ├── serial session handling
   ├── troubleshooting
   ├── bounded recovery actions
   └── optional backend APIs
```

## V1 Recommendation

For the first practical version:

- ship a **Junos Console Chrome/Edge extension**
- let it detect Mist login and current org/site/device context
- let it prefill the local app context
- keep the local app and backend otherwise mostly unchanged

This delivers strong product value without requiring full auth redesign first.

## V2 Recommendation

Add extension-assisted Mist fetches for:

- org list
- site list
- device page context
- recent device events
- last-seen summary

At this stage, the Mist API token modal can become a fallback rather than the
main path.

## V3 Recommendation

Move toward a Mist-native model:

- launch from Mist
- use Mist identity and RBAC
- exchange extension/browser context for short-lived backend-scoped access
- eventually remove customer-facing manual token entry altogether

## Dedicated Junos Console Extension vs Existing Mist Extension

Either can work.

### Dedicated `Junos Console` extension

Pros:

- clear product ownership
- purpose-built UX
- easier to evolve around console-specific workflows

Cons:

- another extension to ship and maintain

### Evolve the existing Mist extension

Pros:

- may already have session/context plumbing
- less duplicated browser integration work
- possibly smoother internal platform fit

Cons:

- tighter coupling to extension behaviors not specific to Junos Console
- product boundaries may be less clear

My recommendation:

- near term: whichever path is easiest operationally
- product framing: present it as the **Junos Console browser extension**
  experience, even if it initially reuses existing Mist extension plumbing

## Bottom Line

Yes: this should be thought of as the **Junos Console Chrome/Edge extension**
integration model.

The key idea is:

- Mist session remains browser-owned
- extension uses that session-aware environment
- extension passes safe scoped context or bounded results to the local app

That gives a much better user experience than manual token entry and a much
cleaner security posture than trying to make the localhost app directly consume
Mist browser session state.
