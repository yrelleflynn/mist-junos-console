================================================================================
JUNOS CONSOLE — INSTALLATION & QUICK START
================================================================================

REQUIREMENTS
  • Node.js 18 or later  — https://nodejs.org/en/download/
  • Google Chrome or Microsoft Edge (Web Serial API — Firefox/Safari not supported)
  • USB-to-serial or RJ45 console cable

INSTALL STEPS
  1. Install Node.js from https://nodejs.org/en/download/
     Windows: run the .msi installer, then open a NEW terminal window.
     macOS:   use the .pkg installer or: brew install node
     Linux:   sudo apt install nodejs npm   (Debian/Ubuntu)
              sudo dnf install nodejs        (Fedora/RHEL)

  2. Clone or download this repository:
       git clone https://github.com/yrelleflynn/mist-junos-console.git
       cd mist-junos-console

  3. Install dependencies:
       npm install

  4. Start the dev server:
       npm run dev

  5. Open Chrome or Edge and go to: http://localhost:3000

The Mist API proxy starts automatically inside the dev server.
No additional processes or configuration files are needed.

FIRST-TIME SETUP
  1. Connect your console cable to the switch.
  2. In the Connection panel, select the baud rate (9600 for most Juniper EX).
  3. Click Connect and select the serial port when the browser dialog appears.
  4. In the Mist API panel:
       - Select your cloud region (e.g. APAC 01, Global 01).
       - Paste your Mist API token.
       - Paste your Org ID.
       - Click Load to populate the Site dropdown.
       - Select your site.

TROUBLESHOOTING STARTUP
  npm: command not found      Install Node.js and open a new terminal.
  EACCES on npm install       macOS/Linux: fix npm permissions or use sudo.
  Port 3000 already in use    Vite auto-increments to 3001 — check terminal.
  Serial port missing         Ensure console cable driver is installed.
  Web Serial not supported    Use Chrome or Edge — not Firefox or Safari.

================================================================================
JUNOS CONSOLE — CLOUD CONNECTIVITY CHECK: TEST REFERENCE
================================================================================

This document describes each automated test, what it checks, why it
matters, what pass/fail means, and recommended remediation steps.
These remediation steps form the basis for future automated fixes.

Each test result is clickable. Clicking a result opens a detail popup
showing the result status, remediation guidance, executable commands,
and raw command output. The popup header contains a "Run Test Now"
button that re-executes just that single test and updates both the popup
and the sidebar result card — without re-running the full test suite.
This is useful after applying a fix to verify the issue is resolved.

CLOUD REGION VERIFICATION
All endpoint tests (Cloud Connectivity Check and Firewall Policy Check)
are run against the cloud region selected in the Mist API panel. The
tool tests the endpoints defined for that specific region — see the
complete endpoint table below this header. Endpoints sourced from:
https://www.juniper.net/documentation/us/en/software/mist/mist-management/topics/ref/firewall-ports-to-open.html

If Mist API credentials (token + Org ID) are NOT configured when you
click Run Cloud Check or Firewall Policy Check, a confirmation dialog
will appear listing the selected cloud region and all endpoints to be
tested. Confirm the region is correct before proceeding. To skip this
prompt, configure your API credentials and load sites — the cloud
region will then be verified automatically against your org.

A "Cloud Region" result card is always shown at the top of every test
run, indicating which region is being tested and whether it was verified
via API credentials or selected manually.

================================================================================
1. LLDP NEIGHBORS
================================================================================

Command:    show lldp neighbors
Purpose:    Detect devices connected to the switch via LLDP and identify the
            uplink port.
Why needed: The uplink port is required for subsequent port, VLAN, and error
            checks.

Pass:       At least one LLDP neighbor found.
Fail:       No LLDP neighbors detected.

Remediation:
  1. Verify the uplink cable is securely connected at both ends.
  2. Check if the upstream device has LLDP enabled:
       show lldp
     If disabled, enable it:
       set protocols lldp interface all
  3. Verify the uplink port is not administratively disabled:
       show interfaces <port> terse
     If admin down:
       delete interfaces <port> disable
  4. Try a different cable or SFP module.
  5. If LLDP is intentionally disabled upstream, manually specify the
     uplink port in the tool's "Uplink Port" field and continue.

================================================================================
1b. UPSTREAM SWITCH PORT CONFIG
================================================================================

Source:     Mist API — upstream device inventory + port_usages profile
Purpose:    Look up the upstream switch in Mist and retrieve the port
            configuration for the port our switch is connected to (identified
            via LLDP). Checks port mode, VLANs, speed/duplex, and STP settings.
