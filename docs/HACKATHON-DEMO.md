# Hackathon Demo Guide

## One-Sentence Summary

`mist-junos-console` is a browser-based serial console workspace that connects directly to an offline Juniper EX switch, runs automated cloud connectivity diagnostics against live Mist context, and lets the operator stage and safely commit a Mist-intended config fix — without any additional tooling or local install.

---

## The Operator Problem

When a Mist-managed switch goes offline, an operator typically faces:

- Physical console access through a laptop serial port and a terminal emulator
- No direct view of Mist context or intended config while at the keyboard
- Manual, experience-dependent troubleshooting with no standard checks or evidence format
- Config remediation by manually copying commands from the Mist UI into the terminal — line by line, with no diff, no validation, and no rollback
- Support escalation by screenshot or phone call because there is no shared view of the session

Recovery is slow, inconsistent across skill levels, and leaves no audit trail.

---

## The Self-Driving Angle

This tool implements all three levels of autonomous operation from the hackathon brief:

**Level 1 — Intelligent Detection**

The troubleshooting engine runs 14 ordered checks over the live serial console: link state, VLAN membership, DHCP lease health, gateway reachability, DNS resolution, TCP path to Mist endpoints, SSL interception detection, Mist agent process health, and more. It gates downstream checks automatically when a prerequisite fails so the operator is not buried in false failures.

The JMA Connectivity State check reads the switch's own self-reported cloud state and surfaces it alongside Mist's last-known device state — giving the operator two signals rather than one.

**Level 2 — Automated Diagnosis**

Check results include a structured interpretation: not just pass/fail output, but what the failure means, where in the connectivity chain it falls, and what state is expected versus observed. Config drift comparison fetches Mist-intended config and compares it against the live running config, highlighting the exact `set` commands the switch is missing.

**Level 3 — Autonomous Action**

Staged config sync fetches the Mist-intended config diff, loads it as a candidate on the switch, runs `commit check`, shows the operator a clear diff and check result, and then waits for an explicit operator action: **Commit** (apply) or **Rollback** (discard). The operator approves; the tool executes.

---

## Demo Flow (10–15 minutes)

### Setup (~1 min, before demo starts)

- Laptop connected to an EX switch via USB serial cable
- Chrome or Edge open to the app
- Mist org and API token pre-configured in settings
- Switch is offline from Mist (config is intentionally drifted or management VLAN is misconfigured)

### Step 1 — Connect and identify (1–2 min)

Connect to the switch via Web Serial. The app authenticates automatically if the switch is already at an operational prompt, or step through the login flow.

**Talking point:** No software install. No SSH tunnel. No separate terminal emulator. The console is the app.

Once connected, click **Identify Device**. The tool reads the switch serial number, hostname, and MAC address, matches it against Mist inventory, and populates the session header with org, site, and device context.

**Talking point:** The operator does not need to know which org or site this switch belongs to. The tool discovers it.

### Step 2 — JMA Connectivity State (30 sec)

Point to the JMA Connectivity State indicator in the session header. It shows the switch's own self-reported cloud connectivity state — for example `104 DefaultGatewayUnreachable` or `108 CloudUnreachable`.

**Talking point:** This is the switch's view of its own problem, not just Mist's last-known status. Two signals, not one.

### Step 3 — Run troubleshoot (3–4 min)

Click **Run Troubleshoot**. Walk through the check results as they appear:

- LLDP identifies the uplink port
- Uplink port is up, no errors
- VLAN config confirms management VLAN presence
- Management IP is present
- DHCP lease is healthy
- Default gateway exists but...
- ARP check shows no gateway ARP entry

**Talking point:** The tool gates downstream checks. Because ARP failed, DNS and cloud path checks are marked as skipped rather than failing — so the operator sees where the chain breaks, not a wall of red.

Highlight the remediation guidance on the failed check.

### Step 4 — Config drift (1–2 min)

Click **Config Drift**. The tool fetches Mist-intended config via the backend Mist proxy and compares it to the live running config. Show the diff — for example, a missing native VLAN on the uplink or a missing management VLAN membership.

**Talking point:** The Mist UI shows intended config. The switch has something different. This tool shows exactly what is missing, right next to the console.

### Step 5 — Staged config sync (3–4 min)

Click **Preview Config Sync**. Walk through what happens:

1. Tool fetches the Mist-intended config for this device
2. Loads the diff as a candidate using `load set terminal`
3. Runs `show | compare` to show the exact pending diff
4. Runs `commit check` to validate the candidate
5. Leaves the candidate staged — does not commit automatically

