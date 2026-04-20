# JMA Troubleshooting — Missing Check Gaps

## Purpose

Backlog-ready implementation notes for the six diagnostic gaps identified while
mapping JMA connectivity states to the current troubleshooting engine.

These gaps were first identified in the Known Gaps section of
[`docs/JMA-RECOMMENDATIONS.md`](/Users/mdusty/Library/CloudStorage/OneDrive-HewlettPackardEnterprise/Documents/03%20Mist%20Docs/07%20Projects/mist-junos-console/docs/JMA-RECOMMENDATIONS.md).
This document expands them with implementation detail, complexity estimates, and
prioritisation guidance.

Related docs:

- [`docs/JMA-RECOMMENDATIONS.md`](/Users/mdusty/Library/CloudStorage/OneDrive-HewlettPackardEnterprise/Documents/03%20Mist%20Docs/07%20Projects/mist-junos-console/docs/JMA-RECOMMENDATIONS.md) — per-state check mapping and first-pass check lists
- [`docs/TROUBLESHOOTING-RUNBOOK.md`](/Users/mdusty/Library/CloudStorage/OneDrive-HewlettPackardEnterprise/Documents/03%20Mist%20Docs/07%20Projects/mist-junos-console/docs/TROUBLESHOOTING-RUNBOOK.md) — operator runbook for current checks
- [`src/services/troubleshoot.service.ts`](/Users/mdusty/Library/CloudStorage/OneDrive-HewlettPackardEnterprise/Documents/03%20Mist%20Docs/07%20Projects/mist-junos-console/src/services/troubleshoot.service.ts) — canonical check implementation

---

## Summary Table

| Gap | Check ID | Affected states | Complexity | Demo priority |
|-----|----------|-----------------|-----------|---------------|
| Gateway reachability ping | `gateway-reachability` | 103, 104 | Low | **Now** |
| Traceroute to Mist | `traceroute-to-mist` | 104, 108 | Low* | **Now** |
| DNS server reachability | `dns-server-reachability` | 113 | Low | Later |
| NTP / clock health | `ntp-health` | 109 | Medium | Later |
| Storage health | `storage-health` | 115, 116 | Low | Later |
| Duplicate IP evidence | `duplicate-ip-evidence` | 151 | Medium | Backlog |

\* `traceroute` logic already exists in `checkTraceroute()` inside the service.
The implementation cost is surfacing it as a standalone check, not writing it from scratch.

---

## Gap Details

---

### GAP-1 — Gateway Reachability

**Proposed check ID:** `gateway-reachability`

**Affected JMA states:**
- `103 NoDefaultGateway` — confirms gateway is at least pingable if a route does exist
- `104 DefaultGatewayUnreachable` — directly tests the claim that the gateway cannot be reached

**Why the current product is incomplete without it:**
The current `arp` check infers gateway reachability from the ARP table — if the gateway MAC is present, the switch has heard from it at some point. But an ARP entry can be stale. An ARP hit with no actual ICMP response is a meaningful distinction: it separates "gateway was alive within the ARP timeout window" from "gateway is responding right now." For `104 DefaultGatewayUnreachable` specifically, the operator's most natural first question is "can we ping the gateway?" — the current product cannot answer it directly.

**Likely Junos commands:**
```
ping inet <gateway-ip> count 3 rapid routing-instance default
```

The gateway IP is already available from `dhcp-lease` output or `default-route` evidence. It can be extracted from either check result if it ran first, or from `show dhcp client binding detail` as a fallback.

**Likely output interpretation:**

| Output pattern | Interpretation |
|----------------|----------------|
| `3 packets transmitted, 3 packets received` | `pass` — gateway reachable |
| `3 packets transmitted, 0 packets received` | `fail` — gateway unreachable (IP routing may exist but L2 or firewall is blocking) |
| `ping: connect: No route to host` | `fail` — no route to gateway; correlates with `103` |
| `unknown host` or blank output | `fail` — gateway IP not resolvable (unexpected for a direct IP) |

