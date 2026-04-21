# Mist Local Console

A browser-based tool that bridges a switch's physical serial console to the
Mist cloud. Technicians plug in a USB-to-serial cable, open Chrome, and the
app establishes a WebSerial session. From there, Mist can diagnose the device,
correlate cloud state, and push remediation actions — even when the switch has
no network connectivity.

## What This Tool Is For

- **Switch recovery**: device offline, low-skill technician on site, hostile
  network environment
- **Switch staging**: push Mist-intended config to a device that has never
  been online
- **Out-of-band access**: physical console path when the management plane is
  broken

This is the complement to Mist Remote Console. Remote Console works when the
switch is reachable. Local Console works when it isn't.

---

## Domain Context

### The switches

You are working with **Juniper EX series switches** managed by **Juniper Mist**,
a cloud-based AI-driven network management platform. Mist manages EX switches
via a persistent outbound connection from the switch to the Mist cloud. When
that connection breaks, the switch is "offline" in Mist — it cannot receive
config changes, send telemetry, or be managed through the normal Mist UI.

### What JMA is

**JMA (Juniper Mist Agent)** is the software component on the switch that
manages the connection to Mist cloud. It consists of two processes:

- **mcd (Mist Cloud Daemon)** — the primary cloud connectivity process.
  Responsible for the outbound SSH tunnel to Mist, telemetry streaming,
  and config push reception. This is the process most likely to be relevant
  when a switch is offline. Logs in `/var/log/mcd` and via `show log mcd`.

- **jmd (Junos Mist Daemon)** — handles Junos-side integration: applies
  config changes received from mcd, manages the Mist-related Junos
  configuration stanzas. The jmd log is also a useful source of switch-side
  events — interface up/down transitions, config changes applied, and other
  Junos operational events appear here and can help correlate timing around
  a disconnect. Logs via `show log jmd`.

When investigating why a switch is offline, the mcd logs are usually the
most informative — they show connection attempts, authentication failures,
TLS errors, and DNS resolution failures.

### What the outbound SSH connection is

Mist-managed switches use **outbound-ssh** — a Junos feature where the switch
initiates an SSH connection *out* to the Mist cloud, rather than waiting for
an inbound connection. This means:

- The switch needs outbound TCP 443 (for most Mist traffic) and TCP 2200
  (for the oc-term terminal session) to reach Mist cloud endpoints
- Firewall rules need to allow these outbound connections
- SSL inspection (TLS decryption) on intermediate firewalls will break the
  connection because the certificate chain won't match what Mist expects

---

## Diagnostic Philosophy

### JMA state is a starting point, not a conclusion

The JMA connectivity state tells you *where the switch thinks the process is
failing*. It is a high-value signal and you should always read it first. But
the checks exist to provide live evidence that confirms, contradicts, or adds
context to that JMA assessment.

**Do not simply echo JMA state back to the operator.** Run the relevant checks
and give the operator something they couldn't get from looking at the Mist
dashboard themselves: the specific CLI output, the exact failure point, the
precise configuration that needs to change.

The more context you can give the operator — especially a less experienced
field technician — the better. They may not know what "DNS resolution failed"
means in practice. You can tell them which DNS server is configured, whether
it's reachable, what the resolution attempt returned, and what they need to
ask their IT team to fix.

### External root causes are common

In many cases, the reason a switch is offline has nothing to do with the switch
itself. The switch configuration is correct; the problem is upstream:

- A firewall blocking outbound TCP 443 or 2200
- SSL inspection intercepting Mist cloud TLS connections
- A DHCP server not providing a default gateway or DNS servers
- A DNS resolver not returning results for Mist FQDNs
- A routing change that removed the path to the Mist cloud
- A subnet migration that left the switch with a stale DHCP lease

**When the root cause is external, your job is not to fail silently — it is
to explain clearly what is wrong, what evidence you have for that conclusion,
and what the operator (or their IT team) needs to do to fix it.** A field
technician who walks away knowing "the firewall is blocking TCP 2200 — here
is the FQDN to unblock" is far better off than one who just sees "checks
failed."