Why needed: Confirms the upstream switch's Mist intended config is compatible
            with what our switch expects, before physical checks get further.

Pass:       Upstream switch found in Mist and matching port config retrieved.
Warn:       Upstream switch found but its port was not matched in Mist config
            (may be using a default profile), or switch not assigned to a site.
Info:       Upstream device is not managed in Mist (third-party switch, router,
            or firewall). Port config must be verified manually.
Skip:       Mist API credentials not configured.

Information shown includes:
  - Upstream switch name and MAC address
  - Matched interface name (e.g. xe-0/1/0)
  - Port usage profile name (e.g. Trunk_uplink)
  - Port mode (trunk / access)
  - Tagged VLANs, native VLAN, VoIP VLAN
  - Speed/duplex settings
  - stp_edge and stp_no_root_port flags

Remediation:
  1. If the upstream device is not in Mist, verify port config manually:
     - Ensure the port is configured as a trunk (not access).
     - Ensure the management VLAN is allowed on the trunk.
     - Ensure STP is not blocking the port.
  2. If the port profile does not match expectations, update it in the
     Mist dashboard under Switches → (upstream switch) → Port Config.

================================================================================
2. UPLINK PORT STATUS
================================================================================

Command:    show interfaces <port> terse
            show interfaces <port>
Purpose:    Verify the uplink port is up with link and determine speed.

Pass:       Port is up with link.
Fail:       Port is admin down or has no link.

Remediation:
  1. If admin down, enable the interface:
       delete interfaces <port> disable
       commit
  2. If link is down (admin up but no link):
     a. Check cable — try a known good cable.
     b. Check SFP/optic — ensure it is compatible with the upstream device.
     c. Check upstream port — verify it is enabled and not in error-disabled state.
     d. Try a different port on the upstream device.
  3. Check for speed/duplex mismatch:
       show interfaces <port> | match "Speed|Duplex|Auto-negotiation"
     If auto-negotiation is off, try enabling it:
       delete interfaces <port> ether-options
       commit
  4. Check for PoE issues if using a PoE-powered device on the uplink.

================================================================================
2b. UPLINK INTERFACE ERRORS
================================================================================

Command:    show interfaces <port> extensive | match error
Purpose:    Check for CRC errors, framing errors, drops, discards on the
            uplink.

Pass:       All error counters are zero.
Warn:       Non-zero error counters detected.

Remediation:
  1. Clear the counters and monitor for new errors:
       clear interfaces statistics <port>
     Wait 5 minutes, then:
       show interfaces <port> extensive | match error
     If errors are still incrementing, the issue is active.
  2. Replace the cable — CRC and framing errors often indicate a bad cable.
  3. Replace the SFP/optic — faulty optics cause CRC errors.
  4. Check for duplex mismatch — half-duplex on one side causes collisions
     and errors:
       show interfaces <port> | match "Duplex"
  5. Check cable length — exceeding maximum distance for the cable type
     causes signal degradation and CRC errors.
  6. If using fiber, clean the connectors and check light levels:
       show interfaces diagnostics optics <port>

================================================================================
3. VLAN CONFIGURATION
================================================================================

Command:    show vlans interface <port>
            show ethernet-switching interface <port>  (fallback)
Purpose:    Verify VLANs are configured on the uplink port.

Pass:       VLANs found on the uplink.
Warn:       No VLANs found.

Remediation:
  1. Check the port mode — it should be trunk for an uplink:
       show configuration interfaces <port>
     If not configured as trunk:
       set interfaces <port> unit 0 family ethernet-switching interface-mode trunk
       set interfaces <port> unit 0 family ethernet-switching vlan members all
       commit
  2. Verify the management VLAN is allowed on the trunk:
       show vlans
     Ensure the VLAN used by irb.0 (management interface) is present.
  3. Verify the native/untagged VLAN if the management IP is on an
     untagged VLAN:
       set interfaces <port> native-vlan-id <vlan-id>
       commit
  4. If the switch is Mist-managed, check the port profile in the Mist
     dashboard — the VLAN assignment may need to be updated there.

================================================================================
3b. UPLINK CONFIG MATCH
================================================================================

Commands:   show configuration interfaces <port> | display set
            show configuration vlans | display set
Source:     Also uses upstream port_usages profile from test 1b.
Purpose:    Compare the local uplink port configuration against what the
            upstream switch expects. Generates exact Junos "set" commands to
            fix any mismatches.
