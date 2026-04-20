================================================================================
JUNOS CONSOLE — WEB SERIAL TERMINAL & MIST TROUBLESHOOTER
================================================================================

A browser-based serial terminal and automated troubleshooting tool for Juniper
Mist-managed EX switches running Junos. Connects via USB-C or RJ45 console
cable using the Web Serial API (Chrome / Edge only — no local software install
needed beyond Node.js for the dev server).

================================================================================
LAUNCHING THE APP
================================================================================

PREREQUISITES
  Node.js installed. Run once after cloning:
    npm install

FULL DEV STACK (recommended)
  npm run dev

  This starts three processes concurrently:
    [server]  node server/index.mjs           http://127.0.0.1:3333
    [mcp]     node server/mcp-server.mjs --http  http://0.0.0.0:3334/mcp
    [client]  vite                            http://localhost:3000

  Open Chrome or Edge (not an IDE embedded browser) to: http://localhost:3000

  Web Serial requires a real Chrome/Edge window. The port picker does NOT work
  inside VS Code or Cursor's embedded Simple Browser.

INDIVIDUAL PROCESSES
  npm run dev:client    Frontend only (Vite). Mist proxy/WebSocket unavailable
                        unless the backend is also running.
  npm run dev:server    Backend only (HTTP + WebSocket hub on port 3333).
  npm run start:server  Same as dev:server (no file watching).
  npm run mcp           MCP server in stdio mode (for Claude Desktop on same
                        machine — no network exposure).
  npm run mcp:http      MCP server in HTTP mode (port 3334, for Claude Desktop
                        on another machine on the LAN).

PORTS
  Frontend (Vite):   http://localhost:3000        (strictPort — will not try 3001)
  Backend (Node):    http://127.0.0.1:3333
  MCP server (HTTP): http://0.0.0.0:3334          (when using mcp:http)

BUILD FOR PRODUCTION
  npm run build
  Outputs static files to dist/. Serve dist/ from any HTTPS host.
  Run server/index.mjs on the same host to provide /mist-proxy and /ws.
  Run server/mcp-server.mjs if AI agent access is needed.

PORT CONFLICT TROUBLESHOOTING
  If port 3333 is in use the backend exits and concurrently stops everything.
  Find and kill the conflicting process:
    Windows: netstat -ano | findstr :3333
    Mac/Linux: lsof -i :3333

================================================================================
PAGES
================================================================================

OPERATOR CONSOLE
  http://localhost:3000  (or /index.html)
  Main app. Connects to the switch via Web Serial, runs diagnostics, and can
  enable a remote support session.

SUPPORT / REMOTE VIEWER
  http://localhost:3000/support.html
  http://localhost:3000/support.html?session=<session-id>
  Joins an operator session over WebSocket. Mirrors all serial RX to the screen
  and can inject keystrokes into the console (sent to the operator browser,
  which writes them to the serial port). The session ID can be pre-filled via
  the ?session= query parameter.

================================================================================
ARCHITECTURE OVERVIEW
================================================================================

