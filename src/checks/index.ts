/**
 * index.ts — Barrel export for all modular checks.
 *
 * Import order reflects the logical run sequence in TroubleshootService.runAll().
 * Factory functions (endpoint-reachability, ssl-certificate, traceroute) are not
 * instantiated here — callers create per-endpoint instances as needed.
 */

// --- Base types ---
export type { Check, CheckContext, CheckResult, CheckStatus } from './base';

// --- Uplink / Layer 1-2 checks ---
export { lldpCheck } from './lldp.check';
export type { LldpCheckResult } from './lldp.check';
export { portStatusCheck } from './port-status.check';
export { interfaceErrorsCheck } from './interface-errors.check';
export { vlanConfigCheck } from './vlan-config.check';

// --- Layer 3 / IP checks ---
export { interfaceIpCheck } from './interface-ip.check';
export type { InterfaceIpCheckResult } from './interface-ip.check';
export { dhcpLeaseCheck } from './dhcp-lease.check';
export { arpCheck } from './arp.check';
export { defaultRouteCheck } from './default-route.check';

// --- DNS checks ---
export { dnsConfigCheck } from './dns-config.check';
export { dnsResolutionCheck } from './dns-resolution.check';

// --- Cloud reachability checks ---
export { routeToMistCheck } from './route-to-mist.check';
export { endpointReachabilityCheck } from './endpoint-reachability.check';
export { sslCertificateCheck } from './ssl-certificate.check';
export { tracerouteCheck } from './traceroute.check';

// --- Mist agent checks ---
export { mistAgentVersionCheck } from './mist-agent-version.check';
export { mistAgentProcessesCheck } from './mist-agent-processes.check';
export { outboundSshCheck } from './outbound-ssh.check';
export type { OutboundSshCheckResult } from './outbound-ssh.check';
export { activeConnectionsCheck } from './active-connections.check';

// --- Offline timeline (multi-result, not a single Check) ---
export { runOfflineTimeline } from './offline-timeline.check';
