# Troubleshooting Runbook

## Purpose

This runbook describes:

- the current troubleshooting sub-checks in the product
- what each check is for
- when it is most useful
- how those checks map to the switch-reported JMA cloud connectivity state

This document builds on the test-by-test reference in [`README.txt`](/Users/mdusty/Library/CloudStorage/OneDrive-HewlettPackardEnterprise/Documents/03%20Mist%20Docs/07%20Projects/mist-junos-console/README.txt:1), but reframes the content into an operator and product runbook that matches the current UI and troubleshooting engine.

Related docs:

- [`docs/JMA-CONNECTIVITY-STATE.md`](/Users/mdusty/Library/CloudStorage/OneDrive-HewlettPackardEnterprise/Documents/03%20Mist%20Docs/07%20Projects/mist-junos-console/docs/JMA-CONNECTIVITY-STATE.md:1)
- [`docs/PRD.md`](/Users/mdusty/Library/CloudStorage/OneDrive-HewlettPackardEnterprise/Documents/03%20Mist%20Docs/07%20Projects/mist-junos-console/docs/PRD.md:164)
- [`README.txt`](/Users/mdusty/Library/CloudStorage/OneDrive-HewlettPackardEnterprise/Documents/03%20Mist%20Docs/07%20Projects/mist-junos-console/README.txt:1)

## Operating Model

The product now has two complementary cloud signals:

- `Mist Status`
  - Mist-side, last-known platform view
- `JMA Connectivity State`
  - switch-side, current self-reported connectivity view

Use them together.

Recommended operator flow:

1. Look at `JMA Connectivity State` first.
2. Use that state to pick the most relevant first-pass checks.
3. Use `Mist Status` as a consistency check, not the only source of truth.
4. If switch-reported state and local checks disagree, treat that as useful diagnostic evidence rather than a product bug by default.

## Current Check Inventory

Below is the current check surface exposed by the troubleshooting engine in [`src/services/troubleshoot.service.ts`](/Users/mdusty/Library/CloudStorage/OneDrive-HewlettPackardEnterprise/Documents/03%20Mist%20Docs/07%20Projects/mist-junos-console/src/services/troubleshoot.service.ts:1).

### LLDP Neighbors

- Purpose: find the likely uplink port and nearest upstream device
- Best used when:
  - uplink port is unknown
  - physical path is unclear
  - you need an upstream identity anchor before doing port/profile comparison

### Upstream Switch Port Config

- Purpose: look up the upstream Mist-managed switch and determine the intended profile for the port facing this switch
- Best used when:
  - LLDP found a managed upstream device
  - you suspect trunk/native VLAN/profile mismatch

### Uplink Port Status

- Purpose: confirm the uplink has carrier and is operationally up
- Best used when:
  - there is any L1/L2 suspicion
  - you are troubleshooting `NoIPAddress`, `DefaultGatewayUnreachable`, or intermittent instability

### Uplink Interface Errors

- Purpose: surface CRC, framing, discard, and similar interface error counters
- Best used when:
  - the link is up but traffic still looks unhealthy
  - there is a cable/optic/duplex suspicion

### VLAN Configuration

- Purpose: confirm VLAN membership exists on the uplink
- Best used when:
  - DHCP, gateway, or DNS failures may actually be tagging problems

### Uplink Config Match

- Purpose: compare local uplink intent against upstream Mist-managed intent and generate corrective `set` commands
- Best used when:
  - LLDP found a managed upstream switch
  - the local uplink and upstream profile may not align

### Management IP Address

- Purpose: confirm the switch has an IP address on a management-capable interface
- Best used when:
  - always early in the flow
- Product note:
  - this is a critical gate; if there is no management IP, most cloud checks are skipped

### DHCP Lease Details

- Purpose: show whether IP/gateway/DNS came from DHCP and whether the lease is healthy
- Best used when:
  - the switch should be DHCP-driven
  - gateway or DNS options look missing
- Operational note:
  - preferred first recovery step:
    - `request dhcp client renew irb.0`
  - if the DHCP client still appears stuck, a stronger workaround is to
    remove and re-add the IRB DHCP client stanza during a maintenance window
    and then re-check `show dhcp client binding detail`

### ARP Table

