# mcd Log Parser — Development Scope

> **Status:** Reviewed — scope and design complete, April 2026. Ready for implementation on top of the current log-access tooling.
> Update as implementation diverges from design.

---

## What It Is

A structured parser that reads the mcd log from the switch, extracts the
diagnostic state machine sequence, and produces interpreted results —
replacing several existing checks and adding capabilities that live checks
fundamentally cannot provide.

## Implementation Intent

This document describes the logic we still need to build, not the raw log
transport we already have.

The current app can already:

- List current and rotated `mcd`, `jmd`, and `messages` logs
- Read current or rotated logs, including `.gz` files
- Search logs through the existing shell-backed agent actions

The new work is to add a repeatable **navigator + parser + formatter** layer
on top of those primitives so the app can answer higher-level questions like:

- Why did the switch go offline?
- What state is mcd in right now?
- Which existing checks can be replaced by historical mcd evidence?
- How should those parser results be rendered in the existing workflow UI?

---

## Product Goal

Add a first-class troubleshooting capability that can explain **why** JMA
reported a given cloud state, not just whether a live point-in-time check
passes or fails now.

The parser is intended to improve operator outcomes in three ways:

- reduce guesswork when a switch is offline and live checks are incomplete
- surface state transitions and failure sequencing that existing checks miss
- replace a subset of current checks with higher-value historical evidence
- reduce troubleshooting clutter by avoiding app-side reimplementation of
  checks whose meaningful output already exists in mcd

## Scope Goals

The implementation should:

- answer Query A: why the switch went offline
- answer Query B: what mcd is doing now
- produce structured output, not ad hoc text blobs
- retire or avoid redundant checks when mcd already provides sufficient
  diagnostic evidence
- plug into the existing check/result model without requiring a new UI surface
- preserve reuse: navigator logic, parser logic, and formatting should remain
  independently testable

## Non-Goals

This iteration does not attempt to:

- build a general-purpose Junos log analytics platform
- parse every JMA log family in one pass
- replace all existing live troubleshooting checks
- preserve redundant checks just because they already exist in the app
- require new transport primitives before validating the parser design
- make jmd correlation a blocking dependency for the first version

---

## Product Principle: Do Not Rebuild mcd in the UI

This feature should reduce clutter, complexity, and fragility in the
troubleshooting product.

If mcd already performs a diagnostic step and logs enough evidence to answer
the operator's question reliably, the app should prefer parsing that evidence
over adding or maintaining a separate live check that effectively reproduces
the same test.

The app should only keep or add checks when they contribute value that mcd
does not already provide, for example:

- layer-2 or physical-state visibility that mcd never sees
- richer live state when historical mcd evidence is insufficient
- configuration, version, or topology facts outside mcd's responsibility
- confirmation of ambiguous cases where mcd only implies, but does not prove,
  the underlying fault

This principle should guide both implementation and cleanup:

- do not add parser-adjacent checks that duplicate mcd semantics
- use the parser to simplify the operator surface where confidence is high
- keep only the checks that are additive, not repetitive

---

## High-Level Architecture

The design has four layers:

1. **Log access primitives**: already present in the app. These list, read,
   and search current or rotated logs.
2. **Navigator**: chooses the right file(s), finds the anchor point, and
   fetches the minimal useful context window.
3. **Parser core**: converts raw mcd lines into structured state/cycle data.
4. **Result formatter**: maps parsed output onto the existing check-result
   schema used by the troubleshooting UI.

This separation matters because the hard problems are different:

- log access is about shell/serial transport and bounded reads
- navigation is about time/file selection correctness
- parsing is about mcd semantics and state-machine interpretation
- formatting is about presenting those conclusions in the existing product UX

## Integration Shape

The recommended first release is a new check, `mcd-log-analysis`, in the
`mist-agent` troubleshooting group.

That keeps the rollout additive:

- no existing check has to be removed on day one
- parser output can be validated side by side with current checks
- the UI can render results through the existing check result model
- later cleanup can replace redundant checks once parser confidence is high

---

## Background: Why the mcd Log

The mcd log is the ground truth for JMA's self-assessment. The state machine
in `ccstate.go` runs the same checks (IP, gateway, DNS, cloud reachability)
and logs each result explicitly before calling `SetState()`. This means:

- Every diagnostic fact mcd acts on is in the log
- The log tells you *what happened*, not just *what the current state is*
- State transitions, self-healing paths, and retry timing are all visible
- The log distinguishes failure modes that produce the same JMA state code

The signal/noise ratio in a raw mcd log is roughly 25% — the other 75% is
`ipc_server.go` polling noise (jmd checking in every 5 seconds) and
`app.go:318` waiting messages. A targeted filter recovers the diagnostic
signal cleanly.

A working filter script lives at `tools/mcd-filter.mjs`.

---

## ccstate.go Line Catalog

Complete set of known diagnostic lines, confirmed against real lab logs:

| Line | Content | Meaning |
|------|---------|---------|
| `ccstate.go:308` | `no management ip address` | No IP — state 102 |
| `ccstate.go:311` | `management ip address X.X.X.X` | Has IP |
| `ccstate.go:327` | `no default gateway` | No gateway entry — state 103 |
| `ccstate.go:330` | `default gateway X.X.X.X` | Gateway found in routing table |
| `ccstate.go:334` | `default gateway not reachable, default gateway ip: X` | Gateway ping failed — state 104 |
| `ccstate.go:346` | `default gateway is reachable` | Gateway ping succeeded |
| `ccstate.go:368` | `LookupIP() failed: ...` | DNS lookup failed (see error type below) |
| `ccstate.go:380` | `dns lookup for jma-terminator.mistsys.net is good` | DNS resolved — proceed to TCP |
| `ccstate.go:406` | `DNS lookup failed for X via Y: ...` | Secondary DNS check failed |
| `ccstate.go:422` | `DNS Server ip: X.X.X.X` | DNS server being used |
| `ccstate.go:431` | `checking google.com is reachable via well-known dns server 8.8.8.8` | Fallback DNS sanity check |
| `ccstate.go:160` | `failed to set cloud connectivity (ignored): Error invoking RPC` | jmd IPC failure during kill — state 110 |
| `ccstate.go:161` | `failed to set cloud connectivity state: 0. err (ignored): 11` | Accompanies ccstate.go:160 |
| `ccstate.go:243` | `SetState(N)` | State transition |
| `ccstate.go:511` | `updated disconnect reason: {...}` | JSON: timestamp, cc_state, reason, event_sent |
| `ccstate.go:574` | `updated disconnect reason event sent status: {...}` | Confirms disconnect event sent to Mist |
| `ccstate.go:606` | `device disconnect reason: &{...}` | Stored reason being reported on reconnect |

### DNS Error Types (ccstate.go:368)

The error string distinguishes failure mode:

| Error | Meaning | State |
|-------|---------|-------|
| `connect: can't assign requested address` | Local socket binding failed — no route or no IP | 106 early, 102/103 |
| `read udp ... i/o timeout` | Packet sent, no response — DNS server unreachable or UDP 53 blocked | 106 |
| `read: no route to host` | Routing table has no path to DNS server | 113 |

### DNS Server as a Diagnostic Signal

When `ccstate.go:422` shows `1.1.1.1`, DHCP did not provide DNS servers.
mcd falls back to Cloudflare's well-known address in the reviewed lab logs.
`1.1.1.1` in the DNS server field is therefore a strong indicator that DHCP
was incomplete — IP and gateway may be present but DNS config is missing.
This should still be validated across JMA versions before being treated as a
hard parser invariant.

---

## State Summary

| State | Code | Key ccstate trigger | Retry |
|-------|------|---------------------|-------|
| NoIPAddress | 102 | `ccstate.go:308` | 2s |
| NoDefaultGateway | 103 | `ccstate.go:327` | 1s |
| DefaultGatewayUnreachable | 104 | `ccstate.go:334` | 60s |
| DNSLookupFailed | 106 | `ccstate.go:368` + i/o timeout | 60s |
| CloudUnreachable | 108 | `connect.go` RST/refused/timeout | 1s |
| ServiceDown | 110 | `ccstate.go:160/161` | — |
| Connected | 111 | `ccstate.go:380` + `connect.go:332` | — |
| NoDNSResponse | 113 | `ccstate.go:368` + no route to host | 1s |

The retry interval is visible in `app.go:1040: will try again in Xs`.

---

## The Two 110 Kill Paths

State 110 (ServiceDown) is produced by two completely different mechanisms.
The mcd log distinguishes them; the JMA state code does not.

### Path 1 — jmd unresponsive (keep-alive timeout)

```
app.go:865: ipc keep-alive timeout; last received "Xs" ago
monitor.go:57: restarting process monitor
monitor.go:238: killing monitored process
```

jmd stopped answering IPC heartbeats. mcd pulls the trigger after ~1 minute.
**Diagnosis:** jmd is hung or deadlocked. Consider agent restart.

### Path 2 — cloud WebSocket dropped

```
ipc_server.go:161: stopping ipc server
ipc_server.go:354: stream context done; exiting cloud cmd stream
app.go:1110: ctx canceled; exiting sendCloudMsgs
msgq.go:176: stopping message-queue publisher: context canceled
monitor.go:238: killing monitored process
```

The Mist WebSocket connection dropped. mcd tears down its IPC server and
kills jmd as part of the shutdown sequence. Recovery is typically ~10 seconds.
**Diagnosis:** Cloud connectivity issue, not a local jmd problem. The
ccstate.go:160/161 RPC errors that follow are a consequence of the kill
timing, not an independent failure.

In 1674 sampled jmd kills from the reviewed lab logs, `Exited=false,
ExitCode=-1` appeared every time. Treat this as strong observed evidence that
the dominant failure mode here is mcd killing jmd, not as proof that jmd can
never crash independently on other builds or platforms.

---

## The Cached IP Mechanism

When DNS fails, mcd checks for a previously cached cloud endpoint IP:

```
connect.go:630: Using cached cloud ip address wss://X.X.X.X:443/ws
```

This allows recovery from DNS failure without DNS working. Implications:

- A live dns-resolution check showing FAIL may not accurately represent
  whether the switch can reach Mist — the cached IP path may succeed
- State can transition 106 → 111 without DNS ever resolving
- The cache is populated when a successful connection caches the resolved IP:
  `connect.go:678: Caching address X.X.X.X:443 for url wss://...`
- Cached IP attempts can also fail (connection refused = stale cache)

---

## Check-by-Check Analysis

A key design question for implementation is which existing checks the parser
makes redundant versus which still need to run live. The distinction also
depends on context: for an **offline switch**, live checks may be unreliable
or impossible; for an **online switch**, live checks give current state while
the mcd log gives history.