Why needed: Even if the port is physically up, VLAN mismatches between the
            local switch and the upstream port profile will prevent the
            management IP from being reachable.

Pass:       All checked items (mode, VLANs, native VLAN, speed/duplex) match.
Fail:       One or more mismatches found. Exact fix commands are shown.
Skip:       Upstream port config (test 1b) was not retrieved.

Items compared:
  - Port mode (trunk vs access)
  - Tagged VLANs (or "all networks")
  - Native/untagged VLAN
  - VoIP VLAN
  - Speed and duplex

If the switch is managed in Mist and its Mist intended config also does not
match the upstream, a second result card ("Mist Config for Uplink Port") shows
the Mist-side mismatches and offers a "Run Fix" button to update the device
config in Mist via the API (PUT /api/v1/sites/{site_id}/devices/{device_id}).

Remediation:
  1. Use the "Run Fix" button in the check popup to apply the listed
     set commands directly to the switch.
  2. For placeholder values (e.g. <vlan-id>), the VLAN ID is shown in
     the network definitions section of the raw output. Edit the command
     before running.
  3. After fixing the local config, commit and re-run the DHCP and IP
     checks to verify connectivity is restored.

================================================================================
3c. STP PORT STATE
================================================================================

Command:    show spanning-tree interface <uplink-port>
Purpose:    Check the spanning tree state on the uplink port to confirm it is
            in forwarding state. A blocked or discarding port is a common cause
            of the switch having physical link but no IP connectivity.
Why needed: STP blocking is silent at the physical layer — the port shows "up"
            but no traffic flows. This check catches that condition before
            moving on to IP-layer checks.

Pass:       Port state is FWD (forwarding).
Fail:       Port state is BLK (blocked) or DIS (discarding) — traffic cannot
            flow. Also fails if the port is BPDU error-disabled (see 3c-ii).
Warn:       Port state is LRN (learning) or LIS (listening) — STP is still
            converging; wait 30 seconds and re-run the test.
Skip:       No uplink port identified, or STP is not active on this port.

Port states:
  FWD — Forwarding. Normal state for an uplink trunk port.
  BLK — Blocking. Port is receiving BPDUs but not forwarding traffic.
  DIS — Discarding (RSTP). Equivalent to blocking in rapid STP.
  LRN — Learning. Transitioning toward forwarding — not yet passing traffic.
  LIS — Listening. Early convergence stage.
  BPDU error-disabled — The upstream port has BPDU Guard active and shut
        down when it received BPDUs from this switch. See test 3c-ii.

Port roles:
  Root        — Best path to the root bridge. Should be forwarding.
  Designated  — Forwarding port on a segment.
  Alternate   — Blocking port providing a backup path.
  Backup      — Blocking port on a shared segment.

Remediation:
  1. If BLK or DIS with role Alternate:
     a. Another path in the network is preferred. If this is unexpected,
        check that the correct device is the STP root bridge:
          show spanning-tree bridge
        Adjust priority if needed:
          set protocols rstp bridge-priority 4k
          commit
     b. Verify no unintended loops are present (extra cables, stack links).
  2. If BLK or DIS with role Root:
     a. The port was root but was blocked — indicates a topology change.
        Re-plug the uplink cable and wait for convergence.
     b. Check the upstream switch's STP configuration.
  3. If BPDU error-disabled:
     a. The upstream port has STP Edge (BPDU Guard) enabled.
     b. Fix the upstream port profile — see test 3c-ii.
     c. After fixing, re-enable the upstream port:
          clear error-disable <upstream-interface>  (on upstream switch)
  4. If LRN or LIS, wait 30 seconds for STP to converge, then click
     "Run Test Now" to re-check.

================================================================================
3c-ii. UPSTREAM STP EDGE CONFIG
================================================================================

Source:     Mist API — upstream device port_usages profile (stp_edge field)
Purpose:    Check whether the upstream port usage profile has stp_edge: true.
            STP Edge (PortFast) is designed for end-device ports only. When
            enabled on a trunk port connecting to another switch, the upstream
            switch will immediately error-disable the port the moment it
            receives a BPDU from our switch.
Why needed: stp_edge misconfiguration on the upstream trunk port is a common
            root cause of BPDU error-disable events and unexplained STP
            blocking, especially when switches are newly adopted into Mist.

Pass:       stp_edge is false (or not set) on the upstream port profile.
Fail:       stp_edge is true — the upstream port will error-disable when it
            receives BPDUs from our switch.
