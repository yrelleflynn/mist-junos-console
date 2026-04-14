# Junos Console — Web Serial Terminal

A browser-based serial terminal and automated troubleshooting tool for Juniper Mist switches running Junos, via USB-C or RJ45 console connection.

## Requirements

- **Node.js 18 or later** — [nodejs.org/en/download](https://nodejs.org/en/download/)
- **Google Chrome or Microsoft Edge** — Web Serial API is not supported in Firefox or Safari
- A USB-to-serial or RJ45 console cable to connect to the switch

> **Windows users:** After installing Node.js, open a new terminal (Command Prompt or PowerShell) for the `node` and `npm` commands to be available.

## Installation

```bash
# 1. Clone the repository
git clone https://github.com/yrelleflynn/mist-junos-console.git
cd mist-junos-console

# 2. Install dependencies
npm install

# 3. Start the dev server
npm run dev
```

Open **Chrome or Edge** and go to `http://localhost:3000`.

The Mist API proxy runs automatically as Vite middleware — no separate process is needed.

### First-time setup checklist

1. Connect your console cable to the switch and your computer
2. In the **Connection** panel, select the correct baud rate (default 9600 for Juniper EX)
3. Click **Connect** and select the serial port when the browser dialog appears
4. In the **Mist API** panel, select your cloud region, paste your API token and Org ID, then click **Load** to populate the site list
5. Select your site — this enables the Root Password and Cloud Connectivity Check features

### Troubleshooting startup

| Problem | Fix |
|---------|-----|
| `npm: command not found` | Install Node.js from nodejs.org and open a new terminal |
| `EACCES` permission error on npm install | On macOS/Linux: prefix with `sudo`, or fix npm permissions |
| Port already in use | Another process is on 3000 — Vite will auto-increment to 3001, check the terminal output |
| Serial port not listed in browser | Ensure the cable driver is installed; on macOS try `ls /dev/tty.*` to confirm it appears |
| "Web Serial API not supported" | Use Chrome or Edge — Firefox and Safari do not support Web Serial |

## Architecture

- **Web Serial API** — Direct serial communication (Chrome/Edge only)
- **TypeScript + Vite** — Production-grade build, Mist API proxy as Vite middleware
- **xterm.js** — Full terminal emulation (VS Code, Proxmox use the same library)
- **Single command** — `npm run dev` starts everything

## Module Map

```
src/
├── main.ts                             # App controller
├── config/mist-clouds.config.ts        # 12 Mist cloud regions + endpoints
├── services/
│   ├── serial.service.ts               # Web Serial API
│   ├── command-runner.service.ts        # CLI command execution + login
│   ├── mist-api.service.ts             # Mist REST API (sites, inventory, config, adoption)
│   ├── switch-identity.service.ts      # Switch identification + Mist inventory matching
│   ├── config-drift.service.ts         # Mist vs Junos config comparison
│   └── troubleshoot.service.ts         # Cloud connectivity checks
├── components/terminal.component.ts    # xterm.js wrapper
└── styles/main.css
```

## Features

### Terminal
- xterm.js with ANSI, cursor, scrollback, clickable URLs, auto-resize

### Mist API Integration
- 12 cloud regions, site list, root password retrieval, inventory search
- Device config pull, adoption commands (`GET /api/v1/orgs/{org_id}/ocdevices/outbound_ssh_cmd`)
- Network template lookup (`GET /api/v1/orgs/{org_id}/networktemplates/{id}`)
- Proxy embedded in Vite dev server (no separate process)

### CLI Mode Detection
- On every serial connect, automatically detects current CLI mode by sending Enter and inspecting the prompt
- Displays a popup showing the detected mode with colour-coded badge and contextual guidance
- Reference table covers all five states: Operational (`>`), Configuration (`#`), Shell (`%`), Login, Unknown
- `?` button in the header re-opens the modal at any time (shows Unknown mode when not connected)

### Device & Config
- **Login to Switch** — detects prompt state, handles factory-default, shell, and password-required scenarios
- **Identify Switch** — extracts serial/MAC from console, matches to Mist inventory; if not found, displays claim-code and adopt-via-console guidance with an inline **Adopt Switch** button
- **Get Root Password** — looks up root password for the selected site in priority order:
  1. Switch template assigned to the site (`networktemplate_id`)
  2. Site-level `switch_mgmt.root_password`
  - All found passwords are displayed with their source label
  - Does **not** require switch identification — works from site selection alone
- **Check Config Drift** — compares Mist intended config vs actual running config
- **Adopt Switch** — fetches adoption commands from API, pre-checks root auth, applies via console

### Cloud Connectivity Check (21 tests)

Tests run sequentially with critical gates:

| # | Test | Command / Source | Critical |
|---|------|-----------------|----------|
| 0 | Root Password | `show configuration system root-authentication` | |
| 0b | Junos Version | `show version \| match "Junos:"` | |
| 1 | LLDP Neighbors | `show lldp neighbors` | |
| 1b | Upstream Port Config | Mist API — upstream device port_usages | |
| 2 | Uplink Port Status | `show interfaces <port> terse` | |
| 2b | Interface Errors | `show interfaces <port> extensive \| match error` | |
| 3 | VLAN Config | `show vlans interface <port>` | |
| 3b | Uplink Config Match | `show configuration interfaces <port> \| display set` vs Mist | |
| 3c | **STP Port State** | `show spanning-tree interface <port>` | |
| 3c-ii | Upstream STP Edge Config | Mist API — upstream port_usages `stp_edge` field | |
| 4 | **Management IP** | `show interfaces terse \| match inet` | **YES** |
| 4b | DHCP Lease | `show dhcp client binding` | |
| 5 | ARP Table | `show arp no-resolve` | |
| 6 | **Default Route** | `show route 0.0.0.0/0` | **YES** |
| 7 | DNS Config | 5 locations checked | |
| 8 | **DNS Resolution** | `ping inet <oc-term> count 3 rapid` | **YES** |
| 9 | Route to Mist | `show host` + `show route` | |
| 10 | Endpoint Reachability | `telnet inet <host> port <port>` | |
| 10b | SSL Certificate | `curl -vk` (checks for inspection) | |
| 10c | Traceroute (on fail) | `traceroute inet <host>` | |
| 11 | Mist Agent Version | `show version \| match mist` | |
| 12 | Mist Agent Processes | `ps aux \| grep mcd\|jmd` | |
| 13 | Outbound SSH Config | `show configuration system services outbound-ssh` | |
| 14 | Active Connections | `show system connections \| grep <mgmt-ip>` + `show host` validation | |

**STP checks (3c / 3c-ii):** Run after VLAN Config. The local check parses `show spanning-tree interface` for FWD/BLK/DIS/LRN/LIS state and BPDU error-disabled condition. The upstream check reads the Mist port usage profile for `stp_edge: true` — if found, it fails with a "Run Fix" button that calls the Mist API to set `stp_edge: false` on the upstream device's port profile.

When test 12 (Mist Agent Processes) fails, an **Adopt Switch** button appears inline within the check result. Clicking it opens the Device & Config panel and triggers the adoption workflow automatically.

Results are cleared on every Run Cloud Check click. If an error occurs mid-run the button is always re-enabled via `try/finally`.

Each individual check result card is clickable and opens a detail modal. The modal header includes a **Run Test Now** button that re-executes just that single check, updates the modal detail/remediation/raw output, and replaces the result card in the sidebar — without re-running the full suite.

### Standalone Mist Status
- Runs tests 11–14 independently via button

### Firewall Policy Check
- Runs SSL certificate and endpoint reachability checks independently

## Key Design Decisions

- **IPv4 forced** — `ping inet` / `telnet inet` to avoid IPv6 AAAA issues
- **DNS checked in 5 locations** — direct, groups, inherited, operational, resolv.conf
- **`show host` for FQDN resolution** — `nslookup` not available on all Junos
- **Management IP-based connection check** — catches both port 2200 and 443
- **SSL inspection detection** — curl cert check, expects Amazon/Google/Mist issuer
- **Root auth pre-check** — verifies before adoption, uses Mist site password or user input
- **Critical gates** — no IP / no route / DNS fail each skip remaining checks
- **CLI mode detection on connect** — sends Enter, inspects prompt regex; detects operational/config/shell/login/unknown; shown in popup with reference guide
- **Root password lookup hierarchy** — template first, then site settings; does not require switch identification; all found passwords shown with source
- **Adopt prompt inline** — when Mist agent processes fail, Adopt Switch button is injected directly into the check result card, not as a separate UI element
- **`?` help button** — always-visible in header; re-detects mode if connected, shows reference only if disconnected
- **Cloud Check results always cleared on click** — `innerHTML = ''` is the first statement in `runTroubleshoot`; button re-enabled via `try/finally`
- **Root password button decoupled from identification** — enabled by Mist API site selection, not serial connection or switch identity
- **Cloud region verification** — if API credentials are not configured when running Cloud Check or Firewall Policy Check, a confirmation modal shows the selected cloud region and all endpoints to be tested; user must confirm before tests start. If API is configured the check proceeds silently. A "Cloud Region" info card is always prepended to results showing which cloud is tested and whether it was verified.
- **Per-test rerun** — each check modal has a "Run Test Now" button; re-runs only that check, updates the modal and the sidebar card; `rerunCheck(result)` dispatches by `result.id` using context captured during the last full run (`currentCloud`, `currentUplinkPort`, `currentMgmtIp`); relevant check methods on `TroubleshootService` are public; `onContextUpdate` callback in `TroubleshootOptions` keeps context in sync

## Mist API Endpoints Used

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/v1/orgs/{orgId}/sites` | List sites |
| GET | `/api/v1/sites/{siteId}/setting` | Site settings (root password, template ID) |
| GET | `/api/v1/orgs/{orgId}/networktemplates/{templateId}` | Switch template (root password) |
| GET | `/api/v1/orgs/{orgId}/inventory?type=switch` | Device inventory |
| GET | `/api/v1/sites/{siteId}/devices/{deviceId}` | Device config |
| PUT | `/api/v1/sites/{siteId}/devices/{deviceId}` | Update device config |
| GET | `/api/v1/orgs/{orgId}/ocdevices/outbound_ssh_cmd` | Adoption commands |
| GET | `/api/v1/sites/{siteId}/devices/events` | Device events |
| GET | `/api/v1/sites/{siteId}/stats/devices/{deviceId}` | Device stats |
| GET | `/api/v1/orgs/{orgId}/logs` | Audit logs |

All requests are proxied through `/mist-proxy` (Vite middleware) to avoid CORS. The browser POSTs `{ apiHost, apiToken, method, path }` and the middleware forwards the real HTTP request to Mist.

## GitHub Repository

Private repository: `https://github.com/yrelleflynn/mist-junos-console`

## Changelog

### v0.10.0

- Cloud Connectivity Check and Firewall Policy Check now show a **confirmation modal** before running if Mist API credentials are not configured — lists the cloud region and all endpoints to be tested so the user can verify correctness before proceeding
- A **Cloud Region** info card is prepended to every cloud check and firewall policy check result, showing the API host and endpoints being tested and whether the region was verified via API credentials or selected manually
- Results container title now includes the cloud region name (e.g. "Cloud Connectivity Check — APAC 01")
- All 12 cloud endpoint tables verified against Juniper documentation (source: firewall-ports-to-open.html); existing config was already correct

### v0.9.0

- Identify Switch "not found" state now shows claim-code and adopt-via-console guidance with an inline Adopt Switch button that opens the Device & Config panel and triggers adoption automatically
- Mist Agent Processes check modal now includes an **Adopt Switch** button as Option 2 remediation, alongside the existing "restart mcd" Run Fix button; remediation text updated to explain both options

### v0.8.0

- Added **Run Test Now** button to every individual check result modal — re-runs only that specific test, updates the modal and the sidebar result card without re-running the full suite
- Relevant `TroubleshootService` check methods changed from `private` to `public` to support per-test rerun dispatch
- Added `onContextUpdate` callback to `TroubleshootOptions` to capture `uplinkPort` and `mgmtIp` from `runAll()` for use in subsequent single-test reruns
- Per-test context stored in `currentCloud`, `currentUplinkPort`, `currentMgmtIp` closure variables in `main.ts`

### v0.7.0

- Added CLI mode detection modal on serial connect — auto-detects operational/config/shell/login/unknown and shows reference popup
- Added `?` help button in header to re-open CLI mode reference at any time
- Added inline Adopt Switch prompt on Mist Agent Processes check failure (button inside the check result card)
- Changed Get Root Password to use selected site (no switch identification required); checks switch template then site settings; displays all found passwords with source labels
- Added `MistNetworkTemplate` interface and `getNetworkTemplate()` method to `MistApiService`
- Fixed Run Cloud Check results not clearing on re-run (clear moved to first line, `try/finally` added for button re-enable)
- Fixed Get Root Password button state — now driven by Mist site selection, not switch identification

### v0.6.0

- Added SSL certificate inspection check (curl -vk via interactive shell)
- Added switch adoption with root auth pre-check
- Added root password retrieval button with login instructions
- Added switch identification and Mist inventory matching
- Added config drift detection (Mist intended vs actual Junos config)
- Added interface error counters on uplink
- Added route table check for Mist endpoint IPs
- Added traceroute on failed telnet tests
- Added Mist agent process check (mcd/jmd)
- Fixed DHCP check for 0.0.0.0 bindings (static IP detection)
- Fixed Global 01 jma-terminator FQDN
- Fixed IPv6 resolution issues (force IPv4 everywhere)
- Fixed Junos telnet syntax (`port` keyword)
- Fixed DNS check to search config groups
- Fixed accordion scroll clipping
- Increased timeouts for slow commands

### v0.1.0–v0.5.0

See previous changelog entries in git history.
