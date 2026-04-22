# Cloud Status Canonical Model

This file is the human-readable canonical definition for switch-reported cloud
states.

It is intended to hold, in one place:

- state identity and operator-facing meaning
- recommended checks and workflow guidance
- remediation guidance
- parser anchor strategy
- parser timestamp rules
- parser evidence fields

The format is Markdown for humans, with one YAML block per state so it can be
parsed later if we choose to make this file the runtime source.

At present, the cloud-state runtime model derives from this file for state
identity, severity, workflow guidance, recommended checks, remediation,
parser anchor strategy, primary timestamp source, evidence fields, and parser
provenance or confidence metadata.

## Global Rules

```yaml
model_version: 1
canonical_owner: cloud_status
ui_rules:
  timestamp_display_timezone: browser_local
  timestamp_display_note: >
    All timestamps shown in the UI should be rendered in the browser's local
    timezone, regardless of whether the source was Mist API or mcd log JSON.
timestamp_sources:
  disconnect_reason:
    source: ccstate.go:511 / ccstate.go:574 JSON timestamp
    meaning: authoritative time of the disconnect reason recorded by mcd
  mist_last_seen:
    source: Mist API device stats last_seen
    meaning: last time Mist reported seeing the switch
  event_sent_transition:
    source: mcd disconnect history
    meaning: >
      locate the most recent event_sent:true, then the first later
      event_sent:false to identify the first unsent disconnect after the last
      successfully reported event
anchor_strategies:
  mist_last_seen_then_event_sent:
    order:
      - nearest retained disconnect cycle to Mist last_seen
      - event_sent transition fallback
      - current live mcd window only
  event_sent_then_current:
    order:
      - event_sent transition history
      - current live mcd window only
  current_window_only:
    order:
      - current live mcd window only
parser_output_rules:
  - prefer clean evidence rows over raw log fragments
  - group evidence by cloud-state semantics, not just line type
  - show mcd's actual tests where they add value beyond existing live checks
  - keep raw console output available as supporting evidence, not the primary summary
evidence_profiles:
  foundation_stage:
    - management_ip
    - default_gateway
    - gateway_reachability
  dns_stage:
    - management_ip
    - default_gateway
    - gateway_reachability
    - dns_server
    - mist_hostname_lookup
    - fallback_dns_lookup
    - fallback_resolver_probe
    - resolver_library_result
  cloud_stage:
    - management_ip
    - default_gateway
    - gateway_reachability
    - dns_server
    - mist_hostname_lookup
    - fallback_dns_lookup
    - fallback_resolver_probe
    - resolver_library_result
    - cloud_tcp_dial
    - cloud_websocket_dial
    - cached_cloud_endpoint
validation_rules:
  format_validation_meaning: >
    "validated_in_lab" means the log line format or field shape was observed in
    lab switch logs. It does not by itself mean the higher-level interpretation
    has been broadly field validated.
  semantics_validation_meaning: >
    "derived_from_lab_and_prototype" means the interpretation comes from the
    parser prototype, lab captures, and current implementation work, but still
    needs broader production validation.
  recommended_values:
    - validated_in_lab
    - derived_from_lab_and_prototype
    - needs_more_field_validation
```

## Current Coverage

This matrix tracks where the current runtime model stands today. It is meant as
an implementation status view, not a replacement for the per-state canonical
definitions below.

