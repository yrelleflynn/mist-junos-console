# Troubleshooting Check Audit vs mcd Log Parser Scope

Date: 2026-04-22  
Status: Draft audit (repo-grounded)

---

## Purpose

Audit the current troubleshooting checks against `docs/MCD-LOG-PARSER-SCOPE.md` and classify each check by whether it is:

1. clearly replaceable by parser-backed mcd log analysis,
2. partially replaceable / still useful as confirmation,
3. definitely still required because mcd does not cover it.

This document emphasizes operator and product value:

- avoid duplicate checks when parser evidence is already sufficient,
- call out checks that become UI clutter after parser rollout,
- separate high-confidence conclusions from tentative items.

---

## Repo-grounded current state

The parser module exists (`src/features/troubleshoot/mcd-log-parser.ts`) but is not wired into the active troubleshooting catalog yet.

- Current catalog still exposes the existing 22 checks across 5 groups in `src/config/check-catalog.config.ts`.
- `mcd-log-analysis` is specified in scope but not currently registered in catalog.
- Existing workflows still run live checks via `src/services/troubleshoot.service.ts`.

Implication: this audit defines the target cleanup direction once parser-backed analysis is integrated, not a statement that replacement has already occurred in shipped behavior.

---

## Classification Summary

### Clearly replaceable by mcd log analysis

- `mist-last-seen` (and timeline-style offline narrative currently assembled from Mist events + switch logs)
- `dns-resolution`
- `dns-config` (for offline root-cause diagnosis; parser has stronger "effective resolver in use at failure time")

### Partially replaceable / still useful as confirmation

- `mgmt-ip`
- `dhcp-lease`
- `arp`
- `default-route`
- `dns-server-reachability`
- `mist-processes`
- `cloud-connections`
- `fw-check`

### Definitely still required (mcd does not cover)

- `lldp`
- `upstream-port-config`
- `port-status`
- `interface-errors`
- `vlan-config`
- `uplink-config-compare`
- `route-to-mist`
- `mist-agent`
- `outbound-ssh-config`
- `traceroute-to-mist`

---

## Check-by-check Findings

## High-confidence conclusions

### A) Clearly replaceable by parser

#### `mist-last-seen`

Why replace:

- Scope defines parser Query A/B as the primary narrative for why the switch went offline and what mcd is doing now.
- Existing `mist-last-seen` path in `troubleshoot.service.ts` is a broad correlation bundle (Mist stats/events, audit logs, jmd/messages windows), but parser output is expected to provide a more direct and defensible causality chain from mcd state transitions.

Operator/product value:

- Reduces duplicated timeline narratives.
- Improves root-cause confidence.
- Removes noisy "context dump" behavior when parser already has state-machine evidence.

#### `dns-resolution`

Why replace:

- Scope explicitly maps DNS success/failure to mcd signals (`ccstate.go:368`, `ccstate.go:380`) and richer failure typing.
- Current live check uses `show host`, useful but less semantically precise than mcd's own state machine evidence around the failure cycle.

Operator/product value:

- Fewer contradictory outcomes between "historical failure" and "current probe."
- Better diagnostic specificity without extra command churn.

#### `dns-config` (offline diagnosis path)

Why replace:

- Scope indicates parser can expose which DNS server mcd used during failure (`ccstate.go:422`) and detect fallback behavior.
- Live `dns-config` validates current configuration state, which is less useful when the question is "why did it go offline."

Operator/product value:

- Removes low-signal duplication in outage-focused workflows.
- Keeps user focused on causal evidence, not post-failure static snapshots.

---

### B) Partially replaceable / keep as targeted confirms

#### `mgmt-ip`

- Parser gives historical state-machine evidence.
- Live check still gives current interface state and source hints (`dhcp/static/unknown`).
- Recommendation: run only as confirm when parser indicates IP-layer issues.

#### `dhcp-lease`

- Parser can imply DHCP outcomes (gateway/DNS signals) but not full lease metadata.
- Live lease details remain useful where server/options data is needed for handoff.
- Recommendation: conditional use, not default in every run.

#### `default-route`

- Parser can indicate missing gateway/default path state.
- Live check inspects active default routes in `inet.0` and `mgmt_junos.inet.0` now.
- Recommendation: retain as confirm check when parser indicates route-related failure.

#### `arp` (Gateway reachability)

- Parser already captures gateway reachability state.
- Live check adds explicit ARP/ping proof for current condition and multiple default paths.
- Recommendation: keep as focused confirmation, not universal baseline.

#### `dns-server-reachability`

- Parser infers DNS transport failure from lookup semantics.
- Live ping-to-resolver can help operators separate "resolver unreachable" vs "resolver responds but query path blocked."
- Recommendation: one of the best optional confirmation checks after parser indicates DNS failure.

#### `mist-processes`

- Parser can classify why jmd was killed (higher root-cause value).
- Live process list still confirms current process presence (now-state sanity check).
- Recommendation: keep as confirmation in ServiceDown / uncertain states.

#### `cloud-connections`