The 22 checks across 5 groups, assessed against mcd log coverage:

---

### Group: `layer2`

| Check | mcd Coverage | Verdict |
|-------|-------------|---------|
| `lldp` | None. mcd operates at IP layer and above, never sees L2 neighbours. | ❌ Cannot replace |
| `upstream-port-config` | None. mcd doesn't log port profiles. | ❌ Cannot replace |
| `port-status` | None. mcd doesn't log physical link state. | ❌ Cannot replace |
| `interface-errors` | None. CRC, drop, framing counters are invisible to mcd. | ❌ Cannot replace |
| `vlan-config` | None. mcd doesn't log VLAN configuration. | ❌ Cannot replace |
| `uplink-config-compare` | None. mcd doesn't compare local vs Mist-intended config. | ❌ Cannot replace |

The entire `layer2` group is below mcd's visibility. These checks remain
necessary and are unaffected by the parser.

---

### Group: `ip-routing`

| Check | mcd Coverage | Verdict |
|-------|-------------|---------|
| `mgmt-ip` | `ccstate.go:308` (no IP) / `ccstate.go:311` (IP found). mcd logs the IP it observed when it last ran its check cycle. | ⚠️ Partial |
| `dhcp-lease` | `ccstate.go:330` (gateway) + `ccstate.go:422` (DNS server). mcd logs the DHCP *results* but not the lease metadata: DHCP server IP, lease time, binding. | ⚠️ Partial |
| `arp` | `ccstate.go:334` (gateway unreachable) / `ccstate.go:346` (reachable). mcd explicitly logs its gateway ping result. | ✅ Replaces |
| `default-route` | `ccstate.go:327` (no gateway entry) / `ccstate.go:330` (gateway found). Covers the critical gate logic. The live check may reveal multiple default routes via different interfaces which mcd wouldn't distinguish. | ⚠️ Mostly replaces |
| `route-to-mist` | None. mcd logs DNS resolution and TCP connection attempts, but not the routing table entry for Mist endpoints specifically. | ❌ Cannot replace |

**On `mgmt-ip`:** mcd's evidence is historical — it shows the IP state at
the time of the last check cycle, not necessarily right now. The live check
is more current. For an offline switch, mcd's evidence may be more reliable
than a live check that can't reach the management interface.

**On `dhcp-lease`:** mcd tells you what DHCP delivered (IP, gateway, DNS
server). It cannot tell you the DHCP server that delivered it, the lease
expiry, or whether the lease is still valid. The live check covers the gaps.
The `1.1.1.1` DNS server signal (DHCP-incomplete indicator) is a mcd-only
diagnostic not available from the live DHCP check.

---

### Group: `dns`

| Check | mcd Coverage | Verdict |
|-------|-------------|---------|
| `dns-config` | `ccstate.go:422` shows the DNS server mcd is using, including detection of the `1.1.1.1` fallback when DHCP didn't provide DNS servers. | ✅ Replaces + adds fallback detection |
| `dns-server-reachability` | None. mcd tests DNS by making a lookup, not by explicit ICMP ping to the DNS server. A failed lookup (ccstate.go:368) implies unreachability but doesn't confirm it. | ❌ Cannot directly replace |
| `dns-resolution` | `ccstate.go:368` (failed, with error type) / `ccstate.go:380` (success). The error string distinguishes `i/o timeout` (server unreachable / UDP 53 blocked), `can't assign requested address` (no local route), and `no route to host` (routing table gap). More diagnostic detail than the live check. | ✅ Replaces + more detail |

**On `dns-server-reachability`:** mcd's lookup failure at ccstate.go:368
strongly implies the DNS server is unreachable, but mcd doesn't run a
separate ICMP test. The live check's explicit ping is still useful for
confirming which path is broken (routing vs firewall vs server down).

---

### Group: `mist-agent`

| Check | mcd Coverage | Verdict |
|-------|-------------|---------|
| `mist-agent` | None. mcd doesn't log its own installed version. | ❌ Cannot replace |
| `mist-processes` | `monitor.go:238` (jmd killed) + kill path classification (`app.go:865` vs `ipc_server.go:161`). Tells you *why* jmd was killed, not just whether it's running. | ✅ Replaces + significantly better |
| `outbound-ssh-config` | None. mcd doesn't log its outbound-ssh Junos configuration. | ❌ Cannot replace |
| `cloud-connections` | `SetState(111)` + `connect.go:332` confirm when a connection was established. Historical evidence only — not a live connection table. | ⚠️ Partial |
| `mist-last-seen` | This check is essentially what the mcd log parser *is*, but at a fraction of the depth. The parser replaces it entirely with Query A. | ✅ Full replacement |

**On `mist-processes`:** The live check tells you the process is or isn't
running. The mcd log tells you *why* it isn't, and which of the two
fundamentally different failure paths caused it. This is the single biggest
qualitative improvement over the live check.

**On `cloud-connections`:** The live check shows established TCP/443 sessions
right now. mcd's `SetState(111)` confirms the last time a connection was
established. For an offline switch, mcd's historical evidence is all you have.

---

### Group: `cloud-reachability`