The action bar appears with two buttons: **Commit** and **Rollback**.

**Talking point:** The tool will not commit without the operator's explicit approval. The operator sees the diff, sees the commit-check result, and decides.

Click **Commit**. The tool sends `commit comment "junos console config sync"` and exits config mode cleanly. Walk through the terminal output and explain that this is the point where the operator has approved the change.

**Talking point:** The important safety boundary is that the tool stages the candidate, validates it, and then waits for operator approval before applying anything.

### Step 6 — Reconnect or verification outcome (1 min)

Best case live path: the Mist Status indicator in the session header updates from offline to connected and the JMA state updates to `111 Connected`.

If the live reconnect is slow or not appropriate to wait for during the demo, stop at the staged diff, `commit check`, and operator decision point, then explain the expected verification path.

**Talking point:** Detect, diagnose, stage, commit, confirm. The operator runs the full recovery workflow without needing to know which Junos commands to run or which Mist config to paste.

---

## Demo Prerequisites

- Chrome or Edge (Web Serial API required; Firefox not supported)
- USB-to-serial cable connected to an EX switch console port
- Mist API token with read access to org, sites, and device config
- Switch must be reachable over serial (powered on, at login or operational prompt)
- Mist-intended config must differ from running config in at least one meaningful way for the sync demo to show a useful diff

---

## Backup Demo Path

If the serial device is unavailable or the live sync is too risky for a demo switch:

- Run **Config Drift** against a pre-staged switch with known drift and walk through the diff comparison
- Show a pre-recorded terminal output of the **Preview Config Sync** flow including the `show | compare` diff and commit check result
- Show the action bar with the two decision buttons and explain the commit / rollback model without completing the commit

The detection and diagnosis portions (Steps 1–4) do not require the switch to be offline and can be run against any reachable Mist-managed switch with a console cable attached.

---

## Key Talking Points Per Step

| Step | Talking Point |
|------|---------------|
| Connect | No install, no SSH, browser-native Web Serial |
| Identify | Device auto-matched to Mist inventory |
| JMA state | Switch's own cloud view, not just Mist's guess |
| Troubleshoot | Structured cloud-connectivity checks, gated with remediation |
| Config drift | Mist intent vs live switch, inline in the console workflow |
| Staged sync | Candidate staged, operator approves commit — not auto-applied |
| Commit | Operator-approved application after staged diff + commit check |
| Reconnect | Guided recovery loop: detect → diagnose → stage → operator-approved act |

---

## Likely Judge Questions

**Q: How is this different from just using a terminal and the Mist UI?**

A: The Mist UI and a terminal are two separate tools with no shared state. This tool brings Mist context — inventory, intended config, device status, cloud connectivity — directly into the console session. The cloud-connectivity troubleshoot workflow runs structured diagnostics that would take an experienced engineer 10–15 minutes to run manually. Config sync stages the exact Mist diff, runs commit check, and gives the operator a structured approve/rollback choice rather than asking them to copy-paste commands.

**Q: Why does the operator still need to approve the commit? Could this be fully automated?**

A: It could be, and that is a deliberate design choice rather than a limitation. Production switches serving real users are not safe targets for fully autonomous config commits without human confirmation. The self-driving value here is removing the manual discovery, comparison, and staging work while still leaving the operator in control of the final risk decision.

**Q: How broadly does this apply across Mist-managed EX switches?**

A: It is designed for Mist-managed EX switches with console access and a Mist-intended config. The checks are generic enough to apply across campus, branch, retail, and education environments, but the strongest current validation is around the EX recovery workflows demonstrated here. The Mist API integration works at the org level, so it can be used across hundreds of sites from a single app instance.

**Q: What is the AI/MCP angle?**

A: The backend MCP design is documented as a roadmap item. The current product exposes structured check results, JMA state, config drift, and staged sync outcomes — exactly the kind of data a diagnostic AI agent needs. The MCP would expose these as tool-shaped interfaces, allowing an agent to observe the session, run targeted checks, and propose actions for operator approval. The product is designed to support that workflow safely.

**Q: What happens if the commit makes things worse?**

A: The tool stages the candidate and shows the exact `show | compare` diff before any commit happens, so the operator knows exactly what is about to change. If they decide not to proceed, they can choose Rollback instead of Commit. The serial console remains available throughout the workflow, so recovery is still local and visible even if the resulting config is not what the operator expected.
