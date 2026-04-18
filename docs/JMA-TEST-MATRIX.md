# JMA Connectivity State — UI Test Matrix

## Purpose

Manual validation guide for the JMA-driven recommendation UI. Use this during
hackathon testing to confirm that each JMA state renders the correct guidance,
workflow recommendation, and check list — and that healthy or benign states do
not produce alarming or misleading output.

Source of truth for expected values: [`docs/JMA-RECOMMENDATIONS.md`](/Users/mdusty/Library/CloudStorage/OneDrive-HewlettPackardEnterprise/Documents/03%20Mist%20Docs/07%20Projects/mist-junos-console/docs/JMA-RECOMMENDATIONS.md)

---

## How to Test

### Testing without live hardware in every state

Most states require a switch that is actually in that condition. Where a live
switch is unavailable, the following approaches are acceptable:

**Option A — Stub the JMA state in the frontend**
Temporarily hardcode a JMA state code in the frontend's state store or inject
a fake `cc-state` value to exercise the rendering path. Confirm the UI responds
with the expected title, severity, check list, and workflow recommendation.
Revert the stub before shipping.

**Option B — Push via `/mcp/agent-context`**
POST a crafted session state payload to `http://127.0.0.1:3333/mcp/agent-context`
with the desired JMA state. The MCP server will surface it via `get_jma_connectivity_state`.
Useful for confirming the data shape end-to-end without a live switch.

Example payload:
```json
{
  "sessionId": "test-session-001",
  "agentAccessEnabled": true,
  "serialConnected": true,
  "deviceIdentified": true,
  "jma": {
    "stateCode": 108,
    "stateLabel": "CloudUnreachable",
    "stateDescription": "TCP path to Mist cloud is blocked",
    "rawValue": "108",
    "checkedAt": "2026-04-18T10:00:00Z"
  }
}
```

**Option C — Live switch in the target state**
This is the highest-confidence test. A switch that is genuinely in, e.g.,
`108 CloudUnreachable` will produce the real JMA state code and let you validate
both rendering and the actual check results.

### What counts as sufficient evidence

For each state, a test pass requires all of the following:

1. **Title** — The displayed title matches the expected operator-friendly wording.
2. **Summary** — One-sentence description is accurate and matches the spec.
3. **Severity badge** — Correct color/class (`fail` = red/destructive, `warn` = amber, `info` = neutral, `pass` = green).
4. **Check list** — At minimum the top-3 check IDs appear in the recommended checks panel, in the correct priority order.
5. **Workflow button state** — The "Run Full Troubleshoot" button is labeled and enabled/suppressed correctly per the `workflowRecommendation` level.
6. **Remediation panel** — At least one correct remediation theme is visible for `fail` and `warn` states.
7. **No-show items** — Confirm that items in the "should NOT appear" column for that state are absent.

### Comparing UI behavior against the recommendation doc

Open `docs/JMA-RECOMMENDATIONS.md` alongside the UI during testing.
For each state:
1. Match the `checks[]` list against what the UI shows in the recommended checks panel.
2. Match `workflowRecommendation` against the button behavior.
3. Match `summary` against the displayed one-liner.
4. If a check ID is missing from the UI: note it as a rendering gap (not a spec gap).
5. If a check ID appears that is not in the spec: note it as an over-suggestion.

---

## Demo-Critical States

These are the states most likely to appear during the hackathon demo. Test
these first and treat failures here as blocking.

| Priority | Code | Label | Why it matters |
|----------|------|-------|---------------|
| 🔴 P0 | 111 | Connected | Final healthy state — must look clean, no false alarms |
| 🔴 P0 | 108 | CloudUnreachable | Primary "switch is offline" demo scenario — full workflow |
| 🔴 P0 | 102 | NoIPAddress | Common entry state for an offline switch — targeted |
| 🔴 P0 | 104 | DefaultGatewayUnreachable | L2 problem scenario — targeted→full path |
| 🟡 P1 | 106 | DNSLookupFailed | DNS problem scenario — targeted |
| 🟡 P1 | 110 | ServiceDown | Daemon health scenario — targeted, no connectivity checks |
| 🟡 P1 | 109 | CloudAuthFailure | Auth failure scenario — targeted, auth-oriented checks |
| 🟢 P2 | 103 | NoDefaultGateway | Gateway config gap — targeted |
| 🟢 P2 | 113 | NoDNSResponse | DNS path problem — targeted |
| 🟢 P2 | 112 | HealthIssue | Degraded connection — optional workflow |

