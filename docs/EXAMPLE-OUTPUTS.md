# Example Outputs

> **The best example of this product in action is the recorded live demo.**
> It shows the complete arc: switch offline, 22 checks run in parallel,
> root cause identified (stale DHCP lease, gateway unreachable), DHCP refresh
> triggered, switch back in Mist — with an AI agent driving the diagnostic
> and remediation sequence via MCP.
>
> *Demo recording available on SharePoint with the submission.*

---

## Purpose

Provide representative text examples of what the product produces during
real troubleshooting and recovery workflows, as a supplement to the
recorded demo.

## Example 1: Recommended Checks For `106 DNSLookupFailed`

Context:

- switch has management IP and gateway
- DNS resolution to Mist hostnames is failing
- JMA state is `106 DNSLookupFailed`

Representative output:

```text
DNS Configuration: pass
  DNS servers present from static and DHCP sources

DNS Server Reachability: pass
  45.90.28.80 and 45.90.30.80 reachable from switch

DNS Resolution: fail
  Could not resolve oc-term.mistsys.net from the switch

Route to Mist: warn
  Could not resolve oc-term.mistsys.net for route lookup
```

Operator takeaway:

- IP path is present
- resolver configuration is present
- the current blocker is hostname resolution, not missing management IP

## Example 2: JMA / Mist Mismatch Explained

Representative UI state:

```text
Mist Status: disconnected
Last seen: 2026-04-20 07:00:45 UTC

Switch Cloud State: 106 DNSLookupFailed
```

Operator takeaway:

- Mist last-known state is historical
- the switch’s current local view is still useful for current diagnosis
- this is exactly the kind of mismatch the product highlights

## Example 3: DHCP Refresh Result

Representative action output:

```text
completed — 1/1 interface(s) refreshed

Interface: irb.0
Before: 10.99.0.109 / BOUND / DNS 45.90.28.80,45.90.30.80
After:  10.99.0.109 / BOUND / DNS 45.90.28.80,45.90.30.80
Result: no change
```

Operator takeaway:

- the product identifies the correct DHCP client interface
- DHCP state and DNS values are shown explicitly
- the operator can see whether the action changed anything

## Example 4: Traceroute To Mist

Representative output:

```text
Traceroute to Mist
10 hop(s) responded
Last visible hop: 159.196.252.105
No response after the last visible hop
```

Operator takeaway:

- the path was partially visible
- lack of final response does not automatically imply firewall policy
- the check is descriptive, not overconfident

## Example 5: Remote Support Session

Representative support-side behavior:

```text
Support viewer connected to operator session
Mirrored switch output visible
If operator disconnects:
  Operator disconnected — this support view is no longer live.
```

Operator/support takeaway:

- support can observe the same session without needing a screen share
- disconnects are explicit rather than silent

## Example 6: Agent / MCP-Style Output

Representative structured result:

```json
{
  "status": "running",
  "note": "Workflow still running; follow up with get_check_results",
  "actionId": "..."
}
```

Representative follow-up:

```json
{
  "status": "completed",
  "results": [
    { "id": "dns-resolution", "status": "fail", "detail": "Could not resolve oc-term.mistsys.net" }
  ]
}
```

Reviewer takeaway:

- long-running workflows do not look like hard failures
- results remain structured and bounded

## Suggested Screenshots For Deck

For the presentation, the best screenshots are:

1. operator UI with:
   - switch identified
   - Mist status visible
   - structured check results visible
2. a `106 DNSLookupFailed` run with relevant check rows
3. an action result such as `DHCP Refresh`
4. support console joined to the same session