FRONTEND (src/)
  Built with TypeScript + Vite. No framework — plain DOM manipulation.
  Two HTML entry points: index.html (operator) and support.html (viewer).

  src/main.ts
    Application entry point. Initialises all services and wires UI controls
    (serial port, Mist API inputs, troubleshoot buttons, adoption flow).
    Checks for Web Serial API support; shows an error if the browser doesn't
    support it.

  src/support-main.ts
    Entry point for support.html. Reads ?session= from the URL, connects to
    the console session hub as a "support" participant, and mirrors serial RX
    to an xterm terminal. Keystrokes typed in the support terminal are sent
    back to the operator browser, which writes them to the physical serial port.

  src/components/terminal.component.ts
    xterm.js wrapper. Provides fit (auto-resize), web-links (clickable URLs),
    ANSI escape code rendering, scrollback buffer, and convenience helpers
    (write, writeln, writeSystem, clear, focus).

  src/config/mist-clouds.config.ts
    Definitions for all 12 Mist cloud regions (Global 01–05, EMEA 01–04,
    APAC 01–03). Each region has an API host and the set of switch-facing
    endpoints required for cloud connectivity (redirect.juniper.net, JMA
    terminator, ZTP, oc-term outbound-SSH, CDN). Used to populate the cloud
    dropdown and to drive the endpoint reachability tests.

  src/services/serial.service.ts
    Wraps the Web Serial API. Handles port selection, open/close, baud rate and
    framing options, continuous read loop, and write. Optionally mirrors RX
    bytes to a ConsoleSessionService (for the shared session) and forwards
    support-injected TX bytes to the port without re-mirroring them as operator
    traffic (loop prevention via a "source" field).

  src/services/console-session.service.ts
    WebSocket client for the shared console session hub. Supports two roles:
      "operator" — creates a new session; sends RX and operator TX upstream.
      "support"  — joins an existing session by ID; receives RX and can send TX.
    In dev, connects directly to ws://127.0.0.1:3333/ws (bypasses Vite WS
    proxy which is unreliable for the Node ws library). In production, derives
    the WebSocket URL from window.location.host.

  src/services/command-runner.service.ts
    Sends Junos CLI commands over the serial port and waits for a prompt.
    Includes a login state machine that handles:
      - Already at a > or # prompt (no-op)
      - At a shell % prompt (sends "cli")
      - Factory default (root, no password)
      - Password-required login (fetches root password from Mist API if
        configured; falls back to user prompt)

  src/services/mist-api.service.ts
    Mist REST API client. All calls go through POST /mist-proxy on the backend
    (no direct browser-to-Mist CORS). Provides:
      - List sites
      - Get site settings (including root password)
      - Get org inventory (switch list)
      - Get device config (intended/pushed config)
      - Get device stats (status, last_seen, port_stat)
      - Get device events (recent timeline events)
      - Get org audit logs (config changes)
      - Get adoption / outbound-SSH commands

  src/services/switch-identity.service.ts
    Runs "show version" and "show chassis hardware" to extract the switch serial
    number and MAC address, then searches the Mist org inventory for a matching
    device. Reports the Mist device ID, site, model, and current cloud status
    (connected / disconnected, last_seen) by cross-referencing inventory data
    with stats/devices API. Provides refreshMistCloudStatus() for post-
    remediation re-checks without re-running the full console identification.

  src/services/config-drift.service.ts
    Fetches the Mist intended (pushed) configuration for the identified switch
    and compares it line by line against the output of "show configuration"
    from the console. Reports lines present in Mist config but missing from
    Junos, and lines in Junos but absent from Mist config.

  src/services/troubleshoot.service.ts
    Core of the automated diagnostic engine. Runs the 17-step cloud
    connectivity check suite (see section below) and the Offline Timeline.
    Uses a TroubleshootStep queue for the first LLDP/uplink/port/error segment;
    remaining steps run sequentially with critical gate logic (skip all
    downstream checks if management IP, default route, or DNS fails).

  src/utils/junos-log-time.ts
    Parses Junos syslog timestamps and converts them to UTC for correlation
    with Mist event timestamps. Reads "Current time" from "show system uptime"
    output (includes timezone abbreviation) and uses a 30+ timezone table
    (with GMT±N offset support) to align log lines to UTC. Known gap: ambiguous
    abbreviations (e.g. CST = US Central or China) default to US Central; use
    GMT±N on the switch for unambiguous alignment.