---

## Per-State Test Cases

---

### TC-102 — NoIPAddress

| Field | Expected value |
|-------|---------------|
| Code | `102` |
| Label | `NoIPAddress` |
| Title | "No management IP address" |
| Summary | Should mention: no IP on management interface; likely DHCP, VLAN, or uplink problem |
| Severity | `fail` (red) |
| Top check (P1) | `mgmt-ip` — Management IP Address |
| Top check (P2) | `dhcp-lease` — DHCP Lease Details |
| Top check (P3) | `vlan-config` — VLAN Configuration |
| Further checks | `port-status`, `lldp` |
| Remediation themes | DHCP renew, upstream trunk VLAN, static IP config, uplink admin state |
| Workflow | `targeted` |
| Workflow note | Should mention: resolve IP issue first; full workflow is premature without an IP |

**Should be visible:**
- `fail` severity indicator
- Recommended checks panel showing `mgmt-ip` first
- Workflow button suggests targeted run or shows a "resolve IP first" note
- Remediation mentions DHCP renewal

**Should NOT appear:**
- `route-to-mist`, `fw-check`, or `dns-resolution` as primary suggested checks — these are irrelevant without an IP
- "Run Full Troubleshoot" as the primary recommended action
- Any suggestion that the cloud path is the problem

---

### TC-103 — NoDefaultGateway

| Field | Expected value |
|-------|---------------|
| Code | `103` |
| Label | `NoDefaultGateway` |
| Title | "No default gateway" or "No default route" |
| Summary | Should mention: has an IP but no default route; likely DHCP Option 3 or missing static route |
| Severity | `fail` (red) |
| Top check (P1) | `default-route` — Default Gateway |
| Top check (P2) | `dhcp-lease` — DHCP Lease Details |
| Top check (P3) | `mgmt-ip` — Management IP Address |
| Further checks | `arp`, `vlan-config` |
| Remediation themes | DHCP Option 3, DHCP renew, static default route |
| Workflow | `targeted` |
| Workflow note | Should mention: routing problem is upstream of DNS and cloud; full workflow premature |

**Should be visible:**
- `fail` severity indicator
- `default-route` as the first recommended check
- DHCP lease check near the top
- Remediation mentions Option 3 or static route

**Should NOT appear:**
- DNS or cloud-path checks as primary suggestions
- Any indication that the issue is a cloud authentication problem
- "Run Full Troubleshoot" as the primary CTA

---

### TC-104 — DefaultGatewayUnreachable *(Demo-critical P0)*

| Field | Expected value |
|-------|---------------|
| Code | `104` |
| Label | `DefaultGatewayUnreachable` |
| Title | "Default gateway is unreachable" |
| Summary | Should mention: IP and route exist but gateway is unreachable; likely L2, VLAN, or ARP problem |
| Severity | `fail` (red) |
| Top check (P1) | `arp` — ARP Table |
| Top check (P2) | `port-status` — Uplink Port Status |
| Top check (P3) | `interface-errors` — Uplink Interface Errors |
| Further checks | `vlan-config`, `lldp`, `upstream-port-config`, `uplink-config-compare` |
| Remediation themes | ARP/L2 path, VLAN config, interface errors, duplicate IP pointer |
| Workflow | `targeted_then_full` |
| Workflow note | Should mention: start with ARP and uplink checks; escalate to full workflow if L2 checks pass but gateway is still unreachable |

**Should be visible:**
- `fail` severity indicator
- `arp` as the first recommended check
- Indication that escalation to full workflow is available if targeted checks don't resolve it
- Remediation mentions checking upstream trunk and duplicate IP

**Should NOT appear:**
- DNS or cloud-path checks as the initial priority
- Pure `full` workflow recommendation without targeted path first
- Pure `targeted` recommendation without escalation path

---

### TC-105 — NoDNS

| Field | Expected value |
|-------|---------------|
| Code | `105` |
| Label | `NoDNS` |
| Title | "No DNS servers configured" |
| Summary | Should mention: gateway is reachable but no DNS servers are configured; likely missing DHCP Option 6 or static name-server |
| Severity | `fail` (red) |
| Top check (P1) | `dns-config` — DNS Configuration |
| Top check (P2) | `dhcp-lease` — DHCP Lease Details |
| Remediation themes | DHCP Option 6, static name-server config |
| Workflow | `targeted` |
| Workflow note | Should mention: simple config gap; full workflow not needed |

