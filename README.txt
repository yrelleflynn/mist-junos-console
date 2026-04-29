================================================================================
  MARVIS CONSOLE
  Automated diagnostic tool for Juniper Mist-managed switches
================================================================================


OVERVIEW
--------
Marvis Console connects to a Juniper switch over a serial console cable and runs
a structured set of diagnostic checks to determine why the switch lost its
connection to the Mist cloud. It correlates switch-side CLI output with Mist API
data and MCD/JMD log files to give you a complete picture in one session.

The tool supports three-machine deployments: one machine runs the server, one
machine has the console cable connected, and a third machine can run Claude
Desktop via MCP to automate the diagnostic workflow.


================================================================================
  PREREQUISITES
================================================================================

  - Node.js 20 or later         https://nodejs.org
  - npm 10 or later             (bundled with Node.js 20)
  - Google Chrome or Edge       (required for Web Serial API on the console machine)
  - A USB-to-serial adapter     (for connecting to the switch console port)


================================================================================
  INSTALLATION
================================================================================

1. Clone or download the repository to your server machine:

     git clone <repository-url> Marvis_Console
     cd Marvis_Console

2. Install all dependencies (installs packages for all workspaces at once):

     npm install

3. Build the shared package first (other packages depend on it):

     npm run build:shared

4. Build all packages for production:

     npm run build

   This compiles TypeScript for every package and places the client SPA into
   packages/server/public/ so the server can serve it as static files.

5. Start the server:

     node packages/server/dist/index.js

   Or using the npm workspace script:

     npm start --workspace=packages/server

   The server listens on port 3000 by default.
   Open http://<SERVER_IP>:3000 in Chrome on the console machine.


================================================================================
  ENVIRONMENT VARIABLES (SERVER)
================================================================================

  PORT                  HTTP listen port. Default: 3000
  MIST_PROXY_TIMEOUT    Timeout in milliseconds for proxied Mist API calls.
                        Default: 30000 (30 seconds)

  Example — run on a different port:
    PORT=8080 node packages/server/dist/index.js


================================================================================
  THREE-MACHINE DEPLOYMENT
================================================================================

  MACHINE 1 — Server
  -------------------
  Run the built server. Note the machine's IP address on the network.

    node packages/server/dist/index.js

  All other machines connect to this IP on port 3000.

  MACHINE 2 — Console (Chrome + USB serial cable)
  ------------------------------------------------
  No software installation needed — just Chrome.

  1. Connect your USB-to-serial adapter to the switch console port.
  2. Open Chrome and navigate to: http://<SERVER_IP>:3000
  3. Click "Connect Serial Port" in the app.
  4. Select your USB adapter from the browser's port picker dialog.

  IMPORTANT: The Web Serial API only works in Chrome or Edge.
  Firefox and Safari are not supported. The page must be served over
  HTTP from the server — it cannot be opened as a local file.

  MACHINE 3 — Claude Desktop (MCP integration)
  ---------------------------------------------
  1. Build the MCP package if not already done:

       npm run build:mcp

  2. Edit your Claude Desktop config file.
     Location on Windows: %APPDATA%\Claude\claude_desktop_config.json
     Location on macOS:   ~/Library/Application Support/Claude/claude_desktop_config.json

     Add this entry (adjust paths and IP):

       {
         "mcpServers": {
           "marvis-console": {
             "command": "node",
             "args": ["C:\\path\\to\\Marvis_Console\\packages\\mcp\\dist\\index.js"],
             "env": {
               "CONSOLE_SERVER_URL": "http://<SERVER_IP>:3000"
             }
           }
         }
       }

  3. Restart Claude Desktop.
  4. Claude can now use the marvis-console tools to read switch output,
     send commands, and run diagnostic checks autonomously.


================================================================================
  CHROME EXTENSION — MIST SESSION BRIDGE
================================================================================

  The Marvis Console Chrome extension automatically supplies your Mist login
  session to the app so you never need to enter API keys manually.

  Installing the extension (developer mode):
  1. Open Chrome and go to: chrome://extensions
  2. Enable "Developer mode" (toggle in the top-right corner)
  3. Click "Load unpacked"
  4. Select the folder: packages/extension

  How it works:
  The extension reads your Mist browser cookies (csrftoken + sessionid) and
  the active tab URL to extract your org_id. It returns these to the Marvis
  Console app when asked. It does NOT modify Mist pages, inject scripts,
  or store your credentials.

  When the extension is installed and you are logged into the Mist dashboard
  in the same Chrome session, the app detects your org and cloud region
  automatically.

  If the extension is not installed, the app falls back to asking for
  credentials manually.