**Remediation value:**
This check adds a definitive pass/fail signal at the most common first question: "can the switch reach its gateway?" It shortens triage time for both `103` and `104` significantly and removes ambiguity from the ARP inference path.

**Implementation complexity:** Low

The command is straightforward. The main implementation work is extracting the gateway IP reliably from prior check results. A reasonable approach:
1. Extract from `dhcp-lease` result if available (look for `gateway:` or `router:` in the raw output)
2. Fall back to extracting from `default-route` result (next-hop IP in the route table)
3. If neither is available, skip with a `skip` result and note "no gateway IP found"

The ping parsing pattern already exists in the service for `dns-resolution` (line 1427). This check reuses the same pattern.

**Suggested placement in the check sequence:**
After `default-route` and before `dns-config`. The gateway must be reachable before DNS is worth testing.

**Demo priority:** Now
This is the single highest-value gap relative to implementation cost. It directly
strengthens the two most common offline-switch scenarios (`103`, `104`) and is
one short `ping` command with parsing that already exists in the service.

---

### GAP-2 — Traceroute to Mist

**Proposed check ID:** `traceroute-to-mist`

**Affected JMA states:**
- `108 CloudUnreachable` — shows where in the network path the connection fails
- `104 DefaultGatewayUnreachable` — shows whether the path breaks at the first hop or further out

**Why the current product is incomplete without it:**
`fw-check` tests TCP reachability to Mist endpoints and reports pass/fail. When it fails, the operator knows the path is blocked but not *where*. A traceroute provides the hop-by-hop path evidence that narrows "outbound TCP 443 blocked somewhere" to "blocked at hop 4 — likely the upstream edge firewall." This is especially valuable in enterprise environments with multiple network boundaries.

**Important:** The `checkTraceroute()` method **already exists** in `troubleshoot.service.ts` (line 1494). It is currently called as a sub-check within `fw-check` when TCP to an endpoint fails (line 328), and it produces a structured `CheckResult`. The gap is that this evidence is embedded within the `fw-check` result rather than surfaced as its own independently invocable check.

**Likely Junos commands:**
```
traceroute inet <mist-endpoint-ip> wait 2 as-number-lookup no-resolve
```

The `checkTraceroute()` implementation already uses this command and parses the last responding hop.

**Likely output interpretation:**
Already handled by the existing `checkTraceroute()` logic:
- Last responding hop before silence = probable point of policy or routing failure
- All hops respond = path is open, TCP policy may still block at the destination
- No response from hop 1 = gateway itself is dropping traffic

**Remediation value:**
Pinpointing the failure hop significantly narrows the operator's escalation path. "TCP 443 to Mist is blocked — traceroute shows it fails at hop 3 (10.1.0.1, the edge firewall)" is actionable. "TCP 443 to Mist is blocked" is not.

**Implementation complexity:** Low

Since `checkTraceroute()` already exists and runs correctly inside `fw-check`, the
implementation is:
1. Add a new public check method that calls `checkTraceroute()` for the primary Mist endpoint
2. Assign it the check ID `traceroute-to-mist`
3. Make it invocable as a standalone check in addition to its current embedded role

This is principally a wiring change, not a new feature. The only decision is whether it should appear in the main `runAllChecks()` sequence or remain as a targeted-only check. Given its runtime (traceroute can take 10–20 seconds per endpoint), keeping it targeted is preferable.

**Demo priority:** Now
The implementation cost is low and the diagnostic value for `108 CloudUnreachable` —
the primary demo failure state — is high. During the demo, showing that the tool
not only detects cloud unreachability but identifies *where* the path breaks
significantly strengthens the self-driving story.

---

### GAP-3 — DNS Server Reachability

**Proposed check ID:** `dns-server-reachability`

**Affected JMA states:**
- `113 NoDNSResponse` — directly validates whether the DNS server is network-reachable

**Why the current product is incomplete without it:**
The current `dns-resolution` check tests resolution by pinging a Mist hostname — it simultaneously tests DNS lookup and IP reachability to the resolved destination. If it fails, the operator cannot immediately distinguish:
- The DNS server is unreachable (network/firewall path to DNS server IP is blocked)
- The DNS server is reachable but is failing to resolve the Mist hostname (broken resolver, split-horizon, NXDOMAIN)