Skip:       Upstream port usage profile was not resolved (test 1b skipped or
            port not found in Mist config).

Upstream port_usages fields checked:
  stp_edge          If true, the port is an STP edge port. BPDUs received
                    on this port trigger an immediate error-disable.
  stp_no_root_port  If true, root protect is enabled. The port will move to
                    root-inconsistent state if it receives a superior BPDU
                    (i.e. one that would make it become the root port).
                    This is informational and shown in the pass detail.

Automated fix (Run Fix button):
  If stp_edge is true and the upstream switch is in Mist, a "Run Fix"
  button is shown in the popup. Clicking it calls:
    PUT /api/v1/sites/{upstream_site_id}/devices/{upstream_device_id}
  with a payload that sets stp_edge: false on the upstream port usage
  profile. The upstream switch will receive the updated config from Mist
  and re-enable the port automatically.

Remediation (manual):
  1. In the Mist dashboard, go to the upstream switch.
  2. Open its port configuration and find the port usage profile connected
     to our switch (profile name shown in the check result).
  3. Edit the profile and disable "STP Edge" / "PortFast".
  4. Save and apply. The upstream switch will push the new config.
  5. The port will come back up and STP will negotiate normally.
  6. After fixing, re-run tests 3c and 3c-ii to confirm.

================================================================================
4. MANAGEMENT IP ADDRESS  [CRITICAL]
================================================================================

Command:    show interfaces terse | match "inet "
Purpose:    Verify the switch has an IP address on a management interface.

Pass:       IP address found on irb, vme, or me0.
Fail:       No IP address. ALL REMAINING CHECKS ARE SKIPPED.

Remediation:
  1. If using DHCP, verify the DHCP client is configured on the
     management interface:
       show configuration interfaces irb unit 0
     If not configured:
       set interfaces irb unit 0 family inet dhcp
       commit
  2. Verify the DHCP server is reachable and has a scope for this VLAN:
     a. Check the VLAN ID on irb.0:
          show configuration interfaces irb unit 0
     b. Verify the VLAN exists:
          show vlans | match <vlan-name>
     c. Verify the uplink port carries this VLAN (see test 3).
  3. If using static IP, configure it:
       set interfaces irb unit 0 family inet address <ip>/<prefix>
       commit
  4. Check if the interface is administratively down:
       show interfaces irb terse
     If down:
       delete interfaces irb unit 0 disable
       commit
  5. If using me0 (out-of-band management), ensure the management
     cable is connected to the dedicated management port on the switch.

================================================================================
4b. DHCP LEASE DETAILS
================================================================================

Command:    show dhcp client binding
            show dhcp client binding detail
Purpose:    Display DHCP lease details if the IP was obtained via DHCP.

Pass:       DHCP lease found with IP, mask, gateway, DNS.
Info:       No DHCP lease or 0.0.0.0 — IP is likely static.

Remediation (if DHCP expected but not working):
  1. Verify the DHCP client is enabled:
       show configuration interfaces irb unit 0
     Should contain "family inet dhcp".
  2. Check if the DHCP server is providing offers:
       monitor traffic interface irb.0 matching "port 67 or port 68"
     Look for DHCP Discover/Offer/Request/Ack.
  3. Verify the VLAN tagging — DHCP may fail if the switch is on the
     wrong VLAN or the uplink isn't carrying the management VLAN.
  4. Check the DHCP scope on the server — ensure it has available
     addresses and the correct subnet/gateway/DNS options.
  5. If DHCP is working but missing gateway or DNS options, update the
     DHCP scope on the server to include:
     - Option 3 (Router/Gateway)
     - Option 6 (DNS Servers)

================================================================================
5. ARP TABLE
================================================================================

Command:    show arp no-resolve
Purpose:    Verify the ARP table has entries.

Pass:       ARP entries found.
Fail:       ARP table is empty.

Remediation:
  1. Verify the default gateway IP is on the same subnet as the
     management interface:
       show interfaces irb.0 terse
       show route 0.0.0.0/0
  2. Ping the gateway to trigger an ARP request:
       ping inet <gateway-ip> count 3
  3. If ping fails with "No route to host", the gateway may be on a
     different VLAN or subnet. Verify the VLAN configuration.
  4. Check for STP issues — if the port is in blocking state, traffic
     won't flow:
       show spanning-tree interface <port>
  5. Check for MAC address table entries:
       show ethernet-switching table
     If empty, there may be a Layer 2 connectivity issue.
  6. Verify there are no firewall filters blocking ARP:
       show configuration firewall

