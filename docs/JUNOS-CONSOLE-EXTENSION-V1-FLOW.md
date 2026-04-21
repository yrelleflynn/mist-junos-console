# Junos Console Extension V1 Flow

## Purpose

Define the first practical browser-extension-driven integration flow between the
Mist UI and `junos-console`.

This is intentionally a V1 scope:

- use extension-provided Mist context
- keep the local app and backend mostly unchanged
- avoid trying to solve full Mist-native auth in one step
- reduce manual setup and make the product feel Mist-aware

Related docs:

- [docs/MIST-EXTENSION-INTEGRATION.md](/Users/mdusty/Library/CloudStorage/OneDrive-HewlettPackardEnterprise/Documents/03%20Mist%20Docs/07%20Projects/mist-junos-console/docs/MIST-EXTENSION-INTEGRATION.md)
- [docs/MIST-API-INTEGRATION.md](/Users/mdusty/Library/CloudStorage/OneDrive-HewlettPackardEnterprise/Documents/03%20Mist%20Docs/07%20Projects/mist-junos-console/docs/MIST-API-INTEGRATION.md)
- [docs/PRD.md](/Users/mdusty/Library/CloudStorage/OneDrive-HewlettPackardEnterprise/Documents/03%20Mist%20Docs/07%20Projects/mist-junos-console/docs/PRD.md)

## Live Observation Summary

From the current Mist browser extension behavior on a Mist switch page, the
extension already exposes:

- `ORG ID`
- `SITE ID`
- `SWITCH ID`

It also already understands that the operator is on a switch-scoped page and
offers quick switch-specific API access.

That means the extension already has the most important context Junos Console
needs.

## V1 Goal

Allow an operator on a Mist switch page to launch or enrich `junos-console`
with pre-scoped Mist context so the app does not require manual org/site/device
selection in the common path.

## Recommended V1 User Experience

### Entry Point

On a Mist switch page, the extension shows a new action:

- `Open in Junos Console`

Optional secondary wording:

- `Open switch in Junos Console`

This should appear alongside or near the existing switch-scoped quick actions.

### User Flow

1. Operator is on a Mist switch page
2. Extension detects current context
3. Operator clicks `Open in Junos Console`
4. Extension opens local `junos-console`
5. Extension passes Mist context to the local app
6. Local app starts already scoped to the current switch/site/org

## Context Payload

The V1 payload should be small and explicit.

Suggested shape:

```ts
type JunosConsoleLaunchContext = {
  source: 'mist-extension';
  cloudHost: string;
  apiHost: string;
  orgId: string;
  siteId: string | null;
  deviceId: string | null;
  deviceType: 'switch' | 'gateway' | 'ap' | 'unknown';
  deviceName?: string | null;
  deviceSerial?: string | null;
  siteName?: string | null;
  orgName?: string | null;
  capturedAt: string;
};
```

### Minimum required fields for switch launch

- `cloudHost`
- `apiHost`
- `orgId`
- `siteId`
- `deviceId`

Everything else is optional enrichment.

## How The Extension Should Deliver Context

For V1, the simplest path is:

- extension opens `http://localhost:3000/index.html`
- includes the launch context in a controlled way

Reasonable transport options:

### Option A: URL payload

Example concept:

```text
http://localhost:3000/index.html?mistContext=...
```

Pros:

- simple to implement
- easy for local development

Cons:

- messy for larger payloads
- visible in URL/history

### Option B: Local page message handshake

Flow:

1. extension opens local app
2. local app announces readiness
3. extension posts launch context

Pros:

- cleaner
- better for future growth

Cons:

- more coordination work

### Recommended V1 choice

Use a **small URL-based launch context** first if needed for speed, but design
the code so it can move to a cleaner postMessage/handshake model later.

## Local App Behavior On Launch

When `junos-console` receives extension context, it should:

1. store the Mist cloud/org/site/device context in local app state
2. show that the session is Mist-scoped from the extension
3. skip the usual manual org/site selection path
4. use the provided context for:
   - device matching
   - Mist status lookups
   - recent events
   - config sync preview
   - check workflows that require Mist context

### UI behavior

The app should show a light indicator such as:

- `Mist context provided by extension`

Or:

- `Scoped from Mist switch page`

This helps the operator understand why the Mist setup modal was skipped.

## What The Local App Should Still Do

The extension should not replace the local app’s existing responsibilities.

The local app should still own:

- serial connection
- switch identification
- JMA state reading
- troubleshooting checks
- bounded recovery actions
- support session sharing

The extension is only bootstrapping Mist context.

## Fallback Behavior

V1 should be resilient if context is partial or unavailable.

### Case 1: Full switch context present

Behavior:

- prefill everything
- no manual Mist selection needed

### Case 2: Org + site present, no device ID

Behavior:

- prefill cloud/org/site
- still perform switch identification and match later

### Case 3: Mist session present, but page context weak

Behavior:

- prefill cloud
- optionally prefill org if known
- fall back to app-side org/site/device flow

### Case 4: No usable Mist extension context

Behavior:

- current manual Mist API flow remains available

This is important because the extension path should improve the product without
becoming a hard dependency for all workflows.

## Security Expectations For V1

The extension should pass:

- scoped identifiers
- non-secret display metadata

It should not pass:

- raw Mist session cookies
- long-lived auth secrets

The local app can continue using its current Mist API fallback model for now.
The extension path is primarily a context shortcut in V1.

## V1 Success Criteria

V1 is successful if:

1. the operator can launch Junos Console from a Mist switch page
2. the app opens already scoped to the correct cloud/org/site/device
3. the app no longer needs manual org/site/device setup in the common path
4. the manual Mist setup modal remains available as fallback

## Recommended Future Enhancements

### V2

Let the extension also pass:

- last seen
- recent events
- device display metadata

### V3

Let the extension perform bounded Mist-side fetches and send the results to the
app so the app depends even less on manual Mist API setup.

### V4

Replace manual customer-facing token entry with a more Mist-native auth model,
potentially via scoped backend exchange.

## Bottom Line

The V1 browser integration should be simple:

- user is on a Mist switch page
- extension extracts switch context
- extension opens Junos Console with that context
- local app uses it immediately

This gives a much more natural Mist-native workflow without requiring a full
auth/platform redesign in the first iteration.