| Check | mcd Coverage | Verdict |
|-------|-------------|---------|
| `fw-check` | Partial. `connect.go` logs TCP connection failures after DNS resolves. But mcd doesn't run structured port tests or detect SSL inspection. For state 106 (DNS failed), no TCP attempt appears at all — so fw-check may be the only way to test firewall policy when DNS is broken. | ⚠️ Partial, cannot replace for state 106 |
| `traceroute-to-mist` | None. mcd doesn't run traceroute. | ❌ Cannot replace |
| `mist-last-seen` | Replaced by Query A. See above. | ✅ Full replacement |

---

### Summary

| Verdict | Checks |
|---------|--------|
| ✅ Replaces (full or better) | `arp`, `dns-config`, `dns-resolution`, `mist-processes`, `mist-last-seen` |
| ⚠️ Partial (mcd adds depth, live check fills gaps) | `mgmt-ip`, `dhcp-lease`, `default-route`, `cloud-connections`, `fw-check` |
| ❌ Cannot replace (mcd blind) | `lldp`, `upstream-port-config`, `port-status`, `interface-errors`, `vlan-config`, `uplink-config-compare`, `route-to-mist`, `dns-server-reachability`, `mist-agent`, `outbound-ssh-config`, `traceroute-to-mist` |

The checks mcd cannot replace are concentrated in `layer2` (all 6) and the
configuration/version checks (`mist-agent`, `outbound-ssh-config`). Everything
from IP layer upward that mcd actually tests is covered — and the log evidence
is often more diagnostic than the equivalent live check because it shows the
sequence and error detail, not just the current pass/fail state.

---

## New Capabilities Checks Cannot Provide

**State history before the current state**
Checks snapshot current state. The parser produces the sequence —
`106 → 111 → 103` is a completely different diagnosis from seeing state 103 now.

**Self-healing path visibility**
The cached IP mechanism (connect.go:630) is invisible to live checks. A
switch can be in state 106 and simultaneously connected to Mist via cached IP.

**Precise 110 diagnosis**
Same JMA state code, different root cause, different fix. Only the log
distinguishes them. See "Two 110 Kill Paths" above.

**Retry interval as signal**
`app.go:1040: will try again in Xs` — 1s means mcd expects quick recovery,
60s means it has settled into a longer failure mode.

**Pre-reconnect disconnect reason**
`ccstate.go:511` JSON captures the disconnect reason before it has been sent
to Mist. The parser can surface what Mist will see when the switch reconnects,
before it reconnects.

---

## Log Navigation

### The Problem

mcd rotates its log on a schedule. The lab switch produced files of ~2MB
before rotation, each covering roughly 8 hours. The filename encodes the
roll time, not the start time:

```
mcd-2026-04-20T02-57-00.755.log   ← rolled at April 20 02:57, contains events before that
mcd-2026-04-20T12-06-23.232.log   ← rolled at April 20 12:06
mcd-2026-04-20T20-05-31.554.log   ← rolled at April 20 20:05
mcd.log                           ← active, rolling (current app convention)
```

To find events at a given timestamp you need to:
1. Find which file covers that time (the file whose roll timestamp is the
   first one >= the target time)
2. Find the right starting line within that file
3. Potentially span across a rotation boundary if the window of interest
   straddles two files

The existing MCP tools (`list_log_files`, `search_log_file`) give an agent
the primitives to do this, but they require the agent to reason about file
selection explicitly. For the parser to be reliably useful — especially in
agentic workflows — this logic needs to be codified, not left to the agent
to figure out each time.

### Primary Query Modes

The two highest-value queries, which together give a complete diagnostic
picture:

**Query A — Why did it go offline? (last-seen anchor)**
Fetch `last_seen` from `get_mist_stats`. Rather than searching a time window,
find the precise disconnect event using the `event_sent` flag:

```
1. Compute search_from = last_seen - 30s  (one heartbeat before last contact)
2. Scan mcd log for ccstate.go:511 lines containing event_sent: false
3. Parse the JSON timestamp embedded in each matching line
4. Return the first line where JSON timestamp >= search_from
5. Use that cycle as the anchor — this IS the disconnect event
```

The JSON timestamp inside `ccstate.go:511` is authoritative — it is the
moment mcd recorded the state change, not an approximation. This gives a
semantic anchor rather than a time range: the exact record of the disconnect
reason that Mist has not yet received.

**Edge case — oscillating state before disconnect:**
If the switch was cycling (multiple disconnect/reconnect cycles leading up
to the final offline), there may be several `event_sent: false` entries
after search_from, each followed by `event_sent: true` on reconnect.
The first `event_sent: false` after search_from is still the correct anchor
— it corresponds to the last heartbeat window. Any earlier false entries
would have already been followed by a successful reconnect and reported
to Mist.

*Answers: what caused the outage?*

**Query B — What is it doing right now? (most recent SetState)**
Tail `mcd.log`. Grep for the last `ccstate.go:511` line — the JSON
gives state code, reason, and timestamp of the most recent SetState. Show
the surrounding cycle for context. No file navigation needed.

*Answers: what is mcd stuck in now?*

These address different questions and can give different answers. A switch
may have gone offline three days ago due to a gateway issue (Query A), but
currently be cycling in DNS failure because the network state has changed
(Query B). Both pieces are needed for a complete diagnosis.

**The `event_sent` flag as additional context**
The `ccstate.go:511` JSON includes `event_sent: true/false`. When false,
Mist has not yet received the disconnect reason — the switch hasn't
reconnected to report it. The tool can surface this explicitly: *"mcd
reports DNS failure but hasn't been able to notify Mist yet."*