| State | Label | Current coverage |
| --- | --- | --- |
| `102` | `NoIPAddress` | Real observed sample integrated into runtime evidence model. Card now shows `Management IP: not present` and suppresses downstream dial noise. |
| `103` | `NoDefaultGateway` | Real observed sample integrated into runtime evidence model. Card now shows `Management IP`, `Default gateway: not present`, and suppresses downstream dial noise. |
| `104` | `DefaultGatewayUnreachable` | Real observed sample integrated into runtime evidence model. Card shows `Management IP`, `Default gateway`, and `Gateway reachability: not reachable`, while suppressing downstream cloud dial noise. |
| `105` | `NoDNS` | Canonical parser model exists, but real observed sample coverage is still light. |
| `106` | `DNSLookupFailed` | Strong real observed coverage. DNS-stage evidence model and formatting are actively used in runtime. |
| `108` | `CloudUnreachable` | Real observed cloud-stage coverage. Shared cloud-stage evidence model is active in runtime. |
| `109` | `CloudAuthFailure` | Shared cloud-stage schema is implemented, but real observed auth-specific samples are still lighter than `108`. |
| `110` | `ServiceDown` | Kill-path and service-down evidence model is implemented in runtime. |
| `111` | `Connected` | Connected-state model is implemented, including Mist last-seen and disconnect-delivery context. |
| `112` | `HealthIssue` | Recommendation and provenance are canonical, but parser rules are not yet defined. |
| `113` | `NoDNSResponse` | Shares the live DNS-stage evidence model with `106`; canonical and runtime support are in place. |
| `115` | `SoftwareDownloadFailure` | Recommendation and provenance are canonical, but parser rules are not yet defined. |
| `116` | `SoftwareUpgradeFailure` | Recommendation and provenance are canonical, but parser rules are not yet defined. |
| `151` | `DuplicateIPAddress` | Canonical parser model exists, but real observed sample coverage is still limited. |

### Coverage Notes

- Strongest real-sample-backed runtime patterns today: `102`, `103`, `104`, `106`, `108`, `110`, `111`, `113`.
- Present in the canonical/runtime model but still lighter on real observed samples: `105`, `109`, `151`.
- Canonical recommendation-only for now: `112`, `115`, `116`.
- Known runtime references without full canonical state entries yet: `107`, `114`.

## State 102

```yaml
code: 102
label: NoIPAddress
title: No management IP address
severity: fail
summary: The switch has no IP address on the management interface.
implication: >
  This is usually a local uplink, VLAN, or DHCP problem. Cloud checks will not
  be meaningful until the switch gets an IP.
workflow_recommendation: targeted
workflow_note: >
  Start with local IP acquisition checks. Full cloud troubleshooting is
  premature until the switch has a management IP.
checks:
  - id: mgmt-ip
    label: Interface IP Summary
    why: Confirm which IPv4 interfaces have addresses and whether DHCP appears to be involved.
  - id: dhcp-lease
    label: DHCP Lease Details
    why: See whether DHCP is configured and whether a lease was offered.
  - id: vlan-config
    label: VLAN Configuration
    why: Verify the management VLAN is present on the uplink.
  - id: port-status
    label: Uplink Port Status
    why: Check whether the uplink is physically up.
remediation:
  - If DHCP is intended, renew the lease on the management IRB and recheck the address.
  - Verify the upstream trunk allows the management VLAN and that the IRB is not admin down.
  - If static IP is intended, confirm the IRB address is configured and committed.
parser:
  anchor_strategy: current_window_only
  primary_timestamp_source: disconnect_reason
  provenance:
    format_validation: validated_in_lab
    semantics_validation: derived_from_lab_and_prototype
  evidence_fields:
    - key: management_ip
      label: Management IP
      description: Whether mcd saw a management IP on the switch.
    - key: mcd_conclusion
      label: mcd conclusion
      description: State-level explanation from the parser.
```

## State 103

```yaml
code: 103
label: NoDefaultGateway
title: No default gateway
severity: fail
summary: The switch has a management IP but no usable default route.
implication: >
  This is usually a DHCP Option 3 issue or a missing static route. Off-subnet
  cloud traffic cannot leave the switch.
workflow_recommendation: targeted
workflow_note: >
  Resolve gateway acquisition first. DNS and cloud checks add little value
  until the switch can forward traffic off-subnet.
checks:
  - id: default-route
    label: Default Routes
    why: Confirm whether active default routes exist at all.
  - id: dhcp-lease
    label: DHCP Lease Details
    why: Check whether DHCP delivered a gateway option.
  - id: mgmt-ip
    label: Interface IP Summary
    why: Confirm which routed IPv4 interfaces exist before reviewing default routes.
  - id: arp
    label: Gateway Reachability
    why: Check whether the discovered gateway path looks reachable via ARP or ping.
remediation:
  - If DHCP is intended, verify the server is sending Option 3 and renew the lease.
  - If static routing is intended, add or correct the default route.
  - Verify the gateway IP is on the same subnet as the management address.
parser:
  anchor_strategy: current_window_only
  primary_timestamp_source: disconnect_reason
  provenance:
    format_validation: validated_in_lab
    semantics_validation: derived_from_lab_and_prototype
  evidence_fields:
    - key: management_ip
      label: Management IP
      description: The management IP mcd used for the cycle.
    - key: default_gateway
      label: Default gateway
      description: The default gateway mcd expected to use.
    - key: mcd_conclusion
      label: mcd conclusion
      description: State-level explanation from the parser.
```