**Should be visible:**
- `fail` severity indicator
- `dns-config` as the top check
- Remediation mentions Option 6 or `set system name-server`

**Should NOT appear:**
- Firewall checks or cloud-path checks as primary suggestions
- LLDP or uplink checks as primary suggestions — this is past L2
- Full workflow recommendation

---

### TC-106 — DNSLookupFailed *(Demo-critical P1)*

| Field | Expected value |
|-------|---------------|
| Code | `106` |
| Label | `DNSLookupFailed` |
| Title | "DNS lookup failed" |
| Summary | Should mention: DNS is configured but the switch cannot resolve Mist hostnames |
| Severity | `fail` (red) |
| Top check (P1) | `dns-config` — DNS Configuration |
| Top check (P2) | `dns-resolution` — DNS Resolution & Reachability |
| Top check (P3) | — |
| Further checks | None by default — stay on DNS-specific evidence first |
| Remediation themes | DNS server reachability, both-public-and-Mist failure, public-DNS-works-but-Mist-fails, alternate DNS fallback |
| Workflow | `targeted` |

**Should be visible:**
- `fail` severity indicator
- `dns-config` and `dns-resolution` as top two checks
- Remediation mentions trying an alternate DNS server to isolate the problem
- DNS interpretation distinguishes:
  - configured DNS servers unreachable
  - DNS servers reachable but all lookups fail
  - public DNS works while Mist domains fail
- Note distinguishing this from `113 NoDNSResponse` if both are present

**Should NOT appear:**
- `mist-processes` or `mist-agent` as primary suggestions — the switch has not reached the cloud layer yet
- Full workflow as the primary recommendation
- Any claim that the switch is close to connecting
- `route-to-mist`, `fw-check`, or certificate checks as default first-pass actions for this state

---

### TC-108 — CloudUnreachable *(Demo-critical P0)*

| Field | Expected value |
|-------|---------------|
| Code | `108` |
| Label | `CloudUnreachable` |
| Title | "Cloud is unreachable" |
| Summary | Should mention: IP, gateway, and DNS appear to work; TCP path to Mist cloud is blocked |
| Severity | `fail` (red) |
| Top check (P1) | `route-to-mist` — Route to Mist Endpoints |
| Top check (P2) | `cloud-connections` — Active Cloud Connections |
| Top check (P3) | `fw-check` — Firewall Policy Check |
| Further checks | `outbound-ssh-config`, `mist-processes` |
| Remediation themes | TCP 443 outbound, SSL inspection/pinning conflict, Mist endpoint hostnames |
| Workflow | `full` |
| Workflow note | Should mention: run full workflow to confirm lower layers are healthy before focusing on cloud path |

**Should be visible:**
- `fail` severity indicator
- `route-to-mist` as the top check
- **Prominent "Run Full Troubleshoot" recommendation** — this is the one state where full workflow is the primary CTA
- Remediation mentions TCP 443, SSL inspection, and Mist endpoint hostnames

**Should NOT appear:**
- `targeted` recommendation without the escalation-to-full note
- LLDP or L2 checks as primary suggestions — this state is past L2
- Any implication that the switch just needs a DHCP renewal

---

### TC-109 — CloudAuthFailure *(Demo-critical P1)*

| Field | Expected value |
|-------|---------------|
| Code | `109` |
| Label | `CloudAuthFailure` |
| Title | "Cloud authentication failed" |
| Summary | Should mention: switch can reach cloud endpoints but authentication or registration is failing |
| Severity | `fail` (red) |
| Top check (P1) | `mist-processes` — Mist Agent Processes |
| Top check (P2) | `mist-agent` — Mist Agent Version |
| Top check (P3) | `outbound-ssh-config` — Outbound SSH Config |
| Further checks | `cloud-connections`, `mist-last-seen`, `mist-events`, `mist-audit-logs` |
| Remediation themes | Adoption commands, clock/NTP drift (noted as gap), device deletion/re-add, agent version |
| Workflow | `targeted` |
| Gap note | NTP/clock check is not implemented; remediation should mention it as a manual verification step |

**Should be visible:**
- `fail` severity indicator
- `mist-processes` as the top check
- Remediation mentions adoption state and possibly clock drift as a manual check
- Timeline checks (`mist-last-seen`, `mist-events`) appear in secondary position

