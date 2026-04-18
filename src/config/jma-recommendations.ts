export type JmaWorkflowRecommendation = 'full' | 'targeted_then_full' | 'targeted' | 'optional' | 'skip';

export interface JmaRecommendationCheck {
  id: string;
  label: string;
  why: string;
}

export interface JmaRecommendation {
  code: number;
  label: string;
  title: string;
  summary: string;
  implication: string;
  severity: 'fail' | 'warn' | 'info' | 'pass';
  checks: JmaRecommendationCheck[];
  remediation: string[];
  workflowRecommendation: JmaWorkflowRecommendation;
  workflowNote: string;
}

const RECOMMENDATIONS: Record<number, JmaRecommendation> = {
  102: {
    code: 102,
    label: 'NoIPAddress',
    title: 'No management IP address',
    summary: 'The switch has no IP address on the management interface.',
    implication: 'This is usually a local uplink, VLAN, or DHCP problem. Cloud checks will not be meaningful until the switch gets an IP.',
    severity: 'fail',
    checks: [
      { id: 'mgmt-ip', label: 'Management IP Address', why: 'Confirm that the switch truly has no usable management IP.' },
      { id: 'dhcp-lease', label: 'DHCP Lease Details', why: 'See whether DHCP is configured and whether a lease was offered.' },
      { id: 'vlan-config', label: 'VLAN Configuration', why: 'Verify the management VLAN is present on the uplink.' },
      { id: 'port-status', label: 'Uplink Port Status', why: 'Check whether the uplink is physically up.' },
    ],
    remediation: [
      'If DHCP is intended, renew the lease on the management IRB and recheck the address.',
      'Verify the upstream trunk allows the management VLAN and that the IRB is not admin down.',
      'If static IP is intended, confirm the IRB address is configured and committed.',
    ],
    workflowRecommendation: 'targeted',
    workflowNote: 'Start with the local IP acquisition checks. Full cloud troubleshooting is premature until the switch has a management IP.',
  },
  103: {
    code: 103,
    label: 'NoDefaultGateway',
    title: 'No default gateway',
    summary: 'The switch has a management IP but no usable default route.',
    implication: 'This is usually a DHCP Option 3 issue or a missing static route. Off-subnet cloud traffic cannot leave the switch.',
    severity: 'fail',
    checks: [
      { id: 'default-route', label: 'Default Gateway', why: 'Confirm whether a default route exists at all.' },
      { id: 'dhcp-lease', label: 'DHCP Lease Details', why: 'Check whether DHCP delivered a gateway option.' },
      { id: 'mgmt-ip', label: 'Management IP Address', why: 'Confirm the management subnet is what you expect.' },
      { id: 'arp', label: 'ARP Table', why: 'Check whether the expected gateway appears locally reachable.' },
    ],
    remediation: [
      'If DHCP is intended, verify the server is sending Option 3 and renew the lease.',
      'If static routing is intended, add or correct the default route.',
      'Verify the gateway IP is on the same subnet as the management address.',
    ],
    workflowRecommendation: 'targeted',
    workflowNote: 'Resolve gateway acquisition first. DNS and cloud checks add little value until the switch can forward traffic off-subnet.',
  },
  104: {
    code: 104,
    label: 'DefaultGatewayUnreachable',
    title: 'Default gateway unreachable',
    summary: 'The switch has an IP and route, but it cannot actually reach the gateway.',
    implication: 'This usually points to a Layer 2 adjacency problem such as VLAN mismatch, missing trunk membership, ARP failure, or physical errors.',
    severity: 'fail',
    checks: [
      { id: 'arp', label: 'ARP Table', why: 'See whether the gateway MAC is learned at all.' },
      { id: 'port-status', label: 'Uplink Port Status', why: 'Confirm the uplink is up before chasing routing issues.' },
      { id: 'interface-errors', label: 'Uplink Interface Errors', why: 'Look for physical-layer trouble like CRC or framing errors.' },
      { id: 'vlan-config', label: 'VLAN Configuration', why: 'Check whether the management VLAN is actually on the uplink.' },
    ],
    remediation: [
      'If the gateway does not appear in ARP, verify the correct VLAN is present on the uplink and upstream switch.',
      'If interface errors are rising, inspect cabling or optics before changing config.',
      'If upstream is Mist-managed, compare the upstream port profile against the local uplink config.',
    ],
    workflowRecommendation: 'targeted_then_full',
    workflowNote: 'Start with the Layer 2 checks above. Escalate to the full workflow only if those look clean and the gateway is still unreachable.',
  },
  105: {
    code: 105,
    label: 'NoDNS',
    title: 'No DNS servers configured',
    summary: 'The switch can reach the gateway but has no DNS servers configured.',
    implication: 'This is usually a missing DHCP Option 6 or missing static name-server config rather than a broader cloud outage.',
    severity: 'fail',
    checks: [
      { id: 'dns-config', label: 'DNS Configuration', why: 'Confirm there are no name servers configured on the switch.' },
      { id: 'dhcp-lease', label: 'DHCP Lease Details', why: 'Check whether the lease includes DNS servers.' },
    ],
    remediation: [
      'If DHCP is intended, verify the server is sending DNS options and renew the lease.',
      'If static DNS is intended, add the required name-server entries.',
      'Confirm the chosen DNS servers are reachable from the management VLAN.',
    ],
    workflowRecommendation: 'targeted',
    workflowNote: 'This is usually a small configuration gap. Resolve DNS configuration before running broader cloud troubleshooting.',
  },
  106: {
    code: 106,
    label: 'DNSLookupFailed',
    title: 'DNS lookup failed',
    summary: 'DNS servers are configured, but Mist hostnames are not resolving successfully.',
    implication: 'The DNS servers may be wrong, unreachable, or returning failures. The cloud path itself may still be fine once name resolution is fixed.',
    severity: 'fail',
    checks: [
      { id: 'dns-config', label: 'DNS Configuration', why: 'Check whether the configured DNS server IPs look correct.' },
      { id: 'dns-resolution', label: 'DNS Resolution & Reachability', why: 'Test whether resolution fails outright or the servers are unreachable.' },
      { id: 'route-to-mist', label: 'Route to Mist Endpoints', why: 'Confirm the switch has a route toward the DNS and cloud path.' },
      { id: 'fw-check', label: 'Firewall Policy Check', why: 'Check whether DNS or outbound cloud traffic is being blocked or intercepted.' },
    ],
    remediation: [
      'If the configured DNS servers are wrong or unreachable, correct them or add a known-good fallback.',
      'If DNS reachability fails, verify the route and firewall policy to the DNS server IPs.',
      'If resolution works only intermittently, compare with a public resolver to isolate whether the issue is local or upstream.',
    ],
    workflowRecommendation: 'targeted',
    workflowNote: 'Target the DNS path first. Full workflow is optional if the targeted checks leave the issue ambiguous.',
  },
  108: {
    code: 108,
    label: 'CloudUnreachable',
    title: 'Mist cloud unreachable',
    summary: 'The local IP, gateway, and DNS chain may be working, but the switch cannot establish the Mist cloud connection.',
    implication: 'This usually points to firewall policy, routing, SSL inspection, or upstream reachability rather than a purely local config issue.',
    severity: 'fail',
    checks: [
      { id: 'route-to-mist', label: 'Route to Mist Endpoints', why: 'Confirm the switch knows how to reach the Mist path.' },
      { id: 'cloud-connections', label: 'Active Cloud Connections', why: 'See whether any live TCP sessions to Mist exist.' },
      { id: 'fw-check', label: 'Firewall Policy Check', why: 'Detect blocked TCP 443 or SSL interception.' },
      { id: 'outbound-ssh-config', label: 'Outbound SSH Config', why: 'Verify the registration path is configured as expected.' },
    ],
    remediation: [
      'If TCP 443 is blocked, permit outbound Mist traffic through the upstream firewall or proxy.',
      'If SSL inspection is detected, bypass Mist traffic so pinned certificates are not intercepted.',
      'If route-to-mist is wrong or missing, fix the default route or upstream path before retrying cloud checks.',
    ],
    workflowRecommendation: 'full',
    workflowNote: 'Run the full troubleshooting workflow here. This state sits high in the chain and benefits from a complete baseline before changing policy or path.',
  },
  109: {
    code: 109,
    label: 'CloudAuthFailure',
    title: 'Cloud authentication failure',
    summary: 'The switch can reach Mist cloud endpoints, but authentication or registration is failing.',
    implication: 'This is usually an identity, certificate, clock, adoption, or agent-state problem rather than a raw transport failure.',
    severity: 'fail',
    checks: [
      { id: 'mist-processes', label: 'Mist Agent Processes', why: 'Confirm the agent daemons are actually running.' },
      { id: 'mist-agent', label: 'Mist Agent Version', why: 'Check whether the installed agent looks current and healthy.' },
      { id: 'outbound-ssh-config', label: 'Outbound SSH Config', why: 'Verify the registration path configuration.' },
      { id: 'cloud-connections', label: 'Active Cloud Connections', why: 'Confirm that TCP sessions are forming even though auth fails.' },
    ],
    remediation: [
      'If the switch was never adopted or was recently re-added in Mist, retrieve and reapply the adoption settings.',
      'If clock drift is suspected, verify NTP and current time before troubleshooting certificates further.',
      'If the agent version looks old or inconsistent, validate it against the expected Mist agent version for this switch.',
    ],
    workflowRecommendation: 'targeted',
    workflowNote: 'Focus on agent and registration evidence first. Full connectivity troubleshooting is usually unnecessary unless lower-layer checks also look wrong.',
  },
  110: {
    code: 110,
    label: 'ServiceDown',
    title: 'Mist agent service down',
    summary: 'The Mist agent service is not running correctly on the switch.',
    implication: 'The switch may still have basic connectivity, but the cloud connection cannot come up while the relevant daemons are stopped.',
    severity: 'fail',
    checks: [
      { id: 'mist-processes', label: 'Mist Agent Processes', why: 'Confirm whether the key Mist daemons are stopped.' },
      { id: 'mist-agent', label: 'Mist Agent Version', why: 'Check whether the agent package is installed and what version is present.' },
      { id: 'switch-logs', label: 'Switch Logs', why: 'Look for crash or restart evidence from the switch itself.' },
      { id: 'switch-uptime', label: 'Switch Uptime', why: 'See whether a reboot or restart aligns with the failure.' },
    ],
    remediation: [
      'If the Mist processes are stopped, restart the Mist agent and watch whether it stays up.',
      'If the agent package is missing or wrong, verify the installed software set before retrying cloud registration.',
      'If the process crashes immediately, collect switch logs and escalate with the failure evidence.',
    ],
    workflowRecommendation: 'targeted',
    workflowNote: 'Treat this as a daemon health problem first. Only escalate into broader path checks if the processes recover but connectivity still fails.',
  },
  111: {
    code: 111,
    label: 'Connected',
    title: 'Switch reports healthy connectivity',
    summary: 'The switch believes it is connected and authenticated with Mist cloud.',
    implication: 'This is the healthy steady state. If the operator still reports trouble, it is probably symptom-specific rather than a basic cloud-connectivity failure.',
    severity: 'pass',
    checks: [
      { id: 'cloud-connections', label: 'Active Cloud Connections', why: 'Confirm that the live cloud sessions match the healthy state.' },
      { id: 'mist-last-seen', label: 'Mist Last Seen', why: 'Cross-check the timing against Mist cloud status if there is a mismatch.' },
      { id: 'mist-events', label: 'Recent Mist Events', why: 'Look for recent instability or flaps if symptoms persist.' },
    ],
    remediation: [
      'No action is needed if the operator sees no symptoms and Mist also looks healthy.',
      'If Mist and JMA disagree temporarily, refresh and compare timestamps before making changes.',
      'If symptoms persist, run only the targeted checks relevant to that symptom rather than the full workflow.',
    ],
    workflowRecommendation: 'skip',
    workflowNote: 'Full troubleshooting is usually unnecessary here. Only run targeted checks if the operator reports a specific ongoing issue.',
  },
  112: {
    code: 112,
    label: 'HealthIssue',
    title: 'Connected but unhealthy',
    summary: 'The switch appears connected to Mist but is reporting an internal health problem.',
    implication: 'This is usually a degraded or partial state where the session exists, but the agent or daemon health needs attention.',
    severity: 'warn',
    checks: [
      { id: 'mist-processes', label: 'Mist Agent Processes', why: 'Check whether the agent daemons are both up and stable.' },
      { id: 'cloud-connections', label: 'Active Cloud Connections', why: 'Confirm the session is actually present while the switch reports a health issue.' },
      { id: 'mist-events', label: 'Recent Mist Events', why: 'Look for anomaly or degradation events from Mist.' },
      { id: 'switch-logs', label: 'Switch Logs', why: 'Inspect local error evidence tied to the health issue.' },
    ],
    remediation: [
      'If one daemon is missing or flapping, restart it and check whether the health state clears.',
      'If both daemons are running but health remains degraded, gather logs and recent events before escalating.',
      'Correlate the issue start time with recent reboots, config changes, or upgrade events.',
    ],
    workflowRecommendation: 'optional',
    workflowNote: 'Start with the agent-health checks. Full troubleshooting can add context, but it is not usually the first move.',
  },
  113: {
    code: 113,
    label: 'NoDNSResponse',
    title: 'No DNS response',
    summary: 'DNS servers are configured, but the switch is not getting any response from them.',
    implication: 'This is usually a path problem to the DNS servers rather than a pure name-resolution failure. The servers may be unreachable or blocked.',
    severity: 'fail',
    checks: [
      { id: 'dns-config', label: 'DNS Configuration', why: 'Confirm which DNS servers the switch is trying to use.' },
      { id: 'dns-resolution', label: 'DNS Resolution & Reachability', why: 'See whether the failure is a timeout rather than a negative response.' },
      { id: 'route-to-mist', label: 'Route to Mist Endpoints', why: 'Check that the path toward DNS and Mist is in place.' },
      { id: 'fw-check', label: 'Firewall Policy Check', why: 'Detect blocked DNS or general outbound path problems.' },
    ],
    remediation: [
      'If the DNS servers are unreachable, verify the route and upstream firewall policy to those server IPs.',
      'If you rely on ISP or campus DNS, try a known-good fallback resolver to isolate the issue.',
      'If DNS traffic is being blocked, permit the required outbound DNS path before retrying cloud checks.',
    ],
    workflowRecommendation: 'targeted',
    workflowNote: 'This is a targeted DNS-path problem. Resolve the reachability issue first, then recheck cloud status.',
  },
  115: {
    code: 115,
    label: 'SoftwareDownloadFailure',
    title: 'Software download failed',
    summary: 'The switch attempted to download software from Mist or its CDN, but the download failed.',
    implication: 'Primary cloud connectivity may still work. This often points to CDN path, firewall, SSL interception, or storage issues rather than a total cloud outage.',
    severity: 'warn',
    checks: [
      { id: 'fw-check', label: 'Firewall Policy Check', why: 'Check whether HTTPS traffic to Mist or CDN destinations is blocked or intercepted.' },
      { id: 'route-to-mist', label: 'Route to Mist Endpoints', why: 'Confirm the switch has a valid path toward download destinations.' },
      { id: 'cloud-connections', label: 'Active Cloud Connections', why: 'See whether the primary Mist session is healthy despite the failed download.' },
      { id: 'mist-events', label: 'Recent Mist Events', why: 'Look for upgrade or download events from the cloud side.' },
    ],
    remediation: [
      'If SSL interception is present, bypass Mist and CDN traffic so downloads are not modified in transit.',
      'If outbound HTTPS to the relevant destinations is blocked, update the firewall policy before retrying.',
      'If repeated download failures occur despite a healthy cloud session, check local storage and previous upgrade artifacts.',
    ],
    workflowRecommendation: 'optional',
    workflowNote: 'Use targeted cloud-path checks first. Full troubleshooting is usually not required unless the switch also looks generally disconnected.',
  },
  116: {
    code: 116,
    label: 'SoftwareUpgradeFailure',
    title: 'Software upgrade failed',
    summary: 'An upgrade was attempted, but it did not complete successfully.',
    implication: 'This is more of a lifecycle and evidence problem than a straight connectivity problem. Logs and reboot history matter more than broad cloud checks.',
    severity: 'warn',
    checks: [
      { id: 'switch-uptime', label: 'Switch Uptime', why: 'Check whether the device rebooted during the failed upgrade.' },
      { id: 'switch-logs', label: 'Switch Logs', why: 'Look for install, partition, or reboot-related errors.' },
      { id: 'mist-last-seen', label: 'Mist Last Seen', why: 'Compare when Mist last saw the device against the upgrade window.' },
      { id: 'mist-agent', label: 'Mist Agent Version', why: 'Confirm the current post-failure software and agent state.' },
    ],
    remediation: [
      'Start with lifecycle evidence: logs, uptime, and current version before changing network configuration.',
      'If the switch looks stuck after an upgrade, treat it as a recovery problem and keep console access as the control path.',
      'If storage or package state looks suspect, verify local disk usage and installed software before retrying.',
    ],
    workflowRecommendation: 'targeted',
    workflowNote: 'Focus on logs and lifecycle evidence first. Full cloud troubleshooting usually adds little unless the switch is also generally offline afterward.',
  },
  151: {
    code: 151,
    label: 'DuplicateIPAddress',
    title: 'Duplicate management IP detected',
    summary: 'The switch has detected an IP conflict on its management address.',
    implication: 'Another device is answering for the same IP, which can cause intermittent reachability, ARP instability, and misleading cloud symptoms.',
    severity: 'fail',
    checks: [
      { id: 'mgmt-ip', label: 'Management IP Address', why: 'Confirm the current management address in use.' },
      { id: 'arp', label: 'ARP Table', why: 'Look for unexpected MAC entries related to the management IP or gateway.' },
      { id: 'vlan-config', label: 'VLAN Configuration', why: 'Confirm the management VLAN scope is what you expect.' },
      { id: 'interface-errors', label: 'Uplink Interface Errors', why: 'Rule out physical instability while investigating the conflict.' },
    ],
    remediation: [
      'Identify the conflicting device and resolve the overlapping IP assignment before chasing cloud symptoms.',
      'If DHCP is in use, check for pool overlap or a collision with a statically assigned device.',
      'Once the conflict is cleared, renew or recommit the management IP and recheck the gateway path.',
    ],
    workflowRecommendation: 'targeted',
    workflowNote: 'Treat this as a specific IP-conflict issue first. Broad troubleshooting adds limited value until the conflict is removed.',
  },
};

export function getJmaRecommendation(code: number | null): JmaRecommendation | null {
  if (code == null) return null;
  return RECOMMENDATIONS[code] ?? null;
}

