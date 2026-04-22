# Mist Local Console
### A self-driving recovery path for offline Mist-managed switches

---

> **Marvis is brilliant. Ask it why a device is offline and it'll tell you — as long as the device is online. The moment it goes dark, Marvis goes quiet. And that's exactly when you need it most.**

---

## The Problem

I have customers with 100+ retail sites. When a switch goes offline, they dispatch a third-party contractor — someone who can drive to a store but might never have touched a CLI. They get there, they're in the back room, they have one bar of signal. Their options are: call the NOC and describe what they're seeing, attempt a Zoom screen share on a 1 bar connection, or wait for someone more qualified to fly out.

Every one of those options is slow, expensive, and assumes the problem is simple.

**We built a fourth option.**

---

## The Solution

**Mist Local Console** bridges the physical serial port to the Mist cloud. A technician plugs in a USB-to-serial cable, opens Chrome, and the app establishes a session — even when the switch has no network connectivity.

From that session, the app:

- **Identifies the device** and matches it to its Mist record, automatically
- **Runs 22 structured diagnostic checks** — Layer 2 through cloud reachability — in parallel, correlated against what Mist expects to see
- **Interprets the results** in plain language, not raw CLI output, with specific remediation steps
- **Takes bounded recovery actions**: DHCP refresh, agent restart, config sync with diff preview and rollback
- **Works as an MCP server** — any AI agent can connect, read device state, run checks, and trigger actions through the same interface the operator uses

The contractor doesn't type a single CLI command.

---

## Self-Driving Capability

| Level | Capability | What the tool does |
|-------|-----------|-------------------|
| **Level 1** | Intelligent Detection | Automatically identifies the failure layer — L2, IP, DNS, cloud reachability — from correlated diagnostic evidence |
| **Level 2** | Automated Diagnosis | Determines root cause: stale DHCP lease, gateway unreachable, firewall blocking TCP 2200, SSL inspection intercepting Mist TLS. Names the specific fix. |
| **Level 3** | Autonomous Action | An AI agent driving the session via MCP reads state, runs checks, identifies the fault, and requests the remediation action. The operator approves. The switch comes back. |

All three levels demonstrated live on a real switch in a real failure scenario.

---

## Built for the Field

- **Any Mist-managed EX switch** with a console port — retail, campus, branch, healthcare, education
- **Any skill level** — the app surfaces interpreted results, not raw CLI. A field technician who has never run a `show` command gets everything they need.
- **Mist-native** — uses Mist Launch Mode, Mist API, and Mist event history. Not a parallel system; an extension of the platform.
- **Open agent interface** — the MCP surface means Marvis, Claude, or any standards-compliant agent can drive the session. The architecture doesn't favour any one AI.

---

## The Vision

> Today it's Claude driving this session through an open MCP interface. The architecture doesn't care which agent is on the other end.
>
> Juniper already has the most sophisticated AI network assistant in the industry. Marvis knows your devices, your topology, your event history, your config intent. It just hasn't had a way to reach a switch that's offline.
>
> **We're giving Marvis a console cable.**

---

*Working code on master. Tested against a live EX2300. Setup instructions in `docs/SETUP.md`. Example outputs in `docs/EXAMPLE-OUTPUTS.md`. Demo recording on SharePoint with the submission.*