================================================================================
6. DEFAULT GATEWAY  [CRITICAL]
================================================================================

Command:    show route 0.0.0.0/0
Purpose:    Verify a default route exists.

Pass:       Default route found with next-hop.
Fail:       No default route. ALL REMAINING CHECKS ARE SKIPPED.

Remediation:
  1. If using DHCP, the gateway should come from DHCP Option 3:
     a. Check DHCP lease details (test 4b).
     b. If the lease has no gateway, update the DHCP scope on the server.
  2. If using static IP, add a default route:
       set routing-options static route 0.0.0.0/0 next-hop <gateway-ip>
       commit
  3. Verify the gateway IP is reachable:
       ping inet <gateway-ip> count 3
  4. If using a management routing instance (mgmt_junos), verify the
     route is in the correct table:
       show route table mgmt_junos.inet.0 0.0.0.0/0
  5. If Mist-managed, check the site configuration in the Mist dashboard
     for the management IP settings.

================================================================================
7. DNS CONFIGURATION
================================================================================

Commands:   show configuration system name-server
            show configuration groups | display set | match name-server
            show configuration system name-server | display inheritance
            show system name-server
            file show /etc/resolv.conf
Purpose:    Verify DNS servers are configured.

Pass:       DNS servers found.
Fail:       No DNS servers found anywhere.

Remediation:
  1. Add DNS servers directly:
       set system name-server 8.8.8.8
       set system name-server 8.8.4.4
       commit
  2. If using DHCP, verify the DHCP server provides DNS (Option 6).
  3. If Mist-managed, DNS may be pushed via configuration groups. Check:
       show configuration groups | display set | match name-server
     If empty, add DNS to the Mist site configuration or switch template.
  4. Check if resolv.conf is populated (known Junos bug where it can be
     empty after switching between static and DHCP):
       start shell
       cat /etc/resolv.conf
       exit
       cli
     If empty, re-add the name-server config and commit to repopulate it.
  5. Verify DNS servers are reachable:
       ping inet 8.8.8.8 count 3

================================================================================
8. DNS RESOLUTION & REACHABILITY  [CRITICAL]
================================================================================

Command:    ping inet <oc-term-host> count 3 rapid
Purpose:    Test DNS resolution and ICMP reachability to the Mist cloud.
            Uses "ping inet" to force IPv4.

Pass:       Hostname resolved and ping replies received.
Warn:       Resolved but 0 replies — ICMP may be blocked.
Fail:       DNS resolution failed. ALL ENDPOINT CHECKS ARE SKIPPED.

Remediation:
  1. If "unknown host" — DNS is not resolving:
     a. Verify DNS servers are configured (test 7).
     b. Test DNS directly:
          show host <oc-term-host>
     c. If DNS servers are configured but not resolving, they may be
        unreachable. Test connectivity:
          ping inet <dns-server-ip> count 3
     d. Check if a firewall is blocking UDP port 53 (DNS).
  2. If resolved but no ping replies:
     a. ICMP may be blocked by a firewall — this is often OK as Mist
        cloud endpoints may not respond to ping.
     b. Proceed with the telnet/reachability tests to verify TCP access.
  3. If "No route to host" after resolution:
     a. The DNS resolved to an IPv6 address. Ensure you use "ping inet"
        to force IPv4.
     b. Check routing (test 6).

================================================================================
9. ROUTE TO MIST ENDPOINTS
================================================================================

Command:    show host <oc-term-host>
            show route <resolved-ip>
Purpose:    Resolve the Mist cloud FQDN and verify a route exists.

Pass:       Route found to the resolved IP.
Warn:       Could not resolve the FQDN.
Fail:       No route to the resolved IP.

Remediation:
  1. If no route, verify the default route exists (test 6).
  2. If there is a default route but no route to this specific IP:
     a. Check for policy-based routing or firewall rules that may be
        dropping traffic to specific destinations.
     b. Check for route filtering:
          show route <ip> detail
  3. If using a management routing instance, ensure outbound traffic
     from the management interface uses the correct routing table.

================================================================================
10. ENDPOINT TCP REACHABILITY
================================================================================

Commands:   ping inet <host> count 1 rapid
            telnet inet <host> port <port>
Purpose:    Test TCP connectivity to each Mist cloud endpoint.