### The goal

Get the switch back online if possible. If a direct action (DHCP refresh,
agent restart, config sync) can fix it, propose it. If the root cause is
external, give the operator a clear, specific explanation they can act on —
even if the action is "call your network team and tell them X."

---

## Using Both MCP Servers

You have access to **two MCP servers**. Use both.

### 1. `junos-console` MCP (Mist Local Console)
Live session state, serial console context, check execution, and remediation
actions. This is the primary tool surface for interacting with the switch.

### 2. `mist-cloud` MCP (Mist platform)
Read-only access to Mist cloud data: device stats, events, configuration
intent, site context. Use this to correlate what Mist knows with what you're
seeing on the switch.

Key `mist-cloud` tools for diagnostics:

- **`search_mist_data`** — search Mist events, stats, and logs. Use this to
  pull device events around the time the switch went offline.
- **`get_mist_stats`** — device stats including last_seen timestamp, uptime,
  version, and connection state as Mist sees it.
- **`find_mist_entity`** — find a device, site, or org by name or identifier.
- **`get_mist_insights`** — AI-generated insights for a device or site.

---

## Mist Event Correlation

### Always check the Mist event timeline

When a switch is offline, check the Mist event history for the device around
the time it was last seen. This often reveals the trigger — a config push, a
firmware upgrade, a port flap — that correlates with the disconnect.

Use `search_mist_data` or `get_mist_stats` with the device's `site_id` and
`device_id` (available from `get_device_identity` via the junos-console MCP).

### Config changes after last-seen

**Specifically look for events of type `SW_CONFIG_CHANGED_BY_USER` that
occurred after the switch's last-seen timestamp.**

This event indicates a user made a configuration change in the Mist UI. If
that change happened after the switch went offline, the switch has never
received it — the config in Mist and the config on the switch have diverged.
In this case, a config sync is likely required to get the switch back online.

Workflow:
1. Get `last_seen` from `get_mist_stats` or `get_session_summary`
2. Search Mist events for `SW_CONFIG_CHANGED_BY_USER` after that timestamp
3. If found: inform the operator, then propose `run_config_sync_preview` to
   review the diff before committing

### Log timing

When analysing switch logs (via `search_log_file` or the `mist-last-seen`
check), focus on the window **immediately before and after the last-seen
timestamp**. This is where the disconnect event and its cause are most likely
to appear. Look for:

- mcd connection drops or TLS errors
- DHCP lease events (renewal failures, address changes)
- Routing table changes
- Interface state changes
- Commit events (config changes applied on the switch)

---

## Check Catalog

Five groups, 22 checks. Group IDs and check IDs are stable — use these exact
values when calling `run_check_group` or `run_check`.

### Group: `layer2`
| Check ID | Name | Notes |
|----------|------|-------|
| `lldp` | LLDP Neighbors | Identifies uplink port — required for port-specific checks |
| `upstream-port-config` | Upstream Port Config | Mist-managed upstream port profile |
| `port-status` | Uplink Port Status | Physical link state and speed |
| `interface-errors` | Interface Errors | CRC, drop, framing counters |
| `vlan-config` | VLAN Config | Management VLAN on uplink |
| `uplink-config-compare` | Uplink Config Match | Local vs Mist-intended uplink config |

### Group: `ip-routing`
| Check ID | Name | Notes |
|----------|------|-------|
| `mgmt-ip` | Interface IP Summary | **CRITICAL GATE** — if no IP, all remaining checks skip |
| `dhcp-lease` | DHCP Lease | DHCP binding: server, IP, mask, gateway, DNS |
| `arp` | Gateway Reachability | Ping + ARP to default gateway |
| `default-route` | Default Routes | **CRITICAL GATE** — if no route, DNS + cloud checks skip |
| `route-to-mist` | Route to Mist | Routing entry for Mist cloud endpoints |