For `113 NoDNSResponse` specifically, the JMA state already indicates the DNS server is not responding at the network level. A dedicated check that pings the configured DNS server IP confirms this and gives the operator a direct `fail` signal at the DNS layer rather than inferring it from the `dns-resolution` failure.

**Likely Junos commands:**
Step 1: read DNS server IPs from `dns-config` result or from:
```
show configuration system name-server
```
Step 2: ping each configured DNS server:
```
ping inet <dns-server-ip> count 3 rapid routing-instance default
```

**Likely output interpretation:**

| Outcome | Interpretation |
|---------|----------------|
| All DNS servers pingable | `pass` — reachability is fine; DNS failure is resolver-side |
| One or more DNS servers not pingable | `fail` — network path to DNS server is blocked |
| No DNS servers configured | `skip` — `dns-config` should have caught this; skip with note |

**Remediation value:**
Distinguishes `113 NoDNSResponse` (fix the network path to DNS) from `106 DNSLookupFailed` (fix the DNS server configuration or try alternate). Without this check, both states show the same check list and the operator cannot know which remediation path to take without manual investigation.

**Implementation complexity:** Low

DNS server IP extraction already happens in the `dns-config` check. The ping pattern exists in `dns-resolution`. This is a targeted composition of existing patterns.

One consideration: multiple DNS servers may be configured. The check should test each and report which are reachable and which are not, rather than failing on the first unreachable server.

**Demo priority:** Later
`113 NoDNSResponse` is not in the primary demo flow. Implement after the hackathon as a straightforward follow-on.

---

### GAP-4 — NTP / Clock Health

**Proposed check ID:** `ntp-health`

**Affected JMA states:**
- `109 CloudAuthFailure` — clock skew causes TLS certificate validation failures that are silent and easily misdiagnosed

**Why the current product is incomplete without it:**
NTP drift is one of the most common causes of `CloudAuthFailure` in the field and one of the least obvious. When the switch clock is significantly wrong (typically >5 minutes from real time), the JMA agent's TLS handshake fails certificate validity checks. From the operator's view the switch looks like it has a configuration or adoption problem. Without a clock check, the diagnosis jumps straight to adoption state, agent version, and SSH config — all of which may be fine. The NTP check short-circuits that investigation.

**Likely Junos commands:**

Primary:
```
show ntp associations
```

This outputs one row per configured NTP peer with status indicators. The `*` prefix means "current reference server," `+` means "candidate," `-` means "eliminated." An `x` prefix or no `*` server means the clock has no synchronized peer.

Secondary (for more detail if associations are present but status is unclear):
```
show ntp status
```

This provides stratum, reference ID, offset, and sync state as a summary.

**Likely output interpretation:**

| Pattern | Interpretation |
|---------|----------------|
| A row prefixed with `*` and offset < 128ms | `pass` — clock is synchronised |
| No rows, or no `*` row | `fail` — no synchronised NTP peer; clock may be drifting |
| Rows present but all prefixed with `x` or `-` | `warn` — peers configured but none accepted |
| `show ntp associations` returns empty or error | `fail` — NTP not configured or daemon not running |
| `stratum 16` in `show ntp status` | `fail` — not synchronised (stratum 16 = unsynchronized in NTP protocol) |

**Remediation value:**
If the check produces `fail` on `109 CloudAuthFailure`, the operator has a clear first action: fix NTP before anything else. This saves potentially 30+ minutes of adoption-state and agent debugging that will find nothing wrong.

**Implementation complexity:** Medium

The command and output pattern are clear, but the parsing has more variation than a simple pass/fail:
- Need to parse NTP association table rows (variable number of peers)
- Need to identify the `*` status indicator correctly (it can appear in different column positions depending on Junos version)
- Offset thresholds require a reasonable default (128ms is a common practical threshold; 5 minutes is where TLS typically breaks)
- `show ntp associations` may not exist on all Junos versions if NTP is not configured — need graceful handling