## State 104

```yaml
code: 104
label: DefaultGatewayUnreachable
title: Default gateway unreachable
severity: fail
summary: The switch has an IP and route, but it cannot actually reach the gateway.
implication: >
  This usually points to a Layer 2 adjacency problem such as VLAN mismatch,
  missing trunk membership, ARP failure, or physical errors.
workflow_recommendation: targeted_then_full
workflow_note: >
  Start with the Layer 2 checks above. Escalate to the full workflow only if
  those look clean and the gateway is still unreachable.
checks:
  - id: arp
    label: Gateway Reachability
    why: See whether the discovered default-route gateway looks reachable at all.
  - id: port-status
    label: Uplink Port Status
    why: Confirm the uplink is up before chasing routing issues.
  - id: interface-errors
    label: Uplink Interface Errors
    why: Look for physical-layer trouble like CRC or framing errors.
  - id: vlan-config
    label: VLAN Configuration
    why: Check whether the management VLAN is actually on the uplink.
remediation:
  - If the gateway does not appear in ARP, verify the correct VLAN is present on the uplink and upstream switch.
  - If interface errors are rising, inspect cabling or optics before changing config.
  - If upstream is Mist-managed, compare the upstream port profile against the local uplink config.
parser:
  anchor_strategy: current_window_only
  primary_timestamp_source: disconnect_reason
  provenance:
    format_validation: validated_in_lab
    semantics_validation: derived_from_lab_and_prototype
  evidence_fields:
    - key: management_ip
      label: Management IP
      description: The management IP mcd used for the cycle.
    - key: default_gateway
      label: Default gateway
      description: The gateway mcd tried to reach.
    - key: gateway_reachability
      label: Gateway reachability
      description: Whether mcd could reach the default gateway.
    - key: mcd_conclusion
      label: mcd conclusion
      description: State-level explanation from the parser.
```

## State 105

```yaml
code: 105
label: NoDNS
title: No DNS servers configured
severity: fail
summary: The switch can reach the gateway but has no DNS servers configured.
implication: >
  This is usually a missing DHCP Option 6 or missing static name-server config
  rather than a broader cloud outage.
workflow_recommendation: targeted
workflow_note: >
  This is usually a small configuration gap. Resolve DNS configuration before
  running broader cloud troubleshooting.
checks:
  - id: dns-config
    label: DNS Configuration
    why: Confirm there are no name servers configured on the switch.
  - id: dhcp-lease
    label: DHCP Lease Details
    why: Check whether the lease includes DNS servers.
remediation:
  - If DHCP is intended, verify the server is sending DNS options and renew the lease.
  - If static DNS is intended, add the required name-server entries.
  - Confirm the chosen DNS servers are reachable from the management VLAN.
parser:
  anchor_strategy: current_window_only
  primary_timestamp_source: disconnect_reason
  provenance:
    format_validation: validated_in_lab
    semantics_validation: derived_from_lab_and_prototype
  evidence_fields:
    - key: dns_server
      label: DNS server
      description: Resolver IP mcd tried to use.
    - key: mcd_conclusion
      label: mcd conclusion
      description: State-level explanation from the parser.
```

## State 106