**Should NOT appear:**
- LLDP, gateway, or DNS checks as primary suggestions — the switch has already passed those layers
- Full workflow as the primary recommendation
- Implication that the network path is the problem

---

### TC-110 — ServiceDown *(Demo-critical P1)*

| Field | Expected value |
|-------|---------------|
| Code | `110` |
| Label | `ServiceDown` |
| Title | "Mist agent is not running" |
| Summary | Should mention: JMA service has exited or stopped; daemon health issue rather than path issue |
| Severity | `fail` (red) |
| Top check (P1) | `mist-processes` — Mist Agent Processes |
| Top check (P2) | `mist-agent` — Mist Agent Version |
| Further checks | `switch-logs`, `switch-uptime`, `mist-last-seen` |
| Remediation themes | Restart agent, check install, inspect jmd.log |
| Workflow | `targeted` |
| Workflow note | Should mention: daemon health issue, not a path issue; full connectivity workflow not needed |

**Should be visible:**
- `fail` severity indicator
- `mist-processes` as the top check
- Remediation mentions restarting the agent or reinstalling
- Note directing attention away from connectivity checks

**Should NOT appear:**
- `dns-config`, `route-to-mist`, or `fw-check` as primary suggestions — these are irrelevant when the daemon is down
- Any indication that the network path is the cause
- Full workflow as the primary CTA

---

### TC-111 — Connected *(Demo-critical P0)*

| Field | Expected value |
|-------|---------------|
| Code | `111` |
| Label | `Connected` |
| Title | "Switch is connected to Mist" |
| Summary | Should mention: fully connected and authenticated; healthy steady state |
| Severity | `pass` (green) |
| Checks (available but not auto-surfaced) | `cloud-connections`, `mist-last-seen`, `mist-events`, `fw-check` |
| Remediation | "No action needed" — or nothing |
| Workflow | `skip` |
| Workflow note | Should mention: no troubleshooting needed unless operator reports a specific symptom |

**Should be visible:**
- `pass` (green) severity indicator
- Mist Status and JMA State should both appear healthy if the switch is truly connected
- If the operator wants to investigate, a secondary "Run Checks Anyway" or optional path should be available
- If JMA says 111 but Mist shows offline: a mismatch indicator should appear

**Should NOT appear:**
- Any `fail` or `warn` indicators for this state
- "Run Full Troubleshoot" as a prominent or default CTA
- Remediation guidance suggesting configuration changes
- A check list shown without any qualifier (e.g. "no checks needed" should be default messaging)

---

### TC-112 — HealthIssue

| Field | Expected value |
|-------|---------------|
| Code | `112` |
| Label | `HealthIssue` |
| Title | "Switch is connected but reporting a health problem" |
| Summary | Should mention: connected but something is wrong internally; degraded or unstable agent state |
| Severity | `warn` (amber) |
| Top check (P1) | `mist-processes` — Mist Agent Processes |
| Top check (P2) | `cloud-connections` — Active Cloud Connections |
| Top check (P3) | `mist-last-seen` — Mist Last Seen |
| Further checks | `mist-events`, `switch-logs` |
| Remediation themes | Restart stopped process, escalate to Mist support, correlate with recent reboots |
| Workflow | `optional` |
| Workflow note | Should mention: targeted checks first; full workflow adds context but not required |

**Should be visible:**
- `warn` (amber) severity — not `fail`, not `pass`
- `mist-processes` as the top check
- Optional full workflow path available

**Should NOT appear:**
- `fail` indicator — the switch is connected, just unhealthy
- L2 or DNS checks as primary suggestions
- "No action needed" messaging

---

### TC-113 — NoDNSResponse

| Field | Expected value |
|-------|---------------|
| Code | `113` |
| Label | `NoDNSResponse` |
| Title | "DNS server is not responding" |
| Summary | Should mention: DNS is configured but the network path to the DNS server is unreachable |
| Severity | `fail` (red) |
| Top check (P1) | `dns-config` — DNS Configuration |
| Top check (P2) | `dns-resolution` — DNS Resolution & Reachability |
| Top check (P3) | `route-to-mist` — Route to Mist Endpoints |
| Further checks | `fw-check` |
| Remediation themes | Route/firewall path to DNS server, fallback DNS server |
| Workflow | `targeted` |
| Gap note | No dedicated `dns-server-reachability` check; `dns-resolution` is the closest proxy |