BACKEND (server/)
  Node.js (ESM). Two processes: the session hub and the MCP server.

  server/index.mjs
    Combined HTTP server and WebSocket hub. Default port 3333 (override with
    JUNOS_CONSOLE_SERVER_PORT environment variable).

    HTTP endpoints:
      POST /mist-proxy          Server-side Mist API proxy. Accepts JSON body
                                with { apiHost, apiToken, method, path, body }.
                                Forwards to https://{apiHost}{path} with the
                                Token auth header. Avoids browser CORS issues.

      GET  /health              Returns { "status": "ok" }.

      GET  /api/session         Returns the first active operator session ID and
                                Mist credentials (used by MCP server for auto-
                                discovery).

      POST /api/authorize-session  Localhost-only. Enables or disables remote
                                MCP access for a given session ID. Called by the
                                UI when the operator ticks "Allow remote access".

      GET  /sessions            Returns array of all active sessions with:
                                  session_id, operator_connected, support_count,
                                  remote_access_enabled

    WebSocket hub (/ws):
      Clients connect and send a { type: "join", role, sessionId } message.
      Roles:
        "operator" — creates a new UUID session; can send serial-rx (switch
                     output → support viewers) and serial-tx with source:
                     "operator" (typed keystrokes → support viewers).
        "support"  — joins by sessionId; receives serial-rx and operator TX;
                     can send serial-tx with source: "support" (keystrokes →
                     operator browser, which writes to serial port).

      Messages:
        serial-rx   { type, data: base64 }           Switch → support viewers
        serial-tx   { type, source, data: base64 }   Keystrokes (bidirectional)
        session-ended { type, reason }                Broadcast when operator disconnects
        error       { type, message }                 Protocol errors

      Operator disconnect cleans up the session and notifies all support clients.
      Mist credentials supplied at join time are stored in the session and
      relayed to support clients that join later.

  server/mcp-server.mjs
    MCP (Model Context Protocol) server. Exposes the console session and Mist
    API as tools that AI agents (Claude Desktop, or any MCP client) can call.

    Connects to the WebSocket hub as a "support" client to send/receive console
    data. Maintains a 1000-line rolling output buffer (ANSI-stripped) shared
    across all tool calls. Detects Junos CLI mode from prompt characters
    (>, #, %, login:).

    Transport modes:
      stdio (default) — for Claude Desktop on the same machine. Trusted; no
                        IP-based or session authorization checks.
      HTTP            — for Claude Desktop on a different LAN machine. Listens
                        on port 3334 (MCP_PORT). Enforces IP allowlist
                        (MCP_ALLOW_CIDR) and requires operator-authorized
                        session IDs.

    Safety guardrails:
      Blocked (always rejected):
        request system zeroize
        request system halt
        request system power-off
        request system reboot  (unless force=true is explicitly passed)
      Warned (allowed with a warning in the response):
        delete, commit, rollback

    Environment variables:
      MCP_TRANSPORT      "stdio" (default) or "http"
      MCP_PORT           HTTP listen port (default 3334)
      MCP_HOST           HTTP bind address (default 0.0.0.0)
      MCP_ALLOW_CIDR     Allowed subnets, comma-separated
                         (default: 10.100.100.0/24,192.168.1.0/24)
                         Localhost is always allowed regardless of this setting.
      HUB_URL            Hub base URL (default http://127.0.0.1:3333)
      WS_URL             WebSocket hub URL (default ws://127.0.0.1:3333/ws)
      MIST_API_HOST      Fallback Mist API host (e.g. api.mist.com)
      MIST_API_TOKEN     Fallback Mist API token
      MIST_ORG_ID        Fallback Mist org ID

    MCP tools:
      list_sessions        List active console sessions. HTTP mode returns only
                           the caller's own session (prevents enumeration).
      send_command         Send a Junos CLI command; wait for prompt response.
      read_output          Read last N lines from the console buffer.
      get_session_state    Detect current CLI mode (operational/config/shell/
                           login/unknown).
      mist_api_get         GET request to the Mist REST API.
      mist_api_put         PUT request to the Mist REST API.
      list_sites           List all sites in a Mist org.
      get_device_config    Get Mist device configuration for a switch.
      get_device_stats     Get live Mist device stats (port_stat, last_seen).
      get_inventory        Get switch inventory for a Mist org.
      get_site_setting     Get site settings (incl. switch_mgmt.root_password).

    Mist credential resolution order (per tool call):
      1. Per-call parameters (api_host, api_token, org_id)
      2. Credentials forwarded from the operator's session at join time
      3. Environment variables (MIST_API_HOST, MIST_API_TOKEN, MIST_ORG_ID)

    Claude Desktop (stdio, same machine):
      {
        "mcpServers": {
          "junos-console": {
            "command": "node",
            "args": ["C:/path/to/mist-junos-console/server/mcp-server.mjs"]
          }
        }
      }

    Claude Desktop (HTTP, remote machine):
      {
        "mcpServers": {
          "junos-console": {
            "url": "http://10.100.100.x:3334/mcp"
          }
        }
      }

LEGACY
  proxy/proxy.js  — standalone Mist-only HTTP proxy on port 4000.
                    Superseded by server/index.mjs. Retained for reference.

================================================================================
CLOUD CONNECTIVITY CHECK — 17-STEP TEST REFERENCE
================================================================================

Tests run sequentially. Critical gates (marked [CRITICAL]) stop all remaining
checks when they fail (no IP → can't check DNS; no route → can't check Mist
endpoints; DNS fail → skip all endpoint tests).

--------------------------------------------------------------------------------
1. LLDP NEIGHBORS
--------------------------------------------------------------------------------
Command:  show lldp neighbors
Purpose:  Detect devices connected via LLDP; identify the uplink port for
          subsequent port/VLAN/error tests.
Pass:     At least one LLDP neighbor found.
Fail:     No LLDP neighbors. Manual uplink port entry is required to continue.

Remediation:
  - Verify cable is connected at both ends.
  - Ensure upstream device has LLDP enabled.
  - Check the uplink port is not administratively disabled:
      show interfaces <port> terse
      delete interfaces <port> disable / commit
  - If LLDP is intentionally disabled upstream, enter the uplink port manually.

--------------------------------------------------------------------------------
2. UPLINK PORT STATUS
--------------------------------------------------------------------------------
Command:  show interfaces <port> terse
Purpose:  Verify the uplink port is up with link and determine speed.
Pass:     Port is up with link.
Fail:     Port is admin down or has no link.

Remediation:
  - Admin down → delete interfaces <port> disable / commit
  - No link → check cable, SFP compatibility, upstream port state,
    speed/duplex mismatch (try enabling auto-negotiation).

--------------------------------------------------------------------------------
2b. UPLINK INTERFACE ERRORS
--------------------------------------------------------------------------------
Command:  show interfaces <port> extensive | match error
Purpose:  Check for CRC errors, framing errors, drops, discards.
Pass:     All error counters zero.
Warn:     Non-zero counters (may indicate cable, optic, or duplex issue).

Remediation:
  - clear interfaces statistics <port>, wait 5 min, recheck.
  - Replace cable or SFP. Check duplex mismatch. Clean fiber connectors.

--------------------------------------------------------------------------------
3. VLAN CONFIGURATION
--------------------------------------------------------------------------------
Command:  show vlans interface <port>  (fallback: show ethernet-switching ...)
Purpose:  Verify VLANs are configured on the uplink.
Pass:     VLANs found on the uplink.
Warn:     No VLANs found (may indicate a misconfigured trunk).

Remediation:
  - Ensure the port is configured as trunk with the management VLAN allowed.
  - Verify irb.0 VLAN is present and native VLAN is set if using untagged mgmt.

--------------------------------------------------------------------------------
4. MANAGEMENT IP ADDRESS  [CRITICAL]
--------------------------------------------------------------------------------
Command:  show interfaces terse | match "inet "
Purpose:  Verify the switch has an IP on a management interface (irb, vme, me0).
Pass:     IP address found.
Fail:     No IP — ALL REMAINING CHECKS ARE SKIPPED.

Remediation:
  - DHCP: verify DHCP client configured on irb.0; verify DHCP server scope,
    VLAN, and that options 3 (gateway) and 6 (DNS) are provided.
  - Static: set interfaces irb unit 0 family inet address <ip>/<prefix> / commit.

--------------------------------------------------------------------------------
4b. DHCP LEASE DETAILS
--------------------------------------------------------------------------------
Command:  show dhcp client binding [detail]
Purpose:  Display DHCP lease details (IP, mask, gateway, DNS).
Pass:     DHCP lease found.
Info:     No lease or 0.0.0.0 binding — IP is likely static (not a failure).

Remediation (DHCP expected but failing):
  - Verify DHCP client config on irb.0 ("family inet dhcp").
  - Monitor DHCP traffic: monitor traffic interface irb.0 matching "port 67 or 68"
  - Check VLAN tagging and DHCP server scope availability.

--------------------------------------------------------------------------------
5. ARP TABLE
--------------------------------------------------------------------------------
Command:  show arp no-resolve
Purpose:  Verify ARP table has entries (switch can reach next-hop).
Pass:     ARP entries found.
Fail:     Empty ARP table.

Remediation:
  - Verify default gateway IP is on same subnet as management interface.
  - Ping the gateway to trigger ARP: ping inet <gateway-ip> count 3
  - Check for STP blocking: show spanning-tree interface <port>
  - Check for firewall filters blocking ARP: show configuration firewall

--------------------------------------------------------------------------------
6. DEFAULT GATEWAY  [CRITICAL]
--------------------------------------------------------------------------------
Command:  show route 0.0.0.0/0
Purpose:  Verify a default route exists with a next-hop.
Pass:     Default route found.
Fail:     No default route — DNS and cloud checks are ALL SKIPPED.

Remediation:
  - DHCP: verify DHCP Option 3 (gateway) is provided by DHCP server.
  - Static: set routing-options static route 0.0.0.0/0 next-hop <gw> / commit.
  - If using mgmt_junos VRF: show route table mgmt_junos.inet.0 0.0.0.0/0

--------------------------------------------------------------------------------
7. DNS CONFIGURATION
--------------------------------------------------------------------------------
Commands: show configuration system name-server
          show configuration groups | display set | match name-server
          show configuration system name-server | display inheritance
          show system name-server
          file show /etc/resolv.conf
Purpose:  Verify DNS servers are configured (5 locations checked).
Pass:     DNS servers found in any location.
Fail:     No DNS servers found anywhere.

Remediation:
  - Add DNS: set system name-server 8.8.8.8 / commit
  - If DHCP-managed: ensure DHCP Option 6 is provided.
  - If Mist-managed: verify DNS is in the Mist switch template or site config.
  - If resolv.conf is empty (known Junos bug): re-add name-server config and commit.

--------------------------------------------------------------------------------
8. DNS RESOLUTION & REACHABILITY  [CRITICAL]
--------------------------------------------------------------------------------
Command:  ping inet <oc-term-host> count 3 rapid
Purpose:  Test DNS resolution and ICMP reachability to the Mist cloud.
          "ping inet" forces IPv4 (avoids IPv6 AAAA resolution issues).
Pass:     Hostname resolved and ICMP replies received.
Warn:     Resolved but 0 replies — ICMP may be blocked (proceed to TCP tests).
Fail:     DNS resolution failed — ALL ENDPOINT CHECKS ARE SKIPPED.

Remediation:
  - "unknown host": verify DNS (test 7), then test: show host <hostname>
  - DNS configured but not resolving: check if DNS servers are reachable
    (ping inet <dns-ip> count 3), check UDP port 53 firewall rules.
  - Resolved but no ping: ICMP may be blocked — check TCP telnet tests.

--------------------------------------------------------------------------------
9. ROUTE TO MIST ENDPOINTS
--------------------------------------------------------------------------------
Commands: show host <oc-term-host>
          show route <resolved-ip>
Purpose:  Resolve the Mist cloud FQDN and verify a route to the resolved IP.
          Uses "show host" because nslookup is not available on all Junos.
Pass:     Route found to the resolved IP.
Warn:     Could not resolve the FQDN.
Fail:     No route to the resolved IP.

Remediation:
  - Verify default route (test 6). Check policy-based routing or firewall rules.

--------------------------------------------------------------------------------
10. ENDPOINT TCP REACHABILITY
--------------------------------------------------------------------------------
Commands: ping inet <host> count 1 rapid
          telnet inet <host> port <port>
Purpose:  Test TCP connectivity to each Mist cloud endpoint.

Endpoints tested per cloud region:
  redirect.juniper.net     TCP 443   Redirect service
  jma-terminator.<cloud>   TCP 443   JMA terminator
  ztp.<cloud>              TCP 443   Zero Touch Provisioning
  oc-term.<cloud>          TCP 2200  Outbound SSH
  cdn.juniper.net          TCP 443   CDN for firmware (non-Global 01)

Pass:   Telnet connects ("Connected to…").
Warn:   Connection refused — port may be filtered.
Fail:   Timed out, no route, or DNS failure.

Remediation:
  - "Connection timed out": firewall is blocking the TCP port. Request:
      TCP 443 outbound to all Mist FQDNs
      TCP 2200 outbound to oc-term FQDN
    Use FQDNs (not IPs) in firewall rules — Mist uses AWS/GCP load balancers.
  - "Connection refused": host reachable but port not accepting (may be transient).
  - Juniper firewall port documentation:
    https://www.juniper.net/documentation/us/en/software/mist/mist-management/topics/ref/firewall-ports-to-open.html

--------------------------------------------------------------------------------
10b. SSL CERTIFICATE INSPECTION CHECK
--------------------------------------------------------------------------------
Command:  curl -vk --connect-timeout 10 https://<host>/ -o /dev/null 2>&1
          (run via interactive shell: start shell → curl → exit → cli)
Purpose:  Verify the SSL certificate is issued by the expected CA (Amazon /
          Google Trust Services / Mist), not a firewall performing TLS decryption.
Pass:     Certificate from Amazon, Google, or Mist.
Fail:     Certificate from an unexpected CA (e.g. Palo Alto, Fortinet, Zscaler)
          — SSL inspection is active.

Remediation:
  - SSL inspection MUST be disabled for Mist cloud endpoints. Create bypass
    rules for: *.mistsys.net, *.mist.com, redirect.juniper.net, cdn.juniper.net
  - Palo Alto: SSL Decryption exclusion or "No Decrypt" policy.
  - Fortinet: SSL/SSH Inspection exemption.
  - Zscaler: SSL Inspection bypass list.

--------------------------------------------------------------------------------
10c. TRACEROUTE (on failed endpoints only)
--------------------------------------------------------------------------------
Command:  traceroute inet <host> wait 2 as-number-lookup no-resolve
Purpose:  Show where the network path breaks for unreachable endpoints.
Info:     Identifies the last responding hop before the drop point.

Remediation:
  - Last responding hop is your gateway → that device is blocking traffic.
  - Hops respond for several then stop → intermediate firewall or ISP issue.
  - All * * * → local gateway may be blocking traceroute (ICMP/UDP).
    This does not necessarily mean TCP will also fail — focus on telnet results.

--------------------------------------------------------------------------------
11. MIST AGENT VERSION
--------------------------------------------------------------------------------
Command:  show version | match mist
Purpose:  Check if the Mist Agent is installed.
Pass:     Mist Agent installed with version shown.
Fail:     Mist Agent not found — switch is not adopted.

Remediation:
  - Use the "Adopt Switch" button to apply adoption commands from Mist.
  - Or paste commands from: Organization → Inventory → Switches → Adopt Switches.

--------------------------------------------------------------------------------
12. MIST AGENT PROCESSES (mcd / jmd)
--------------------------------------------------------------------------------
Command:  ps aux | grep mcd|jmd  (via interactive shell)
Purpose:  Verify the Mist Cloud Daemon (mcd) and Junos Mist Daemon (jmd) run.
Pass:     Both mcd and jmd running.
Warn:     Only one process running.
Fail:     Neither process running.

Log file selection: "show version | match mist" determines whether the switch
runs JMA (jmd.log) or the legacy pyagent (mist.log). This also controls which
log file the Offline Timeline reads.

Remediation:
  - restart mcd (wait 30 seconds)
  - Check logs: show log jmd.log  (or show log mist.log for legacy pyagent)
  - Check disk space: show system storage / request system storage cleanup

--------------------------------------------------------------------------------
13. OUTBOUND SSH CONFIGURATION
--------------------------------------------------------------------------------
Command:  show configuration system services outbound-ssh
Purpose:  Verify client "mist" is configured with device-id, secret, target.
Pass:     Client "mist" configured with all required fields.
Warn:     Configuration exists but missing components.
Fail:     Client "mist" not configured or deactivated.

Remediation:
  - Not configured → use "Adopt Switch" or paste adoption commands.
  - Deactivated → activate system services outbound-ssh client mist / commit.
  - Deactivate/reactivate cycle if configured but not connecting.
  - Delete and re-adopt if device-id or secret appears corrupted.
  - Target must match the oc-term FQDN for the selected cloud region.

--------------------------------------------------------------------------------
14. ACTIVE CLOUD CONNECTIONS
--------------------------------------------------------------------------------
Commands: show system connections | grep <management-ip>
          show host <endpoint>  (for each Mist FQDN)
Purpose:  Check for established TCP connections from the management IP and
          validate destination IPs against resolved Mist cloud FQDNs.
Pass:     ESTABLISHED connections found matching Mist cloud endpoints.
Warn:     Connections exist but don't match known Mist endpoints, or connections
          are in non-established states.
Fail:     No outbound connections from the management IP.

Connection states and what they indicate:
  ESTABLISHED  Connection is active.
  SYN_SENT     Switch can send but firewall is blocking the return SYN-ACK.
               Also check NAT table capacity and session timeouts.
  FIN_WAIT /   Connection was established but terminated (timeout or firewall
  CLOSE_WAIT   session timeout). Try restarting mcd.
  ESTABLISHED  If switch shows disconnected in Mist, the device-id may not
  but offline   match any org → delete and re-adopt.

================================================================================
LOGIN FLOW
================================================================================

The "Login to Switch" button runs a state machine with four scenarios:

  1. Already logged in (> or # prompt) — no action needed.
  2. At shell prompt (%) — sends "cli" to enter Junos operational mode.
  3. Factory default (root, no password) — logs in automatically; warns that
     a root password must be set before any config commits.
  4. Password required — fetches root password from Mist site settings via API
     (Organization → Site Configuration → Switch Management → root password).
     If the API is not configured or the password is unavailable, prompts the
     user to enter it manually.

Login failure remediation:
  - Factory default: set system root-authentication plain-text-password / commit.
  - Mist password rejected: site password may differ from switch (e.g. after
    zeroize). Console in with no password (factory default) if necessary.
  - No Mist API: configure cloud, token, org ID, and site in the Mist section.

================================================================================
OFFLINE TIMELINE
================================================================================

Correlates cloud-side and switch-side data to explain when and why a switch
went offline. Requires switch to be identified in Mist with a site assigned.

Steps and data sources:

  1. Mist Last Seen      stats/devices API     Last seen timestamp + status
  2. Recent Mist Events  devices/events API     Up to 20 events; highlights
                                               DISCONNECTED events
  3. Switch Uptime       show system uptime     Boot time, last configured time,
                                               configuring user
  4. Mist Audit Logs     orgs/{id}/logs API     Config changes ±30 min around
                                               the disconnect event
  5. Switch Logs         show log jmd.log       Mist agent log lines around the
                         (or mist.log)          disconnect window

Log file is chosen automatically: "show version | match mist" determines JMA
(jmd.log) vs legacy pyagent (mist.log). Timestamps in log files are converted
to UTC using junos-log-time.ts and the switch's reported current time + TZ.

================================================================================
DEVICE & CONFIG FEATURES
================================================================================

IDENTIFY SWITCH
  Runs "show version" and "show chassis hardware" to extract serial number and
  MAC address. Searches Mist org inventory for a match. Reports device ID, site,
  model, and current cloud status (connected/disconnected, last_seen).

GET ROOT PASSWORD
  Fetches the root password from Mist site settings
  (switch_mgmt.root_password path in site configuration). Displays it with
  login instructions for the console.

CHECK CONFIG DRIFT
  Fetches the Mist intended (pushed) configuration for the identified switch
  and compares it against "show configuration" from the console. Reports lines
  present in Mist config but missing from Junos (and vice versa).

ADOPT SWITCH
  Fetches outbound-SSH adoption commands from the Mist API
  (orgs/{id}/ocdevices/outbound_ssh_cmd). Performs a root authentication
  pre-check before applying commands. Applies commands via the console.

STANDALONE MIST STATUS
  Runs tests 11–14 (Mist agent version, processes, outbound-SSH config,
  active connections) independently, without running the full connectivity suite.

================================================================================
REMOTE SUPPORT SESSION
================================================================================

After connecting to serial:
  1. Tick "Enable remote session" in the Connection panel.
  2. The backend creates a session UUID and returns it.
  3. Share the session ID with the support engineer.
  4. Support engineer opens: http://<host>:3000/support.html?session=<id>
  5. All switch output is mirrored to the support terminal.
  6. Keystrokes typed by support are sent to the operator browser, which
     writes them to the serial port.

The operator's browser can supply Mist credentials at session creation time.
These are stored in the session and relayed to joining support clients.

Security note: Session IDs are currently the only access control. Treat them
as secrets. Add SSO / short-lived token auth before wider rollout.

================================================================================
KEY DESIGN DECISIONS
================================================================================

- IPv4 forced everywhere        — "ping inet" / "telnet inet" avoid IPv6 AAAA issues
- DNS checked in 5 locations    — direct, groups, inherited, operational, resolv.conf
- "show host" for FQDN lookup   — nslookup not available on all Junos versions
- Management IP for conn check  — catches both port 2200 and 443
- SSL inspection detection      — curl cert check; expects Amazon/Google/Mist CA
- Root auth pre-check           — verifies before adoption to avoid failed apply
- Critical gates (4, 6, 8)      — no IP/route/DNS each skip remaining checks
- WebSocket directly to backend — Vite WS proxy unreliable with the Node ws library
- MCP stdio = always trusted    — IP and session authorization only in HTTP mode

================================================================================
MIST CLOUD REGIONS
================================================================================

  ID        Name        API Host
  --------  ----------  -------------------
  global01  Global 01   api.mist.com
  global02  Global 02   api.gc1.mist.com
  global03  Global 03   api.ac2.mist.com
  global04  Global 04   api.gc2.mist.com
  global05  Global 05   api.gc4.mist.com
  emea01    EMEA 01     api.eu.mist.com
  emea02    EMEA 02     api.gc3.mist.com
  emea03    EMEA 03     api.ac6.mist.com
  emea04    EMEA 04     api.gc6.mist.com
  apac01    APAC 01     api.ac5.mist.com    ← default in UI
  apac02    APAC 02     api.gc5.mist.com
  apac03    APAC 03     api.gc7.mist.com

Global 01 uses oc-term.mistsys.net / jma-terminator.mistsys.net (legacy domain).
All other regions use oc-term.<cloud>.mist.com / jma-terminator.<cloud>.mist.com.
cdn.juniper.net (TCP 443) is tested for all regions except Global 01.

================================================================================
DEPENDENCIES
================================================================================

Runtime:
  @modelcontextprotocol/sdk   MCP server + transport implementations
  @xterm/xterm                Browser terminal emulator (ANSI, VT100)
  @xterm/addon-fit            xterm resize-to-container addon
  @xterm/addon-web-links      xterm clickable URL addon
  ws                          WebSocket server library (Node backend + MCP server)

Dev:
  vite                        Build tool + dev server (with HMR)
  typescript                  TypeScript compiler
  concurrently                Run multiple npm scripts in parallel
  wait-on                     Wait for a TCP port to become available
  @types/w3c-web-serial        Web Serial API TypeScript definitions
  @types/ws                    ws TypeScript definitions
