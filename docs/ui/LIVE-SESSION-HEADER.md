# Live Session Header

## Purpose

Describe how the top-of-screen session header should behave so the operator gets immediate, trustworthy context without needing to manually run every workflow.

## Current Layout

The live session header is organized into three adjacent panels:

1. `Serial Session`
2. `Device Identity`
3. `Cloud Status`

This header should remain visible while the terminal is active.

## Serial Session Panel

Shows:

- selected serial port
- basic console guidance
- the fact that the operator is in a live serial session

This panel is informational and should not be overloaded with workflow state.

## Device Identity Panel

Shows switch-local context gathered from the console:

- hostname
- model
- serial
- MAC

Shows Mist-derived context when available:

- Mist org name
- Mist site name

## Cloud Status Panel

Shows two distinct indicators:

- `Mist Status`
- `JMA Connectivity State`

Interpretation rule:

- `Mist Status` is Mist last-known or cloud-observed state
- `JMA Connectivity State` is the switch’s current self-reported cloud connectivity state

These should be presented as related but separate signals.

## Silent Bootstrap Behavior

After the serial session becomes usable, the product may silently perform lightweight bootstrap work:

1. settle the prompt after connection
2. detect that the operator is logged in
3. gather local device identity
4. match the device in Mist when cloud configuration is already available
5. refresh Mist and JMA status

These actions should update the header without polluting the visible terminal.

## Visible vs Silent Rule

- silent bootstrap and background monitoring may update the header without printing raw command traffic into the live terminal
- explicit operator-invoked workflows such as `Identify Switch`, troubleshooting, and config drift should remain visible in the terminal

See [`docs/SESSION-LOGGING-DESIGN.md`](/Users/mdusty/Library/CloudStorage/OneDrive-HewlettPackardEnterprise/Documents/03%20Mist%20Docs/07%20Projects/mist-junos-console/docs/SESSION-LOGGING-DESIGN.md) for the broader visible-versus-silent action rule.

## Loading Behavior

While silent bootstrap is still working, the `Device Identity` panel may temporarily show:

- a spinner
- an animated progress bar
- a short stage message such as:
  - `Reading switch identity…`
  - `Matching device in Mist…`
  - `Refreshing live cloud status…`

The loading treatment should remain visible until the background identity and post-identify cloud refresh finish.

## Data Source Rules

### Switch-local identity

Preferred sources:

- `show version`
- `show chassis mac-addresses`
- fallback only when needed to more specific commands such as hostname configuration queries

### Mist context

- org name should come from `GET /api/v1/self`
- site name should be resolved from the matched `site_id`
- the user does not need to preselect a site for the header to show Mist site context

## UX Goals

- make the session feel alive immediately after login
- reduce the need for manual context-building clicks
- keep the operator aware of both local device identity and cloud context
- avoid making background automation feel mysterious or noisy