**Distinction from 106 DNSLookupFailed:**
- `106` = DNS configured, lookup fails (server responds with error or failure)
- `113` = DNS configured, server not responding at all (network path to DNS is blocked)
- The UI should ideally communicate this distinction in the summary text

**Should NOT appear:**
- Same check list as `106` without any messaging difference — the two states have similar checks but different root causes
- Cloud path checks as primary suggestions

---

### TC-115 — SoftwareDownloadFailure

| Field | Expected value |
|-------|---------------|
| Code | `115` |
| Label | `SoftwareDownloadFailure` |
| Title | "Firmware download failed" |
| Summary | Should mention: switch is likely connected but the image download from Mist CDN failed |
| Severity | `warn` (amber) |
| Top check (P1) | `fw-check` — Firewall Policy Check |
| Top check (P2) | `route-to-mist` — Route to Mist Endpoints |
| Top check (P3) | `cloud-connections` — Active Cloud Connections |
| Further checks | `mist-last-seen`, `mist-events` |
| Remediation themes | SSL inspection bypass for CDN, CDN hostnames, storage space |
| Workflow | `optional` |
| Gap note | No `storage-health` check; storage mentioned as manual guidance only |

**Should be visible:**
- `warn` severity — the switch may still be connected
- `fw-check` as the top check (CDN blocking via SSL interception is a common cause)
- Remediation mentions CDN bypass as well as primary Mist hostnames

**Should NOT appear:**
- `fail` indicator — the switch is likely still connected, just unable to download
- `mist-processes` or `mist-agent` as primary checks — this is a path issue, not a daemon issue

---

### TC-116 — SoftwareUpgradeFailure

| Field | Expected value |
|-------|---------------|
| Code | `116` |
| Label | `SoftwareUpgradeFailure` |
| Title | "Software upgrade failed" |
| Summary | Should mention: upgrade attempt failed; log evidence more useful than connectivity checks |
| Severity | `warn` (amber) |
| Top check (P1) | `switch-uptime` — Switch Uptime |
| Top check (P2) | `switch-logs` — Switch Logs |
| Top check (P3) | `mist-events` — Recent Mist Events |
| Further checks | `mist-processes`, `mist-agent` |
| Remediation themes | Reboot evidence, partial upgrade, storage, re-adoption if needed |
| Workflow | `targeted` |
| Gap note | No `storage-health` check; this is a lifecycle evidence state, not a connectivity state |

**Should be visible:**
- `warn` severity
- Timeline/lifecycle checks as the top priority rather than connectivity checks
- Note that this is about upgrade evidence, not a cloud path problem

**Should NOT appear:**
- DNS or firewall checks as the primary suggestion
- Full connectivity workflow as the CTA
- `fail` severity — the switch may still be operational

---

### TC-151 — DuplicateIPAddress

| Field | Expected value |
|-------|---------------|
| Code | `151` |
| Label | `DuplicateIPAddress` |
| Title | "Duplicate IP address conflict" |
| Summary | Should mention: another device is using the same management IP; intermittent connectivity expected |
| Severity | `fail` (red) |
| Top check (P1) | `mgmt-ip` — Management IP Address |
| Top check (P2) | `arp` — ARP Table |
| Top check (P3) | `interface-errors` — Uplink Interface Errors |
| Further checks | `vlan-config` |
| Remediation themes | ARP conflict identification, upstream switch ARP lookup, DHCP pool overlap |
| Workflow | `targeted` |
| Gap note | No dedicated `duplicate-ip-evidence` check; `arp` is the closest available proxy |

**Should be visible:**
- `fail` severity
- `arp` check in the top three — this is the most relevant evidence source
- Remediation mentions checking the upstream switch ARP table to identify the conflicting device

**Should NOT appear:**
- Cloud-path or daemon checks as primary suggestions
- Full workflow as the primary recommendation
- DNS checks as anything other than lower priority

---

## Failure Modes to Watch For

The following are the most likely rendering errors. Each describes what wrong
behavior looks like, why it is a problem, and what the correct behavior is.

---

### FM-1: Wrong check IDs shown for a state

**Wrong:** State `110 ServiceDown` shows `route-to-mist` or `fw-check` as
primary checks.

**Why it matters:** Sends the operator in the wrong direction. ServiceDown is a
daemon health issue, not a network path issue. Surfacing firewall checks wastes
time.