Endpoints tested per region:
  - redirect.juniper.net (TCP 443)
  - jma-terminator.<cloud> (TCP 443)
  - ztp.<cloud> (TCP 443)
  - oc-term.<cloud> (TCP 2200)
  - cdn.juniper.net (TCP 443)

Pass:       Telnet connects ("Connected to...").
Warn:       Connection refused — port may be filtered.
Fail:       Timed out, no route, or DNS failure.

Remediation:
  1. If "Connection timed out" but ICMP ping works:
     a. A firewall is blocking the specific TCP port. Request the
        network/firewall team to allow:
        - TCP 443 outbound to all Mist FQDNs
        - TCP 2200 outbound to oc-term FQDN
     b. Provide the firewall team with the FQDNs (not IPs, as they
        change). See the Juniper Mist firewall ports documentation:
        https://www.juniper.net/documentation/us/en/software/mist/mist-management/topics/ref/firewall-ports-to-open.html
  2. If "Connection refused":
     a. The host is reachable but the port is not accepting connections.
        This may be transient — retry after a few minutes.
     b. Verify you are testing the correct endpoint for your cloud region.
  3. If "No route to host":
     a. Check routing (tests 6 and 9).
  4. If "DNS resolution failed":
     a. Check DNS configuration (test 7).
  5. If only port 2200 is blocked but 443 works:
     a. The switch may still connect via the CloudX/JMA path on port 443.
     b. If the switch requires port 2200, request it be opened.

================================================================================
10b. SSL CERTIFICATE INSPECTION CHECK
================================================================================

Command:    curl -vk --connect-timeout 10 https://<host>/ -o /dev/null 2>&1
            (run via interactive shell: start shell → curl → exit → cli)
Purpose:    Verify the SSL certificate is issued by the expected authority
            (Amazon/Google for Mist cloud), not by a firewall performing
            SSL inspection.

Pass:       Certificate issued by Amazon, Google Trust Services, or Mist.
Fail:       Certificate issued by an unexpected authority (e.g. Palo Alto,
            Fortinet, Zscaler) indicating SSL inspection.

Remediation:
  1. SSL inspection (TLS decryption) MUST be disabled for all Mist cloud
     endpoints. The Junos outbound SSH connection will fail if the
     certificate is intercepted.
  2. Request the firewall/security team to add bypass/exclusion rules for:
     - *.mistsys.net
     - *.mist.com
     - redirect.juniper.net
     - cdn.juniper.net
  3. If using Palo Alto:
     a. Create an SSL Decryption exclusion rule for the Mist FQDNs.
     b. Or create a "No Decrypt" policy for the destination addresses.
  4. If using Fortinet/FortiGate:
     a. Create an SSL/SSH Inspection exemption for the Mist FQDNs.
  5. If using Zscaler:
     a. Add the Mist FQDNs to the SSL Inspection bypass list.
  6. After making firewall changes, re-run this test to confirm the
     certificate is now from the expected issuer.

================================================================================
10c. TRACEROUTE (on failed endpoints only)
================================================================================

Command:    traceroute inet <host> wait 2 as-number-lookup no-resolve
Purpose:    Show where the network path breaks for unreachable endpoints.

Info:       Shows responding hops and identifies where traffic is dropped.

Remediation:
  1. Identify the last responding hop — this is typically the device
     before the one that is blocking traffic.
  2. If the last hop is your default gateway:
     a. The firewall/router at the gateway is blocking the traffic.
     b. Request the appropriate ports be opened (see test 10).
  3. If hops respond for several hops then stop:
     a. An intermediate firewall or ISP is blocking the traffic.
     b. Contact the ISP or identify the intermediate device.
  4. If no hops respond at all (* * *):
     a. The local gateway may be blocking traceroute (ICMP/UDP).
     b. This doesn't necessarily mean the TCP connection will also fail.
     c. Focus on the telnet test results instead.

================================================================================
11. MIST AGENT VERSION
================================================================================

Command:    show version | match mist
Purpose:    Check if the Mist Agent is installed.

Pass:       Mist Agent installed with version displayed.
Fail:       Mist Agent not found.

Remediation:
  1. If the Mist Agent is not installed, the switch needs to be adopted:
     a. Use the "Adopt Switch" button to fetch and apply adoption commands.
     b. Or manually paste adoption commands from the Mist dashboard
        (Organization → Inventory → Switches → Adopt Switches).
  2. If the agent is installed but an old version:
     a. Upgrade the Junos OS firmware via Mist dashboard
        (Switch Details → Utilities → Upgrade Firmware).
     b. Or upgrade manually:
          request system software add <image-url> no-validate reboot