This is definitely implementable in a single development session, but requires more careful output parsing than a ping-based check.

**Note on placement:** This check should appear in the main sequence only if `109 CloudAuthFailure` is the active JMA state or if it is operator-invoked. Adding it to every full troubleshoot run adds latency for a signal that is rarely the cause of `102–108` state failures.

**Demo priority:** Later
`109 CloudAuthFailure` can appear in field demos. The NTP gap is real and the check is valuable, but it does not affect the primary `108 CloudUnreachable` demo story. Implement post-hackathon as an early follow-on given its field value.

---

### GAP-5 — Storage Health

**Proposed check ID:** `storage-health`

**Affected JMA states:**
- `115 SoftwareDownloadFailure` — image cannot be written if `/var` is full
- `116 SoftwareUpgradeFailure` — upgrade process may fail silently due to storage

**Why the current product is incomplete without it:**
Storage failures are silent in both JMA state reporting and in the current check set. The switch reports a download or upgrade failure without specifying why, and the operator has no automated evidence for storage. The manual workaround — running `show system storage` by hand — is simple and often the right first question, but the current check set does not do it.

**Likely Junos commands:**
```
show system storage
```

This outputs filesystem usage as a `df`-style table. The columns are filesystem, size, used, available, use%, and mount point. The key mount point for Junos image storage is `/var` (or `/dev/da0s1a` depending on the platform).

**Likely output interpretation:**

| Pattern | Interpretation |
|---------|----------------|
| `/var` use% < 80% | `pass` — storage is adequate |
| `/var` use% 80–89% | `warn` — storage is getting full; monitor |
| `/var` use% ≥ 90% | `fail` — storage is critically low; likely cause of upgrade failure |
| `/` (root) use% ≥ 90% | `warn` — root filesystem pressure; may affect operation |

**Remediation value:**
Directly answers "is storage the cause of the download/upgrade failure?" with a single check. The remediation path (clean up old packages with `request system storage cleanup`) is well-known and the check gives the operator the evidence to decide whether to proceed.

**Implementation complexity:** Low

`show system storage` output is consistent across Junos versions. Percentage parsing with a threshold-based warn/fail is a simple pattern. No multi-step command dependency.

The only decision is which filesystem thresholds to use. The values above (80%/90%) are reasonable starting points and can be tuned if needed.

**Demo priority:** Later
Storage issues arise infrequently enough that this is not demo-critical. It is a quick win given the low implementation complexity and belongs in a "polish" cycle post-hackathon.

---

### GAP-6 — Duplicate IP Evidence

**Proposed check ID:** `duplicate-ip-evidence`

**Affected JMA states:**
- `151 DuplicateIPAddress` — JMA reports a conflict; this check would surface evidence

**Why the current product is incomplete without it:**
When JMA reports `151 DuplicateIPAddress`, the current product surfaces the `arp` check (which shows the ARP table) and `mgmt-ip` (which confirms the management IP). These give context, but neither actively flags the conflict. The operator must visually scan the ARP table for a duplicate MAC entry. A dedicated check that explicitly flags ARP conflicts or filters system logs for gratuitous ARP events would make the evidence unambiguous.

**Likely evidence sources:**

**Source A — ARP table scan:**
```
show arp no-resolve
```
Parse for the management IP (`irb.0` or `vme`) and check whether multiple entries share the same IP with different MAC addresses. A duplicate IP produces two rows for the same IP.

**Source B — System log filter:**
```
show log messages | match "duplicate|conflicting|ARP" | last 20
```
Junos logs gratuitous ARP conflict events to `messages`. A pattern like `Duplicate IP detected` or `ARP conflict for` in recent messages confirms the conflict is active.

**Likely output interpretation:**

| Evidence | Interpretation |
|----------|----------------|
| ARP table has two entries for management IP | `fail` — active duplicate; two devices are using this IP |
| System log shows ARP conflict messages | `fail` (or `warn`) — conflict has been detected recently |
| ARP table clean, no log entries | `info` — no active evidence; conflict may be intermittent or already resolved |