```yaml
code: 106
label: DNSLookupFailed
title: DNS lookup failed
severity: fail
summary: DNS servers are configured, but Mist hostnames are not resolving successfully.
implication: >
  The DNS servers may be wrong, unreachable, or blocked for DNS queries. The
  cloud path itself may still be fine once name resolution is fixed.
workflow_recommendation: targeted
workflow_note: >
  Target the DNS path first. Do not run endpoint or certificate checks until
  name resolution is working again.
checks:
  - id: dns-config
    label: DNS Configuration
    why: Check whether the configured DNS server IPs look correct.
  - id: dns-server-reachability
    label: DNS Server Reachability
    why: Verify that at least one configured DNS server is reachable from the switch before attempting lookups.
  - id: dns-resolution
    label: DNS Resolution
    why: Test whether lookups fail generally or only for Mist domains once reachable DNS servers are confirmed.
remediation:
  - If the configured DNS servers are wrong or unreachable, correct them or add a known-good fallback.
  - If DHCP supplies resolver IPs, consider request dhcp client renew all to refresh stale leased DNS servers.
  - If resolver IPs are reachable but lookups still fail, focus on upstream DNS transport blocking such as UDP or TCP 53 policy.
  - If public lookups work but Mist domains do not, focus on selective filtering, split-DNS, or upstream policy affecting Mist hostnames.
parser:
  anchor_strategy: mist_last_seen_then_event_sent
  primary_timestamp_source: disconnect_reason
  provenance:
    format_validation: validated_in_lab
    semantics_validation: derived_from_lab_and_prototype
  evidence_fields:
    - key: management_ip
      label: Management IP
      description: The management IP mcd used for the cycle.
    - key: default_gateway
      label: Default gateway
      description: The gateway mcd found before DNS checks.
    - key: gateway_reachability
      label: Gateway reachability
      description: Whether mcd proved the default gateway was reachable.
    - key: dns_server
      label: DNS server
      description: Resolver IP mcd used for the DNS attempt.
    - key: mist_hostname_lookup
      label: Mist hostname lookup
      description: The primary Mist FQDN lookup result from mcd.
    - key: fallback_dns_lookup
      label: Fallback DNS lookup
      description: The public-domain fallback lookup mcd attempted.
    - key: fallback_resolver_probe
      label: Fallback resolver probe
      description: The explicit fallback resolver reachability test mcd recorded.
    - key: resolver_library_result
      label: Resolver library result
      description: The lower-level resolver error mcd recorded for the lookup.
    - key: mcd_conclusion
      label: mcd conclusion
      description: Parser conclusion based on the DNS-stage evidence.
```

## State 108

```yaml
code: 108
label: CloudUnreachable
title: Mist cloud unreachable
severity: fail
summary: The local IP, gateway, and DNS chain may be working, but the switch cannot establish the Mist cloud connection.
implication: >
  This usually points to firewall policy, routing, SSL inspection, or upstream
  reachability rather than a purely local config issue.
workflow_recommendation: full
workflow_note: >
  Run the full troubleshooting workflow here. This state sits high in the
  chain and benefits from a complete baseline before changing policy or path.
checks:
  - id: route-to-mist
    label: Route to Mist Endpoints
    why: Confirm the switch knows how to reach the Mist path.
  - id: cloud-connections
    label: Active Cloud Connections
    why: See whether any live TCP sessions to Mist exist.
  - id: fw-check
    label: Firewall Policy Check
    why: Detect blocked TCP 443 or SSL interception.
  - id: traceroute-to-mist
    label: Traceroute to Mist
    why: Show where along the path traffic stops responding when the cloud is unreachable.
  - id: outbound-ssh-config
    label: Outbound SSH Config
    why: Verify the registration path is configured as expected.
remediation:
  - If TCP 443 is blocked, permit outbound Mist traffic through the upstream firewall or proxy.
  - If SSL inspection is detected, bypass Mist traffic so pinned certificates are not intercepted.
  - If route-to-mist is wrong or missing, fix the default route or upstream path before retrying cloud checks.
parser:
  anchor_strategy: mist_last_seen_then_event_sent
  primary_timestamp_source: disconnect_reason
  provenance:
    format_validation: validated_in_lab
    semantics_validation: needs_more_field_validation
  evidence_fields:
    - key: management_ip
      label: Management IP
      description: The management IP mcd used for the cycle.
    - key: default_gateway
      label: Default gateway
      description: The gateway mcd found before cloud dial attempts.
    - key: gateway_reachability
      label: Gateway reachability
      description: Whether mcd proved the default gateway was reachable.
    - key: dns_server
      label: DNS server
      description: Resolver IP mcd used before the cloud connection attempt.
    - key: mist_hostname_lookup
      label: Mist hostname lookup
      description: The primary Mist FQDN lookup result from mcd.
    - key: fallback_dns_lookup
      label: Fallback DNS lookup
      description: The public-domain fallback lookup mcd attempted.
    - key: fallback_resolver_probe
      label: Fallback resolver probe
      description: The explicit fallback resolver reachability test mcd recorded.
    - key: resolver_library_result
      label: Resolver library result
      description: The lower-level resolver error mcd recorded for the lookup.
    - key: cloud_tcp_dial
      label: Cloud TCP dial
      description: The TCP endpoint mcd attempted to dial.
    - key: cloud_websocket_dial
      label: Cloud websocket dial
      description: The websocket or HTTP path mcd attempted.
    - key: cached_cloud_endpoint
      label: Cached cloud endpoint
      description: Any cached cloud endpoint mcd reused during recovery.
    - key: mcd_conclusion
      label: mcd conclusion
      description: Parser conclusion based on the cloud-stage evidence.
```