================================================================================
12. MIST AGENT PROCESSES (mcd/jmd)
================================================================================

Command:    ps aux | grep mcd|jmd  (via interactive shell)
Purpose:    Verify the Mist Cloud Daemon (mcd) and Junos Mist Daemon (jmd)
            are running.

Pass:       Both mcd and jmd running.
Warn:       Only one process running.
Fail:       Neither process running.

Inline adopt prompt:
  When this check fails or warns, an "Adopt Switch" button is injected
  directly inside the check result card (below the result text). Clicking it
  opens the Device & Config panel and triggers the adoption workflow
  automatically. The Mist API must be configured for the button to appear;
  otherwise a message is shown to configure credentials first.

Remediation:
  Option 1 — Restart mcd (recommended first step):
  1. Use the "Run Fix" button in the check popup to run:
       restart mcd
     Wait 30 seconds, then use "Run Test Now" to verify.
  2. If mcd won't start, check the logs:
       show log messages | match mcd
       show log mist_agent.log
  3. If jmd is missing, it may need to be reinstalled:
       request extension-service reinstall
     Or for newer Junos versions:
       request extension-service daemonize-restart mcd
  4. Check disk space — insufficient space can prevent processes from
     starting:
       show system storage
     If full, free up space:
       request system storage cleanup

  Option 2 — Adopt Switch (if restart does not resolve or agent was
              never installed):
  Use the "Adopt Switch" button in the check popup (or the inline button
  in the check result card, or the Adopt Switch button in the Device &
  Config panel). This fetches the adoption "set" commands from Mist and
  applies them via the console, reconfiguring the agent from scratch.

  After either option, use "Run Test Now" in the popup to verify.

================================================================================
13. OUTBOUND SSH CONFIGURATION
================================================================================

Command:    show configuration system services outbound-ssh
Purpose:    Verify the outbound-ssh client "mist" is configured.

Pass:       Client "mist" configured with device-id, secret, and target.
Warn:       Configuration exists but missing components.
Fail:       Client "mist" not configured or deactivated.

Remediation:
  1. If not configured, adopt the switch:
     a. Use the "Adopt Switch" button, or
     b. Paste adoption commands from Mist dashboard.
  2. If deactivated, reactivate:
       activate system services outbound-ssh client mist
       commit
  3. If configured but not connecting, try deactivate/reactivate:
       deactivate system services outbound-ssh client mist
       commit
       activate system services outbound-ssh client mist
       commit
  4. If the device-id or secret appears corrupted, delete and re-adopt:
       delete system services outbound-ssh client mist
       commit
     Then re-apply the adoption commands from Mist.
  5. Verify the target host and port match the selected cloud region:
       show configuration system services outbound-ssh client mist
     The target should be oc-term.<cloud>.mist.com or oc-term.mistsys.net.

================================================================================
14. ACTIVE CLOUD CONNECTIONS
================================================================================

Commands:   show system connections | grep <management-ip>
            show host <endpoint>  (for each cloud endpoint FQDN)
Purpose:    Check established TCP connections from the management IP and
            validate destination IPs against resolved Mist cloud FQDNs.

Pass:       Established connections found matching Mist cloud endpoints.
Warn:       Connections exist but don't match known Mist endpoints, or
            connections are in non-established states.
Fail:       No outbound connections from the management IP.

Remediation:
  1. If no connections at all:
     a. Verify the Mist agent is running (test 12).
     b. Verify outbound-ssh is configured and active (test 13).
     c. Try deactivate/reactivate the outbound-ssh client.
  2. If connections are in SYN_SENT state (not establishing):
     a. A firewall is blocking the return traffic (SYN-ACK).
     b. Request the firewall team to allow return traffic for the
        Mist cloud endpoints.
     c. Check for NAT issues — ensure the firewall's NAT table is not
        full or timing out.
  3. If connections are in FIN_WAIT or CLOSE_WAIT:
     a. The connection was established but has been terminated.
     b. This may indicate a timeout or firewall session timeout issue.
     c. Try restarting mcd:
          restart mcd
  4. If connections exist but don't match Mist endpoints:
     a. The switch may be connecting to the wrong cloud region.
     b. Verify the outbound-ssh target matches your cloud (test 13).
     c. DNS may be returning different IPs — this is normal for AWS/GCP
        load balancers but the IPs should still resolve from the same
        FQDNs.
  5. If connections are ESTABLISHED but the switch shows disconnected
     in Mist:
     a. There may be a cloud-side issue. Check the Mist dashboard for
        alerts.
     b. The device-id in the outbound-ssh config may not match any org.
        Delete and re-adopt the switch.

