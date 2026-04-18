# Customer Impact

## Why Customers Would Deploy This Immediately

When a Mist-managed switch goes offline, operators currently need to:

1. Find the switch and attach a console cable
2. Open a separate serial terminal application
3. Navigate Mist manually to find the device, its site, and its intended config
4. Troubleshoot from memory or tribal knowledge — no standard checklist, no structured evidence
5. Manually construct and paste remediation commands from the Mist UI
6. Escalate by phone or screenshot because there is no shared view of the session

This tool collapses that into a single browser tab. There is no software to install. The operator opens the app, connects the cable, and has structured diagnostics, Mist context, and guided remediation in one place.

---

## Target Operator Profile

**Primary:** Field technician or on-site network operator

- Physical access to switches but may have limited Junos expertise
- Comfortable with basic CLI but not with diagnosing JMA connectivity states, interpreting config drift, or constructing safe Junos commit workflows
- Currently dependent on experienced support staff for diagnosis and remediation
- Needs to resolve issues without escalation when possible

**Secondary:** Remote support engineer assisting a field operator

- Can join the live session and observe the same console output and check results
- Does not need to ask the operator to read back CLI output line by line
- Can guide the operator through a structured workflow with shared evidence

---

## The Pain Today

### Time to diagnose

An experienced engineer running manual troubleshooting on an offline switch — checking LLDP, ports, VLAN, DHCP, routing, DNS, firewall path, and agent processes — takes 15–30 minutes per switch to do it well. A less experienced operator takes longer and may miss key checks entirely.

This tool runs 14 ordered checks in 2–3 minutes with gated logic that skips downstream checks when a prerequisite fails. The operator sees exactly where the chain breaks without wading through false negatives.

### Time to remediate

Finding the Mist-intended config, comparing it to the running config by eye, constructing the `load set terminal` commands, running `commit check`, and then deciding on commit vs rollback — that is a manual process that takes 10–20 minutes and requires Junos commit workflow knowledge most field operators do not have.

Config sync stages the exact candidate, shows the diff, runs commit check, and gives the operator a one-click path to commit with a 5-minute automatic rollback window. The operator does not need to know Junos commit syntax.

### Escalation cost

When a less experienced operator cannot resolve an issue, they escalate. The escalating engineer then has to reconstruct context from verbal relay or screenshots. This is slow and frustrating on both sides.

Remote session mirroring gives a support engineer a live view of the same console without needing physical access or a VPN session to the switch. The shared context reduces escalation time significantly.

---

## Time-to-Recovery Reduction

Representative internal estimate per switch recovery event:

| Step | Manual workflow | With this tool |
|------|----------------|----------------|
| Device identification and Mist context lookup | 5–10 min | < 1 min (automatic after connect) |
| Run structured connectivity checks | 15–30 min | 2–3 min |
| Identify config drift | 5–15 min | < 2 min |
| Stage and apply Mist config fix | 10–20 min | 3–5 min |
| **Total** | **35–75 min** | **~10 min** |

For a customer with 50 offline switch events per year, that is potentially 25–65 hours of operator time saved annually, based on the estimates above — and that is before accounting for the consistency improvement of having every operator follow the same structured workflow rather than relying on individual experience.

---

## Mist-Native Fit

This tool is not a generic Junos console. Every meaningful feature is built around Mist:

- Device identification uses Mist inventory APIs
- Config drift comparison fetches Mist-intended device config via the Mist `config_cmd` proxy
- Cloud connectivity checks validate the path to Mist endpoints specifically
- JMA Connectivity State surfaces the switch's own Mist cloud state (`102 NoIPAddress`, `108 CloudUnreachable`, `111 Connected`, etc.)
- Config sync applies the Mist-intended config diff — not a manually crafted patch
- Adoption command retrieval fetches the Mist device-specific adoption commands

The product is designed to eventually be launched from Mist directly, with org and site context inherited from the Mist session, eliminating the current manual token and org configuration step.

---

## Applicable Environments

The tool works across any environment where Mist manages EX switches with console access:

| Vertical | Typical scenario |
|----------|-----------------|
| Retail | Branch switch offline after a power event or config change |
| Campus | Access switch drifted from Mist intent after a manual change |
| Healthcare | Isolated switch that needs guided recovery without exposing SSH |
| Education | Low-expertise operator on site with limited remote support availability |
| Branch networks | Single switch sites where escalation cost is high relative to site size |

The checks and config sync flow are device-context-aware but not site-topology-specific. The same operator workflow can be reused across many EX switch deployments even though exact root causes and validation details will vary by environment.

---

## Production vs Hackathon Scope

The tool is deployed today as an internal-facing application and can be used immediately by teams that are comfortable operating it with Chrome, a USB serial cable, and a Mist API token.

### Already production-usable

- Web Serial terminal
- Device identification
- JMA Connectivity State and Mist Status monitoring
- structured cloud-connectivity troubleshooting workflow
- Config drift comparison
- Staged config sync with Commit Confirmed, Commit, and Rollback
- Remote session mirroring

### Production-leaning, needs hardening

- Mist API token input: currently a manual entry step; should be replaced by a trusted Mist-native auth handoff
- Remote session: functional but needs authentication, expiry, and access controls for production exposure
- Config sync: the staged candidate model is safe, but the complete operator UX for complex multi-VLAN diffs could be improved

### Roadmap (documented, not yet implemented)

- Backend MCP server exposing session state, structured check results, JMA state, and config sync as tool-shaped interfaces for AI agent integration
- AI diagnostic assistant operating within operator-owned sessions with explicit approval gates for state-changing actions

---

## The One-Line Deployment Case

A field operator with a console cable and Chrome can diagnose an offline Mist-managed switch, compare it to Mist-intended config, and safely apply a fix — without Junos expertise, without a separate terminal, and without escalating to an experienced engineer.