**Correct:** `mist-processes` and `mist-agent` are the top two checks for `110`.

**How to catch it:** Walk through TC-110 and compare the rendered check list
against the spec. If any check from the `108 CloudUnreachable` list appears at
the top, there is a mapping error.

---

### FM-2: Healthy state shows aggressive fail guidance

**Wrong:** State `111 Connected` shows a `fail` badge, displays remediation
guidance, or shows "Run Full Troubleshoot" as the primary button.

**Why it matters:** This is the healthy outcome at the end of the demo. If the
switch just reconnected and the UI shows failure indicators, it undermines the
entire "self-driving network" story.

**Correct:** `111` shows a `pass` (green) badge, "No troubleshooting needed"
messaging, and only optional secondary checks.

**How to catch it:** After a successful config sync demo, confirm the JMA badge
turns green and no remediation or workflow buttons are prominently displayed.

---

### FM-3: Over-recommending the full workflow

**Wrong:** States `102`, `103`, `105`, `110`, or `151` show "Run Full
Troubleshoot" as the primary or only CTA.

**Why it matters:** These states have specific, narrow failure modes. The full
full troubleshoot workflow is premature and adds 2–3 minutes of unnecessary checks.
The operator looks at a wall of results when only 2–3 checks matter.

**Correct:** These states have `workflowRecommendation: 'targeted'`. The UI
should surface the first-pass check list and treat the full workflow as a
secondary option.

**How to catch it:** Check that the primary button or recommendation text for
each `targeted` state is NOT "Run Full Troubleshoot". At most, it should appear
as a secondary option labeled "Run Full Troubleshoot Anyway" or similar.

---

### FM-4: Under-recommending the full workflow for 108

**Wrong:** State `108 CloudUnreachable` only shows `route-to-mist` and
`fw-check` with no full workflow prompt.

**Why it matters:** `108` is the one state where the full workflow IS the
primary recommendation. The lower layers (IP, gateway, DNS) may look fine from
the switch's perspective but have subtle issues. The full workflow surfaces them.

**Correct:** `108` should prominently show "Run Full Troubleshoot" as the
primary action. Targeted checks may appear in addition, but the full workflow
button should be primary.

**How to catch it:** Walk TC-108 specifically and confirm the full workflow
button is the most prominent action element for this state.

---

### FM-5: Contradicting an existing troubleshoot result

**Wrong:** JMA says `111 Connected` but the troubleshoot workflow result panel
shows a `fail` on `default-route` or `dns-resolution`. The UI shows only the
JMA `pass` badge without acknowledging the contradiction.

**Why it matters:** JMA state can lag behind real conditions. If local checks
show a failure that JMA doesn't reflect, the operator needs to see both signals
and the mismatch — not just the optimistic JMA view.

**Correct:** The UI should display a mismatch indicator when JMA state and
troubleshoot results disagree. The suggested text from the spec:
*"Switch-reported state and local test results disagree — may indicate stale
JMA state or a transient condition."*

**How to catch it:** After running a full troubleshoot that produces a `fail`
result, inject JMA state `111`. Confirm the UI shows the mismatch note rather
than just displaying the green badge.

---

### FM-6: Check ID typo or mismatch

**Wrong:** The UI renders "Management IP" but maps it internally to check ID
`management-ip` instead of `mgmt-ip`.

**Why it matters:** If the recommendation data shape uses a different ID than
the troubleshoot service produces, clicking "Run Recommended Checks" will either
fail silently or run the wrong check.

**Correct:** All check IDs in the recommendation data must exactly match the
canonical IDs in `troubleshoot.service.ts`. See the Implemented Check IDs table
in `docs/JMA-RECOMMENDATIONS.md`.

**Reference IDs to verify:**
- `mgmt-ip` (not `management-ip`)
- `dhcp-lease` (not `dhcp`)
- `dns-config` (not `dns-configuration`)
- `dns-resolution` (not `dns-resolve` — note: `dns-resolve` appears in the context of remediation hint text inside the service but the check ID is `dns-resolution`)
- `fw-check` (not `firewall`)
- `mist-processes` (not `mist-process`)
- `cloud-connections` (not `active-connections`)

---

### FM-7: 113 NoDNSResponse treated identically to 106 DNSLookupFailed

**Wrong:** Both `106` and `113` show the same summary, same checks, and no
distinction in guidance.