## State 109

```yaml
code: 109
label: CloudAuthFailure
title: Cloud authentication failure
severity: fail
summary: The switch can reach Mist cloud endpoints, but authentication or registration is failing.
implication: >
  This is usually an identity, certificate, clock, adoption, or agent-state
  problem rather than a raw transport failure.
workflow_recommendation: targeted
workflow_note: >
  Focus on agent and registration evidence first. Full connectivity
  troubleshooting is usually unnecessary unless lower-layer checks also look wrong.
checks:
  - id: mist-processes
    label: Mist Agent Processes
    why: Confirm the agent daemons are actually running.
  - id: mist-agent
    label: Mist Agent Version
    why: Check whether the installed agent looks current and healthy.
  - id: outbound-ssh-config
    label: Outbound SSH Config
    why: Verify the registration path configuration.
  - id: cloud-connections
    label: Active Cloud Connections
    why: Confirm that TCP sessions are forming even though auth fails.
remediation:
  - If the switch was never adopted or was recently re-added in Mist, retrieve and reapply the adoption settings.
  - If clock drift is suspected, verify NTP and current time before troubleshooting certificates further.
  - If the agent version looks old or inconsistent, validate it against the expected Mist agent version for this switch.
parser:
  anchor_strategy: mist_last_seen_then_event_sent
  primary_timestamp_source: disconnect_reason
  provenance:
    format_validation: validated_in_lab
    semantics_validation: needs_more_field_validation
  evidence_fields:
    - key: management_ip
      label: Management IP
      description: The management IP mcd used for the cycle.
    - key: default_gateway
      label: Default gateway
      description: The gateway mcd found before cloud authentication attempts.
    - key: gateway_reachability
      label: Gateway reachability
      description: Whether mcd proved the default gateway was reachable.
    - key: dns_server
      label: DNS server
      description: Resolver IP mcd used before the auth-stage failure.
    - key: mist_hostname_lookup
      label: Mist hostname lookup
      description: The primary Mist FQDN lookup result from mcd.
    - key: fallback_dns_lookup
      label: Fallback DNS lookup
      description: The public-domain fallback lookup mcd attempted.
    - key: fallback_resolver_probe
      label: Fallback resolver probe
      description: The explicit fallback resolver reachability test mcd recorded.
    - key: resolver_library_result
      label: Resolver library result
      description: The lower-level resolver error mcd recorded for the lookup.
    - key: cloud_tcp_dial
      label: Cloud TCP dial
      description: The TCP endpoint mcd reached before auth failed.
    - key: cloud_websocket_dial
      label: Cloud websocket dial
      description: The websocket or auth path mcd attempted.
    - key: cached_cloud_endpoint
      label: Cached cloud endpoint
      description: Any cached cloud endpoint mcd reused during recovery.
    - key: mcd_conclusion
      label: mcd conclusion
      description: Parser conclusion based on the authentication-stage evidence.
```