================================================================================
  DEVELOPMENT MODE
================================================================================

  Run all packages concurrently with hot reload:

    npm run dev

  This starts:
    - packages/shared   TypeScript watch mode (recompiles on type changes)
    - packages/server   tsx watch server (restarts on source changes)
    - packages/client   Vite dev server with HMR (typically on port 5173)

  During development, open http://localhost:5173 in Chrome (not port 3000).
  The Vite dev server proxies all /api and /ws requests to the backend server.

  Type-check all packages without building:

    npm run typecheck

  Run all test suites:

    npm test


================================================================================
  DIAGNOSTIC CHECKS — FULL REFERENCE
================================================================================

  Marvis Console runs 21 diagnostic checks in 5 groups. Checks run in
  dependency order. If a critical check fails, dependent checks are skipped
  automatically rather than producing confusing cascading failures.

  Legend:
    [GATE] = Failure causes dependent checks to skip
    Gate:  = Which check must pass before this one runs


  ── GROUP 1: CONNECTIVITY (6 checks) ──────────────────────────────────────

  CHECK 1 — Uplink Port Status
  What it does:
    Runs "show interfaces <uplink-port>" and reads the physical and
    operational link state of the port connecting the switch to the network.
  Pass:   Port is operationally up and forwarding traffic.
  Fail:   Port is physically down or in error-disabled state.
  Skip:   Could not determine which port is the uplink.
  Why it matters:
    A down uplink means no traffic can leave the switch. Without catching
    this first, every subsequent check would also fail for the wrong reason.

  CHECK 2 — Uplink Port Errors
  What it does:
    Reads the input and output error counters on the uplink interface.
    Compares against thresholds to determine if errors are significant.
  Pass:   Error counters are at zero or negligible levels.
  Warn:   Some errors present but port is operational.
  Fail:   Error rate is high — indicates duplex mismatch, bad cable, or SFP.
  Gate:   Uplink Port Status must pass first.
  Why it matters:
    A switch can have a "link up" port that is dropping most packets due to
    physical layer problems. Error counters reveal this when the link state
    check alone would not.

  CHECK 3 — Management IP Assigned  [GATE]
  What it does:
    Runs "show interfaces irb" and "show interfaces me0" to find a
    management IP address. Checks that the address is assigned and usable.
  Pass:   A management IP is found on the irb or me0 interface.
  Fail:   No IP address on either management interface.
  Why it matters:
    Without a management IP the switch cannot initiate any IP communication.
    This is the most upstream possible failure and gates everything below:
    Management VLAN Reachable, Default Gateway Ping, and all routing, DNS,
    and cloud checks skip if this fails.

  CHECK 4 — Management VLAN Reachable
  What it does:
    Sends a ping from the management interface to the default gateway to
    verify layer-2 connectivity within the management VLAN.
  Pass:   Default gateway responds to ping.
  Fail:   No response — VLAN may be wrong, STP may be blocking, or the
          gateway port may be down.
  Gate:   Management IP Assigned must pass first.
  Why it matters:
    Even with a correct IP address, the switch may be in the wrong VLAN,
    the port may be blocked by spanning tree, or the upstream switch may
    have a misconfigured trunk. This check isolates layer-2 from layer-3.

  CHECK 5 — Default Gateway Ping  [GATE]
  What it does:
    Sends ICMP echo requests to the configured default gateway IP and waits
    for a response within a timeout window.
  Pass:   Gateway responds to ping.
  Fail:   No response from gateway IP.
  Gate:   Management IP Assigned must pass first.
  Why it matters:
    Confirms basic layer-3 forwarding is working. This is a critical gate
    for all routing, DNS, and Mist cloud checks. A failure here isolates
    the problem to the local network before attempting any internet checks.

  CHECK 6 — MTU Check
  What it does:
    Sends an oversized ICMP packet (1472+ bytes payload) toward the Mist
    cloud endpoint IP. Detects silent packet drops that indicate an MTU
    black hole on the path.
  Pass:   Large packet reaches destination or fragmentation needed received.
  Fail:   Large packet silently dropped (black hole detected).
  Gate:   Default Gateway Ping must pass first.
  Why it matters:
    MTU black holes cause TLS connections to hang silently. The TCP
    three-way handshake (small packets) succeeds, but the TLS client hello
    (large packet) is silently dropped. The connection appears to hang
    indefinitely. This is a common, hard-to-diagnose cause of Mist
    connectivity failure in environments with tunnel overlays or strict
    firewall policies.


  ── GROUP 2: ROUTING (5 checks) ───────────────────────────────────────────

  CHECK 7 — Default Route Present  [GATE]
  What it does:
    Runs "show route 0.0.0.0/0" and confirms a default route exists with a
    valid next-hop address.
  Pass:   A 0.0.0.0/0 route is in the routing table.
  Fail:   No default route found.
  Why it matters:
    Without a default route, the switch cannot reach any address outside
    its directly connected subnets. This gates the rest of the routing
    group — if no default route exists, the remaining routing checks
    provide no additional information.

  CHECK 8 — Default Route via Gateway
  What it does:
    Compares the default route next-hop against the expected gateway IP
    discovered during the connectivity checks.
  Pass:   Default route next-hop matches the discovered gateway.
  Warn:   Default route points to an unexpected next-hop.
  Fail:   Default route next-hop is unreachable.
  Gate:   Default Route Present must pass first.
  Why it matters:
    A static route misconfiguration pointing to the wrong next-hop passes
    the "default route present" check but causes all traffic to be
    blackholed. This check catches that.

  CHECK 9 — Routing Table Size
  What it does:
    Counts the total number of routes in the routing table and compares
    against expected bounds. Too few routes may indicate a routing protocol
    failure; too many may indicate a loop or injection.
  Pass:   Route count is within expected range.
  Warn:   Route count is outside expected range.
  Gate:   Default Route Present must pass first.
  Why it matters:
    A healthy switch in a typical branch deployment has a predictable
    number of routes. Unexpected counts can indicate upstream BGP or OSPF
    session failures that cause asymmetric or intermittent connectivity.

  CHECK 10 — ARP — Default Gateway
  What it does:
    Inspects the ARP cache for a valid entry mapping the gateway IP to a
    MAC address. Triggers ARP resolution via ping if no entry exists.
  Pass:   ARP entry exists with a populated MAC address.
  Fail:   No ARP entry or ARP resolution failed.
  Gate:   Default Gateway Ping must pass first.
  Why it matters:
    ARP failure at the gateway means layer-2 is broken even when the IP
    and routing configuration looks correct. Common causes: switch is in
    the wrong VLAN, upstream port is misconfigured, or proxy ARP is
    interfering.

  CHECK 11 — ARP — Mist Endpoint
  What it does:
    Resolves the Mist WebSocket endpoint hostname to an IP and checks
    whether the switch has a routing or ARP path to reach that IP.
  Pass:   A forwarding path to the Mist endpoint IP is confirmed.
  Fail:   No path to the Mist endpoint IP found in routing/ARP tables.
  Gate:   Default Gateway Ping must pass first.
  Why it matters:
    Confirms the specific path to Mist is available, not just that a
    default route exists. Catches cases where Mist IP ranges are
    specifically blackholed by a firewall policy or route map.


  ── GROUP 3: DNS (3 checks) ────────────────────────────────────────────────

  CHECK 12 — DNS Resolution  [GATE]
  What it does:
    Queries each DNS server IP from "show system name-servers" and verifies
    that at least one responds successfully to a DNS lookup.
  Pass:   At least one DNS server responds.
  Fail:   All DNS servers are unreachable or return errors.
  Gate:   Default Gateway Ping must pass first.
  Why it matters:
    DNS is required for all Mist cloud connectivity. The switch cannot
    connect to the Mist WebSocket endpoint without resolving its hostname.
    This is a gate for the DNS sub-checks and indirectly for the cloud
    checks. A failure here often means the DNS server IP is wrong or the
    DNS server is in a VLAN the switch cannot reach.

  CHECK 13 — DNS — Mist Endpoint
  What it does:
    Performs a DNS query for the Mist WebSocket endpoint hostname
    (for example ep-terminator.mist.com for Global 01) and confirms
    the hostname resolves to one or more IP addresses.
  Pass:   Hostname resolves successfully.
  Fail:   DNS query times out, returns NXDOMAIN, or returns SERVFAIL.
  Gate:   DNS Resolution must pass first.
  Why it matters:
    Even when general DNS works, the Mist endpoint hostname may fail to
    resolve if the DNS server does not forward external queries, if split-
    horizon DNS is misconfigured, or if the wrong cloud region is configured
    on the switch (the endpoint hostname varies by region).

  CHECK 14 — DNS — NTP Servers
  What it does:
    Resolves the configured NTP server hostnames to confirm they are
    reachable by name. If NTP servers are configured by IP this check
    passes trivially.
  Pass:   All NTP server hostnames resolve.
  Warn:   Some NTP hostnames fail to resolve.
  Fail:   All NTP hostname resolution fails.
  Gate:   DNS Resolution must pass first.
  Why it matters:
    NTP synchronisation is required for TLS. If NTP server hostnames
    cannot be resolved, the switch cannot sync its clock and TLS
    certificate validation will eventually fail as the clock drifts.
    This check identifies NTP DNS failure before it causes a connectivity
    outage.


  ── GROUP 4: MIST CLOUD (4 checks) ────────────────────────────────────────

  CHECK 15 — JMA State
  What it does:
    Reads the JMA (Juniper Mist Agent) self-reported state code from
    "show system jma" and maps it to a human-readable label.
  Pass:   State code 111 — fully connected.
  Warn:   State codes 109-110 — connecting or authenticating.
  Fail:   State codes 102-108 — connectivity failure at a specific layer.
  Why it matters:
    The JMA state code is the switch's own summary of where its connection
    attempt is failing. It maps directly to the network layer:
      102 = No IP address on management interface
      103 = No default gateway / no default route
      106 = DNS lookup failed for Mist endpoint
      107 = NTP synchronisation failed (clock skew too large for TLS)
      108 = Mist cloud IP endpoint unreachable (ICMP timeout)
      109 = WebSocket connecting (TCP connected, handshake in progress)
      110 = WebSocket open, authentication pending
      111 = Fully connected and authenticated
    This check often points directly to which group's checks to focus on.

  CHECK 16 — Mist Endpoint Reachable
  What it does:
    Sends ICMP pings to the Mist WebSocket endpoint IP address to verify
    network-level IP reachability independent of TCP or TLS.
  Pass:   Mist endpoint IP responds to ping.
  Fail:   No ICMP response from the Mist endpoint.
  Gate:   DNS — Mist Endpoint must pass first (to resolve the IP).
  Why it matters:
    Distinguishes between a DNS failure (caught by check 13) and a pure
    network reachability failure (firewall, routing asymmetry, etc.).
    Note: some firewalls allow TCP/443 but block ICMP. A fail here combined
    with a pass on the WebSocket check would indicate ICMP filtering rather
    than a real connectivity problem.

  CHECK 17 — NTP Sync
  What it does:
    Runs "show ntp status" and verifies the switch is synchronised to an
    NTP server with an acceptable clock offset (typically under 1 second).
  Pass:   Clock is synchronised within acceptable offset bounds.
  Warn:   Clock is synchronised but offset is larger than ideal.
  Fail:   Clock is not synchronised or no reachable NTP server found.
  Gate:   DNS — NTP Servers must pass first.
  Why it matters:
    TLS certificate validation requires the client clock to be accurate.
    If the clock drifts more than a few minutes from real time, TLS
    handshakes fail with a certificate validity error. This is one of the
    most common causes of intermittent Mist connectivity loss in the field —
    the switch connects fine initially but drops off after its last NTP sync
    was too long ago.

  CHECK 18 — Mist WebSocket
  What it does:
    Reads the JMA state code and confirms it is 111 (fully connected).
    Cross-references with results from the preceding checks to validate
    that the self-reported state is consistent with observed behaviour.
  Pass:   JMA state is 111 and check results are consistent.
  Warn:   JMA state is 109-110 (still connecting) or results are
          inconsistent (e.g. JMA says connected but pings fail).
  Fail:   JMA state indicates a connection failure.
  Gates:  Mist Endpoint Reachable and NTP Sync must pass first.
  Why it matters:
    This is the final verification of the complete cloud connection stack:
    IP → routing → DNS → NTP → TCP → TLS → WebSocket → authentication.
    A pass here means the switch is or should be online in Mist. A fail
    here with all other checks passing may indicate a Mist-side issue,
    a firewall blocking WebSocket upgrade headers, or a certificate problem.


  ── GROUP 5: OFFLINE HISTORY (3 checks) ───────────────────────────────────

  CHECK 19 — Mist Last Seen  [GATE for history group]
  What it does:
    Queries the Mist API for the device record and reads the last_seen
    field, which is the Unix timestamp of the last time Mist received a
    heartbeat from the device. Calculates and displays how long ago the
    device went offline.
  Pass:   last_seen timestamp retrieved from Mist API successfully.
  Fail:   Device not found in Mist API or API call failed.
  Requires: Valid Mist session (from extension or manual entry) and the
            device must be matched to a site in the organisation.
  Why it matters:
    The last_seen timestamp is the anchor for the two history checks below.
    Knowing the exact offline time allows the tool to pull the right window
    of logs from both the switch and the Mist event log. Without this
    anchor, the history checks cannot run.

  CHECK 20 — MCD Logs at Offline
  What it does:
    Reads the Mist Cloud Daemon log file from the switch filesystem,
    targeting lines within 15 minutes either side of the offline timestamp.
    Automatically determines the correct log filename: newer Junos versions
    use "jmd.log", older versions use "mist.log". Highlights error and
    warning lines.
  Pass:   Log lines retrieved and parsed successfully.
  Fail:   Log file not found, not readable, or console command timed out.
  Gate:   Mist Last Seen must pass first (to establish the offline time).
  Why it matters:
    The MCD/JMD log is the switch's own record of every Mist cloud
    connection attempt, error, certificate event, and configuration
    application. Log lines near the offline time often contain the exact
    error message explaining the failure — TLS handshake error, auth
    rejection, config push error, memory pressure, etc. This is the
    primary evidence source for diagnosing intermittent or config-triggered
    outages.

  CHECK 21 — Config Changes at Offline
  What it does:
    Queries the Mist API events endpoint for SW_CONFIG_CHANGED_BY_USER
    events within 15 minutes either side of the device's last_seen time.
    Reports the timestamp, admin username, and change description for each
    event found.
  Pass:   API query completed (regardless of whether events were found).
  Warn:   One or more config changes found within the offline window —
          a configuration push is a likely cause of connectivity loss.
  Info:   No config changes found in the window.
  Fail:   Mist API query failed.
  Gate:   Mist Last Seen must pass first.
  Why it matters:
    Configuration changes pushed via the Mist dashboard are a leading cause
    of switch connectivity loss. A firewall filter update, VLAN
    reconfiguration, management IP change, or incorrect port profile can
    all silently disconnect a switch. This check identifies whether a human
    action coincided with the outage and names the admin responsible, which
    is often the fastest path to root cause in a team environment.