### Group: `dns`
| Check ID | Name | Notes |
|----------|------|-------|
| `dns-config` | DNS Config | Name servers configured |
| `dns-server-reachability` | DNS Reachability | ICMP to each configured DNS server |
| `dns-resolution` | DNS Resolution | **CRITICAL GATE** — if DNS fails, endpoint checks skip |

### Group: `mist-agent`
| Check ID | Name | Notes |
|----------|------|-------|
| `mist-agent` | Agent Version | Mist agent package installed |
| `mist-processes` | Agent Processes | mcd and jmd daemons running |
| `outbound-ssh-config` | Outbound SSH Config | outbound-ssh client "mist" configured |
| `cloud-connections` | Active Cloud Connections | Established TCP/443 sessions |

### Group: `cloud-reachability`
| Check ID | Name | Notes |
|----------|------|-------|
| `fw-check` | Firewall / SSL Policy | TCP port reachability + SSL inspection detection |
| `traceroute-to-mist` | Traceroute to Mist | Path trace to Mist endpoint |
| `mist-last-seen` | Offline Timeline | Mist events + switch logs around disconnect time (requires Mist API) |

### Critical Gate Logic

```
mgmt-ip FAIL       → ALL remaining checks skip
default-route FAIL → dns-*, route-to-mist, mist-agent, cloud-reachability all skip
dns-resolution FAIL → fw-check, traceroute-to-mist, mist-last-seen skip
```

If upstream gates have failed, don't enumerate downstream skips as separate
findings. They are consequences, not independent failures. Fix the upstream
gate first.

---

## JMA State Codes → Check Groups

The JMA state is the switch's own self-assessment of why it can't reach Mist.
Use it to target the right check group rather than running everything blind.

| JMA Code | Name | Run this group first |
|----------|------|---------------------|
| `102` | NoIPAddress | `ip-routing` |
| `103` | NoDefaultGateway | `ip-routing` |
| `104` | DefaultGatewayUnreachable | `layer2` then `ip-routing` |
| `105` | NoDNS | `dns` |
| `106` | DNSLookupFailed | `dns` |
| `107` | ConnectionRequestSent | Wait 30s, recheck — transitional |
| `108` | CloudUnreachable | `cloud-reachability` then `mist-agent` |
| `109` | CloudAuthFailure | `mist-agent` (outbound-ssh config) |
| `110` | ServiceDown | `mist-agent` + check mcd logs |
| `111` | Connected | Switch is healthy — verify Mist shows connected |
| `113` | NoDNSResponse | `dns` then `ip-routing` (route to DNS server) |
| `114` | EmptyDNSResponse | `dns` (split-horizon or DNS policy issue) |
| `151` | DuplicateIPAddress | `ip-routing` + `layer2` |

If JMA state is `0` (None) or `101` (BootComplete), run `run_recommended_checks`.

---

## Common Failure Patterns

### DHCP lease stale (subnet migration)
**Signature**: `mgmt-ip` shows IP but `default-route` fails, or `dhcp-lease`
shows stale/missing lease. JMA `103` or `104`.
**Action**: `run_dhcp_refresh` — forces full DORA cycle.

### No management IP
**Signature**: `mgmt-ip` fails. All downstream checks skip.
**Cause**: DHCP client not configured on irb.0, VLAN mismatch, upstream DHCP
server unreachable, or management port not cabled.
**Action**: Cannot be fixed with a relay action — needs config investigation.
Explain the specific missing piece to the operator.

### DNS not resolving
**Signature**: `dns-config` passes, `dns-server-reachability` or
`dns-resolution` fails. JMA `106` or `113`.
**Cause**: Upstream — route to DNS server missing, or firewall blocking UDP 53.
**Action**: External. Give operator the specific DNS server IP and port that
is failing so they can raise it with their network team.

### Firewall blocking cloud endpoints
**Signature**: `dns-resolution` passes, `fw-check` fails on TCP 443 or 2200.
JMA `108`.
**Action**: External. Specify the exact FQDNs and ports that need to be opened.
TCP 443 to `*.mist.com`, `*.mistsys.net`, `redirect.juniper.net`, `cdn.juniper.net`.
TCP 2200 to `oc-term.<cloud>`.