## State 110

```yaml
code: 110
label: ServiceDown
title: Mist agent service down
severity: fail
summary: The Mist agent service is not running correctly on the switch.
implication: >
  The switch may still have basic connectivity, but the cloud connection
  cannot come up while the relevant daemons are stopped.
workflow_recommendation: targeted
workflow_note: >
  Treat this as a daemon health problem first. Only escalate into broader path
  checks if the processes recover but connectivity still fails.
checks:
  - id: mist-processes
    label: Mist Agent Processes
    why: Confirm whether the key Mist daemons are stopped.
  - id: mist-agent
    label: Mist Agent Version
    why: Check whether the agent package is installed and what version is present.
  - id: switch-logs
    label: Switch Logs
    why: Look for crash or restart evidence from the switch itself.
  - id: switch-uptime
    label: Switch Uptime
    why: See whether a reboot or restart aligns with the failure.
remediation:
  - If the Mist processes are stopped, restart the Mist agent and watch whether it stays up.
  - If the agent package is missing or wrong, verify the installed software set before retrying cloud registration.
  - If the process crashes immediately, collect switch logs and escalate with the failure evidence.
parser:
  anchor_strategy: event_sent_then_current
  primary_timestamp_source: disconnect_reason
  provenance:
    format_validation: validated_in_lab
    semantics_validation: derived_from_lab_and_prototype
  evidence_fields:
    - key: current_cycle
      label: Current cycle
      description: Whether the latest mcd cycle reflects keep-alive timeout or cloud disconnect recovery.
    - key: mcd_conclusion
      label: mcd conclusion
      description: Parser conclusion based on the kill-path evidence.
```

## State 111

```yaml
code: 111
label: Connected
title: Switch reports healthy connectivity
severity: pass
summary: The switch believes it is connected and authenticated with Mist cloud.
implication: >
  This is the healthy steady state. If the operator still reports trouble, it
  is probably symptom-specific rather than a basic cloud-connectivity failure.
workflow_recommendation: skip
workflow_note: >
  Full troubleshooting is usually unnecessary here. Only run targeted checks
  if the operator reports a specific ongoing issue.
checks:
  - id: cloud-connections
    label: Active Cloud Connections
    why: Confirm that the live cloud sessions match the healthy state.
  - id: mist-last-seen
    label: Mist Last Seen
    why: Cross-check the timing against Mist cloud status if there is a mismatch.
  - id: mist-events
    label: Recent Mist Events
    why: Look for recent instability or flaps if symptoms persist.
remediation:
  - No action is needed if the operator sees no symptoms and Mist also looks healthy.
  - If Mist and JMA disagree temporarily, refresh and compare timestamps before making changes.
  - If symptoms persist, run only the targeted checks relevant to that symptom rather than the full workflow.
parser:
  anchor_strategy: mist_last_seen_then_event_sent
  primary_timestamp_source: mist_last_seen
  provenance:
    format_validation: validated_in_lab
    semantics_validation: needs_more_field_validation
  evidence_fields:
    - key: mist_last_seen
      label: Mist last seen
      description: The latest Mist cloud observation for the matched switch.
    - key: disconnect_delivery
      label: Disconnect delivery
      description: Whether the last disconnect reason was sent to Mist before reconnect.
    - key: mcd_conclusion
      label: mcd conclusion
      description: Parser conclusion for the currently connected state.
```

## State 112