**Why it matters:** These two states have the same primary checks but different
root causes. `106` means DNS responds with failure; `113` means DNS doesn't
respond at all. The remediation is different: `106` → try alternate DNS server;
`113` → fix the network path to the DNS server.

**Correct:** While both show `dns-config` and `dns-resolution` at the top, the
summary text and remediation guidance should differ. `106` should mention
alternate DNS; `113` should mention route/firewall to the DNS server.

**How to catch it:** Display both states side-by-side (using stubbed states)
and confirm the summary text is distinguishably different.

---

### FM-8: Mismatch between JMA severity and Mist Status color

**Wrong:** JMA shows `fail` (red badge for `108 CloudUnreachable`) but the
Mist Status indicator also turns red for a different reason, and the UI shows
two competing red indicators without clearly labeling their sources.

**Why it matters:** The product's value is showing *two signals* — the
operator needs to quickly read both and understand which is which. If both
signals use the same visual treatment without labeling, the operator cannot
distinguish switch-reported state from Mist last-known state.

**Correct:** The JMA state badge should be explicitly labeled "JMA State" (or
"Switch-reported") and the Mist Status badge should be labeled "Mist Status"
(or "Cloud last-known"). They should appear as parallel indicators, not merged.

---

## Quick-Reference Validation Checklist

Use this checklist per state during a test pass. Print or keep open alongside
the UI.

```
[ ] Title matches expected operator-friendly wording
[ ] Summary is accurate (check against JMA-RECOMMENDATIONS.md)
[ ] Severity badge is correct color (fail=red / warn=amber / info=grey / pass=green)
[ ] Top-3 check IDs appear in the recommended checks panel, in priority order
[ ] Check IDs match canonical IDs from troubleshoot.service.ts (no typos)
[ ] Workflow recommendation matches (full / targeted_then_full / targeted / optional / skip)
[ ] Full workflow button is primary for 108, secondary for all others
[ ] Full workflow button is suppressed or secondary for 111 (Connected)
[ ] Remediation shows at least one correct guidance item for fail/warn states
[ ] No remediation or fail indicators for 111 (Connected) by default
[ ] JMA badge and Mist Status badge are separately labeled
[ ] Mismatch indicator appears when JMA and Mist Status disagree
[ ] No DNS/cloud checks shown as primary for 102, 103, 110, 151
[ ] No daemon/auth checks shown as primary for 102, 103, 104, 105
```

---

## Ambiguities and Validation Risks

**Risk 1 — dns-resolution check ID**
Inside `troubleshoot.service.ts`, the check ID string is `dns-resolution`
(confirmed at line 1399). The service also uses the identifier `dns-resolve`
internally as a remediation hint lookup key (line 2567). If the frontend
recommendation data accidentally uses `dns-resolve` instead of `dns-resolution`,
check dispatch will fail silently. Verify the exact string against the service.

**Risk 2 — 106 vs 113 differentiation**
Both states start with `dns-config` → `dns-resolution`. If
the recommendation rendering logic shares a template for these two states without
state-specific summary text, they will appear identical. The differentiation only
matters in the summary text and secondary remediation guidance — confirm those
are rendered from state-specific data, not a shared template.

**Risk 3 — 104 targeted_then_full button state**
The `targeted_then_full` recommendation requires a UI decision: does the
button say "Run Recommended Checks" with a note that full workflow may follow,
or does it show both buttons simultaneously? The spec does not mandate the exact
button layout. Either is acceptable, but the behavior should be consistent and
tested explicitly. Confirm the UI behavior before the demo.

**Risk 4 — JMA state stale after config sync**
In the demo flow, config sync completes and the switch reconnects. The JMA
state transitions from a `fail` state (e.g. `108`) to `111 Connected`. This
transition must trigger a JMA state refresh — if the polling interval is too
long, the badge may still show `108` after the switch reconnects. Confirm the
refresh happens within a reasonable time (< 60s) after a successful commit.

**Risk 5 — No recommendation data for transitional states**
States `0 None`, `101 BootComplete`, `107 ConnectionRequestSent`, `117
SoftwareUpgradeInProgress`, `118 SoftwareDownloadComplete`, and `119 CloudReady`
are not covered by `JMA-RECOMMENDATIONS.md` recommendations. If the switch
reports one of these states, the UI must handle the missing recommendation
gracefully — ideally showing the raw state label with a neutral indicator and
no check suggestions, rather than crashing or showing stale guidance from a
previous state.
```