**Remediation value:**
Confirms the conflict with direct evidence rather than asking the operator to read the ARP table manually. More importantly, the MAC address of the conflicting device is surfaced directly, giving the operator a concrete target for resolution.

**Implementation complexity:** Medium

ARP table parsing already exists in the service for the `arp` check. The addition here is:
1. Filtering specifically for the management IP address (from `mgmt-ip` result)
2. Checking for duplicate MAC entries for that IP
3. Filtering `show log messages` for ARP conflict patterns

The log filtering step introduces variability: log message format and the presence of the conflict log depends on Junos version and how recently the conflict was active. The ARP table approach is more reliable. A reasonable implementation checks the ARP table first and uses the log as supplementary evidence.

One operational consideration: duplicate IP conditions are intermittent. The check may pass during the troubleshoot run even though the conflict exists. Adding a note about this ("ARP conflicts are intermittent — rerun if symptoms persist") is important for operator trust.

**Demo priority:** Backlog
`151 DuplicateIPAddress` is an uncommon edge case in typical demo scenarios. The existing `arp` check provides enough context for most operators. Deprioritise.

---

## Prioritised Recommendations

### Highest value after the hackathon

**1. `gateway-reachability` — implement first**

Affects the two most common offline-switch root causes (`103`, `104`). The
command and parsing patterns already exist in the service. The implementation
is one new check method plus a gateway IP extraction helper. Estimated effort:
one focused development session.

**2. `traceroute-to-mist` — expose the existing code**

The `checkTraceroute()` method is already implemented and tested. Surfacing it
as a standalone, independently invocable check with ID `traceroute-to-mist`
takes the existing code and wires it to a new entry point. This is the lowest
implementation cost of all six gaps for meaningful diagnostic value.

### High value, slightly more work

**3. `ntp-health`**

The field impact is significant — clock skew is a common silent cause of
`109 CloudAuthFailure`. The implementation is medium complexity but is
self-contained (one command, threshold-based). Prioritise this in the first
post-hackathon cycle alongside `gateway-reachability`.

### Quick wins but lower urgency

**4. `dns-server-reachability`** and **5. `storage-health`**

Both are low complexity and would close real diagnostic gaps. Neither is
on the critical path for common demo scenarios. Do them together in a
single "polish" cycle — they are each about a half-session of implementation work.

### Defer indefinitely

**6. `duplicate-ip-evidence`**

`151 DuplicateIPAddress` is an infrequent state. The existing `arp` check
provides enough for most operators. The implementation has edge-case variability
(intermittent conflicts, log message format differences). The effort-to-value
ratio is the lowest of the six gaps. Add to backlog and revisit only if
customer demand is clear.

---

## Do Not Overbuild

The JMA-guided recommendation layer is already useful and complete enough for
the hackathon and near-term field use without any of these gaps being closed.

**What the current product can do for every major JMA failure state:**

