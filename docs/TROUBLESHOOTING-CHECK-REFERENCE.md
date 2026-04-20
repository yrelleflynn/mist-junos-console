# MIST JUNOS CONSOLE

Browser-based serial console and guided recovery workspace for
Juniper Mist-managed switches running Junos.

## WHAT IT IS

mist-junos-console is a single-page web application that runs in Chrome or Edge
using the Web Serial API. It gives an operator a complete recovery workspace for
an offline, unadopted, or misconfigured Mist-managed EX switch — without
installing any software, opening a separate terminal, or manually cross-referencing
the Mist dashboard.

Core capabilities:
  - Web Serial console terminal (xterm, Junos syntax highlighting)
  - Automatic device identification matched against Mist inventory
  - JMA Connectivity State monitoring (switch-reported cloud state)
  - Mist Status monitoring (last-known cloud state from Mist)
  - 14-check automated cloud connectivity troubleshooting
  - Config drift comparison (Mist intended vs live running config)
  - Staged config sync with operator-gated Commit Confirmed, Commit, and Rollback
  - Remote session mirroring for shared support sessions

## THE PROBLEM IT SOLVES

When a Mist-managed switch goes offline, the current workflow is slow and
fragmented: physical console access, a separate terminal application, manual
Mist context lookup, tribal-knowledge troubleshooting, and manual command
construction for any remediation. Less experienced operators escalate. Recovery
takes 30-60 minutes per switch.

This tool collapses that into a single browser tab. The operator connects the
cable, opens the app, and has structured diagnostics and guided remediation in
one place — without deep Junos expertise.

## ARCHITECTURE

Frontend (browser):
  - src/main.ts         — UI orchestration and workflow wiring
  - src/components/terminal.component.ts — xterm terminal wrapper and render path
  - src/services/       — Modular workflow services:
      troubleshoot.service.ts   — 14-check connectivity diagnostic engine
      config-sync.service.ts    — Staged config sync with commit/rollback
      config-drift.service.ts   — Mist intent vs live config comparison
      switch-identity.service.ts — Switch identification and Mist matching
      command-runner.service.ts  — Console command execution, prompt, and mode handling
  - src/controllers/    — Shared session and device workflow controllers:
      cloud-status.controller.ts — Mist status and JMA state orchestration
      device-context.controller.ts — Device identity and Mist match state
  - index.html          — UI layout
  - src/styles/main.css — Styling

Backend (Node/Express):
  - server/index.mjs    — Mist API proxy, WebSocket relay for remote sessions
  - Proxies Mist REST calls (config, stats, events, adoption commands)
  - Manages session state and remote participant connections
  - Exposes /mcp/session-state and /mcp/agent-context for MCP POC integration

MCP server (standalone, Phase 1 POC):
  - mcp/server.ts       — Read-only MCP server for AI agent access
  - Tools: get_session_summary, get_device_identity, get_jma_connectivity_state,
            get_check_results, get_device_config (fully wired via Mist proxy)
  - See docs/BACKEND-MCP-POC.md for setup and current status

## SETUP

Requirements:
  - Node.js 18+
  - Chrome or Edge (Web Serial API required; Firefox not supported)
  - USB-to-serial cable connected to an EX switch console port
  - Mist API token with org/site/device read access

Install and run:
  npm install
  npm run build
  npm start

Open http://localhost:3000 in Chrome or Edge.

Configure in the app settings panel:
  - Mist cloud (api.mist.com or EU/staging equivalent)
  - API token
  - Organization

The site and device are discovered automatically after identification.

## EXAMPLE OPERATOR WORKFLOW

1. Connect USB serial cable to EX switch console port.
2. Open the app in Chrome, click Connect, select the serial port.
3. Log in to the switch if prompted (use root password from Mist site settings).
4. Click Identify Device — the tool matches the switch to Mist inventory.
5. Observe JMA Connectivity State and Mist Status in the session header.
6. Click Run Troubleshoot — 14 checks run in sequence.
   - Gated checks skip automatically if a prerequisite fails.
   - Each failed check shows what was found, what was expected, and remediation.
7. Click Config Drift to compare Mist-intended config to live running config.
8. Click Config Sync to stage the Mist diff as a candidate:
   - The tool runs show | compare and commit check.
   - The candidate is left staged on the switch.
   - Choose Commit Confirmed (5-min auto-rollback), Commit, or Rollback.
9. Observe the session header — Mist Status updates to connected after a
   successful commit.

## EXAMPLE OUTPUTS

Troubleshooting check (failed gateway):
  [FAIL] Default Gateway
  Expected: A default route in the routing table.
  Found: No inet.0 default route.
  Skipped downstream: DNS Resolution, Route to Mist Endpoints, Firewall Policy
  Remediation: Verify DHCP lease, check gateway config on uplink, renew DHCP.

Config drift (missing VLAN):
  Mist intent includes:
    set vlans MGMT vlan-id 100
    set interfaces irb unit 100 family inet address 10.1.1.10/24
  Running config is missing both lines.