```yaml
code: 112
label: HealthIssue
title: Connected but unhealthy
severity: warn
summary: The switch appears connected to Mist but is reporting an internal health problem.
implication: >
  This is usually a degraded or partial state where the session exists, but
  the agent or daemon health needs attention.
workflow_recommendation: optional
workflow_note: >
  Start with the agent-health checks. Full troubleshooting can add context,
  but it is not usually the first move.
checks:
  - id: mist-processes
    label: Mist Agent Processes
    why: Check whether the agent daemons are both up and stable.
  - id: cloud-connections
    label: Active Cloud Connections
    why: Confirm the session is actually present while the switch reports a health issue.
  - id: mist-events
    label: Recent Mist Events
    why: Look for anomaly or degradation events from Mist.
  - id: switch-logs
    label: Switch Logs
    why: Inspect local error evidence tied to the health issue.
remediation:
  - If one daemon is missing or flapping, restart it and check whether the health state clears.
  - If both daemons are running but health remains degraded, gather logs and recent events before escalating.
  - Correlate the issue start time with recent reboots, config changes, or upgrade events.
parser:
  anchor_strategy: not_defined_yet
  primary_timestamp_source: not_defined_yet
  provenance:
    format_validation: validated_in_lab
    semantics_validation: needs_more_field_validation
  evidence_fields: []
```

## State 113

```yaml
code: 113
label: NoDNSResponse
title: No DNS response
severity: fail
summary: DNS servers are configured, but the switch is not getting any response from them.
implication: >
  This is usually a path problem to the DNS servers rather than a pure
  name-resolution failure. The servers may be unreachable or blocked.
workflow_recommendation: targeted
workflow_note: >
  This is a targeted DNS-path problem. Resolve the reachability issue first,
  then recheck cloud status.
checks:
  - id: dns-config
    label: DNS Configuration
    why: Confirm which DNS servers the switch is trying to use.
  - id: dns-resolution
    label: DNS Resolution & Reachability
    why: See whether the failure is a timeout rather than a negative response.
  - id: route-to-mist
    label: Route to Mist Endpoints
    why: Check that the path toward DNS and Mist is in place.
  - id: fw-check
    label: Firewall Policy Check
    why: Detect blocked DNS or general outbound path problems.
remediation:
  - If the DNS servers are unreachable, verify the route and upstream firewall policy to those server IPs.
  - If you rely on ISP or campus DNS, try a known-good fallback resolver to isolate the issue.
  - If DNS traffic is being blocked, permit the required outbound DNS path before retrying cloud checks.
parser:
  anchor_strategy: mist_last_seen_then_event_sent
  primary_timestamp_source: disconnect_reason
  provenance:
    format_validation: validated_in_lab
    semantics_validation: derived_from_lab_and_prototype
  evidence_fields:
    - key: management_ip
      label: Management IP
      description: The management IP mcd used for the cycle.
    - key: default_gateway
      label: Default gateway
      description: The gateway mcd found before DNS checks.
    - key: gateway_reachability
      label: Gateway reachability
      description: Whether mcd proved the default gateway was reachable.
    - key: dns_server
      label: DNS server
      description: Resolver IP mcd used for the failed query.
    - key: mist_hostname_lookup
      label: Mist hostname lookup
      description: The primary Mist FQDN lookup result from mcd.
    - key: fallback_dns_lookup
      label: Fallback DNS lookup
      description: The public-domain fallback lookup mcd attempted.
    - key: fallback_resolver_probe
      label: Fallback resolver probe
      description: Whether the explicit fallback resolver probe succeeded.
    - key: resolver_library_result
      label: Resolver library result
      description: The lower-level resolver error mcd recorded for the lookup.
    - key: mcd_conclusion
      label: mcd conclusion
      description: Parser conclusion based on the no-response DNS evidence.
```

## State 115

```yaml
code: 115
label: SoftwareDownloadFailure
title: Software download failed
severity: warn
summary: The switch attempted to download software from Mist or its CDN, but the download failed.
implication: >
  Primary cloud connectivity may still work. This often points to CDN path,
  firewall, SSL interception, or storage issues rather than a total cloud outage.
workflow_recommendation: optional
workflow_note: >
  Use targeted cloud-path checks first. Full troubleshooting is usually not
  required unless the switch also looks generally disconnected.
checks:
  - id: fw-check
    label: Firewall Policy Check
    why: Check whether HTTPS traffic to Mist or CDN destinations is blocked or intercepted.
  - id: route-to-mist
    label: Route to Mist Endpoints
    why: Confirm the switch has a valid path toward download destinations.
  - id: cloud-connections
    label: Active Cloud Connections
    why: See whether the primary Mist session is healthy despite the failed download.
  - id: mist-events
    label: Recent Mist Events
    why: Look for upgrade or download events from the cloud side.
remediation:
  - If SSL interception is present, bypass Mist and CDN traffic so downloads are not modified in transit.
  - If outbound HTTPS to the relevant destinations is blocked, update the firewall policy before retrying.
  - If repeated download failures occur despite a healthy cloud session, check local storage and previous upgrade artifacts.
parser:
  anchor_strategy: not_defined_yet
  primary_timestamp_source: not_defined_yet
  provenance:
    format_validation: validated_in_lab
    semantics_validation: needs_more_field_validation
  evidence_fields: []
```