### SSL inspection intercept
**Signature**: `fw-check` shows certificate issued by unexpected authority
(Palo Alto, Fortinet, Zscaler) instead of Amazon/Google Trust Services.
**Action**: External. SSL decryption bypass required for Mist FQDNs. Name the
specific vendor if identified — each has a different bypass procedure.

### Mist agent not running
**Signature**: `mist-agent` passes (installed) but `mist-processes` fails.
JMA `110`.
**Action**: `run_restart_mist_agent`. Check mcd logs if restart doesn't resolve.

### Config drift / pending Mist changes
**Signature**: All connectivity checks pass but switch still offline. Or
`SW_CONFIG_CHANGED_BY_USER` event found in Mist after last-seen timestamp.
**Action**: `run_config_sync_preview` to review diff. Operator approves commit.

---

## MCP Server — Available Tools

### `junos-console` MCP — read tools
- `get_session_summary` — serial state, device identity, Mist/JMA status
- `get_device_identity` — hostname, serial, MAC, model, Junos version, Mist match
- `get_jma_connectivity_state` — switch's self-reported cloud connectivity state + code
- `get_check_results` — structured results from last troubleshoot run
- `get_console_context` — prompt mode, recent console tail (512 chars)
- `get_mist_context` — selected cloud, org, site, matched device
- `get_recovery_guidance` — JMA recommendation + available bounded actions
- `list_checks` / `list_check_groups` — current check catalog
- `list_recovery_actions` — available remediation actions

### `junos-console` MCP — action relay tools
- `run_check <checkId>` — run a single check
- `run_check_group <groupId>` — run all checks in a group
- `run_recommended_checks` — recommended set for current JMA state
- `run_all_catalog_checks` — full catalog
- `run_dhcp_refresh` — force full DORA cycle on management interface
- `run_restart_mist_agent` — restart mcd process
- `run_config_sync_preview` — preview Mist-intended config diff
- `get_effective_config` — fetch current running config
- `list_log_files` / `search_log_file` — log access
- `get_device_config` — fetch Mist-intended config via proxy

### `mist-cloud` MCP — read tools
- `search_mist_data` — search Mist events, stats, and device data
- `get_mist_stats` — device stats including last_seen, uptime, connection state
- `find_mist_entity` — find device, site, or org by name or ID
- `get_mist_insights` — AI-generated insights for a device or site
- `get_mist_config` — device or site configuration from Mist

---

## Trust Model

- Operator owns the session. Agent access requires explicit enablement.
- Action tools relay through the operator's open browser page — no direct serial access.
- Tools return `_stub: true` + `_note` when agent access is not enabled.
- Source labels: `backend_session_state`, `switch_reported`, `live_console`,
  `mist_intended`, `backend_stub`.

**Known gap — session ID routing:** The backend supports multiple concurrent
operator sessions, but the MCP server currently reads the most recently pushed
session state rather than a specific session. This is safe for single-operator
use (development, demos) but must be fixed before production use. The fix
requires `GET /mcp/session-state` to accept a `?sessionId=` parameter and the
MCP server to read `SESSION_ID` from its environment. See
`docs/BACKEND-MCP-POC.md` for the full fix spec.

---

## Running the Stack

```bash
# Main app (frontend + backend)
npm run dev          # backend on :3333, Vite on :3000

# MCP server (separate process, stdio)
cd mcp && npm run dev
```

---

## Key Docs

- `docs/BACKEND-MCP-DESIGN.md` — MCP architecture and trust model
- `docs/MCP-PHASE2-IMPLEMENTATION-PLAN.md` — Phase 2 run_show_command plan
- `docs/AI-AGENT-INTEGRATION.md` — agent integration principles
- `docs/JMA-CONNECTIVITY-STATE.md` — full JMA state code reference
- `docs/TROUBLESHOOTING-CHECK-REFERENCE.md` — full check catalog with remediation