================================================================================
  CHECK DEPENDENCY TREE
================================================================================

  uplink-port-status
    └── uplink-port-errors

  mgmt-ip-assigned  [CRITICAL GATE]
    ├── mgmt-vlan-reachable
    └── default-gateway-ping  [CRITICAL GATE]
          ├── mtu-check
          ├── arp-gateway
          ├── arp-mist-ep
          └── dns-resolution  [CRITICAL GATE]
                ├── dns-mist-ep
                │     └── mist-ep-reachable
                │           └── (contributes to) mist-websocket
                └── dns-ntp
                      └── ntp-sync
                            └── (contributes to) mist-websocket

  default-route-present  [GATE for routing group]
    ├── default-route-via-gateway
    └── routing-table-size

  jma-state  (independent — always runs)

  mist-last-seen  [GATE for history group]
    ├── mcd-logs-at-offline
    └── config-changes-at-offline


================================================================================
  TROUBLESHOOTING THE TOOL ITSELF
================================================================================

  Problem: "Web Serial not available" or serial button is greyed out
  Solution: Use Google Chrome or Microsoft Edge. Firefox and Safari do not
            support the Web Serial API. The page must be loaded over HTTP
            from the server, not opened as a local file.

  Problem: Browser shows "Not secure" and Web Serial is blocked
  Solution: Web Serial requires HTTPS in production. For local network use
            you can add an exception in Chrome, or configure the server with
            a self-signed certificate. Localhost always works without HTTPS.

  Problem: "Cannot connect to server" when opening the app
  Solution: Verify the server is running on the server machine:
              node packages/server/dist/index.js
            Check that port 3000 is not blocked by Windows Firewall or a
            network firewall between the two machines.

  Problem: The Chrome extension is not detected
  Solution: Make sure the extension is loaded from chrome://extensions and
            is enabled. The extension ID shown there must match the
            EXTENSION_ID constant in packages/client/src/config.ts.
            After loading the extension, reload the Marvis Console page.

  Problem: Mist API calls return 401 Unauthorized
  Solution: Your Mist session has expired. Log out of manage.mist.com and
            log back in, then reload the Marvis Console page. The extension
            will pick up the new session cookies automatically.

  Problem: MCD log file not found (check 20 fails)
  Solution: The log filename varies by Junos version. The tool auto-detects
            it, but a new Junos release may change the filename. Check the
            resolver definition in packages/shared/src/catalog/resolvers.ts
            and update the version heuristic if needed.

  Problem: Claude Desktop cannot find the MCP server
  Solution: Verify the full absolute path in claude_desktop_config.json
            is correct and points to the compiled dist/index.js file.
            Make sure you have run "npm run build:mcp" first.
            Check that CONSOLE_SERVER_URL points to the correct server IP
            and that the server is running.

================================================================================