## State 116

```yaml
code: 116
label: SoftwareUpgradeFailure
title: Software upgrade failed
severity: warn
summary: An upgrade was attempted, but it did not complete successfully.
implication: >
  This is more of a lifecycle and evidence problem than a straight
  connectivity problem. Logs and reboot history matter more than broad cloud checks.
workflow_recommendation: targeted
workflow_note: >
  Focus on logs and lifecycle evidence first. Full cloud troubleshooting
  usually adds little unless the switch is also generally offline afterward.
checks:
  - id: switch-uptime
    label: Switch Uptime
    why: Check whether the device rebooted during the failed upgrade.
  - id: switch-logs
    label: Switch Logs
    why: Look for install, partition, or reboot-related errors.
  - id: mist-last-seen
    label: Mist Last Seen
    why: Compare when Mist last saw the device against the upgrade window.
  - id: mist-agent
    label: Mist Agent Version
    why: Confirm the current post-failure software and agent state.
remediation:
  - Start with lifecycle evidence: logs, uptime, and current version before changing network configuration.
  - If the switch looks stuck after an upgrade, treat it as a recovery problem and keep console access as the control path.
  - If storage or package state looks suspect, verify local disk usage and installed software before retrying.
parser:
  anchor_strategy: not_defined_yet
  primary_timestamp_source: not_defined_yet
  provenance:
    format_validation: validated_in_lab
    semantics_validation: needs_more_field_validation
  evidence_fields: []
```

## State 151

```yaml
code: 151
label: DuplicateIPAddress
title: Duplicate management IP detected
severity: fail
summary: The switch has detected an IP conflict on its management address.
implication: >
  Another device is answering for the same IP, which can cause intermittent
  reachability, ARP instability, and misleading cloud symptoms.
workflow_recommendation: targeted
workflow_note: >
  Treat this as a specific IP-conflict issue first. Broad troubleshooting adds
  limited value until the conflict is removed.
checks:
  - id: mgmt-ip
    label: Interface IP Summary
    why: Confirm the current IPv4 addresses and any DHCP-configured interfaces.
  - id: arp
    label: Gateway Reachability
    why: Look for whether the management gateway path actually appears reachable.
  - id: vlan-config
    label: VLAN Configuration
    why: Confirm the management VLAN scope is what you expect.
  - id: interface-errors
    label: Uplink Interface Errors
    why: Rule out physical instability while investigating the conflict.
remediation:
  - Identify the conflicting device and resolve the overlapping IP assignment before chasing cloud symptoms.
  - If DHCP is in use, check for pool overlap or a collision with a statically assigned device.
  - Once the conflict is cleared, renew or recommit the management IP and recheck the gateway path.
parser:
  anchor_strategy: current_window_only
  primary_timestamp_source: disconnect_reason
  provenance:
    format_validation: validated_in_lab
    semantics_validation: derived_from_lab_and_prototype
  evidence_fields:
    - key: management_ip
      label: Management IP
      description: The conflicting management IP mcd observed.
    - key: mcd_conclusion
      label: mcd conclusion
      description: Parser conclusion based on the duplicate-IP evidence.
```

## Known but Not Yet Modeled Here

```yaml
known_state_codes_without_full_canonical_entry:
  - 107
  - 114
note: >
  These codes exist in current parser/runtime references but do not yet have a
  full operator recommendation record in the consolidated model.
```