================================================================================
IDENTIFY SWITCH
================================================================================

The "Identify Switch" button reads the switch hostname, serial number, MAC
address, model, and Junos version from the console, then searches the Mist
inventory for a matching device.

Outcomes:
  Found      — Switch is in Mist inventory. Config Drift and Offline Timeline
               buttons are enabled.
  Not found  — Switch is not in the Mist inventory. Two options are presented:

    1. Claim code — go to Mist → Organization → Inventory → Add Devices and
       enter the claim code printed on the switch label (or LCD). This links
       the switch to the org without console access.

    2. Adopt via console — an inline "Adopt Switch" button appears directly
       below the not-found message. Clicking it opens the Device & Config
       panel and triggers the adoption workflow, which fetches the adoption
       "set" commands from the Mist API and applies them via the console.

  No API     — Mist API credentials are not configured. Configure cloud,
               token, and org ID in the Mist API panel and load sites first.

After adoption, run "Identify Switch" again to confirm the switch now appears
in the inventory.

================================================================================
CLI MODE DETECTION
================================================================================

On every serial connect the tool automatically detects the current CLI mode
by sending Enter and inspecting the resulting prompt.

Modes detected:
  operational  >   Normal Junos CLI — most troubleshooting commands run here.
  config       #   Configuration mode — type "exit" to return to operational.
  shell        %   Unix shell — type "cli" to enter Junos.
  login            Login prompt — enter username/password to continue.
  unknown          No recognisable prompt — press Enter in the terminal.

A popup appears immediately with:
  • A colour-coded badge showing the detected mode.
  • A short note explaining what to do to reach operational mode.
  • A reference table listing all five modes with prompt examples and
    navigation instructions.

The modal can be dismissed by clicking the X, pressing Escape, clicking
outside the modal, or clicking "Got it".

The ? button in the top-right header re-opens this modal at any time.
If the serial port is not connected the modal shows the reference table
immediately (no detection attempt is made).

================================================================================
LOGIN FLOW
================================================================================

The Login to Switch button handles these scenarios:

  1. Already logged in (> or # prompt) — no action needed.
  2. At shell prompt (%) — sends 'cli' to enter Junos.
  3. Factory default (root, no password) — logs in, warns that root
     password must be set before committing config.
  4. Password required — fetches root password from Mist (template then
     site settings) via API. If unavailable, prompts user.

GET ROOT PASSWORD button:
  • Enabled as soon as the Mist API is configured and a site is selected.
    Does NOT require the switch to be identified or even connected.
  • Lookup order:
      1. Switch template assigned to the site (networktemplate_id in site
         settings → /api/v1/orgs/{orgId}/networktemplates/{templateId}).
      2. Site-level switch_mgmt.root_password in site settings.
  • All found passwords are displayed with their source label
    (e.g. "Switch Template: "Corp-Template"" or "Site Settings").
  • If the site has no template or no password is set, guidance is shown.

Remediation for login failures:
  1. If factory default, set a root password before any config changes:
       set system root-authentication plain-text-password
       <enter password twice>
       commit
  2. If Mist password is rejected:
     a. The site root password in Mist may differ from what is on the
        switch (e.g. if the switch was zeroized and re-configured).
     b. If you have physical access, try console access with no password
        (factory default) after zeroizing:
          request system zeroize
        WARNING: This erases all configuration.
  3. If no Mist API configured:
     a. Set up the Mist API section (cloud, token, org ID, site).
     b. Ensure the site has a root password configured in:
        Organization → Switch Templates → (template) → Switch Management
        — or —
        Organization → Site Configuration → Switch Management.

================================================================================
CRITICAL GATE LOGIC
================================================================================

  0. Root Password — skips all remaining if no root password is configured.
  4. Management IP Address — skips all remaining if no IP.
  6. Default Gateway — skips DNS and cloud checks if no route.
  8. DNS Resolution — skips endpoint checks if DNS fails.

Skipped checks show a dash (—) with the reason. This avoids wasting time on
checks that cannot possibly succeed.

Note: STP blocking (test 3c) is not a hard gate — the checks continue so that
the full picture of why there is no IP can be seen. If the port is STP blocked
the Management IP check will fail, which is expected. Fix the STP issue first
then re-run the full suite.
