# Junos Console — Web Serial Terminal

A browser-based serial terminal and automated troubleshooting tool for Juniper Mist switches running Junos, via USB-C or RJ45 console connection.

## Getting Started

```bash
npm install
npm run dev
```

Open Chrome to `http://localhost:3000`. The Mist API proxy runs automatically inside the dev server.

## Architecture

- **Web Serial API** — Direct serial communication (Chrome/Edge)
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
- Proxy embedded in Vite dev server (no separate process)

### Device & Config
- **Identify Switch** — serial/MAC from console, matches to Mist inventory
- **Get Root Password** — from Mist site settings, with login instructions
- **Check Config Drift** — compares Mist intended config vs actual running config
- **Adopt Switch** — fetches adoption commands from API, pre-checks root auth, applies via console

### Cloud Connectivity Check (17 tests)

Tests run sequentially with critical gates:

| # | Test | Command | Critical |
|---|------|---------|----------|
| 1 | LLDP Neighbors | `show lldp neighbors` | |
| 2 | Uplink Port Status | `show interfaces <port> terse` | |
| 2b | Interface Errors | `show interfaces <port> extensive \| match error` | |
| 3 | VLAN Config | `show vlans interface <port>` | |
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

### Standalone Mist Status
- Runs tests 11-14 independently via button

## Key Design Decisions

- **IPv4 forced** — `ping inet` / `telnet inet` to avoid IPv6 AAAA issues
- **DNS checked in 5 locations** — direct, groups, inherited, operational, resolv.conf
- **`show host` for FQDN resolution** — `nslookup` not available on all Junos
- **Management IP-based connection check** — catches both port 2200 and 443
- **SSL inspection detection** — curl cert check, expects Amazon/Google/Mist issuer
- **Root auth pre-check** — verifies before adoption, uses Mist site password or user input
- **Critical gates** — no IP / no route / DNS fail each skip remaining checks

## Changelog

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