Config sync staged:
  show | compare output:
    [edit vlans]
    + MGMT { vlan-id 100; }
    [edit interfaces irb]
    + unit 100 { family inet { address 10.1.1.10/24; } }
  commit check: configuration check succeeds
  Candidate staged — choose Commit Confirmed, Commit, or Rollback.

## JUNOS CONSOLE — CLOUD CONNECTIVITY CHECK: TEST REFERENCE

This section describes each automated test, what it checks, why it
matters, what pass/fail means, and recommended remediation steps.
These remediation steps form the basis for future automated fixes.

### 1. LLDP NEIGHBORS

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

### 2. UPLINK PORT STATUS

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

### 2b. UPLINK INTERFACE ERRORS

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

### 3. VLAN CONFIGURATION

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

### 4. MANAGEMENT IP ADDRESS  [CRITICAL]

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

### 4b. DHCP LEASE DETAILS

Command:    show dhcp client binding
            show dhcp client binding detail
Purpose:    Display DHCP lease details if the IP was obtained via DHCP.

Pass:       DHCP lease found with IP, mask, gateway, DNS.
Info:       No DHCP lease or 0.0.0.0 — IP is likely static.

Remediation (if DHCP expected but not working):
  1. Verify the DHCP client is enabled:
       show configuration interfaces irb unit 0
     Should contain "family inet dhcp".
  2. Force the DHCP client to renew its lease:
       request dhcp client renew irb.0
     This is the preferred first-step way to reinitialize DHCP lease
     acquisition on EX switches before changing interface configuration.
  3. If the DHCP client still appears stuck after a renew:
     a. During a maintenance window, remove and re-add the DHCP client
        stanza on the IRB interface to force a deeper reinitialization:
          delete interfaces irb unit 0 family inet dhcp
          commit
          set interfaces irb unit 0 family inet dhcp
          commit
     b. Re-check:
          show dhcp client binding detail
     c. Use this cautiously — Junos DHCP client behavior can be sticky,
        and this is a stronger workaround than a normal renew.
  4. Check if the DHCP server is providing offers:
       monitor traffic interface irb.0 matching "port 67 or port 68"
     Look for DHCP Discover/Offer/Request/Ack.
  5. Verify the VLAN tagging — DHCP may fail if the switch is on the
     wrong VLAN or the uplink isn't carrying the management VLAN.
  6. Check the DHCP scope on the server — ensure it has available
     addresses and the correct subnet/gateway/DNS options.
  7. If DHCP is working but missing gateway or DNS options, update the
     DHCP scope on the server to include:
     - Option 3 (Router/Gateway)
     - Option 6 (DNS Servers)

### 5. ARP TABLE

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

### 6. DEFAULT GATEWAY  [CRITICAL]

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

### 7. DNS CONFIGURATION

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

### 8. DNS RESOLUTION & REACHABILITY  [CRITICAL]

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

### 9. ROUTE TO MIST ENDPOINTS

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

### 10. ENDPOINT TCP REACHABILITY

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

### 10b. SSL CERTIFICATE INSPECTION CHECK

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

### 10c. TRACEROUTE (on failed endpoints only)

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

### 11. MIST AGENT VERSION

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

### 12. MIST AGENT PROCESSES (mcd/jmd)

Command:    ps aux | grep mcd|jmd  (via interactive shell)
Purpose:    Verify the Mist Cloud Daemon (mcd) and Junos Mist Daemon (jmd)
            are running.

Pass:       Both mcd and jmd running.
Warn:       Only one process running.
Fail:       Neither process running.

Remediation:
  1. Restart the Mist agent processes:
       restart mcd
     Wait 30 seconds, then check again.
  2. If mcd won't start, check the logs:
       show log messages | match mcd
       show log mist_agent.log
  3. If jmd is missing, it may need to be reinstalled:
       request extension-service reinstall
     Or for newer Junos versions:
       request extension-service daemonize-restart mcd
  4. Verify the Mist Agent package is installed:
       show version | match mist
     If not present, the switch needs to be adopted (test 11).
  5. Check disk space — insufficient space can prevent processes from
     starting:
       show system storage
     If full, free up space:
       request system storage cleanup

### 13. OUTBOUND SSH CONFIGURATION

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

### 14. ACTIVE CLOUD CONNECTIONS

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

### LOGIN FLOW

The Login to Switch button handles these scenarios:

  1. Already logged in (> or # prompt) — no action needed.
  2. At shell prompt (%) — sends 'cli' to enter Junos.
  3. Factory default (root, no password) — logs in, warns that root
     password must be set before committing config.
  4. Password required — fetches root password from Mist site settings
     via API. If unavailable, prompts user.

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
     b. Ensure the site has a root password configured in
        Organization → Site Configuration → Switch Management.

### CRITICAL GATE LOGIC

  4. Management IP Address — skips all remaining if no IP.
  6. Default Gateway — skips DNS and cloud checks if no route.
  8. DNS Resolution — skips endpoint checks if DNS fails.

Skipped checks show "—" with the reason. This avoids wasting time on
checks that cannot possibly succeed.