- Parser gives historical connection transitions and failures.
- Live check is still useful for "is TCP/443 established right now?"
- Recommendation: targeted "current state" confirm, not always-on.

#### `fw-check`

- Parser can reveal cloud connection failure behavior but not full synthetic policy tests.
- Live check uniquely validates endpoint/port reachability and SSL inspection signatures.
- Recommendation: keep for CloudUnreachable and firewall-policy workflows.

---

### C) Definitely still required (mcd-blind)

#### Entire `layer2` group remains required

- `lldp`
- `upstream-port-config`
- `port-status`
- `interface-errors`
- `vlan-config`
- `uplink-config-compare`

Reason:

- mcd has no visibility into physical/L2 topology, uplink profile parity, or interface error counters.

#### Additional required checks

- `route-to-mist` (explicit route table evidence to resolved Mist endpoint)
- `mist-agent` (installed package/version presence)
- `outbound-ssh-config` (Junos outbound-ssh config correctness and secrets)
- `traceroute-to-mist` (path-break localization)

Reason:

- These provide config, package, or path diagnostics outside mcd state-machine semantics.

---

## Checks likely to become clutter after parser rollout

Highest clutter risk if left as default alongside parser:

1. `mist-last-seen` (duplicate outage narrative)
2. `dns-resolution` (duplicate DNS failure test with weaker semantics)
3. `dns-config` in outage root-cause flows (config snapshot duplicates parser evidence)

Secondary clutter risk:

- Always running both parser and all gateway/routing confirms even when parser confidence is high.

Product principle:

- If parser already provides sufficient evidence to answer the operator question, default to parser output and suppress redundant checks unless there is a specific ambiguity to resolve.

---

## Parser-first Run Policy Matrix

Default:

- Always run `mcd-log-analysis` first (Query A + Query B).
- Suppress default execution of: `mist-last-seen`, `dns-resolution`, `dns-config`.
- Trigger confirmation checks only when parser output is ambiguous, stale, or contradicted by current symptoms.

State-driven guidance:

- Parser indicates `102` (No IP):
  - Run: `mgmt-ip`, `dhcp-lease`
  - Optional: selected Layer2 checks (`port-status`, `vlan-config`)
  - Skip downstream DNS/cloud checks until IP exists

- Parser indicates `103` (No default gateway):
  - Run: `default-route`, `dhcp-lease`
  - Optional: `arp` if route state is uncertain
  - Skip DNS/cloud checks until default route is fixed

- Parser indicates `104` (Gateway unreachable):
  - Run: `arp`, `default-route`
  - Optional: selected Layer2 confirms
  - Skip broad DNS/cloud sweeps until gateway path is restored

- Parser indicates DNS failure (`105/106/113/114`):
  - Run: `dns-server-reachability` as primary confirm
  - Optional: `dhcp-lease` if parser hints DHCP-incomplete resolver config
  - Do not default-run `dns-config` + `dns-resolution`

- Parser indicates `108` (Cloud unreachable):
  - Run: `fw-check`, `outbound-ssh-config`
  - Optional: `cloud-connections`
  - Run `traceroute-to-mist` only when path-localization is needed

- Parser indicates `109` (Cloud auth failure):
  - Run: `outbound-ssh-config`, `mist-agent`
  - Optional: `cloud-connections`

- Parser indicates `110` (ServiceDown):
  - Use parser kill-path classification as primary diagnosis
  - Run confirms: `mist-processes`, `mist-agent`
  - Avoid broad cloud checks unless parser also indicates concurrent cloud reachability issues

- Parser indicates `111` (Connected) but operator reports issue:
  - Run: `cloud-connections`, `outbound-ssh-config`
  - Add targeted checks by symptom

---

## Tentative conclusions (validate in pilot before hard retirement)

- Full retirement of `default-route` and `arp` may be premature due to strong present-time evidence in current implementation.
- Full retirement of `mist-processes` may be risky when logs are sparse/rotated or mcd parser confidence is low.
- Full retirement of `cloud-connections` may reduce operator reassurance for real-time status validation.

Pilot recommendation:

1. Run parser-first plus conditional confirms for several real/offline cases.
2. Track whether confirm checks changed diagnosis or only reiterated parser conclusions.
3. Retire confirms that rarely change outcome and mostly add UI/latency clutter.

---

## Suggested implementation sequence

1. Register and ship `mcd-log-analysis` in `mist-agent` group (additive release).
2. Add parser-confidence-aware check selection in recommended workflows.
3. Disable default `mist-last-seen`, `dns-resolution`, `dns-config` when parser confidence is high.
4. Keep mcd-blind checks first-class and visible.
5. Reassess partial checks after pilot telemetry and operator feedback.

---

## Source files reviewed for this audit

- `docs/MCD-LOG-PARSER-SCOPE.md`
- `src/config/check-catalog.config.ts`
- `src/services/troubleshoot.service.ts`
- `src/features/troubleshoot/mcd-log-parser.ts`
- `src/features/troubleshoot/mcd-log-parser.types.ts`
- `src/features/troubleshoot/guided-analysis.ts`