Important implementation note: the confirming `ccstate.go:574` line often
appears in the later reconnect cycle rather than the original failure cycle.
The parser core can safely treat `511` parsing as cycle-local, but the
navigator/formatter layer may need to retain adjacent cycles when it wants to
show the full "recorded locally, then later sent to Mist" story end to end.

**Additional use cases (lower priority)**

**3. Recent history window**
Last N hours or N cycles regardless of file boundaries. May span from a
rotated file into `mcd.log`.

**4. Mist event correlation**
Given a Mist event timestamp (e.g., `SW_CONFIG_CHANGED_BY_USER`), find the
mcd log window around that time to see if a config push correlates with a
disconnect. jmd logs are a secondary source for this use case — interface
up/down transitions and config commits applied on the Junos side appear in
jmd and can help establish whether something on the switch side preceded the
mcd disconnect. jmd rotates roughly every 2 hours (vs mcd's ~8 hours), so
timestamp-anchored grep within the correct rotated file follows the same
pattern as for mcd.

---

## jmd Log Scope

**In scope for primary queries (Query A/B): no.**

The mcd log is the ground truth for cloud connectivity. Both kill paths
(keep-alive timeout and cloud WebSocket drop) are fully diagnosed from mcd
alone — jmd logs add nothing to Query A or Query B.

**In scope for correlation (use case 4): yes, as a secondary source.**

When the question is *what else happened around the time of the disconnect*,
jmd adds:
- Interface up/down transitions (port flaps, link events)
- Config commits received from Mist and applied on the switch
- Junos operational events that may have preceded or caused the disconnect

The correlation workflow: find the mcd disconnect window first (Query A),
then grep jmd logs for the same timestamp range to see if a Junos-side event
coincides.

**Deliberately out of scope for this iteration.** The parser targets mcd.
jmd correlation is a follow-on capability once the core mcd parser is
validated.

### Design Decision: Separate Navigator vs Built-in

**Recommended: Separate log navigator component**

The parser core should consume a stream of log lines and know nothing about
file selection. The navigator sits above it and is responsible for:

- Building a file manifest from `list_log_files`
- Selecting the right file(s) for a given time range
- Finding the entry point within a file (by timestamp scan or grep)
- Stitching across rotation boundaries when needed
- Passing the resulting line stream to the parser

This separation keeps the parser testable in isolation (feed it any lines,
get structured output) and keeps the navigation logic reusable — the same
navigator could serve future log parsers for jmd or other Junos logs.

An agent using the MCP tools directly can also use the navigator's logic
explicitly, calling `list_log_files` then `search_log_file` with the
navigator-computed parameters. The navigator makes that reasoning repeatable
and correct rather than ad hoc.

### File Selection Algorithm

Given a target timestamp T:

```
1. Fetch file list from list_log_files (mcd logs only)
2. Parse roll timestamps from filenames
3. Sort files chronologically by roll timestamp
4. Select the file with the smallest roll timestamp >= T
   → that file contains events from [previous roll time, this roll time)
5. If T is after the last rotated file's roll time → use `mcd.log`
6. If the requested window extends past the selected file's roll time
   → also fetch the next file and concatenate
```

Edge case: if T predates all available rotated files, the relevant log has
been purged. Surface this as a "log window unavailable" result rather than
returning empty or incorrect data.

### Entry Point Within a File

For large files (~2MB), scanning from the top to find a timestamp wastes
time over serial. The navigator uses targeted `search_log_file` calls with
a timestamp anchor rather than transferring the full file. The Mist heartbeat
interval is 30 seconds, so `last_seen` is at most ~30 seconds stale when a
switch goes dark — the `search_from = last_seen - 30s` bound is tight and
reliable.

See the **Serial Access Efficiency** section below for the complete strategy,
including `search_log_file` API constraints, call budget, and where the
navigator still adds value above the existing log-access primitives.

---

## Serial Access Efficiency

### Preferred implementation layer: shell grep

The switch exposes a root shell (accessible at the `root@...RE:0%` prompt via
the serial console). Shell-level `grep` and `zgrep` are the right
implementation layer for log parsing — not `show log | match`.

| Capability | `show log \| match` | Shell `grep` / `zgrep` |
|------------|--------------------|-----------------------|
| Regex | Literal text only | Full ERE (`-E`) |
| Context lines | None | `-A N -B N` |
| Compressed files | Transparent via `show log` | `zgrep` natively |
| Line cap | Configurable soft limit | No cap — returns all matches |
| Cross-file search | One file per call | Glob across all rotated files |
| File metadata | Requires CLI output parsing | `ls -la /var/log/mcd*` |

The existing `search_log_file` path in the app is already shell-backed and can
read rotated files. The navigator should build on those same capabilities,
using targeted shell commands and file-selection logic so the transfer cost
stays proportional to the number of matching lines rather than the file size.

### `search_log_file` API (for reference / fallback)

| Parameter | Behaviour |
|-----------|-----------|
| No `findText` | Returns the **last N lines** of the file |
| With `findText` | Returns **N lines starting from the first match** (literal text only) |
| `maxLines` | Defaults to 20; current cap 100 (soft — tunable) |
| `logFile` | Current or rotated `mcd`, `jmd`, or `messages` filename |

Constraints: first-match-only anchoring, no context-before, literal text
matching. Good for bounded reads; less suitable than explicit `grep`/`zgrep`
for richer context windows or cross-file stitching.

### Query B — Current state

```bash
grep -E "ccstate\.go:|connect\.go:|app\.go:1040|app\.go:865|app\.go:1110|ipc_server\.go:161|monitor\.go:238|monitor\.go:211" \
  /var/log/mcd.log | tail -200
```

Last 200 signal lines from the live `mcd.log`. Client-side: parse for the most
recent `ccstate.go:511` to get current state, reason, and `event_sent`.
No file selection needed.

### Query A — Last-seen anchor

The navigator finds the anchor in two steps: locate the right line, then
fetch context around it. The challenge is that mcd logs are sparse during
connected periods — a switch that has been online for hours may have no log
entries across many consecutive minutes. Any timestamp-based approach must
handle the case where there is no line matching the target minute.

**Preferred strategy — semantic grep + line number**

Search directly for the semantic content rather than a timestamp. This
sidesteps the sparse-log problem entirely: grep returns only lines that
carry state transition information, regardless of how quiet the surrounding
period was.

```bash
# Step 1 — get all ccstate.go:511 entries with line numbers
grep -n "updated disconnect reason:" /var/log/mcd.log

# For a rotated file:
zgrep -n "updated disconnect reason:" /var/log/mcd-2026-04-20T12-06-23.232.log.gz
```

Returns a small set of lines (one per state change event). Client-side:
parse the embedded JSON timestamp in each match, find the first line where
`json.timestamp >= last_seen - 30s`. This gives the anchor line number `N`.

```bash
# Step 2 — fetch context by line number
sed -n '$((N-100)),$((N+50))p' /var/log/mcd.log

# For a compressed file:
zcat /var/log/mcd-2026-04-20T12-06-23.232.log.gz | sed -n '$((N-100)),$((N+50))p'
```

100 lines before ≈ 25 signal lines — captures the preceding connected cycle.
50 lines after ≈ 12 signal lines — captures the cycle boundary and next start.
No timestamp matching required at any point.

**Fallback strategy — timestamp step-back**

Used when shell line-number addressing is unavailable (e.g., `search_log_file`
fallback path). The log may have no entries for the exact target minute, so
the navigator steps back through minutes until it finds one that exists.

```
1. Format target = last_seen - 30s as "YYYY/MM/DD HH:MM"
2. grep/findText for that minute string
3. If no match → try target - 1 minute
4. If no match → try target - 2 minutes
5. Continue until a match is found or a reasonable limit is reached (e.g. 10 minutes)
6. If still no match → file likely does not cover the target period;
   surface "no log activity found near [timestamp]" and check file selection
```

Step back rather than forward — the disconnect happened at or before
`last_seen`, so earlier minutes are the right direction. Stepping forward
risks landing in a post-reconnect period.

The step-back limit of ~10 minutes covers even a switch that has been
connected and quiet for an extended period. If no mcd activity is found
within 10 minutes before `last_seen`, the selected log file is likely wrong
(or the switch has been running without incident for a very long time and
mcd has nothing to say).

### File selection

```bash
ls -la /var/log/mcd*.log.gz /var/log/mcd.log
```

Roll timestamps are encoded in the filename:
`mcd-2026-04-20T12-06-23.232.log.gz` → rolled at `2026-04-20T12:06:23`.

Selection algorithm (client-side arithmetic on filename list):
1. Parse roll timestamps from filenames
2. Sort ascending by roll time
3. Pick the first file whose roll time ≥ target timestamp
4. If target is after all rotated files → use `mcd.log`

### Live log filename

On the switch, the live mcd log is `/var/log/mcd.log`. Rotated files follow
the pattern `/var/log/mcd-YYYY-MM-DDTHH-MM-SS.mmm.log.gz`. Confirmed against
the lab EX2300. There is no `current_mcd.log` on the device — that name was
an artifact of how Mist downloads and renames files locally for inspection.
The navigator should use `mcd.log` as the live log path with no ambiguity.

For later jmd correlation work, the same pattern applies: live log
`/var/log/jmd.log`, rotated files `/var/log/jmd-YYYY-MM-DDTHH-MM-SS.mmm.log.gz`.
In lab observation, jmd rotated more frequently than mcd, roughly every
2 hours versus mcd's roughly 8-hour windows, so time-window file selection
will be more fine-grained for jmd correlation than for mcd analysis.

### What not to do

- Do not `cat` or `zcat` the full file — transfer only grep output
- Do not use `show log | match` when shell access is available
- Do not rely solely on the log-level timestamp — always verify against the
  JSON timestamp inside `ccstate.go:511`
- Do not use `event_sent":false` as a grep anchor without `-n` — you need the
  line number or timestamp to fetch context in a second call

### Relationship to Existing MCP Tools

`list_log_files` and `search_log_file` remain available as a fallback when
shell access is not possible. The shell approach is preferred — see Serial
Access Efficiency section. When using shell commands, the navigator bypasses
`search_log_file` entirely and issues grep commands directly via the existing
command dispatch mechanism (`start shell sh -c '<cmd>'`).

---

## Component Workflow

### Trigger

`run_check('mcd-log-analysis')` — same entry point as any other check. Can be
called via MCP, operator click, or as part of `run_check_group('mist-agent')`.
The check handler reads session state to determine which query mode(s) to run:
is `last_seen` available from Mist context? Is the device currently offline?
Typically both Query A and Query B run together — they answer different
questions and the combined output gives a complete picture.

### Data flow

```
Trigger: run_check('mcd-log-analysis')
│
├─ Check handler
│   Reads: last_seen (from Mist context in session state), device offline flag
│   Decides: run Query A, Query B, or both
│
├─ Navigator (Query A — why did it go offline?)
│   Input:  last_seen timestamp
│   Step 1: shell → ls -la /var/log/mcd*.log.gz /var/log/mcd.log
│           client-side: parse roll timestamps from filenames → select file
│   Step 2: shell → zgrep -n "updated disconnect reason:" /var/log/<file>
│           client-side: parse JSON timestamp in each match,
│                        find first where json.timestamp >= last_seen - 30s
│                        → anchor line number N
│   Step 3: shell → zcat <file> | sed -n '$((N-100)),$((N+50))p'
│   Output: ~150 lines of raw log text → passed to parser core
│
├─ Navigator (Query B — what is it doing right now?)
│   Input:  (none beyond log family)
│   Step 1: shell → grep -E "<SIGNAL_PATTERNS>" /var/log/mcd.log | tail -200
│   Output: ~200 lines of raw log text → passed to parser core
│
├─ Parser core
│   Input:  raw log lines from navigator
│   - Applies SIGNAL_PATTERNS filter
│   - Groups into retry cycles at app.go:1040 boundary
│   - Per cycle: extracts SetState sequence, classifies kill path
│               (keep-alive timeout vs cloud WebSocket drop),
│               parses ccstate.go:511/574 JSON
│   Output: structured cycle objects
│           { cycleNumber, states[], killPath, disconnectReason,
│             eventSent, sentAt, rawLines[] }
│
└─ Result formatter
    Input:  cycle objects + query mode
    Query A output: state transition at disconnect, disconnect reason JSON,
                    event_sent status, kill path classification
    Query B output: current state, retry interval, how long in this state
    Maps to: check result { status, headline, details, remediation }
             → same schema as existing checks → no UI changes needed
```

### Shell command execution

The existing check infrastructure issues Junos CLI commands via the serial
session. The navigator requires shell-level `grep`/`zgrep`. Three options:

**Option 1 — `start shell sh -c '<cmd>'` wrapper (recommended first step)**
Single-line shell execution from within the Junos CLI. Junos executes the
command and returns to the CLI prompt. No new backend primitive needed — works
within the existing command dispatch mechanism. Example:

```
start shell sh -c 'zgrep -n "event_sent.*false" /var/log/mcd.log'
```

**Option 2 — `runShellCommand` backend primitive**
Explicit shell mode handling — backend manages the `start shell` / `exit`
transition as a distinct execution context. Cleaner long-term but requires
new backend work. Right approach if multiple shell commands need to run
sequentially without the overhead of repeated `start shell` invocations.

**Option 3 — session already at root shell**
If the operator is at the root shell prompt, commands go directly. Not
reliable as a dependency — the navigator cannot assume shell mode.

Confirm `start shell sh -c` works cleanly on the target device before
committing to option 1. If it adds unwanted output (banner, prompts) that
interferes with output parsing, option 2 becomes necessary.

---

## Delivery Strategy

### Phase 1 — Additional check in `mist-agent` group (recommended first step)

Add `mcd-log-analysis` as a new check. Fetches the mcd log, parses the last
N cycles, returns structured results alongside existing checks. Additive, low
risk. Existing checks remain for comparison during validation, but the
validation goal is to identify which of them can be retired rather than to
keep both paths indefinitely.

### Phase 2 — Replace redundant checks selectively

Remove checks the parser makes redundant, route through the parser instead.
Fewer CLI round trips, faster overall diagnostic. Appropriate after Phase 1
validates log format stability across JMA versions. This is not just a
performance cleanup; it is part of the product goal of reducing operator
clutter and app fragility.

---

## Implementation Components

1. **Log navigator** — given a target timestamp or query type (last-seen,
   current state, recent history), uses the existing log-access capabilities
   (`list_log_files`, `search_log_file`, or direct shell commands such as
   `ls`, `grep`, `zgrep`, `sed`) to select the right file, locate the anchor,
   and fetch context. Returns a line stream to the parser. Reusable for jmd
   and other log parsers.

2. **Parser core** — the filter logic from `tools/mcd-filter.mjs` ported to
   TypeScript. Consumes a line stream, knows nothing about file selection.
   Returns structured objects rather than formatted text.

3. **Cycle extractor** — groups lines into retry cycles using `app.go:1040`
   as boundary, extracts SetState sequence, classifies kill type
   (keep-alive timeout vs cloud disconnect).

4. **Result formatter** — maps parsed cycle data to the existing check result
   schema so it renders in the UI without frontend changes.

5. **JMA version guard** — detects JMA version, warns if parsing confidence
   is uncertain due to unknown log format.

## Integration Points

Expected implementation touchpoints in the current app:

- existing log-access actions that already list and search rotated logs
- the troubleshooting check catalog, where `mcd-log-analysis` is registered
- the troubleshooting execution path, where the new check runs
- the existing check-result formatter contract, which should remain unchanged
- `tools/mcd-filter.mjs`, which is the best reference implementation for the
  first parser pass

The design should avoid creating a second parallel result model just for this
feature. If the parser returns richer structured output internally, the
formatter should still project it onto the current troubleshooting schema.

## Validation Plan

Implementation should be validated at three levels:

1. **Parser unit tests**
   Feed known log snippets into the parser core and assert cycle extraction,
   state transitions, kill-path classification, and disconnect-reason parsing.

2. **Navigator tests**
   Given synthetic file lists and timestamps, assert correct rotated-file
   selection, anchor detection, and boundary stitching decisions.

3. **End-to-end workflow validation**
   Run the new check in the app and confirm:
   - results render through the standard troubleshooting UI
   - Query A and Query B stay stable across current and rotated logs
   - output remains useful when shell access is available and when the
     bounded `search_log_file` fallback is used

## Success Criteria

This work is successful when:

- an operator can run one check and get a defensible explanation for
  “why the switch went offline”
- the result distinguishes the two different state-110 failure modes
- the result can explain current mcd behavior even when the switch has since
  moved into a different failure state
- at least the clearly redundant live checks can be retired with confidence
- the troubleshooting surface gets simpler, not more crowded, as parser-backed
  checks replace duplicated live tests
- the parser logic is testable without a live serial session

---

## Risks and Unknowns

**Log format stability across JMA versions**
All analysis is from one JMA version on one device. The `ccstate.go` line
numbers (`:308`, `:311`, `:334` etc.) will likely change across releases.
The parser must match on text content after the line number, not the line
number itself. The line numbers in this document are reference only.

**`search_log_file` line limit**
The current default cap is 100 lines — set conservatively to limit token burn
for AI agent callers. This is a soft parameter that can be raised for the
navigator's specific use case. The navigator should declare what it actually
needs (see call budget in the Serial Access Efficiency section) rather than
working around an artificially low limit. Recommended: raise the cap to 300
lines or make it caller-configurable, so a single call reliably covers a full
failure cycle even on high-churn switches.

**Navigator/file-selection complexity**
Rotated file access is already present in the current app: rotated filenames
are accepted, listed, and searched, including `.gz` files. The remaining work
is higher-level:

- deciding which rotated file(s) cover the requested timestamp
- stitching context across roll boundaries when needed
- choosing when a bounded `search_log_file` read is enough vs when explicit
  `grep`/`zgrep` context is the better tool

That keeps the implementation focus where it belongs: parser/navigation
correctness, not re-adding basic rotated-log support.

**DNS fallback behaviour**
The `1.1.1.1` fallback when DHCP doesn't provide DNS servers appears
consistent in lab logs but should be confirmed as intentional mcd behaviour
across JMA versions before relying on it as a diagnostic signal.

**Live log filename**
Confirmed against the lab EX2300: the live log is `/var/log/mcd.log`.
Rotated files follow the pattern `mcd-YYYY-MM-DDTHH-MM-SS.mmm.log.gz`.
`current_mcd.log` is not present on the device — it was a Mist download
artefact in the local test files. Not a risk.

---

## For Implementors

### Key files to read first

- **`tools/mcd-filter.mjs`** — the working prototype. Parser core and cycle
  extractor logic should be ported from here. Signal patterns, cycle boundary,
  kill path classification, and disconnect reason parsing are all implemented
  and validated against real lab logs.

- **An existing check implementation** — read any check in the check catalog
  (e.g. `mist-processes`, `dns-resolution`) to understand the check result
  schema the formatter must produce. The new check must return the same shape.

- **`docs/TROUBLESHOOTING-CHECK-REFERENCE.md`** — full check catalog. The
  new `mcd-log-analysis` check belongs in the `mist-agent` group as the first
  implementation step (Architecture Option A).

### Signal patterns (from mcd-filter.mjs)

```javascript
const SIGNAL_PATTERNS = [
  /ccstate\.go:/,        // all state machine lines
  /connect\.go:/,        // TCP connection attempts and failures
  /app\.go:1040/,        // "will try again in Xs" — cycle boundary
  /app\.go:865/,         // ipc keep-alive timeout — jmd unresponsive
  /app\.go:1110/,        // ctx canceled — cloud disconnect path
  /ipc_server\.go:161/,  // stopping ipc server — cloud WebSocket dropped
  /monitor\.go:238/,     // killing jmd
  /monitor\.go:211/,     // started jmd
]

const CYCLE_BOUNDARY = /app\.go:1040/   // splits cycles
```

Match on text content, not line numbers — line numbers will change across
JMA versions.

### Output structure (target)

The parser core should return cycle objects. The result formatter maps these
to the existing check result schema:

```typescript
interface ParsedCycle {
  cycleNumber: number
  states: number[]                  // SetState() calls in order
  killPath: 'keep-alive-timeout' | 'cloud-disconnect' | null
  disconnectReason: {
    timestamp: string               // JSON timestamp from ccstate.go:511
    cc_state: number
    reason: string
    event_sent: boolean
  } | null
  retryIntervalSeconds: number | null  // from app.go:1040
  rawLines: string[]
}
```

---

## Reference: Filter Script

`tools/mcd-filter.mjs` — standalone Node.js script that implements the core
filtering and cycle grouping logic. Useful for offline log analysis and as a
prototype for the parser core.

```bash
# Run against a log file
node tools/mcd-filter.mjs /path/to/mcd.log

# Pipe from switch via SSH
ssh <switch> "show log mcd" | node tools/mcd-filter.mjs
```

Output: cycles with state transition labels, parsed disconnect reason JSON,
and a state transition summary with frequency counts.
