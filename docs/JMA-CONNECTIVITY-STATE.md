# JMA Connectivity State

## Purpose

Define how the product should interpret the switch-reported JMA cloud connectivity state and map it into troubleshooting results, related checks, and remediation guidance.

## Source

The state is read from:

- `show lldp local-information`

Relevant fields:

- `cc-state`
- `cc-message`
- `cc-errno`

Although the command is under LLDP local information, this should be treated as a switch-reported cloud-connectivity state rather than an LLDP feature.

## Why It Matters

This signal is high value because it represents the switch’s own synthesized view of where the Mist connectivity process is failing.

It complements the tool’s lower-level tests:

- management IP
- default gateway
- gateway reachability
- DNS presence
- DNS lookup
- cloud reachability
- authentication

## Product Role

Use this as:

1. a concise top-level connectivity summary
2. a consistency check against the tool’s own troubleshooting results
3. a continuously visible status indicator alongside Mist device connected state

If the switch-reported state and local checks agree, confidence increases.

If they disagree, the product should surface that mismatch explicitly rather than hiding it.

## State Mapping

| Code | Name | Product Status | Meaning | Primary Follow-up |
|---|---|---|---|---|
| `0` | `None` | `info` | No state reported yet | Treat as uninitialized or transitional |
| `101` | `BootComplete` | `info` | Boot finished, checks not complete yet | Wait and recheck |
| `102` | `NoIPAddress` | `fail` | No management IP | Check management interface, DHCP, VLAN |
| `103` | `NoDefaultGateway` | `fail` | Management IP exists but no default route | Check DHCP option 3 or static route |
| `104` | `DefaultGatewayUnreachable` | `fail` | Gateway exists but is unreachable | Check L2, VLAN, gateway, duplicate IP |
| `105` | `NoDNS` | `fail` | No DNS servers configured | Check DHCP DNS or static name-server config |
| `106` | `DNSLookupFailed` | `fail` | DNS configured but lookup failed | Check DNS reachability and resolver behavior |
| `107` | `ConnectionRequestSent` | `warn` | Connection attempt in progress | Transitional, recheck shortly |
| `108` | `CloudUnreachable` | `fail` | Local checks passed but cloud connect failed | Check firewall, TCP 443, cloud path |
| `109` | `CloudAuthFailure` | `fail` | Cloud reachable but authentication failed | Check cert, registration, clock |
| `110` | `ServiceDown` | `fail` | JMA service exited or stopped | Check service health and logs |
| `111` | `Connected` | `pass` | Fully connected and authenticated | Healthy steady state |
| `112` | `HealthIssue` | `warn` | Connected but unhealthy | Inspect daemon logs and health symptoms |
| `113` | `NoDNSResponse` | `fail` | DNS server unreachable at network level | Check route or firewall to DNS server |
| `114` | `EmptyDNSResponse` | `fail` | DNS response contained no IPs | Check DNS zone or split-horizon behavior |
| `115` | `SoftwareDownloadFailure` | `warn` | Image download failed | Check CDN or cloud reachability |
| `116` | `SoftwareUpgradeFailure` | `warn` | Upgrade failed | Check logs, image, storage, reboot history |
| `117` | `SoftwareUpgradeInProgress` | `info` | Upgrade in progress | Transitional |
| `118` | `SoftwareDownloadComplete` | `info` | Download complete | Informational |
| `119` | `CloudReady` | `info` | Provisioned and ready to connect | Transitional or pre-connected |
| `151` | `DuplicateIPAddress` | `fail` | Duplicate IP detected | Check IP conflict immediately |

## Recommended Related Checks

Map states to existing troubleshooting checks where possible.

- `102 NoIPAddress`
  - `mgmt-ip`
  - `dhcp-lease`
  - `vlan-config`

- `103 NoDefaultGateway`
  - `default-route`
  - `dhcp-lease`

- `104 DefaultGatewayUnreachable`
  - `arp`
  - `vlan-config`
  - uplink and interface health checks

- `105 NoDNS`
  - `dns-config`

- `106 DNSLookupFailed`
  - `dns-config`
  - `dns-resolve`

- `113 NoDNSResponse`
  - `dns-config`
  - `dns-resolve`
  - any future DNS reachability or firewall-to-DNS checks

- `108 CloudUnreachable`
  - `route-to-mist`
  - firewall and outbound connectivity checks
  - Mist daemon log evidence

- `109 CloudAuthFailure`
  - identity, adoption, and auth-oriented checks

- `110 ServiceDown`
  - Mist process and service checks

- `112 HealthIssue`
  - daemon logs
  - health-related supporting evidence

## Recommended Remediation Mapping

### `102 NoIPAddress`

- verify management interface config
- verify DHCP or static IP configuration
- verify management VLAN presence

### `103 NoDefaultGateway`

- verify DHCP Option 3
- verify static default route

### `104 DefaultGatewayUnreachable`

- verify Layer 2 path to the gateway
- verify VLAN and ARP behavior
- if duplicate IP is indicated, investigate IP conflict immediately

### `105 NoDNS`

- verify DNS servers are configured
- verify DHCP is supplying DNS if expected

### `106 DNSLookupFailed`

- verify DNS server reachability
- verify cloud hostname resolution

### `113 NoDNSResponse`

- verify route and firewall path to DNS server

### `108 CloudUnreachable`

- verify outbound TCP 443 path
- verify cloud endpoint reachability
- inspect `jmd.log` and `mcd.log`

### `109 CloudAuthFailure`

- verify device certificate and registration state
- verify clock and time sync

### `110 ServiceDown`

- inspect daemon status and logs
- verify service restart path if appropriate

### `112 HealthIssue`

- inspect daemon logs
- correlate with switch and Mist evidence

## UI Guidance

Present this as:

- `JMA Connectivity State`

Show:

- numeric state code
- state name
- raw `cc-message`
- raw `cc-errno`
- normalized interpretation
- related checks

Recommended paired status model:

- `Mist Status` = last-known connected state from Mist
- `JMA Connectivity State` = current switch-reported cloud-connectivity state

These should both remain visible in the UI because agreement or mismatch between them is diagnostically valuable.

Recommended refresh behavior:

- refresh periodically while the session is active
- treat this as lightweight status polling, separate from full troubleshooting runs
- show the last refresh time in the UI where practical

## Mismatch Handling

If the switch-reported state conflicts with the tool’s local troubleshooting checks, show an explicit mismatch note such as:

`Switch-reported connectivity state does not fully match the current local test results. This may indicate stale state, timing drift, or a diagnostic mismatch.`

## AI Agent Guidance

This is a strong structured signal for AI-assisted troubleshooting because it already encodes the switch’s internal diagnosis path.

It should be exposed as a structured field rather than only as raw terminal text.

## Implementation Note

Do not depend on the explanatory state-reference text always being present in command output.

The numeric state mapping should live in code.