- Purpose: verify L2 neighbor discovery is working well enough to populate ARP
- Best used when:
  - gateway reachability is in doubt
  - duplicate IP or VLAN adjacency is suspected

### Default Gateway

- Purpose: confirm a default route exists
- Best used when:
  - management IP exists but nothing cloud-related works
- Product note:
  - this is a critical gate; if there is no default route, downstream cloud checks are skipped

### DNS Configuration

- Purpose: confirm DNS servers are configured somewhere meaningful
- Best used when:
  - JMA says `NoDNS`
  - the switch appears to have an IP and route but still cannot reach cloud services by name

### DNS Resolution & Reachability

- Purpose: prove that Mist hostnames resolve and are at least network-reachable enough to test
- Best used when:
  - JMA says `DNSLookupFailed`, `NoDNSResponse`, or `EmptyDNSResponse`
- Product note:
  - this is a critical gate for endpoint-oriented checks

### Route to Mist Endpoints

- Purpose: verify the switch has a route toward the Mist destination IPs
- Best used when:
  - DNS works but the switch still cannot establish cloud connectivity

### Firewall Policy Check

- Purpose: actively test TCP reachability to Mist endpoints and inspect HTTPS certificate behavior for SSL interception
- Best used when:
  - JMA says `CloudUnreachable`
  - you suspect outbound filtering or SSL inspection

### Mist Agent Version

- Purpose: confirm the Mist agent is installed and determine its version
- Best used when:
  - adoption, packaging, or lifecycle questions exist
  - `ServiceDown` or health issues are suspected

### Mist Agent Processes

- Purpose: confirm `mcd` and `jmd` are actually running
- Best used when:
  - JMA says `ServiceDown`
  - JMA says `HealthIssue`
  - cloud should be up but there are no active sessions

### Outbound SSH Config

- Purpose: verify outbound SSH client config exists and appears sane
- Best used when:
  - agent is installed but not establishing expected cloud sessions
  - adoption state may be incomplete

### Active Cloud Connections

- Purpose: inspect live TCP sessions from the management IP and validate them against expected Mist endpoints
- Best used when:
  - cloud path looks partially alive
  - you need to know whether sessions are actually forming

### Offline Timeline / Disconnect Evidence

- Includes:
  - `Mist Last Seen`
  - `Recent Mist Events`
  - `Switch Uptime`
  - `Mist Audit Logs (config changes)`
  - `Switch Logs`
  - `System Messages (around disconnect)`
- Purpose: collect evidence around a disconnect or instability event
- Best used when:
  - the switch was previously connected and later went offline
  - you need event/log correlation rather than only point-in-time status

## JMA-Driven First-Pass Runbook

Use the JMA state to choose the smallest meaningful set of checks first.

### `102 NoIPAddress`

Run first:

- `Management IP Address`
- `DHCP Lease Details`
- `VLAN Configuration`
- `Uplink Port Status`
- `LLDP Neighbors`

Why:

- this is usually a local L2, VLAN, or DHCP problem rather than a cloud problem

### `103 NoDefaultGateway`

Run first:

- `Default Gateway`
- `DHCP Lease Details`
- `Management IP Address`

Then:

- `ARP Table`
- `VLAN Configuration`

Why:

- this points to route acquisition rather than DNS or cloud path

### `104 DefaultGatewayUnreachable`

Run first:

- `ARP Table`
- `Uplink Port Status`
- `Uplink Interface Errors`
- `VLAN Configuration`

Then:

- `LLDP Neighbors`
- `Upstream Switch Port Config`
- `Uplink Config Match`

Why:

- this usually indicates local path, VLAN, or gateway adjacency problems

### `105 NoDNS`

Run first:

- `DNS Configuration`
- `DHCP Lease Details`

Then:

- `Default Gateway`

Why:

- DNS servers may simply be absent from config or DHCP

### `106 DNSLookupFailed`

Run first:

- `DNS Configuration`
- `DNS Resolution & Reachability`

Then:

- `Route to Mist Endpoints`
- `Firewall Policy Check`

Why:

- DNS is configured but not functioning end-to-end

### `113 NoDNSResponse`

Run first:

- `DNS Configuration`
- `DNS Resolution & Reachability`

Then:

- `Route to Mist Endpoints`
- `Firewall Policy Check`

Why:

- this usually indicates DNS path reachability rather than only missing config

### `114 EmptyDNSResponse`

Run first:

- `DNS Resolution & Reachability`

Then:

- Mist-side or upstream DNS investigation

Why:

- the resolver responded, but not with a useful result

### `108 CloudUnreachable`

Run first:

- `Route to Mist Endpoints`
- `Active Cloud Connections`
- `Firewall Policy Check`

Then:

- `Traceroute`
- `Outbound SSH Config`

Why:

- local IP/route/DNS may be fine, but the cloud path or policy is not

### `109 CloudAuthFailure`

Run first:

- `Mist Agent Processes`
- `Mist Agent Version`
- `Outbound SSH Config`
- `Active Cloud Connections`

Then:

- `Offline Timeline / Disconnect Evidence`
- Mist-side event and audit evidence

Why:

- transport may exist but the device is failing registration or authentication

### `110 ServiceDown`

Run first:

- `Mist Agent Processes`
- `Mist Agent Version`

Then:

- `Offline Timeline / Disconnect Evidence`

Why:

- this points to local daemon health rather than only path reachability

### `111 Connected`

Default approach:

- do not run the full workflow automatically
- only run targeted checks if the operator still reports symptoms

Good targeted choices:

- `Offline Timeline / Disconnect Evidence`
- `Active Cloud Connections`
- `Firewall Policy Check`

Why:

- this is a healthy steady-state signal according to the switch

### `112 HealthIssue`

Run first:

- `Mist Agent Processes`
- `Active Cloud Connections`
- `Offline Timeline / Disconnect Evidence`

Why:

- the switch believes it is connected but not healthy

### `115 SoftwareDownloadFailure`

Run first:

- `Firewall Policy Check`
- `Route to Mist Endpoints`
- `Active Cloud Connections`
- `Offline Timeline / Disconnect Evidence`

Why:

- likely CDN/cloud-path or package-fetch related

### `116 SoftwareUpgradeFailure`

Run first:

- `Offline Timeline / Disconnect Evidence`
- `Mist Agent Processes`
- `Switch Uptime`

Why:

- usually lifecycle/install/reboot evidence matters more than simple path checks

### `117 SoftwareUpgradeInProgress`

Default approach:

- usually wait and recheck first

If it appears stuck:

- `Offline Timeline / Disconnect Evidence`
- `Mist Agent Processes`

### `119 CloudReady`

Default approach:

- treat as transitional
- usually recheck before running heavy troubleshooting

### `151 DuplicateIPAddress`

Run first:

- `Management IP Address`
- `ARP Table`
- `Uplink Interface Errors`

Then:

- `VLAN Configuration`
- upstream validation

Why:

- this suggests local conflict evidence and address contention

## Recommended Operator Profiles

### Fast triage

Use:

- `JMA Connectivity State`
- the small state-specific first-pass set above

Best for:

- quickly deciding whether the issue is IP, route, DNS, cloud path, auth, or daemon health

### Full connectivity workflow

Use:

- `Run Troubleshoot`

Best for:

- methodical end-to-end troubleshooting
- escalations
- evidence collection for others

### Disconnect investigation

Use:

- `Offline Timeline`
- Mist/JMA status

Best for:

- intermittent or historical outages
- “it was connected yesterday” cases

## Known Gaps / Future Checks

The current runbook is already useful, but these additions would improve state-to-check mapping further:

- `Clock / NTP Health`
  - especially valuable for `CloudAuthFailure`
- `Gateway Reachability`
  - a more direct companion to `NoDefaultGateway` / `DefaultGatewayUnreachable`
- `DNS Server Reachability`
  - especially valuable for `NoDNSResponse`
- `Duplicate IP Evidence`
  - especially valuable for `DuplicateIPAddress`

## Product Guidance

The product should eventually expose this runbook more directly as:

- recommended next checks based on JMA state
- a reduced “first-pass” checklist before running the full workflow
- explicit source labels such as:
  - `mist_last_known`
  - `switch_reported`
  - `live_console`
  - `disconnect_evidence`

This would make both the operator UX and future AI-assisted diagnosis more guided without hiding the raw evidence.