- It surfaces the switch's own diagnosis (`cc-state`) as a structured signal
- It maps that state to the most relevant first-pass checks from the existing troubleshoot engine
- It provides operator-friendly remediation guidance per state
- It runs the full check workflow when the state warrants it (`108 CloudUnreachable`)
- It avoids wasted checks for obvious failure points (`102 NoIPAddress` → don't run DNS checks)

The six gaps represent *incremental improvements* to an already functional layer —
not missing foundations.

**Which gaps are truly important vs nice-to-have:**

| Gap | Importance | Reason |
|-----|-----------|--------|
| `gateway-reachability` | **Important** | Fills the most common "can we ping the gateway?" question; directly shortens triage for `103`, `104` |
| `traceroute-to-mist` | **Important** | Narrows "cloud blocked somewhere" to a specific hop; code already exists |
| `ntp-health` | **Important** | Silent cause of `CloudAuthFailure`; not diagnosable with current checks |
| `dns-server-reachability` | Nice to have | Useful disambiguation; `dns-resolution` already covers most of `113` |
| `storage-health` | Nice to have | Narrow scenario; easy to add but not frequently needed |
| `duplicate-ip-evidence` | Nice to have | `arp` check already exposes the relevant table; manual review is sufficient |

A product with only `gateway-reachability`, `traceroute-to-mist`, and `ntp-health`
added would close the three most operationally significant gaps with moderate
implementation effort. The remaining three can be added later without urgency.

---

## Suggested Future Implementation Shape

### These should live as new troubleshoot checks

All six gaps fit naturally as new check methods in `troubleshoot.service.ts`,
following the same pattern as existing checks:
- private `async check<Name>(): Promise<CheckResult>` method
- canonical check ID string constant (`const id = 'gateway-reachability'`)
- structured `CheckResult` with `status`, `detail`, `raw`, and optional `remediation`

There is no reason to build these as a separate subsystem or a new service module.

### Which should be in the main sequence vs operator-invoked only

The main `runAllChecks()` sequence should stay lean. Not every new check should
be added to the default full run:

| Check | Recommendation |
|-------|---------------|
| `gateway-reachability` | Add to main sequence — after `default-route`, before `dns-config`; adds ~2s |
| `traceroute-to-mist` | Operator-invoked only — can take 10–20s; leave inside `fw-check` sub-flow and expose as standalone targeted check |
| `dns-server-reachability` | Operator-invoked only, or triggered by `113 NoDNSResponse` recommendation only |
| `ntp-health` | Operator-invoked only, or triggered by `109 CloudAuthFailure` recommendation only; not worth the latency in every full run |
| `storage-health` | Optional targeted check for `115`/`116` states; no reason to add to every full run |
| `duplicate-ip-evidence` | Operator-invoked only, triggered by `151 DuplicateIPAddress` state |

### Which should remain advisory rather than automated

No gap check needs to be automated (executed without operator awareness). All
of them fit the existing model: operator triggers a workflow or a targeted check,
the check runs, the result is displayed.

`ntp-health` is the one gap where the case for *proactive* background polling
might arise (e.g. poll NTP status silently alongside JMA state). However, this
adds latency and complexity to the polling loop for a signal that is only
relevant to `109 CloudAuthFailure`. It is cleaner to surface it as a targeted
check invoked when the JMA state is `109`, rather than a background poll.

The general rule from the existing product design applies here: silent background
checks should be lightweight status signals. Diagnostic checks that run CLI
commands and produce evidence should remain operator-visible.

---

## Uncertainties in Command and Source Selection

**`gateway-reachability` — gateway IP extraction**
The gateway IP needs to be obtained from prior check results. It is available
from `dhcp-lease` raw output (look for `router:` or `option 3`) or from the
routing table in `default-route` evidence. The exact parsing will depend on
which DHCP client format the switch uses (`dhclient` vs Junos-native). This is
the main implementation uncertainty for this check.

**`ntp-health` — NTP association table format variation**
The `show ntp associations` output varies between Junos versions. On older
EX switches, the column layout differs from modern versions. The `*` indicator
for the selected peer can appear at the start of the refid column or as a prefix
on the peer IP. Robust parsing requires handling both formats or using
`show ntp status` as a fallback for a simpler stratum check.

**`ntp-health` — acceptable offset threshold**
TLS certificates typically have a 5-minute tolerance for clock skew. But Mist's
agents may be more or less tolerant. Using 128ms as a `warn` threshold and
5 minutes as a `fail` threshold is conservative. The appropriate values are not
documented in the current product; they would need confirmation from Mist
engineering or empirical testing.

**`duplicate-ip-evidence` — log message format**
The Junos `messages` log format for ARP conflicts is not standardised across
versions. The pattern `Duplicate IP detected` or `ARP conflict` may not appear
consistently. The ARP table approach is more reliable than log filtering, and
the implementation should treat log evidence as supplementary rather than primary.

**`traceroute-to-mist` — standalone check target endpoint**
The existing `checkTraceroute()` takes a `MistEndpoint` parameter. When surfaced
as a standalone check, a default target endpoint needs to be chosen (likely the
primary Mist API hostname). This choice should match the primary endpoint used
by `fw-check` to keep results consistent.
