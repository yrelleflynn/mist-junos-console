# JMA Connectivity State — Troubleshooting Recommendations

## Purpose

This document provides a structured per-state recommendation mapping for the UI to use when surfacing JMA-driven guidance. For each state, it defines:

- what the state usually means in operator terms
- which checks to surface first (using canonical check IDs from `troubleshoot.service.ts`)
- what remediation guidance to show
- whether running the full troubleshoot workflow is recommended, optional, or usually unnecessary

This is intended as an implementation reference — the frontend can consume the data shape in the [Frontend Data Shape](#frontend-data-shape) section directly.

Related docs:

- [`docs/JMA-CONNECTIVITY-STATE.md`](/Users/mdusty/Library/CloudStorage/OneDrive-HewlettPackardEnterprise/Documents/03%20Mist%20Docs/07%20Projects/mist-junos-console/docs/JMA-CONNECTIVITY-STATE.md) — state code definitions and raw mapping
- [`docs/TROUBLESHOOTING-RUNBOOK.md`](/Users/mdusty/Library/CloudStorage/OneDrive-HewlettPackardEnterprise/Documents/03%20Mist%20Docs/07%20Projects/mist-junos-console/docs/TROUBLESHOOTING-RUNBOOK.md) — check-by-check operator runbook
- [`src/services/troubleshoot.service.ts`](/Users/mdusty/Library/CloudStorage/OneDrive-HewlettPackardEnterprise/Documents/03%20Mist%20Docs/07%20Projects/mist-junos-console/src/services/troubleshoot.service.ts) — canonical check ID source

---

## Implemented Check IDs

The following check IDs are confirmed implemented in `troubleshoot.service.ts`. These are the only IDs referenced in recommendations below. Any gap from a JMA state that cannot be covered by existing checks is noted explicitly.

| Check ID | Display Name |
|----------|--------------|
| `lldp` | LLDP Neighbors |
| `upstream-port-config` | Upstream Switch Port Config |
| `port-status` | Uplink Port Status |
| `interface-errors` | Uplink Interface Errors |
| `vlan-config` | VLAN Configuration |
| `uplink-config-compare` | Uplink Config Match |
| `mgmt-ip` | Management IP Address *(critical gate)* |
| `dhcp-lease` | DHCP Lease Details |
| `arp` | ARP Table |
| `default-route` | Default Gateway *(critical gate)* |
| `dns-config` | DNS Configuration |
| `dns-resolution` | DNS Resolution & Reachability *(critical gate)* |
| `route-to-mist` | Route to Mist Endpoints |
| `fw-check` | Firewall Policy Check |
| `mist-agent` | Mist Agent Version |
| `mist-processes` | Mist Agent Processes |
| `outbound-ssh-config` | Outbound SSH Config |
| `cloud-connections` | Active Cloud Connections |
| `mist-last-seen` | Mist Last Seen *(offline timeline)* |
| `mist-events` | Recent Mist Events *(offline timeline)* |
| `switch-uptime` | Switch Uptime *(offline timeline)* |
| `mist-audit-logs` | Mist Audit Logs *(offline timeline)* |
| `switch-logs` | Switch Logs *(offline timeline)* |

---

## Per-State Recommendations

---

### 102 — NoIPAddress

**What it usually means:**
The switch has no IP address on the management interface. This is typically a local L2, VLAN, or DHCP problem — not a cloud path problem. The connectivity chain is broken at the first step.

**First checks (in order):**
1. `mgmt-ip` — confirm there is no IP on any management-capable interface
2. `dhcp-lease` — determine if DHCP is configured and whether a lease exists
3. `vlan-config` — verify the management VLAN is present on the uplink port
4. `port-status` — confirm the uplink has link and is operationally up
5. `lldp` — identify the upstream device if the uplink is unknown

**Remediation guidance:**
- If DHCP: run `request dhcp client renew irb.0` and recheck
- If no lease: verify the upstream switch allows the management VLAN on the trunk port
- If static: verify `set interfaces irb unit <vlan-id> family inet address <ip/prefix>` is committed
- Confirm the native VLAN on the uplink matches what the management VLAN expects
- Check that `set interfaces irb unit <vlan-id>` is not admin down

**Workflow recommendation:** `targeted`
Running the full workflow is premature. The switch cannot reach DNS or cloud until it has an IP. Start with the first-pass checks above. Escalate to full workflow only if the IP issue is resolved but the switch still does not connect.

---

### 103 — NoDefaultGateway

**What it usually means:**
The switch has a management IP but no default route. This is usually a DHCP Option 3 problem or a missing static default route. The switch cannot forward anything off-subnet.

**First checks (in order):**
1. `default-route` — confirm no default exists in inet.0
2. `dhcp-lease` — look for gateway (Option 3) in the lease details
3. `mgmt-ip` — confirm the management IP and prefix are correct

**Then if needed:**
4. `arp` — check whether the gateway IP appears reachable at all
5. `vlan-config` — confirm VLAN membership in case gateway is on a different VLAN

**Remediation guidance:**
- If DHCP: verify DHCP server is sending Option 3; run `show dhcp client binding detail` and look for `router` option
- If DHCP lease shows no gateway: renew with `request dhcp client renew irb.0`
- If static routing is intended: add `set routing-options static route 0.0.0.0/0 next-hop <gw-ip>` and commit
- Verify the gateway IP is on the same subnet as the management interface

**Workflow recommendation:** `targeted`
The failure is upstream of DNS and cloud. Full workflow adds noise. Resolve gateway acquisition first, then recheck JMA state.

---

### 104 — DefaultGatewayUnreachable

**What it usually means:**
The switch has an IP and a default route, but cannot actually reach the gateway. This is usually a Layer 2 adjacency problem: wrong VLAN, missing trunk, ARP failure, or a duplicate IP conflict.

**First checks (in order):**
1. `arp` — look for the gateway MAC in the ARP table
2. `port-status` — confirm the uplink has link and is operationally up
3. `interface-errors` — check for CRC/framing errors that indicate physical layer problems
4. `vlan-config` — verify the management VLAN is on the uplink

**Then if VLAN/upstream issues suspected:**
5. `lldp` — identify the upstream device
6. `upstream-port-config` — look up the upstream Mist-managed port intent
7. `uplink-config-compare` — check for trunk/native VLAN mismatch between local and upstream config

**Remediation guidance:**
- If no ARP for gateway: verify the gateway IP is reachable on the expected VLAN; check upstream switch trunk config
- If interface errors are high: replace cable or SFP; check for duplex mismatch
- If upstream is Mist-managed and the port profile does not allow the management VLAN: update the upstream port profile in Mist
- If a duplicate IP conflict is suspected: see state `151 DuplicateIPAddress`

**Workflow recommendation:** `targeted_then_full`
Start with the targeted checks above. If L2 and VLAN checks pass but the gateway is still unreachable, escalate to the full workflow — the issue may be upstream path-related and requires the full evidence set.

---

### 105 — NoDNS

**What it usually means:**
The switch has connectivity to the gateway but has no DNS servers configured. This is almost always a missing DHCP Option 6 or a missing static name-server configuration.

**First checks (in order):**
1. `dns-config` — confirm no name-server entries exist in the switch config
2. `dhcp-lease` — check whether the lease includes DNS (Option 6)

**Remediation guidance:**
- If DHCP: verify the DHCP server is sending Option 6 (DNS servers); renew with `request dhcp client renew irb.0`
- If static DNS is intended: add `set system name-server <dns-ip>` and commit
- Verify DNS server IP is reachable from the management VLAN

**Workflow recommendation:** `targeted`
This is a simple configuration gap. Full workflow is not needed unless DNS is resolved and the switch still does not connect.

---

### 106 — DNSLookupFailed

**What it usually means:**
DNS servers are configured, but the switch cannot resolve Mist hostnames. The DNS servers may be wrong, unreachable, or blocked for actual DNS queries even if they still answer pings.

**First checks (in order):**
1. `dns-config` — confirm the configured DNS server IPs look correct
2. `dns-resolution` — confirm whether Junos can reach and query configured DNS servers
3. `dns-resolution` — test whether public lookups work, whether Mist domains are selectively failing, or whether Junos reports that no DNS servers can be reached

**Remediation guidance:**
- If the configured DNS servers are unreachable: verify the route or firewall path to those resolver IPs
- If resolver IPs were learned from DHCP and may be stale: refresh them with `request dhcp client renew all`
- If the configured DNS servers are reachable but Junos says `no servers could be reached`: focus on upstream DNS transport blocking such as firewall policy on UDP/TCP 53
- If the configured DNS servers are reachable but both public and Mist lookups still fail without that transport error: focus on the upstream DNS service or DNS-specific blocking
- If public lookups work but Mist domains do not: focus on selective filtering, split-DNS, or upstream policy affecting Mist hostnames
- If needed, test with an alternate DNS server (for example 8.8.8.8) to isolate whether the issue is local to the configured resolvers

**Workflow recommendation:** `targeted`
Usually resolved by DNS-specific checks. Do not move to endpoint or certificate checks until name resolution is working again.

---

### 108 — CloudUnreachable

**What it usually means:**
The local chain (IP, gateway, DNS) appears to work, but the switch cannot establish a TCP connection to Mist cloud endpoints. This is typically a firewall policy, routing, or SSL inspection issue.

**First checks (in order):**
1. `route-to-mist` — verify a route exists toward Mist destination IPs
2. `cloud-connections` — inspect whether any live TCP sessions to Mist endpoints exist
3. `fw-check` — test TCP reachability to Mist endpoints and detect SSL interception

**Then:**
4. `outbound-ssh-config` — verify outbound SSH client config exists (for the JMA registration path)
5. `mist-processes` — verify `mcd` and `jmd` are running

**Remediation guidance:**
- If `fw-check` shows TCP 443 blocked: work with network team to permit outbound TCP 443 to Mist endpoints (`*.mist.com`, `*.mistsys.net`)
- If SSL interception is detected: Mist pinned certificates will fail behind an inspecting proxy; the proxy must be configured to pass Mist traffic without inspection
- If no route to Mist: verify default route exits through a firewall that permits outbound traffic
- If `cloud-connections` shows no active sessions but DNS works: check if a host-based firewall on the switch is blocking outbound connections (`set security policies …`)

**Workflow recommendation:** `full`
Run the full troubleshoot workflow. This state is at the top of the connectivity chain; it is worth confirming that the lower layers (IP, gateway, DNS) are all healthy before focusing on cloud path.

---

### 109 — CloudAuthFailure

**What it usually means:**
The switch can reach Mist cloud endpoints at the TCP level, but authentication or registration is failing. This is typically an identity, certificate, clock, or adoption-state problem.

**First checks (in order):**
1. `mist-processes` — confirm `mcd` and `jmd` are running
2. `mist-agent` — confirm the Mist agent version is installed and current
3. `outbound-ssh-config` — verify the outbound SSH client config used for registration
4. `cloud-connections` — confirm TCP sessions to Mist are forming

**Then for timeline context:**
5. `mist-last-seen` — when did Mist last see this device?
6. `mist-events` — look for auth failure events in Mist
7. `mist-audit-logs` — check for recent config changes that may have affected adoption state

**Remediation guidance:**
- If the switch was never adopted: retrieve adoption commands from Mist and apply them via the guided adoption flow
- If the switch was previously connected: check whether the device was deleted and re-added in Mist (adoption state reset)
- If clock drift is suspected: verify NTP configuration with `show ntp associations` — clock skew can cause certificate validation failures *(see gap: no NTP check implemented)*
- If agent version is outdated: check whether the version supports the current Mist cloud authentication model

**Workflow recommendation:** `targeted`
This state is specific enough to focus on agent and auth checks. Full connectivity workflow is not usually necessary unless the lower-layer checks indicate something unexpected.

---

### 110 — ServiceDown

**What it usually means:**
The Mist agent (`mcd` and/or `jmd`) is not running. The switch may have connectivity but the cloud connection process cannot establish because the daemons are stopped.

**First checks (in order):**
1. `mist-processes` — confirm whether `mcd` and `jmd` are running or stopped
2. `mist-agent` — confirm the agent is installed and determine its version

**Then for evidence:**
3. `switch-logs` — look for process crash or exit events
4. `switch-uptime` — determine whether a recent reboot or process restart is relevant
5. `mist-last-seen` — confirm when Mist last saw the device

**Remediation guidance:**
- If the agent process is stopped: restart with `restart mist-agent` or equivalent for the installed agent version
- If the agent binary is missing: check whether the agent package is installed with `show version | match mist`; reinstall if missing
- If the process crashes immediately on restart: check `jmd.log` for error output; this may indicate a config file corruption or upgrade failure

**Workflow recommendation:** `targeted`
The full connectivity workflow is not needed. The failure is a daemon health issue, not a path issue. If processes start successfully but the switch still does not connect, escalate to `108 CloudUnreachable` checks.

---

### 111 — Connected

**What it usually means:**
The switch believes it is fully connected and authenticated with Mist cloud. This is the healthy steady-state signal.

**First checks (in order):**
*None required by default.* If the operator is investigating a symptom despite this state being reported:

1. `cloud-connections` — confirm live TCP sessions to Mist endpoints exist
2. `fw-check` — confirm no path issues have emerged since the last connection
3. `mist-last-seen` — confirm when Mist last saw the device (cross-check with JMA state)
4. `mist-events` — look for any recent events or instability

**Remediation guidance:**
- If Mist shows the device as connected and there are no symptoms: no action needed
- If there is a mismatch between JMA state (111) and Mist showing the device as offline: wait and refresh — this is usually a timing gap between Mist polling and JMA state update
- If JMA says Connected but the operator still reports problems: run targeted checks based on the reported symptom rather than treating this as a connectivity failure

**Workflow recommendation:** `skip`
Do not run the full troubleshoot workflow automatically for this state. Only run targeted checks if the operator specifically reports ongoing symptoms.

---

### 112 — HealthIssue

**What it usually means:**
The switch believes it is connected to Mist but is reporting an internal health problem. The TCP session exists but something is wrong with the agent or daemon state. Often indicates a partial or degraded connection.

**First checks (in order):**
1. `mist-processes` — confirm both `mcd` and `jmd` are running and stable
2. `cloud-connections` — verify the TCP sessions to Mist endpoints look healthy
3. `mist-last-seen` — confirm last Mist contact timestamp
4. `mist-events` — look for health or anomaly events from Mist

**Then for evidence:**
5. `switch-logs` — look for any daemon or system error messages

**Remediation guidance:**
- If one of `mcd` or `jmd` appears stopped while the other is running: restart the stopped process
- If both processes are running but health issues persist: collect `jmd.log` evidence and escalate to Mist support
- If the switch shows recent reboots or process restarts in `switch-logs`: correlate the timing with when the health issue began

**Workflow recommendation:** `optional`
Run targeted daemon and connection checks first. Full workflow is optional and most useful if the targeted checks do not surface an obvious cause.

---

### 113 — NoDNSResponse

**What it usually means:**
DNS servers are configured, but the network path to the DNS server is not reachable. This is different from `106 DNSLookupFailed` — it means the DNS server is not responding at the network level rather than returning a failure.

**First checks (in order):**
1. `dns-config` — confirm the configured DNS server IPs
2. `dns-resolution` — test whether DNS resolution fails at the network level or returns a negative result
3. `route-to-mist` — check that routes exist to DNS server IPs (the path and Mist path often share the same upstream)
4. `fw-check` — check whether outbound UDP/53 or TCP/53 is blocked

**Remediation guidance:**
- If there is no route to the DNS server: verify that the DNS server IP is reachable via the default gateway
- If a firewall is blocking DNS: permit outbound UDP/53 and TCP/53 to the DNS server IPs
- If using ISP-provided DNS and the ISP path is down: configure a fallback DNS server

**Workflow recommendation:** `targeted`
This is a network path problem specific to DNS traffic. Targeted checks are usually sufficient. Full workflow is optional if the targeted checks resolve the issue.

---

### 115 — SoftwareDownloadFailure

**What it usually means:**
The switch attempted to download a firmware image from Mist CDN but the download failed. The switch may be connected to Mist but the image fetch path is failing — often a firewall or CDN-blocking issue separate from the primary Mist WebSocket path.

**First checks (in order):**
1. `fw-check` — test outbound TCP 443 to Mist endpoints and CDN patterns; check for SSL interception
2. `route-to-mist` — verify routes toward Mist and CDN IP ranges
3. `cloud-connections` — confirm the primary Mist session is active
4. `mist-last-seen` / `mist-events` — look for upgrade-related events from Mist

**Remediation guidance:**
- If SSL interception is detected: CDN image downloads will fail if the intercepting proxy modifies or blocks content; configure the proxy to bypass Mist CDN traffic
- If outbound TCP 443 to CDN hostnames is blocked: work with the network team to permit outbound traffic to `*.cloudflare.com`, `*.mist.com`, or the specific CDN hostnames used by Mist
- If the switch is connected but download keeps failing: check available flash storage with `show system storage`

**Workflow recommendation:** `optional`
The switch is likely connected. Run targeted cloud-path and firewall checks. Full workflow is usually not needed unless the primary connection is also failing.

---

### 116 — SoftwareUpgradeFailure

**What it usually means:**
An upgrade was attempted but failed. This may be due to an image download failure (see `115`), a verification failure, a storage issue, or a failed reboot. Evidence in the switch logs is more useful than connectivity checks for this state.

**First checks (in order):**
1. `switch-uptime` — check whether a reboot occurred and when
2. `switch-logs` — look for upgrade-related errors, partition failures, or unexpected reboots
3. `mist-last-seen` / `mist-events` — look for the upgrade event and failure event from Mist side
4. `mist-processes` — confirm the agent is running post-failure
5. `mist-agent` — confirm which agent version is currently running

**Remediation guidance:**
- If the agent is running but on an unexpected version: the upgrade may have partially succeeded; check `show version` and correlate with expected upgrade target
- If the switch is in a boot loop or is not reachable: this requires physical console access and manual intervention
- If storage is the issue: check with `show system storage`; clean up old packages if needed
- If Mist shows the device as offline post-upgrade: reattempt adoption if the agent state was lost

**Workflow recommendation:** `targeted`
Focus on lifecycle evidence rather than connectivity checks. The full troubleshoot workflow is most useful only if the switch appears unreachable after the upgrade failure.

---

### 151 — DuplicateIPAddress

**What it usually means:**
The switch has detected an IP conflict — another device on the same network is responding to ARP for the management IP. This causes intermittent connectivity failures and unpredictable behavior.

**First checks (in order):**
1. `mgmt-ip` — confirm the current management IP address
2. `arp` — look for duplicate or unexpected MAC addresses for the management IP
3. `interface-errors` — elevated error counts can accompany duplicate IP conditions

**Then:**
4. `vlan-config` — confirm the management VLAN is scoped correctly and not inadvertently shared

**Remediation guidance:**
- Identify which device owns the conflicting IP: use `show arp no-resolve` on the upstream switch to find the conflicting MAC
- If the conflict is with another network device: change the management IP assignment in Mist for one of the devices
- If DHCP is in use: check the DHCP pool for scope overlap; look for a static IP assignment collision
- Once the conflict is resolved: renew DHCP or recommit the static IP config, then verify with `ping <gateway-ip>` from the switch

**Workflow recommendation:** `targeted`
This is a specific conflict issue. Run the targeted ARP and IP checks. The full troubleshoot workflow adds limited value until the conflict is resolved.

---

## Frontend Data Shape

The following TypeScript interface describes the recommended data structure for use in the frontend. This allows the UI to drive check suggestions and guidance from a single source of truth rather than embedding state-specific logic in multiple places.

```typescript
/**
 * Workflow recommendation levels for a given JMA state.
 *
 *  full           — Run the complete troubleshoot workflow.
 *                   Useful when the state is high in the connectivity chain
 *                   and lower layers need confirming first.
 *
 *  targeted_then_full — Start with the check list below, escalate to full
 *                   workflow if those checks don't resolve the issue.
 *
 *  targeted       — Run the check list below only.
 *                   Full workflow is premature or unhelpful for this state.
 *
 *  optional       — Run targeted checks; full workflow adds context but
 *                   is not required.
 *
 *  skip           — Do not run the workflow automatically.
 *                   Only run targeted checks if the operator reports symptoms.
 */
type WorkflowRecommendation = 'full' | 'targeted_then_full' | 'targeted' | 'optional' | 'skip';

interface JmaRecommendation {
  /** Numeric JMA cc-state code */
  code: number;
  /** Raw JMA state name (from the switch) */
  label: string;
  /** Short operator-friendly title for the UI header */
  title: string;
  /** One-sentence plain-language explanation for the operator */
  summary: string;
  /** Severity for visual treatment */
  severity: 'fail' | 'warn' | 'info' | 'pass';
  /**
   * Ordered list of check IDs to surface first.
   * These match the canonical IDs in troubleshoot.service.ts.
   * The first entry is the highest-priority check.
   */
  checks: string[];
  /** Ordered remediation guidance steps (plain text, operator-friendly) */
  remediation: string[];
  /** Whether to recommend, optionally suggest, or skip the full workflow */
  workflowRecommendation: WorkflowRecommendation;
  /**
   * One-sentence explanation of the workflow recommendation,
   * suitable for showing next to the workflow button.
   */
  workflowNote: string;
}
```

### Example instance (102 NoIPAddress)

```typescript
const noIpAddress: JmaRecommendation = {
  code: 102,
  label: 'NoIPAddress',
  title: 'No management IP address',
  summary: 'The switch has no IP address on the management interface — likely a DHCP, VLAN, or uplink problem.',
  severity: 'fail',
  checks: ['mgmt-ip', 'dhcp-lease', 'vlan-config', 'port-status', 'lldp'],
  remediation: [
    'Run "request dhcp client renew irb.0" and recheck management IP.',
    'Verify the management VLAN is allowed on the upstream trunk port.',
    'If using a static IP: confirm "set interfaces irb unit <vlan-id> family inet address <ip/prefix>" is committed.',
    'Confirm the uplink port is not admin down and has link.',
  ],
  workflowRecommendation: 'targeted',
  workflowNote: 'Resolve the IP issue first — the full connectivity workflow requires a management IP to be meaningful.',
};
```

### Example instance (111 Connected)

```typescript
const connected: JmaRecommendation = {
  code: 111,
  label: 'Connected',
  title: 'Switch is connected to Mist',
  summary: 'The switch reports it is fully connected and authenticated with Mist cloud.',
  severity: 'pass',
  checks: ['cloud-connections', 'fw-check', 'mist-last-seen', 'mist-events'],
  remediation: [
    'No action needed — this is the healthy steady state.',
    'If symptoms persist despite Connected state, run targeted checks based on the reported symptom.',
  ],
  workflowRecommendation: 'skip',
  workflowNote: 'The switch reports healthy connectivity. Only run checks if the operator reports a specific problem.',
};
```

---

## Suggested UI Wording

### JMA state badge (session header)

Format: `<code> <label>` — e.g. `108 CloudUnreachable`

Pair with Mist Status for the two-signal display:

```
Mist Status:       Offline (last seen 4h ago)
JMA State:         108 CloudUnreachable
```

If the two signals disagree (e.g. JMA says `111 Connected` but Mist shows offline):

```
JMA State:         111 Connected  ⚠ Mist shows offline
```

Small note: `Switch-reported state and Mist status disagree — may indicate timing drift or stale cloud-side state.`

### Recommended checks prompt (below JMA state)

When a `fail` state is active and no troubleshooting has been run yet:

> **Switch reports `<label>`.** Recommended first checks: `<check name 1>`, `<check name 2>`, `<check name 3>`.
> [Run Recommended Checks] [Run Full Troubleshoot]

When `workflowRecommendation` is `skip` (Connected):

> **Switch reports Connected.** No troubleshooting needed. [Run Checks Anyway]

When `workflowRecommendation` is `full`:

> **Switch reports `<label>`.** Run the full troubleshoot workflow to establish a complete connectivity baseline before investigating the cloud path.
> [Run Full Troubleshoot]

### Remediation panel heading

> Remediation — `<state code>` `<label>`
> *`<summary>`*

---

## Complete Check-First Mapping (Quick Reference)

This table summarizes first-pass check ordering per state for easy reference during UI implementation.

| State | Priority 1 | Priority 2 | Priority 3 | Workflow |
|-------|-----------|-----------|-----------|---------|
| 102 NoIPAddress | `mgmt-ip` | `dhcp-lease` | `vlan-config` | targeted |
| 103 NoDefaultGateway | `default-route` | `dhcp-lease` | `mgmt-ip` | targeted |
| 104 DefaultGatewayUnreachable | `arp` | `port-status` | `interface-errors` | targeted→full |
| 105 NoDNS | `dns-config` | `dhcp-lease` | — | targeted |
| 106 DNSLookupFailed | `dns-config` | `dns-resolution` | — | targeted |
| 108 CloudUnreachable | `route-to-mist` | `cloud-connections` | `fw-check` | **full** |
| 109 CloudAuthFailure | `mist-processes` | `mist-agent` | `outbound-ssh-config` | targeted |
| 110 ServiceDown | `mist-processes` | `mist-agent` | `switch-logs` | targeted |
| 111 Connected | `cloud-connections` | `mist-last-seen` | `mist-events` | skip |
| 112 HealthIssue | `mist-processes` | `cloud-connections` | `mist-last-seen` | optional |
| 113 NoDNSResponse | `dns-config` | `dns-resolution` | `route-to-mist` | targeted |
| 115 SoftwareDownloadFailure | `fw-check` | `route-to-mist` | `cloud-connections` | optional |
| 116 SoftwareUpgradeFailure | `switch-uptime` | `switch-logs` | `mist-events` | targeted |
| 151 DuplicateIPAddress | `mgmt-ip` | `arp` | `interface-errors` | targeted |

---

## Known Gaps

The following situations arise in JMA states but are not currently covered by an implemented check. These are gaps the product could close in a future cycle.

### NTP / Clock Health

- **Affects:** `109 CloudAuthFailure`
- **Gap:** No check currently verifies NTP configuration, associations, or clock accuracy. Clock skew causes TLS certificate validation failures silently — the agent may appear to be failing authentication when it is actually a time drift issue.
- **Suggested check:** `ntp-health` — run `show ntp associations` and flag if no server is reachable or the offset is large.

### Gateway Reachability (Ping)

- **Affects:** `103 NoDefaultGateway`, `104 DefaultGatewayUnreachable`
- **Gap:** The current ARP check infers gateway reachability but does not actively probe it. A dedicated `gateway-reachability` check using `ping <gateway-ip> count 3 routing-instance default` would give a direct pass/fail for the most common first question.
- **Suggested check:** `gateway-reachability`

### DNS Server Reachability (Ping)

- **Affects:** `113 NoDNSResponse`
- **Gap:** The `dns-resolution` check tests whether hostnames resolve but does not explicitly ping the configured DNS server IP. A dedicated check would distinguish "DNS server unreachable" from "DNS server reachable but returning bad results."
- **Suggested check:** `dns-server-reachability`

### Duplicate IP Evidence

- **Affects:** `151 DuplicateIPAddress`
- **Gap:** The ARP check shows the ARP table, but no check actively looks for ARP conflicts (multiple MACs for the same IP or gratuitous ARP events in the switch log). A targeted check here would make duplicate IP evidence explicit.
- **Suggested check:** `duplicate-ip-evidence` — look for ARP table anomalies and filter `switch-logs` for ARP conflict patterns.

### Flash / Storage Health

- **Affects:** `116 SoftwareUpgradeFailure`, `115 SoftwareDownloadFailure`
- **Gap:** No check verifies available storage. Image downloads and upgrades fail silently when `/var` is full.
- **Suggested check:** `storage-health` — run `show system storage` and warn if usage exceeds a threshold.

### Outbound Traceroute

- **Affects:** `108 CloudUnreachable`, `104 DefaultGatewayUnreachable`
- **Gap:** The `fw-check` tests TCP reachability but does not show the path. A `traceroute-to-mist` check would show where in the network the path breaks.
- **Suggested check:** `traceroute-to-mist` — bounded traceroute toward a Mist endpoint IP.

---

*This document is a living implementation reference. The check IDs, workflow recommendations, and gap notes should be updated as new checks are added to `troubleshoot.service.ts`.*
