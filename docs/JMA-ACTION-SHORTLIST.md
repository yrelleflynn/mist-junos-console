# JMA State → Action Shortlist

## Purpose

This note narrows the remediation focus for the hackathon demo.

The product already has a large troubleshooting surface, but the strongest
hackathon story is no longer "we can run lots of checks." It is:

- the switch reports its own cloud failure domain via JMA state
- the app explains what that means
- the app offers one or two useful next actions in the same workspace

This document identifies:

- which JMA states are best suited to in-app actions
- which actions are strong enough to emphasize in the demo
- which states should remain guidance-first rather than fully actioned

Related docs:

- [`docs/JMA-RECOMMENDATIONS.md`](/Users/mdusty/Library/CloudStorage/OneDrive-HewlettPackardEnterprise/Documents/03%20Mist%20Docs/07%20Projects/mist-junos-console/docs/JMA-RECOMMENDATIONS.md)
- [`docs/TROUBLESHOOTING-RUNBOOK.md`](/Users/mdusty/Library/CloudStorage/OneDrive-HewlettPackardEnterprise/Documents/03%20Mist%20Docs/07%20Projects/mist-junos-console/docs/TROUBLESHOOTING-RUNBOOK.md)
- [`docs/HACKATHON-DEMO.md`](/Users/mdusty/Library/CloudStorage/OneDrive-HewlettPackardEnterprise/Documents/03%20Mist%20Docs/07%20Projects/mist-junos-console/docs/HACKATHON-DEMO.md)

## Core Product Position

The app does not need to turn every JMA state into a one-click fix.

For the current phase:

- JMA state should identify the likely failure domain
- targeted checks should gather confirmation and operator evidence
- actions should be limited to bounded, explainable, high-confidence recovery steps

This is especially important because many JMA states already imply that the
switch has performed the underlying connectivity tests internally. The app's job
is often to:

- make that state understandable
- gather supporting evidence
- offer the next meaningful action

## High-Value Demo Actions

These are the strongest actions to emphasize now.

### 1. Config Sync

Status:

- implemented

Why it matters:

- This is the core "Mist to offline switch" bridge.
- It is the cleanest answer to the common customer scenario:
  - operator changes config in Mist
  - switch is offline
  - switch cannot receive those changes
  - console session is used to stage and apply the intended diff safely

Best fit states:

- `102 NoIPAddress`
- `103 NoDefaultGateway`
- `104 DefaultGatewayUnreachable`
- `105 NoDNS`
- some `108 CloudUnreachable`
- some `109 CloudAuthFailure`

Product note:

Config Sync is not just another action. It is the main remediation bridge for
any state where the real fix is "correct the intent in Mist, then apply it
locally because the switch is offline."

### 2. DHCP Refresh

Status:

- implemented

Why it matters:

- bounded
- reversible enough for demo use
- easy to explain in operator terms
- strong fit for disconnected-switch recovery

Best fit states:

- `102 NoIPAddress`
- `103 NoDefaultGateway`
- `105 NoDNS`
- `106 DNSLookupFailed`
- `151 DuplicateIPAddress` after the conflict is resolved

Best demo scenario:

- switch is DHCP-managed
- DHCP scope or delivered DNS servers were corrected upstream
- switch still holds stale DHCP-learned DNS servers
- DHCP Refresh forces lease renewal
- switch picks up the new DNS servers and reconnects

### 3. Adopt Switch

Status:

- implemented

Why it matters:

- directly addresses incomplete or missing adoption state
- strong support and onboarding value

Best fit states:

- `109 CloudAuthFailure`
- some `110 ServiceDown`
- factory-default / zeroized switch scenarios

## Best Next Implementations

These are the next actions worth adding if time allows.

### 4. Restart Mist Agent

Status:

- not implemented as a dedicated action
- remediation guidance already points to it

Why it matters:

- narrow, understandable recovery action
- strong fit for service/daemon failure states
- likely straightforward to build

Best fit states:

- `110 ServiceDown`
- some `112 HealthIssue`

Likely command shape:

- `restart mist-agent`

Implementation note:

Exact command behavior should be validated on the target EX software train and
agent packaging. The app should present it as a deliberate operator action, not
as a silent background recovery.

### 5. Bounce Outbound SSH Client

Status:

- not implemented as a dedicated action
- remediation logic already suggests it

Why it matters:

- bounded config change
- fits JMA registration/auth failure recovery
- existing remediation mapping already points to the command pair

Best fit states:

- `109 CloudAuthFailure`
- some `112 HealthIssue`
- selected `108 CloudUnreachable` cases once lower layers are healthy

Likely command shape:

- `deactivate system services outbound-ssh client mist`
- `activate system services outbound-ssh client mist`

Implementation note:

This is a stronger action than DHCP Refresh because it changes running config,
but it is still narrow and explainable.

## Guidance-First States

These states are still valuable in the demo, but they should mainly drive:

- explanation
- evidence gathering
- recommendation toward Config Sync or external remediation

### `104 DefaultGatewayUnreachable`

Why guidance-first:

- often a trunk/VLAN/upstream adjacency issue
- not usually fixable with one safe generic local command

Good in-app direction:

- show evidence
- recommend Config Sync if the intended uplink/native VLAN profile was already corrected in Mist

### `108 CloudUnreachable`

Why guidance-first:

- often firewall, route, SSL inspection, or upstream policy
- not typically fixable locally with one safe generic action

Good in-app direction:

- show evidence
- recommend Config Sync only when the root cause is config drift on the switch
- otherwise guide the operator toward firewall/path remediation

### `113 NoDNSResponse`

Why guidance-first:

- often upstream DNS server/path issue
- may still benefit from DHCP Refresh if DNS servers were learned dynamically

Good in-app direction:

- if DHCP-learned resolvers may be stale, suggest DHCP Refresh
- otherwise stay guidance-first

### `115 SoftwareDownloadFailure`

Why guidance-first:

- likely CDN/path/storage issue
- not a good candidate for a simple generic fix

### `116 SoftwareUpgradeFailure`

Why guidance-first:

- likely storage/process/post-upgrade issue
- may need logs, packaging review, or re-adoption

### `151 DuplicateIPAddress`

Why guidance-first:

- requires deciding which host actually owns the IP
- not safe to auto-remediate

Good in-app direction:

- once the conflict is resolved upstream, DHCP Refresh can be useful to reacquire a clean lease

## State-To-Action Mapping

### Implement now / emphasize now

| JMA state | Primary action | Secondary action | Notes |
|-----------|----------------|------------------|-------|
| `102 NoIPAddress` | Config Sync | DHCP Refresh | Strong demo state when Mist intent was corrected but the switch is still offline |
| `103 NoDefaultGateway` | Config Sync | DHCP Refresh | Especially good when DHCP option / VLAN intent was corrected in Mist |
| `105 NoDNS` | Config Sync | DHCP Refresh | Missing DNS config can be solved either by corrected Mist intent or renewed DHCP-delivered DNS |
| `106 DNSLookupFailed` | DHCP Refresh | Config Sync | Best when stale DHCP-learned DNS servers are the issue |
| `109 CloudAuthFailure` | Adopt Switch | Config Sync | Strong fit when adoption state or outbound SSH config is missing |
| `110 ServiceDown` | Restart Mist Agent | Adopt Switch | Next likely remediation action to implement |

### Guidance only for now

| JMA state | Recommended product posture |
|-----------|-----------------------------|
| `104 DefaultGatewayUnreachable` | Evidence + Config Sync if upstream/local intent was corrected in Mist |
| `108 CloudUnreachable` | Evidence + path/firewall guidance; Config Sync only if drift is clearly the cause |
| `113 NoDNSResponse` | Evidence-first; DHCP Refresh only when stale DHCP-delivered resolvers are plausible |
| `115 SoftwareDownloadFailure` | Evidence-first |
| `116 SoftwareUpgradeFailure` | Evidence-first |
| `151 DuplicateIPAddress` | Evidence-first; DHCP Refresh only after conflict is resolved |

## Recommended Demo Emphasis

If time is limited, the best remediation story is:

1. **Config Sync**
2. **DHCP Refresh**
3. **One more bounded recovery action**

The best candidate for that third action is:

- **Restart Mist Agent**

Why:

- it is easy to explain
- it aligns directly with `110 ServiceDown`
- it complements Config Sync and DHCP Refresh without expanding the risk surface too much

## Design Principle

The product should prefer actions that are:

- bounded
- operator-comprehensible
- easy to explain in a demo
- safe enough to present as productized workflow actions

It should avoid pretending that every disconnected-switch problem has a safe
one-click fix. In many cases the most valuable action is:

- correct the intent in Mist
- use **Config Sync** to bridge that intent to the offline switch

That is already a compelling and realistic self-driving recovery story.
