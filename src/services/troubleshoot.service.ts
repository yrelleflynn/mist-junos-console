/**
 * troubleshoot.service.ts — Cloud connectivity troubleshooting engine
 *
 * Runs a series of Junos CLI checks to determine why a switch
 * cannot connect to the Mist cloud. Checks are run sequentially
 * and results are reported via callbacks.
 */

import { CommandRunnerService, CommandResult } from './command-runner.service';
import { MistApiService, MistDeviceEvent, MistAuditLog } from './mist-api.service';
import { MistCloud, MistEndpoint } from '../config/mist-clouds.config';
import {
  formatOffsetEastLabel,
  getJunosLogLineUtcMs,
  parseCurrentTimeFromUptime,
} from '../utils/junos-log-time';
import {
  LldpNeighbor,
  parseLldpNeighborsOutput,
  selectUplinkNeighbor,
} from './troubleshoot/parsers/lldp.parser';
import { parseJmaConnectivityState } from './troubleshoot/parsers/jma-connectivity.parser';
import { DhcpRefreshService } from './dhcp-refresh.service';
import { buildMcdLogAnalysisResult } from '../features/troubleshoot/mcd-log-analysis';
import { parseMcdLog } from '../features/troubleshoot/mcd-log-parser';
import type { McdParsedCycle, McdParsedLog } from '../features/troubleshoot/mcd-log-parser.types';

export type CheckStatus = 'pending' | 'running' | 'pass' | 'fail' | 'warn' | 'skip' | 'info';

export interface CheckResult {
  id: string;
  name: string;
  status: CheckStatus;
  detail: string;
  raw?: string;
  remediation?: string;
  commands?: string[];
}

export type CheckProgressCallback = (result: CheckResult) => void;

export type { LldpNeighbor } from './troubleshoot/parsers/lldp.parser';

export interface UpstreamPortConfig {
  neighborName: string;
  neighborMac: string;
  neighborDeviceId: string | null;
  neighborSiteId: string | null;
  remotePortInfo: string;
  remoteInterface: string | null;
  usageProfile: string | null;    // Mist port usage profile name (e.g. "Trunk_uplink")
  portMode: string | null;        // 'trunk' | 'access' | null
  allNetworks: boolean;
  nativeVlan: string | null;
  vlans: string[];
  voipNetwork: string | null;
  speed: string | null;
  duplex: string | null;
  rawPortConfig: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  networkDefinitions: Record<string, any>;
}

export interface TroubleshootOptions {
  cloud: MistCloud;
  uplinkPort?: string;
  siteId?: string;
  deviceId?: string;
  jmaStateCode?: number | null;
  onProgress: CheckProgressCallback;
}

export interface RecommendedChecksOptions extends TroubleshootOptions {
  checkIds: string[];
}

type DnsServerSource = 'static' | 'dhcp' | 'runtime';

interface DnsServerEntry {
  ip: string;
  source: DnsServerSource;
}

interface DnsServerSnapshot {
  servers: string[];
  entries: DnsServerEntry[];
  raw: string;
  expiresAt: number;
}

interface DnsReachabilitySnapshot {
  result: CheckResult;
  reachableServers: string[];
  checkedServers: string[];
  raw: string;
  expiresAt: number;
}

interface DefaultRoutePath {
  table: string;
  nextHop: string;
  iface: string;
}

const MCD_SIGNAL_FILTER_ERE = [
  'ccstate\\.go:',
  'connect\\.go:',
  'will try again in [0-9]+s',
  'ipc keep-alive timeout',
  'ctx canceled; exiting sendCloudMsgs',
  'stopping ipc server',
  'killing monitored process',
  'started jmd',
].join('|');

const DISCONNECT_REASON_JSON = /updated disconnect reason(?:(?: event sent status)?):\s+(\{.*\})/;
const MCD_ANCHOR_MAX_DELTA_MS = 10 * 60 * 1000;

function quoteForShellCommand(command: string): string {
  return `'${command.replace(/'/g, `'\\''`)}'`;
}

function parseMcdLogRollTimestamp(fileName: string): number | null {
  const match = fileName.match(/^mcd-(\d{4})-(\d{2})-(\d{2})T(\d{2})-(\d{2})-(\d{2})(?:\.(\d{1,3}))?\.log(?:\.gz)?$/);
  if (!match) return null;
  const [, year, month, day, hour, minute, second, millis = '0'] = match;
  const paddedMillis = millis.padEnd(3, '0');
  return Date.UTC(
    Number(year),
    Number(month) - 1,
    Number(day),
    Number(hour),
    Number(minute),
    Number(second),
    Number(paddedMillis),
  );
}

function buildCombinedParsedLog(anchor: McdParsedLog | null, current: McdParsedLog): McdParsedLog {
  const cycles: McdParsedCycle[] = [];
  const pushCycles = (parsed: McdParsedLog | null) => {
    if (!parsed) return;
    for (const cycle of parsed.cycles) {
      cycles.push({
        ...cycle,
        cycleNumber: cycles.length + 1,
      });
    }
  };

  pushCycles(anchor);
  pushCycles(current);

  return {
    cycles,
    totalLines: (anchor?.totalLines ?? 0) + current.totalLines,
    signalLines: (anchor?.signalLines ?? 0) + current.signalLines,
  };
}

function formatAnchorOffset(deltaMs: number): string {
  const seconds = Math.round(Math.abs(deltaMs) / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.round(seconds / 60);
  return `${minutes}m`;
}

type McdAnchorWindow = {
  parsed: McdParsedLog;
  file: string;
  matchedTimestampMs: number;
  deltaMs: number;
  source: 'mist-last-seen' | 'event-sent-transition';
};

type McdDisconnectEntry = {
  file: string;
  lineNumber: number;
  timestampMs: number;
  eventSent: boolean;
};

interface RawDisconnectReasonJson {
  timestamp?: string;
  event_sent?: boolean;
}

/** Mutable context for the modular troubleshoot step queue (Juniper EX). */
export interface TroubleshootContext {
  cloud: MistCloud;
  uplinkPort: string;
  uplinkNeighbor: LldpNeighbor | null;
  upstreamConfig: UpstreamPortConfig | null;
  siteId?: string;
  deviceId?: string;
  /** Set by the uplink port status step when the interface is operationally up. */
  uplinkPortOperational?: boolean;
}

export interface TroubleshootStepRun {
  result: CheckResult;
  /** Splice these steps immediately after the current step (dynamic expansion). */
  extraSteps?: TroubleshootStep[];
}

export interface TroubleshootStep {
  id: string;
  name: string;
  skipWhen?: (ctx: TroubleshootContext) => boolean;
  run: (ctx: TroubleshootContext) => Promise<TroubleshootStepRun>;
}

export class TroubleshootService {
  private runner: CommandRunnerService;
  private mistApi: MistApiService | null;
  private dnsServerCache: DnsServerSnapshot | null = null;
  private dnsReachabilityCache: DnsReachabilitySnapshot | null = null;
  private dhcpParser: DhcpRefreshService;

  constructor(runner: CommandRunnerService, mistApi?: MistApiService) {
    this.runner = runner;
    this.mistApi = mistApi || null;
    this.dhcpParser = new DhcpRefreshService(runner);
  }

  /**
   * Run an ordered queue of steps; supports `extraSteps` injection after any step.
   */
  private async runTroubleshootSteps(
    initialSteps: TroubleshootStep[],
    ctx: TroubleshootContext,
    report: (result: CheckResult) => void,
  ): Promise<void> {
    const queue = [...initialSteps];
    for (let i = 0; i < queue.length; i++) {
      const step = queue[i];
      if (step.skipWhen?.(ctx)) continue;
      const { result, extraSteps } = await step.run(ctx);
      report(result);
      if (extraSteps?.length) {
        queue.splice(i + 1, 0, ...extraSteps);
      }
    }
  }

  /**
   * First segment of `runAll`: LLDP → Mist upstream lookup → port status → interface errors.
   * Additional phases can be migrated here over time.
   */
  private buildInitialJuniperSteps(): TroubleshootStep[] {
    return [
      {
        id: 'lldp',
        name: 'LLDP Neighbors',
        run: async (ctx) => {
          const lldpResult = await this.checkLldp(ctx.uplinkPort);
          ctx.uplinkNeighbor = lldpResult.uplinkNeighbor;
          return { result: lldpResult.result };
        },
      },
      {
        id: 'upstream-port-config',
        name: 'Upstream Switch Port Config',
        skipWhen: (ctx) => !ctx.uplinkPort || !ctx.uplinkNeighbor,
        run: async (ctx) => {
          const upstreamResult = await this.lookupUpstreamPortConfig(ctx.uplinkNeighbor!);
          ctx.upstreamConfig = upstreamResult.config;
          return { result: upstreamResult.result };
        },
      },
      {
        id: 'port-status',
        name: 'Uplink Port Status',
        run: async (ctx) => {
          const portResult = await this.checkPortStatus(ctx.uplinkPort);
          ctx.uplinkPortOperational = portResult.status === 'pass';
          return { result: portResult };
        },
      },
      {
        id: 'interface-errors',
        name: 'Uplink Interface Errors',
        skipWhen: (ctx) => !ctx.uplinkPort || !ctx.uplinkPortOperational,
        run: async (ctx) => ({
          result: await this.checkInterfaceErrors(ctx.uplinkPort),
        }),
      },
    ];
  }

  /**
   * Run all cloud connectivity checks.
   * Returns the final array of results.
   */
  async runAll(options: TroubleshootOptions): Promise<CheckResult[]> {
    this.dnsServerCache = null;
    this.dnsReachabilityCache = null;
    const results: CheckResult[] = [];
    const { cloud, onProgress } = options;

    /** Helper to push a result and report progress */
    const report = (result: CheckResult) => {
      results.push(result);
      onProgress(result);
    };

    /** Helper to skip remaining checks with a reason */
    const skipRemaining = (reason: string, checkNames: string[]) => {
      for (const name of checkNames) {
        report({ id: `skip-${name.replace(/\s+/g, '-').toLowerCase()}`, name, status: 'skip', detail: `Skipped — ${reason}` });
      }
    };

    // Disable pagination first
    await this.runner.ensureOperationalMode();

    const ctx: TroubleshootContext = {
      cloud,
      uplinkPort: options.uplinkPort || '',
      uplinkNeighbor: null,
      upstreamConfig: null,
      siteId: options.siteId,
      deviceId: options.deviceId,
    };

    await this.runTroubleshootSteps(this.buildInitialJuniperSteps(), ctx, report);

    const { uplinkPort, upstreamConfig } = ctx;

    // 3. VLAN Config
    const vlanResult = await this.checkVlanConfig(uplinkPort);
    report(vlanResult);

    // 3b. Uplink Port Config Comparison (if upstream config is known)
    if (upstreamConfig && uplinkPort) {
      const compResults = await this.compareUplinkConfig(
        uplinkPort, upstreamConfig, options.siteId, options.deviceId,
      );
      for (const r of compResults) report(r);
    }

    // 4. Interface IP — CRITICAL: no IP means nothing beyond this will work
    const ipResult = await this.checkInterfaceIp();
    report(ipResult.result);

    if (ipResult.result.status === 'fail') {
      skipRemaining('no management IP address', [
        'DHCP Lease Details', 'Default Routes', 'Gateway Reachability',
        'DNS Configuration', 'DNS Server Reachability', 'DNS Resolution',
        'Route to Mist Endpoints',
        'Mist Agent Version', 'Mist Agent Processes', 'Outbound SSH Config', 'Active Cloud Connections',
      ]);
      return results;
    }

    // 4b. DHCP Lease Details
    const dhcpResult = await this.checkDhcpLease();
    report(dhcpResult);

    // 5. Default Routes — CRITICAL: no route means no cloud connectivity
    const routeResult = await this.checkDefaultRoute();
    report(routeResult);

    if (routeResult.status === 'fail') {
      skipRemaining('no default route', [
        'Gateway Reachability',
        'DNS Configuration', 'DNS Server Reachability', 'DNS Resolution',
        'Route to Mist Endpoints',
        'Mist Agent Version', 'Mist Agent Processes', 'Outbound SSH Config', 'Active Cloud Connections',
      ]);
      return results;
    }

    // 6. Gateway Reachability
    const arpResult = await this.checkArp();
    report(arpResult);

    // 7. DNS Config
    const dnsConfigResult = await this.checkDnsConfig();
    report(dnsConfigResult);

    // 8. DNS server reachability
    const dnsReachabilityResult = await this.checkDnsServerReachability();
    report(dnsReachabilityResult.result);

    // 9. DNS Resolution — CRITICAL: if DNS doesn't resolve, skip endpoint checks
    const dnsResolveResult = await this.checkDnsResolution(cloud, dnsReachabilityResult);
    report(dnsResolveResult);

    if (dnsReachabilityResult.reachableServers.length === 0 || dnsResolveResult.status === 'fail') {
      skipRemaining('DNS resolution failed', [
        'Route to Mist Endpoints',
        'Mist Agent Version', 'Mist Agent Processes', 'Outbound SSH Config', 'Active Cloud Connections',
      ]);
      return results;
    }

    // 9. Route Table Check for Mist Endpoints
    const routeCheckResult = await this.checkRouteToMistEndpoints(cloud);
    report(routeCheckResult);

    // 10. Mist Cloud Status
    const mistResults = await this.checkMistCloudStatus(ipResult.mgmtIp, cloud, options.siteId, options.deviceId);
    for (const r of mistResults) {
      report(r);
    }

    return results;
  }

  /**
   * Run a targeted subset of troubleshooting checks in a caller-specified order.
   * Used by the JMA recommendation UI to keep the first-pass workflow focused.
   */
  async runRecommendedChecks(options: RecommendedChecksOptions): Promise<CheckResult[]> {
    this.dnsServerCache = null;
    this.dnsReachabilityCache = null;
    const results: CheckResult[] = [];
    const reportedIds = new Set<string>();
    const requested = [...new Set(options.checkIds)];
    const ctx: TroubleshootContext = {
      cloud: options.cloud,
      uplinkPort: options.uplinkPort || '',
      uplinkNeighbor: null,
      upstreamConfig: null,
      siteId: options.siteId,
      deviceId: options.deviceId,
    };

    let mgmtIp: string | null | undefined;
    let timelineCache: CheckResult[] | null = null;

    const report = (result: CheckResult) => {
      results.push(result);
      options.onProgress(result);
      reportedIds.add(result.id);
    };

    const ensureMgmtIp = async (): Promise<string | null> => {
      if (mgmtIp !== undefined) return mgmtIp;
      const ipResult = await this.checkInterfaceIp();
      mgmtIp = ipResult.mgmtIp;
      // Intentionally NOT reporting here — use case 'mgmt-ip' for explicit reporting.
      // This prevents mgmt-ip from appearing as a side-effect when other checks (e.g.
      // cloud-connections) call ensureMgmtIp() as a prerequisite.
      return mgmtIp;
    };

    const ensureUplink = async (): Promise<void> => {
      if (!ctx.uplinkPort || ctx.uplinkNeighbor) return;
      const lldpResult = await this.checkLldp(ctx.uplinkPort);
      ctx.uplinkNeighbor = lldpResult.uplinkNeighbor;
      // Intentionally NOT reporting here — use case 'lldp' for explicit reporting.
      // This only enriches the nominated uplink port with its LLDP neighbor.
    };

    const ensureUpstreamConfig = async (): Promise<void> => {
      if (ctx.upstreamConfig || !ctx.uplinkNeighbor) return;
      const upstreamResult = await this.lookupUpstreamPortConfig(ctx.uplinkNeighbor);
      ctx.upstreamConfig = upstreamResult.config;
      if (!reportedIds.has(upstreamResult.result.id)) {
        report(upstreamResult.result);
      }
    };

    const ensureTimeline = async (): Promise<CheckResult[]> => {
      if (timelineCache) return timelineCache;
      timelineCache = await this.checkOfflineTimeline(options.siteId, options.deviceId);
      return timelineCache;
    };

    const reportMissingUplink = (id: string, name: string): void => {
      report({
        id,
        name,
        status: 'skip',
        detail: 'Skipped — no uplink port was nominated.',
      });
    };

    await this.runner.ensureOperationalMode();

    for (const checkId of requested) {
      if (reportedIds.has(checkId) && checkId !== 'fw-check') continue;

      switch (checkId) {
        case 'lldp': {
          // Always run the full LLDP check so we can surface the suggested uplink
          // even when no specific port has been nominated.
          const lldpResult = await this.checkLldp(ctx.uplinkPort ?? '');
          ctx.uplinkNeighbor = lldpResult.uplinkNeighbor;
          report(lldpResult.result);
          break;
        }
        case 'upstream-port-config': {
          await ensureUplink();
          if (!ctx.uplinkNeighbor) {
            report({
              id: 'upstream-port-config',
              name: 'Upstream Switch Port Config',
              status: 'skip',
              detail: 'Skipped — no LLDP uplink neighbor was detected.',
            });
            break;
          }
          await ensureUpstreamConfig();
          break;
        }
        case 'port-status': {
          if (!ctx.uplinkPort) await ensureUplink();
          if (!ctx.uplinkPort) {
            reportMissingUplink('port-status', 'Uplink Port Status');
            break;
          }
          report(await this.checkPortStatus(ctx.uplinkPort));
          break;
        }
        case 'interface-errors': {
          if (!ctx.uplinkPort) await ensureUplink();
          if (!ctx.uplinkPort) {
            reportMissingUplink('interface-errors', 'Uplink Interface Errors');
            break;
          }
          report(await this.checkInterfaceErrors(ctx.uplinkPort));
          break;
        }
        case 'vlan-config': {
          if (!ctx.uplinkPort) await ensureUplink();
          if (!ctx.uplinkPort) {
            reportMissingUplink('vlan-config', 'VLAN Config');
            break;
          }
          report(await this.checkVlanConfig(ctx.uplinkPort));
          break;
        }
        case 'uplink-config-compare': {
          if (!ctx.uplinkPort) await ensureUplink();
          if (!ctx.uplinkNeighbor) await ensureUplink();
          await ensureUpstreamConfig();
          if (!ctx.uplinkPort || !ctx.upstreamConfig) {
            report({
              id: 'uplink-config-compare',
              name: 'Uplink Config Match',
              status: 'skip',
              detail: 'Skipped — local uplink or upstream switch config could not be determined.',
            });
            break;
          }
          const compResults = await this.compareUplinkConfig(
            ctx.uplinkPort,
            ctx.upstreamConfig,
            options.siteId,
            options.deviceId,
          );
          for (const result of compResults) report(result);
          break;
        }
        case 'mgmt-ip': {
          // Run directly and populate the cache so other checks (cloud-connections etc.)
          // can call ensureMgmtIp() and get the IP without re-running the command.
          const ipResult = await this.checkInterfaceIp();
          mgmtIp = ipResult.mgmtIp;
          report(ipResult.result);
          break;
        }
        case 'dhcp-lease': {
          report(await this.checkDhcpLease());
          break;
        }
        case 'arp': {
          report(await this.checkArp());
          break;
        }
        case 'default-route': {
          report(await this.checkDefaultRoute());
          break;
        }
        case 'dns-config': {
          report(await this.checkDnsConfig());
          break;
        }
        case 'dns-server-reachability': {
          report((await this.checkDnsServerReachability()).result);
          break;
        }
        case 'dns-resolution': {
          report(await this.checkDnsResolution(options.cloud));
          break;
        }
        case 'route-to-mist': {
          report(await this.checkRouteToMistEndpoints(options.cloud));
          break;
        }
        case 'traceroute-to-mist': {
          report(await this.checkTracerouteToMist(options.cloud));
          break;
        }
        case 'fw-check': {
          const fwResults = await this.checkFirewallPolicy(options.cloud);
          for (const result of fwResults) report(result);
          break;
        }
        case 'mist-agent': {
          report(await this.checkMistAgentVersion());
          break;
        }
        case 'mcd-log-analysis': {
          report(await this.checkMcdLogAnalysis(options.siteId, options.deviceId, options.jmaStateCode));
          break;
        }
        case 'mist-processes': {
          report(await this.checkMistAgentProcesses());
          break;
        }
        case 'outbound-ssh-config': {
          const sshResult = await this.checkOutboundSshConfig();
          report(sshResult.result);
          break;
        }
        case 'cloud-connections': {
          report(await this.checkActiveCloudConnections(await ensureMgmtIp(), options.cloud));
          break;
        }
        case 'mist-last-seen':
        case 'mist-events':
        case 'switch-uptime':
        case 'mist-audit-logs':
        case 'switch-logs': {
          if (!options.siteId || !options.deviceId) {
            report({
              id: checkId,
              name: checkId,
              status: 'skip',
              detail: 'Skipped — identify and match the switch in Mist first.',
            });
            break;
          }
          const timelineResults = await ensureTimeline();
          const matches = timelineResults.filter((result) => {
            if (checkId === 'switch-logs') return result.id.startsWith('switch-logs');
            return result.id === checkId;
          });
          if (matches.length === 0) {
            report({
              id: checkId,
              name: checkId,
              status: 'skip',
              detail: 'Skipped — this evidence was not available for the current session context.',
            });
            break;
          }
          for (const result of matches) {
            if (!reportedIds.has(result.id)) report(result);
          }
          break;
        }
        default: {
          report({
            id: checkId,
            name: checkId,
            status: 'skip',
            detail: 'Skipped — this recommended check is not wired into the targeted runner yet.',
          });
          break;
        }
      }
    }

    return results;
  }

  /**
   * Standalone Firewall Policy Check.
   * Tests each Mist cloud endpoint with telnet (port allowed/denied) and
   * SSL cert check on port 443 (inspecting/not inspecting).
   */
  async checkFirewallPolicy(cloud: MistCloud): Promise<CheckResult[]> {
    await this.runner.ensureOperationalMode();
    const results: CheckResult[] = [];

    if (cloud.switchEndpoints.length === 0) {
      results.push({
        id: 'fw-check',
        name: 'Firewall Policy Check',
        status: 'skip',
        detail: 'No endpoints configured for this cloud region',
      });
      return results;
    }

    // Phase 1: Telnet reachability for all endpoints (from Junos CLI)
    for (const endpoint of cloud.switchEndpoints) {
      const reachResult = await this.checkEndpointReachability(endpoint);

      // Rewrite the result to use firewall-focused language
      const fwId = `fw-policy-${endpoint.host.replace(/\./g, '-')}-${endpoint.port}`;
      const fwName = `${endpoint.host}:${endpoint.port}`;

      if (reachResult.status === 'pass') {
        results.push({
          id: fwId,
          name: fwName,
          status: 'pass',
          detail: `Firewall Policy: ALLOWED traffic (TCP ${endpoint.port})`,
          raw: reachResult.raw,
        });
      } else if (reachResult.status === 'fail') {
        results.push({
          id: fwId,
          name: fwName,
          status: 'fail',
          detail: `Firewall Policy: DENIED traffic (TCP ${endpoint.port})`,
          raw: reachResult.raw,
        });

        // Traceroute on failure
        const traceResult = await this.checkTraceroute(endpoint);
        results.push(traceResult);
      } else {
        results.push({
          id: fwId,
          name: fwName,
          status: reachResult.status,
          detail: `Firewall Policy: ${reachResult.detail}`,
          raw: reachResult.raw,
        });
      }
    }

    // Phase 2: SSL cert check for port 443 endpoints (requires shell)
    const port443Endpoints = cloud.switchEndpoints.filter((e) => e.port === 443);

    if (port443Endpoints.length > 0) {
      for (const endpoint of port443Endpoints) {
        const certResult = await this.checkSslCertificate(endpoint);

        // Rewrite the result to use firewall inspection language
        const inspId = `fw-inspect-${endpoint.host.replace(/\./g, '-')}`;
        const inspName = `Inspection: ${endpoint.host}`;

        if (certResult.status === 'pass') {
          results.push({
            id: inspId,
            name: inspName,
            status: 'pass',
            detail: `Firewall NOT inspecting connection — ${certResult.detail.replace('Certificate OK — ', '')}`,
            raw: certResult.raw,
          });
        } else if (certResult.status === 'fail') {
          results.push({
            id: inspId,
            name: inspName,
            status: 'fail',
            detail: `Firewall INSPECTING connection — ${certResult.detail}`,
            raw: certResult.raw,
          });
        } else {
          results.push({
            id: inspId,
            name: inspName,
            status: certResult.status,
            detail: certResult.detail,
            raw: certResult.raw,
          });
        }
      }
    }

    return results;
  }

  /**
   * Standalone Mist cloud status check.
   * Can be called independently from the full troubleshoot flow.
   * @param mgmtIp — management IP to grep connections for (optional, auto-detects if not provided)
   * @param cloud — Mist cloud config for validating destination IPs against known endpoints
   */
  async checkMistCloudStatus(mgmtIp?: string | null, cloud?: MistCloud | null, siteId?: string, deviceId?: string): Promise<CheckResult[]> {
    await this.runner.ensureOperationalMode();
    const results: CheckResult[] = [];

    // If no mgmt IP provided, detect it
    if (!mgmtIp) {
      const ipResult = await this.checkInterfaceIp();
      mgmtIp = ipResult.mgmtIp;
    }

    // 10a. Mist Agent Version
    results.push(await this.checkMistAgentVersion());

    // 10b. Mist Agent Processes (mcd/jmd running)
    results.push(await this.checkMistAgentProcesses());

    // 10c. Outbound SSH Configuration
    const sshResult = await this.checkOutboundSshConfig();
    results.push(sshResult.result);

    // 10d. Active Cloud Connections (grep on management IP, validate against cloud endpoints)
    results.push(await this.checkActiveCloudConnections(mgmtIp, cloud));

    // 10e. Offline Timeline (Mist events + switch logs correlation)
    const timelineResults = await this.checkOfflineTimeline(siteId, deviceId);
    results.push(...timelineResults);

    return results;
  }

  async getJmaConnectivityState(options: { silent?: boolean } = {}) {
    const cmd = await this.runner.execute('show lldp local-information', 15000, 3000, {
      silent: options.silent,
    });
    if (!cmd.success && !cmd.output.trim()) {
      return {
        code: null,
        name: 'Unknown',
        severity: 'unknown' as const,
        label: 'Unknown',
        message: '',
        errno: null,
        detail: cmd.error || 'Could not read switch-reported JMA connectivity state.',
      };
    }

    const parsed = parseJmaConnectivityState(cmd.output);
    if (parsed.code === null && !cmd.success) {
      return {
        ...parsed,
        detail: cmd.error || parsed.detail,
      };
    }
    return parsed;
  }

  // ---- Individual checks ----

  /**
   * Look up the LLDP neighbor in Mist inventory and extract the port config
   * for the port our switch is connected to.
   */
  async lookupUpstreamPortConfig(neighbor: LldpNeighbor): Promise<{ result: CheckResult; config: UpstreamPortConfig | null }> {
    const id = 'upstream-port-config';
    const name = 'Upstream Switch Port Config';

    if (!this.mistApi?.isConfigured) {
      return {
        result: { id, name, status: 'skip', detail: 'Mist API not configured — cannot look up upstream switch' },
        config: null,
      };
    }

    // Step 1: Find the upstream switch in Mist by MAC then by name
    let upstreamDevice = await this.mistApi.findDeviceByMac(neighbor.chassisId);
    if (!upstreamDevice && neighbor.systemName) {
      upstreamDevice = await this.mistApi.findDeviceByName(neighbor.systemName);
    }

    if (!upstreamDevice) {
      return {
        result: {
          id, name, status: 'info' as CheckStatus,
          detail: `Upstream device "${neighbor.systemName || 'unknown'}" (${neighbor.chassisId}) is not managed in Mist. It may be a non-Mist switch, router, or firewall. Port config must be verified manually on the upstream device.`,
          raw: `LLDP Neighbor Details:\n  System Name: ${neighbor.systemName || '(not advertised)'}\n  Chassis ID:  ${neighbor.chassisId}\n  Port Info:   ${neighbor.portInfo}\n  Local Port:  ${neighbor.localInterface}\n\nThis device was not found in the Mist inventory.\nIt could be a third-party switch, router, firewall, or\na Juniper device not yet adopted into this Mist org.\n\nTo verify connectivity, check the port configuration\non the upstream device manually and ensure:\n  - The port is configured as a trunk (if tagged VLANs needed)\n  - The management VLAN is allowed on the trunk\n  - STP is not blocking the port`,
        },
        config: null,
      };
    }

    if (!upstreamDevice.site_id) {
      return {
        result: {
          id, name, status: 'warn',
          detail: `Upstream switch "${upstreamDevice.name || neighbor.systemName}" found in Mist but not assigned to a site`,
        },
        config: null,
      };
    }

    // Step 2: Pull the upstream switch's config from Mist
    let upstreamConfig;
    try {
      upstreamConfig = await this.mistApi.getDeviceConfig(upstreamDevice.site_id, upstreamDevice.id);
    } catch {
      return {
        result: {
          id, name, status: 'warn',
          detail: `Found upstream switch "${upstreamDevice.name}" but could not fetch its config`,
        },
        config: null,
      };
    }

    // Step 3: Find the port our switch is connected to
    // port_config maps interface → { usage: "profile_name", ... }
    // port_usages defines the profile details (mode, VLANs, speed, etc.)
    const portInfo = neighbor.portInfo;
    let remoteInterface: string | null = null;
    let usageProfile: string | null = null;
    let portMode: string | null = null;
    let allNetworks = false;
    let nativeVlan: string | null = null;
    let voipNetwork: string | null = null;
    const vlans: string[] = [];
    let speed: string | null = null;
    let duplex: string | null = null;
    let rawPortConfig = '';

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const portUsages: Record<string, any> = upstreamConfig.port_usages || {};
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const portConfig: Record<string, any> = upstreamConfig.port_config || {};

    // Try to find the port in port_config by matching:
    // 1. LLDP port info matches the interface name key (e.g. "xe-0/1/0")
    // 2. LLDP port info matches the port description
    // 3. LLDP port info matches the port usage profile name
    for (const [ifName, pCfg] of Object.entries(portConfig)) {
      const desc = pCfg?.description || '';
      const usage = pCfg?.usage || '';

      if (ifName === portInfo ||
          ifName.includes(portInfo) ||
          portInfo.includes(ifName) ||
          (desc && desc === portInfo) ||
          (usage && usage === portInfo)) {
        remoteInterface = ifName;
        usageProfile = usage;
        rawPortConfig = `Interface: ${ifName}\n` + JSON.stringify(pCfg, null, 2);
        break;
      }
    }

    // If not found by LLDP port info, check all port_config entries
    // and also try getting LLDP detail for the actual remote interface name
    if (!remoteInterface) {
      // The LLDP port info might be a Mist port name/description that doesn't
      // directly match port_config keys. Try to get more detail from LLDP.
      const lldpDetailCmd = await this.runner.execute(
        `show lldp neighbors interface ${neighbor.localInterface} detail`,
        15000,
        3000,
      );
      if (lldpDetailCmd.success) {
        // Look for "Port ID" which shows the actual interface name
        const portIdMatch = lldpDetailCmd.output.match(/Port ID\s*:\s*(\S+)/i);
        if (portIdMatch) {
          const remotePortId = portIdMatch[1];
          // Try to match this against port_config keys
          for (const [ifName, pCfg] of Object.entries(portConfig)) {
            if (ifName === remotePortId || ifName.includes(remotePortId)) {
              remoteInterface = ifName;
              usageProfile = pCfg?.usage || '';
              rawPortConfig = `Interface: ${ifName} (matched via LLDP Port ID: ${remotePortId})\n` + JSON.stringify(pCfg, null, 2);
              break;
            }
          }
        }
      }
    }

    // Resolve the usage profile to get mode, VLANs, speed, duplex
    if (usageProfile && portUsages[usageProfile]) {
      const profile = portUsages[usageProfile];
      portMode = profile.mode || null;
      allNetworks = !!profile.all_networks;
      nativeVlan = profile.port_network || null;
      voipNetwork = profile.voip_network || null;
      speed = profile.speed || null;
      duplex = profile.duplex || null;

      if (profile.networks && Array.isArray(profile.networks)) {
        vlans.push(...profile.networks);
      }

      rawPortConfig += '\n\nPort Usage Profile: ' + usageProfile + '\n' + JSON.stringify(profile, null, 2);
    }

    // Also check additional_config_cmds for any port-specific config
    if (upstreamConfig.additional_config_cmds && Array.isArray(upstreamConfig.additional_config_cmds)) {
      const portCmds = upstreamConfig.additional_config_cmds.filter(
        (c: string) => typeof c === 'string' && c.trim().length > 0 &&
          (c.includes(portInfo) || (remoteInterface && c.includes(remoteInterface)))
      );
      if (portCmds.length > 0) {
        rawPortConfig += '\n\nAdditional CLI commands:\n' + portCmds.join('\n');
      }
    }

    // Build the config object
    const config: UpstreamPortConfig = {
      neighborName: upstreamDevice.name || neighbor.systemName,
      neighborMac: neighbor.chassisId,
      neighborDeviceId: upstreamDevice.id,
      neighborSiteId: upstreamDevice.site_id,
      remotePortInfo: portInfo,
      remoteInterface,
      usageProfile,
      portMode,
      allNetworks,
      nativeVlan,
      vlans,
      voipNetwork,
      speed,
      duplex,
      rawPortConfig: rawPortConfig || 'No specific port config found in Mist',
      networkDefinitions: upstreamConfig.networks || {},
    };

    // Build detail summary
    let detail = `Upstream: ${config.neighborName}`;
    if (remoteInterface) {
      detail += ` port ${remoteInterface}`;
    }
    if (usageProfile) {
      detail += ` [${usageProfile}]`;
    }
    if (portMode) {
      detail += ` ${portMode.toUpperCase()}`;
      if (portMode === 'trunk') {
        if (allNetworks) {
          detail += ' (all VLANs)';
        } else if (vlans.length > 0) {
          detail += ` tagged: ${vlans.join(', ')}`;
        }
        if (nativeVlan) {
          detail += ` native: ${nativeVlan}`;
        }
      } else if (portMode === 'access') {
        if (nativeVlan) {
          detail += ` VLAN: ${nativeVlan}`;
        }
      }
    }
    if (voipNetwork) {
      detail += ` VoIP: ${voipNetwork}`;
    }
    if (speed || duplex) {
      detail += ` | ${speed || 'auto'}/${duplex || 'auto'}`;
    }
    if (!remoteInterface && !portMode) {
      detail += ` — port "${portInfo}" not found in Mist config (may use default profile)`;
    }

    // Build raw output
    let raw = `Upstream switch: ${config.neighborName} (${config.neighborMac})\n`;
    raw += `Mist device ID: ${config.neighborDeviceId}\n`;
    raw += `LLDP port info: ${portInfo}\n`;
    raw += `Matched interface: ${remoteInterface || 'not found'}\n`;
    raw += `Usage profile: ${usageProfile || 'none'}\n`;
    raw += `Mode: ${portMode || 'unknown'}\n`;
    raw += `All networks: ${allNetworks}\n`;
    raw += `Native VLAN: ${nativeVlan || 'none'}\n`;
    raw += `Tagged VLANs: ${vlans.length > 0 ? vlans.join(', ') : 'none'}\n`;
    raw += `VoIP network: ${voipNetwork || 'none'}\n`;
    raw += `Speed: ${speed || 'auto'}\n`;
    raw += `Duplex: ${duplex || 'auto'}\n\n`;
    raw += config.rawPortConfig;

    // Add network/VLAN definitions if available
    if (upstreamConfig.networks && typeof upstreamConfig.networks === 'object' && Object.keys(upstreamConfig.networks).length > 0) {
      raw += '\n\nNetwork definitions:\n' + JSON.stringify(upstreamConfig.networks, null, 2);
    }

    return {
      result: { id, name, status: remoteInterface ? 'pass' : 'warn', detail, raw },
      config,
    };
  }

  /**
   * Compare the upstream switch port config to the local switch uplink config.
   * Generates the exact 'set' commands needed to make the local port match.
   */
  private async compareUplinkConfig(
    localPort: string,
    upstream: UpstreamPortConfig,
    ourSiteId?: string,
    ourDeviceId?: string,
  ): Promise<CheckResult[]> {
    const results: CheckResult[] = [];
    const id = 'uplink-config-compare';
    const name = 'Uplink Config Match';

    // Helper to resolve VLAN name to ID from upstream network definitions
    const resolveVlanId = (vlanName: string): string | null => {
      const net = upstream.networkDefinitions?.[vlanName];
      if (net?.vlan_id) return String(net.vlan_id);
      return null;
    };

    // Helper to generate VLAN creation command with resolved ID
    const vlanCreateCmd = (vlanName: string): string => {
      const vlanId = resolveVlanId(vlanName);
      if (vlanId) return `set vlans ${vlanName} vlan-id ${vlanId}`;
      return `set vlans ${vlanName} vlan-id <vlan-id>`;
    };

    // Pull the current config for the local uplink port
    const configCmd = await this.runner.execute(`show configuration interfaces ${localPort} | display set`, 15000, 3000);
    const currentConfig = configCmd.success ? configCmd.output : '';

    // Pull the current VLANs
    const vlanCmd = await this.runner.execute('show configuration vlans | display set', 15000, 3000);
    const currentVlans = vlanCmd.success ? vlanCmd.output : '';

    // Build the expected config and the fix commands
    const commands: string[] = [];
    const mismatches: string[] = [];
    const matches: string[] = [];

    // 1. Port mode (trunk vs access)
    const upstreamMode = upstream.portMode || 'trunk';
    const currentHasTrunk = currentConfig.includes('interface-mode trunk');
    const currentHasAccess = currentConfig.includes('interface-mode access');

    if (upstreamMode === 'trunk') {
      if (!currentHasTrunk) {
        mismatches.push(`Port mode: upstream is TRUNK, local is ${currentHasAccess ? 'ACCESS' : 'not configured'}`);
        commands.push(`set interfaces ${localPort} unit 0 family ethernet-switching interface-mode trunk`);
      } else {
        matches.push('Port mode: trunk ✓');
      }

      // 2. VLANs on trunk
      if (upstream.allNetworks) {
        // Trunk allows all VLANs — set vlan members all
        if (!currentConfig.includes('vlan members all')) {
          mismatches.push('Trunk VLANs: upstream allows ALL, local does not');
          commands.push(`set interfaces ${localPort} unit 0 family ethernet-switching vlan members all`);
        } else {
          matches.push('Trunk VLANs: all ✓');
        }
      } else if (upstream.vlans.length > 0) {
        // Specific tagged VLANs
        for (const vlan of upstream.vlans) {
          if (!currentConfig.includes(`vlan members ${vlan}`)) {
            mismatches.push(`Tagged VLAN: "${vlan}" missing from local port`);
            // Check if the VLAN exists on the switch
            if (!currentVlans.includes(`set vlans ${vlan}`)) {
              commands.push(vlanCreateCmd(vlan));
            }
            commands.push(`set interfaces ${localPort} unit 0 family ethernet-switching vlan members ${vlan}`);
          } else {
            matches.push(`Tagged VLAN: ${vlan} ✓`);
          }
        }
      }

      // 3. Native VLAN on trunk
      if (upstream.nativeVlan) {
        if (!currentConfig.includes(`native-vlan-id`) && !currentConfig.includes(`port-network ${upstream.nativeVlan}`)) {
          mismatches.push(`Native VLAN: upstream has "${upstream.nativeVlan}", local not set`);
          // Check if the VLAN exists
          if (!currentVlans.includes(`set vlans ${upstream.nativeVlan}`)) {
            commands.push(vlanCreateCmd(upstream.nativeVlan!));
          }
          commands.push(`set interfaces ${localPort} native-vlan-id ${upstream.nativeVlan}`);
        } else {
          matches.push(`Native VLAN: ${upstream.nativeVlan} ✓`);
        }
      }

    } else if (upstreamMode === 'access') {
      if (!currentHasAccess) {
        mismatches.push(`Port mode: upstream is ACCESS, local is ${currentHasTrunk ? 'TRUNK' : 'not configured'}`);
        commands.push(`set interfaces ${localPort} unit 0 family ethernet-switching interface-mode access`);
      } else {
        matches.push('Port mode: access ✓');
      }

      // Access VLAN
      if (upstream.nativeVlan) {
        if (!currentConfig.includes(`vlan members ${upstream.nativeVlan}`)) {
          mismatches.push(`Access VLAN: upstream has "${upstream.nativeVlan}", local not set`);
          if (!currentVlans.includes(`set vlans ${upstream.nativeVlan}`)) {
            commands.push(vlanCreateCmd(upstream.nativeVlan!));
          }
          commands.push(`set interfaces ${localPort} unit 0 family ethernet-switching vlan members ${upstream.nativeVlan}`);
        } else {
          matches.push(`Access VLAN: ${upstream.nativeVlan} ✓`);
        }
      }
    }

    // 4. VoIP VLAN (if configured upstream)
    if (upstream.voipNetwork) {
      if (!currentConfig.includes(`vlan members ${upstream.voipNetwork}`)) {
        mismatches.push(`VoIP VLAN: "${upstream.voipNetwork}" missing from local port`);
        if (!currentVlans.includes(`set vlans ${upstream.voipNetwork}`)) {
          commands.push(vlanCreateCmd(upstream.voipNetwork!));
        }
        commands.push(`set interfaces ${localPort} unit 0 family ethernet-switching vlan members ${upstream.voipNetwork}`);
      } else {
        matches.push(`VoIP VLAN: ${upstream.voipNetwork} ✓`);
      }
    }

    // 5. Speed/duplex (only flag if upstream is not auto and local differs)
    if (upstream.speed && upstream.speed !== 'auto') {
      if (!currentConfig.includes(`speed ${upstream.speed}`)) {
        mismatches.push(`Speed: upstream is ${upstream.speed}, local is auto/different`);
        commands.push(`set interfaces ${localPort} ether-options speed ${upstream.speed}`);
      } else {
        matches.push(`Speed: ${upstream.speed} ✓`);
      }
    }
    if (upstream.duplex && upstream.duplex !== 'auto') {
      if (!currentConfig.includes(`duplex ${upstream.duplex}`)) {
        mismatches.push(`Duplex: upstream is ${upstream.duplex}, local is auto/different`);
        commands.push(`set interfaces ${localPort} ether-options duplex ${upstream.duplex}`);
      } else {
        matches.push(`Duplex: ${upstream.duplex} ✓`);
      }
    }

    // Build result
    let raw = `Upstream: ${upstream.neighborName} port ${upstream.remoteInterface || upstream.remotePortInfo}\n`;
    raw += `Profile: ${upstream.usageProfile || 'default'} (${upstreamMode})\n`;
    raw += `All networks: ${upstream.allNetworks}\n`;
    raw += `Native VLAN: ${upstream.nativeVlan || 'none'}\n`;
    raw += `Tagged VLANs: ${upstream.vlans.length > 0 ? upstream.vlans.join(', ') : 'none'}\n`;
    raw += `VoIP: ${upstream.voipNetwork || 'none'}\n`;
    raw += `Speed/Duplex: ${upstream.speed || 'auto'}/${upstream.duplex || 'auto'}\n\n`;

    raw += `--- Local port ${localPort} current config ---\n`;
    raw += currentConfig || '(no config found — factory default)\n';
    raw += '\n\n--- Comparison ---\n';
    raw += matches.map((m) => `  ✓ ${m}`).join('\n');
    if (matches.length > 0 && mismatches.length > 0) raw += '\n';
    raw += mismatches.map((m) => `  ✗ ${m}`).join('\n');

    if (commands.length > 0) {
      raw += '\n\n--- Commands to apply ---\n';
      raw += commands.join('\n');
    }

    if (mismatches.length === 0) {
      results.push({
        id, name, status: 'pass',
        detail: `Uplink ${localPort} config matches upstream (${matches.length} items verified)`,
        raw,
      });
    } else {
      const hasPlaceholders = commands.some((c) => /<\w+>/.test(c));
      results.push({
        id, name, status: 'fail',
        detail: `${mismatches.length} mismatch(es) — ${commands.length} commands to fix`,
        raw,
        remediation: `The local uplink port ${localPort} does not match the upstream switch (${upstream.neighborName}) port config.\n\nMismatches:\n${mismatches.map((m) => `  • ${m}`).join('\n')}\n\n${hasPlaceholders ? 'Note: Some commands contain <vlan-id> placeholders — replace with the actual VLAN ID from the upstream network definition.' : 'The commands below will configure the local port to match the upstream.'}`,
        commands: hasPlaceholders ? undefined : commands,
      });
    }

    // Step 6: Check if our switch is in Mist and compare Mist intended config
    if (this.mistApi?.isConfigured && ourSiteId && ourDeviceId && mismatches.length > 0) {
      const mistCheckResult = await this.checkMistUplinkConfig(localPort, upstream, ourSiteId, ourDeviceId);
      results.push(mistCheckResult);
    }

    return results;
  }

  /**
   * Check if the Mist intended config for our switch matches the upstream expectations.
   * If not, offer to update via PUT API.
   */
  private async checkMistUplinkConfig(
    localPort: string,
    upstream: UpstreamPortConfig,
    siteId: string,
    deviceId: string,
  ): Promise<CheckResult> {
    const id = 'mist-uplink-config';
    const name = 'Mist Config for Uplink Port';

    try {
      const ourMistConfig = await this.mistApi!.getDeviceConfig(siteId, deviceId);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const ourPortConfig: Record<string, any> = ourMistConfig.port_config || {};
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const ourPortUsages: Record<string, any> = ourMistConfig.port_usages || {};

      // Check if the uplink port has a config in Mist
      const portEntry = ourPortConfig[localPort];
      const usageName = portEntry?.usage;
      const usageProfile = usageName ? ourPortUsages[usageName] : null;

      const mistMode = usageProfile?.mode || null;
      const mistAllNetworks = !!usageProfile?.all_networks;
      const mistNativeVlan = usageProfile?.port_network || null;
      const mistVlans: string[] = usageProfile?.networks || [];

      const upstreamMode = upstream.portMode || 'trunk';
      const mistMismatches: string[] = [];

      // Compare Mist config against upstream expectations
      if (!portEntry) {
        mistMismatches.push(`Port ${localPort} has no device-level config in Mist (using site/template default)`);
      } else if (!usageProfile) {
        mistMismatches.push(`Port ${localPort} uses profile "${usageName}" but it's not defined in device port_usages`);
      } else {
        if (mistMode !== upstreamMode) {
          mistMismatches.push(`Mist mode: ${mistMode || 'not set'}, upstream expects: ${upstreamMode}`);
        }
        if (upstreamMode === 'trunk') {
          if (upstream.allNetworks && !mistAllNetworks) {
            mistMismatches.push('Upstream allows all networks but Mist does not have all_networks enabled');
          }
          if (upstream.nativeVlan && mistNativeVlan !== upstream.nativeVlan) {
            mistMismatches.push(`Mist native VLAN: ${mistNativeVlan || 'none'}, upstream expects: ${upstream.nativeVlan}`);
          }
        } else if (upstreamMode === 'access') {
          if (upstream.nativeVlan && mistNativeVlan !== upstream.nativeVlan) {
            mistMismatches.push(`Mist access VLAN: ${mistNativeVlan || 'none'}, upstream expects: ${upstream.nativeVlan}`);
          }
        }
      }

      if (mistMismatches.length === 0) {
        return {
          id, name, status: 'pass',
          detail: `Mist config for ${localPort} matches upstream expectations`,
          raw: `Mist port config:\n${JSON.stringify(portEntry, null, 2)}\n\nUsage profile:\n${JSON.stringify(usageProfile, null, 2)}`,
        };
      }

      // Build the Mist API update payload
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const newUsageProfile: Record<string, any> = {
        mode: upstreamMode,
        all_networks: upstream.allNetworks,
        speed: upstream.speed || 'auto',
        duplex: upstream.duplex || 'auto',
      };
      if (upstream.nativeVlan) {
        newUsageProfile.port_network = upstream.nativeVlan;
      }
      if (upstream.vlans.length > 0) {
        newUsageProfile.networks = upstream.vlans;
      }
      if (upstream.voipNetwork) {
        newUsageProfile.voip_network = upstream.voipNetwork;
      }

      const profileName = usageName || `uplink_${localPort.replace(/[\/\-]/g, '_')}`;
      const updatePayload = {
        port_usages: {
          ...ourPortUsages,
          [profileName]: { ...newUsageProfile, name: profileName },
        },
        port_config: {
          ...ourPortConfig,
          [localPort]: { usage: profileName },
        },
      };

      return {
        id, name, status: 'warn',
        detail: `Mist config for ${localPort} differs from upstream — ${mistMismatches.length} issue(s). Update available.`,
        raw: `Mismatches:\n${mistMismatches.map((m) => `  ✗ ${m}`).join('\n')}\n\nCurrent Mist port config:\n${JSON.stringify(portEntry, null, 2)}\n\nProposed Mist update:\n${JSON.stringify(updatePayload, null, 2)}`,
        remediation: `Mist will push config to this switch that doesn't match the upstream port.\nIf not corrected in Mist, the switch may lose connectivity after the next config push.\n\nMismatches:\n${mistMismatches.map((m) => `  • ${m}`).join('\n')}\n\nClick "Run Fix" to update the Mist device config via API.`,
        commands: [`__mist_api_update__${siteId}__${deviceId}__${JSON.stringify(updatePayload)}`],
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return {
        id, name, status: 'warn',
        detail: `Could not check Mist config: ${msg}`,
      };
    }
  }

  private async checkLldp(userPort: string): Promise<{
    result: CheckResult;
    detectedPort: string | null;
    uplinkNeighbor: LldpNeighbor | null;
  }> {
    const id = 'lldp';
    const name = 'LLDP Neighbors';

    const cmd = await this.runner.execute('show lldp neighbors', 20000, 3000);
    if (!cmd.success) {
      return {
        result: { id, name, status: 'fail', detail: cmd.error || 'Command failed', raw: cmd.output },
        detectedPort: null,
        uplinkNeighbor: null,
      };
    }

    const { neighbors } = parseLldpNeighborsOutput(cmd.output);

    if (neighbors.length === 0) {
      return {
        result: { id, name, status: 'fail', detail: 'No LLDP neighbors found', raw: cmd.output },
        detectedPort: null,
        uplinkNeighbor: null,
      };
    }

    const { neighbor: matchedNeighbor, detectedPort } = userPort
      ? selectUplinkNeighbor(neighbors, userPort)
      : { neighbor: null, detectedPort: null };

    const count = neighbors.length;
    let detail = `${count} neighbor(s)`;
    if (userPort) {
      if (detectedPort) {
        detail += `. Matched nominated uplink: ${detectedPort}`;
      } else {
        detail += `. Nominated uplink ${userPort} not present in LLDP neighbors`;
      }
    }
    if (matchedNeighbor) {
      detail += ` → ${matchedNeighbor.systemName || 'unknown'} (${matchedNeighbor.portInfo || 'unknown port'})`;
    }

    return {
      result: { id, name, status: 'info', detail, raw: cmd.output },
      detectedPort,
      uplinkNeighbor: matchedNeighbor,
    };
  }

  private async checkPortStatus(port: string): Promise<CheckResult> {
    const id = 'port-status';
    const name = 'Uplink Port Status';

    if (!port) {
      return { id, name, status: 'skip', detail: 'No uplink port identified' };
    }

    const cmd = await this.runner.execute(`show interfaces ${port} terse`, 10000);
    if (!cmd.success) {
      return { id, name, status: 'fail', detail: cmd.error || 'Command failed', raw: cmd.output };
    }

    const isUp = /\bup\b/i.test(cmd.output);
    if (!isUp) {
      return { id, name, status: 'fail', detail: `Port ${port} is not up`, raw: cmd.output };
    }

    // Get speed/duplex
    const detailCmd = await this.runner.execute(`show interfaces ${port}`);
    const speedMatch = detailCmd.output.match(/Speed:\s*(\S+)/i) || detailCmd.output.match(/(\d+[mMgG]bps)/);
    const speed = speedMatch ? speedMatch[1] : 'unknown';

    return { id, name, status: 'pass', detail: `Port ${port} is up (${speed})`, raw: cmd.output };
  }

  private async checkInterfaceErrors(port: string): Promise<CheckResult> {
    const id = 'interface-errors';
    const name = 'Uplink Interface Errors';

    const cmd = await this.runner.execute(`show interfaces ${port} extensive | match error`, 15000);
    if (!cmd.success) {
      return { id, name, status: 'warn', detail: 'Could not retrieve error counters', raw: cmd.output };
    }

    // Parse error counters — look for non-zero values
    const errorLines = cmd.output.split('\n').filter((l) => l.trim().length > 0);
    const errors: { name: string; count: number }[] = [];

    for (const line of errorLines) {
      // Match patterns like "Input errors: 5" or "CRC/Align errors: 0"
      const match = line.match(/([\w\/\s-]+errors?|drops|discards|CRC|framing|runts|giants|collisions)\s*:\s*(\d+)/i);
      if (match) {
        const count = parseInt(match[2], 10);
        if (count > 0) {
          errors.push({ name: match[1].trim(), count });
        }
      }
    }

    if (errors.length === 0) {
      return { id, name, status: 'pass', detail: `No errors on ${port}`, raw: cmd.output };
    }

    const errorSummary = errors.map((e) => `${e.name}: ${e.count}`).join(', ');
    return { id, name, status: 'warn', detail: `${port}: ${errorSummary}`, raw: cmd.output };
  }

  private async checkVlanConfig(port: string): Promise<CheckResult> {
    const id = 'vlan-config';
    const name = 'VLAN Config';

    if (!port) {
      return { id, name, status: 'skip', detail: 'No uplink port identified' };
    }

    const cmd = await this.runner.execute(`show vlans interface ${port}`);
    if (!cmd.success) {
      return { id, name, status: 'fail', detail: cmd.error || 'Command failed', raw: cmd.output };
    }

    // Check for VLAN entries
    const vlanLines = cmd.output.split('\n').filter((l) => /\d+/.test(l) && !/^(Routing|Name|VLAN)/.test(l.trim()));

    if (vlanLines.length === 0) {
      // Try alternate command
      const altCmd = await this.runner.execute(`show ethernet-switching interface ${port}`);
      if (altCmd.output.includes('trunk') || altCmd.output.includes('access')) {
        return { id, name, status: 'pass', detail: `VLANs configured on ${port}`, raw: altCmd.output };
      }
      return { id, name, status: 'warn', detail: `No VLANs found on ${port}`, raw: cmd.output };
    }

    return { id, name, status: 'pass', detail: `${vlanLines.length} VLAN(s) on ${port}`, raw: cmd.output };
  }

  private async checkInterfaceIp(): Promise<{ result: CheckResult; mgmtIp: string | null }> {
    const id = 'mgmt-ip';
    const name = 'Interface IP Summary';

    const cmd = await this.runner.execute('show interfaces terse | match "inet "');
    const cfgCmd = await this.runner.execute('show configuration interfaces | display set | match "family inet"', 20000, 3000);
    if (!cmd.success) {
      return {
        result: { id, name, status: 'fail', detail: cmd.error || 'Command failed', raw: cmd.output },
        mgmtIp: null,
      };
    }

    // Internal/non-management interfaces to exclude
    const internalPrefixes = ['bme', 'pfe', 'pfh', 'jsrv', 'lo0', 'pip', 'tap', 'gre', 'ipip', 'lsi', 'mtun', 'pimd', 'pime'];

    // Non-routable IP ranges used internally by Junos
    const isRoutableIp = (ip: string): boolean => {
      const parts = ip.split('.').map(Number);
      if (parts[0] === 127) return false;             // loopback
      if (parts[0] === 128 && parts[1] === 0) return false;  // Junos internal (128.0.0.0/16)
      if (parts[0] === 0) return false;                // 0.0.0.0
      if (parts[0] === 169 && parts[1] === 254) return false; // link-local
      return true;
    };

    const configLines = cfgCmd.success ? cfgCmd.output.split('\n').map((line) => line.trim()).filter(Boolean) : [];
    const configByIface = new Map<string, { dhcp: boolean; static: boolean }>();

    for (const line of configLines) {
      const match = line.match(/^set interfaces (\S+) unit (\d+) family inet (dhcp|address)\b/);
      if (!match) continue;
      const iface = `${match[1]}.${match[2]}`;
      const current = configByIface.get(iface) ?? { dhcp: false, static: false };
      if (match[3] === 'dhcp') current.dhcp = true;
      if (match[3] === 'address') current.static = true;
      configByIface.set(iface, current);
    }

    type InterfaceSummary = {
      iface: string;
      admin: string;
      oper: string;
      ip: string | null;
      source: 'dhcp' | 'static' | 'unknown';
    };

    const summaries: InterfaceSummary[] = [];

    for (const line of cmd.output.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || !trimmed.includes('inet')) continue;
      const parts = trimmed.split(/\s+/);
      if (parts.length < 4) continue;
      const iface = parts[0];
      if (internalPrefixes.some((p) => iface.startsWith(p))) continue;

      const ipDisplay = parts.find((part) => /\d+\.\d+\.\d+\.\d+(\/\d+)?/.test(part)) ?? null;
      const ip = ipDisplay?.match(/(\d+\.\d+\.\d+\.\d+)/)?.[1] ?? null;
      if (ip && !isRoutableIp(ip)) continue;

      const cfg = configByIface.get(iface);
      const source: 'dhcp' | 'static' | 'unknown' = cfg?.dhcp ? 'dhcp' : (cfg?.static ? 'static' : 'unknown');
      summaries.push({
        iface,
        admin: parts[1],
        oper: parts[2],
        ip: ipDisplay,
        source,
      });
    }

    if (summaries.length === 0) {
      return {
        result: {
          id,
          name,
          status: 'fail',
          detail: 'No relevant IPv4 interfaces found',
          raw: [cmd.output, cfgCmd.output].filter(Boolean).join('\n\n=== interface config ===\n'),
        },
        mgmtIp: null,
      };
    }

    const detailLines = summaries.map((summary) => {
      const state = `${summary.admin}/${summary.oper}`;
      if (summary.ip) {
        return `${summary.iface} — ${state} — ${summary.ip} — ${summary.source}`;
      }
      if (summary.source === 'dhcp') {
        return `${summary.iface} — ${state} — no IP — dhcp configured`;
      }
      return `${summary.iface} — ${state} — no IP — ${summary.source}`;
    });

    const firstUsableIp = summaries.find((summary) => summary.admin === 'up' && summary.oper === 'up' && summary.ip)?.ip?.match(/(\d+\.\d+\.\d+\.\d+)/)?.[1] ?? null;
    const hasAnyIp = summaries.some((summary) => Boolean(summary.ip));
    const hasUpUpIp = summaries.some((summary) => summary.admin === 'up' && summary.oper === 'up' && Boolean(summary.ip));
    const hasDhcpWithoutIp = summaries.some((summary) => summary.source === 'dhcp' && !summary.ip);
    const status: CheckStatus = !hasAnyIp
      ? 'warn'
      : (!hasUpUpIp || hasDhcpWithoutIp)
        ? 'warn'
        : 'info';

    return {
      result: {
        id,
        name,
        status,
        detail: detailLines.join('\n'),
        raw: [cmd.output, cfgCmd.output].filter(Boolean).join('\n\n=== interface config ===\n'),
      },
      mgmtIp: firstUsableIp,
    };
  }

  private async checkDhcpLease(): Promise<CheckResult> {
    const id = 'dhcp-lease';
    const name = 'DHCP Lease Details';

    // Try 'show dhcp client binding' first (EX Series standard)
    let cmd = await this.runner.execute('show dhcp client binding');

    // Some Junos versions use 'show system services dhcp client binding'
    if (!cmd.success || cmd.output.includes('unknown command') || cmd.output.includes('syntax error')) {
      cmd = await this.runner.execute('show system services dhcp client binding');
    }

    if (!cmd.success) {
      return { id, name, status: 'skip', detail: 'DHCP client info not available', raw: cmd.output };
    }

    // Check if there's actually a DHCP binding with a real IP
    const hasBinding = /\d+\.\d+\.\d+\.\d+/.test(cmd.output) &&
      !cmd.output.includes('no entries') &&
      !cmd.output.includes('0 bindings');

    if (!hasBinding) {
      return { id, name, status: 'info' as CheckStatus, detail: 'No DHCP lease — IP is likely static', raw: cmd.output };
    }

    // Check if the only IP found is 0.0.0.0 (no active lease)
    const allIps = cmd.output.match(/\b(\d+\.\d+\.\d+\.\d+)\b/g) || [];
    const realIps = allIps.filter((ip) => ip !== '0.0.0.0');
    if (realIps.length === 0) {
      return { id, name, status: 'info' as CheckStatus, detail: 'DHCP client bound to 0.0.0.0 — management IP appears to be statically assigned', raw: cmd.output };
    }

    const detailCmd = await this.runner.execute('show dhcp client binding detail');
    const allOutput = cmd.output + '\n' + (detailCmd.success ? detailCmd.output : '');
    const summaryBindings = this.dhcpParser.parseSummary(cmd.output)
      .filter((binding) => binding.ipAddress !== '0.0.0.0');
    const detailMap = this.dhcpParser.parseDetail(detailCmd.success ? detailCmd.output : '');

    const lines = summaryBindings.map((binding) => {
      const detail = detailMap.get(binding.interface);
      const dns = detail?.dnsServers?.length ? detail.dnsServers.join(', ') : 'not found';
      return [
        `${binding.interface}: ${binding.ipAddress}`,
        `Mask ${detail?.subnetMask ?? 'not found'}`,
        `Gateway ${detail?.router ?? 'not found'}`,
        `DNS ${dns}`,
      ].join(' | ');
    });

    return {
      id,
      name,
      status: 'pass',
      detail: lines.join('\n'),
      raw: allOutput,
    };
  }

  private async isMgmtJunosConfigured(): Promise<{ configured: boolean; raw: string }> {
    const cmd = await this.runner.execute('show configuration | display set | match mgmt_junos', 15000, 3000);
    if (!cmd.success) {
      return { configured: false, raw: cmd.output || cmd.error || '' };
    }
    const lines = cmd.output.split('\n').map((line) => line.trim()).filter(Boolean);
    return {
      configured: lines.some((line) => line.includes('mgmt_junos')),
      raw: cmd.output,
    };
  }

  private parseActiveDefaultRoutes(routeOutput: string, table: string): DefaultRoutePath[] {
    const lines = routeOutput.split('\n');
    const paths: DefaultRoutePath[] = [];
    let inDefaultBlock = false;

    for (const line of lines) {
      if (/^0\.0\.0\.0\/0\b/.test(line.trim())) {
        inDefaultBlock = true;
        continue;
      }

      if (inDefaultBlock && /^\S/.test(line) && !line.includes('0.0.0.0/0')) {
        inDefaultBlock = false;
      }

      if (!inDefaultBlock) continue;

      const match = line.match(/>\s+to\s+(\d+\.\d+\.\d+\.\d+)\s+via\s+(\S+)/);
      if (match) {
        paths.push({
          table,
          nextHop: match[1],
          iface: match[2],
        });
      }
    }

    return paths;
  }

  private async getDefaultRoutePaths(): Promise<{
    paths: DefaultRoutePath[];
    mgmtJunosConfigured: boolean;
    raw: string;
    tablesChecked: string[];
  }> {
    const mgmtJunos = await this.isMgmtJunosConfigured();
    const tablesChecked = ['inet.0'];
    const sections: string[] = [];
    const paths: DefaultRoutePath[] = [];

    const inetCmd = await this.runner.execute('show route table inet.0 0.0.0.0/0', 20000, 3000);
    sections.push(`=== inet.0 ===\n${inetCmd.output || inetCmd.error || ''}`.trim());
    if (inetCmd.success) {
      paths.push(...this.parseActiveDefaultRoutes(inetCmd.output, 'inet.0'));
    }

    if (mgmtJunos.configured) {
      tablesChecked.push('mgmt_junos.inet.0');
      const mgmtCmd = await this.runner.execute('show route table mgmt_junos.inet.0 0.0.0.0/0', 20000, 3000);
      sections.push(`=== mgmt_junos.inet.0 ===\n${mgmtCmd.output || mgmtCmd.error || ''}`.trim());
      if (mgmtCmd.success) {
        paths.push(...this.parseActiveDefaultRoutes(mgmtCmd.output, 'mgmt_junos.inet.0'));
      }
    }

    const raw = [
      '=== mgmt_junos config ===',
      mgmtJunos.raw || '(not configured)',
      ...sections,
    ].join('\n\n');

    return {
      paths,
      mgmtJunosConfigured: mgmtJunos.configured,
      raw,
      tablesChecked,
    };
  }

  private async checkArp(): Promise<CheckResult> {
    const id = 'arp';
    const name = 'Gateway Reachability';

    const routeSnapshot = await this.getDefaultRoutePaths();
    if (routeSnapshot.paths.length === 0) {
      return {
        id,
        name,
        status: 'skip',
        detail: `Skipped — no active default routes were found in ${routeSnapshot.tablesChecked.join(' or ')}`,
        raw: routeSnapshot.raw,
      };
    }

    const arpCmd = await this.runner.execute('show arp no-resolve', 30000, 3000);
    if (!arpCmd.success) {
      return { id, name, status: 'fail', detail: arpCmd.error || 'Command failed', raw: arpCmd.output };
    }

    const arpOutput = arpCmd.output;
    const summaries: string[] = [];
    const pingEvidence: string[] = [];
    let sawReachableEvidence = false;

    for (const path of routeSnapshot.paths) {
      const arpPresent = new RegExp(`\\b${path.nextHop.replace(/\./g, '\\.')}\\b`).test(arpOutput);
      const pingCommand = path.table === 'mgmt_junos.inet.0'
        ? `ping routing-instance mgmt_junos ${path.nextHop} count 1 rapid`
        : `ping inet ${path.nextHop} count 1 rapid`;
      const ping = await this.runner.execute(pingCommand, 15000, 2000);
      const receivedMatch = ping.output.match(/(\d+) packets received/);
      const received = receivedMatch ? parseInt(receivedMatch[1], 10) : 0;
      const pingPass = received > 0;
      const pingTimedOut = !ping.success && (ping.error || '').includes('timed out');

      if (arpPresent || pingPass) {
        sawReachableEvidence = true;
      }

      let statusText = '';
      if (arpPresent && pingPass) {
        statusText = 'ARP present, ping replies received';
      } else if (arpPresent && pingTimedOut) {
        statusText = 'ARP present, ping check timed out';
      } else if (arpPresent) {
        statusText = 'ARP present, no ping reply';
      } else if (pingTimedOut) {
        statusText = 'no ARP entry, ping check timed out';
      } else if (pingPass) {
        statusText = 'ping replies received, ARP entry not seen';
      } else {
        statusText = 'no ARP entry, no ping reply';
      }

      summaries.push(`${path.table}: ${path.nextHop} via ${path.iface} — ${statusText}`);
      pingEvidence.push(`=== ${path.table} ${path.nextHop} via ${path.iface} ===\n${pingCommand}\n${ping.output || ping.error || '(no output)'}`);
    }

    return {
      id,
      name,
      status: sawReachableEvidence ? 'pass' : 'fail',
      detail: summaries.join('\n'),
      raw: `${routeSnapshot.raw}\n\n=== ARP ===\n${arpOutput}\n\n${pingEvidence.join('\n\n')}`,
    };
  }

  private async checkDefaultRoute(): Promise<CheckResult> {
    const id = 'default-route';
    const name = 'Default Routes';

    const routeSnapshot = await this.getDefaultRoutePaths();
    if (routeSnapshot.paths.length === 0) {
      return {
        id,
        name,
        status: 'fail',
        detail: `No active default routes found in ${routeSnapshot.tablesChecked.join(' or ')}`,
        raw: routeSnapshot.raw,
      };
    }

    const summaries = routeSnapshot.paths.map((path) => `${path.table}: ${path.nextHop} via ${path.iface}`);
    return {
      id,
      name,
      status: 'pass',
      detail: summaries.length === 1
        ? `Active default route: ${summaries[0]}`
        : summaries.join('\n'),
      raw: routeSnapshot.raw,
    };
  }

  private async checkDnsConfig(): Promise<CheckResult> {
    const id = 'dns-config';
    const name = 'DNS Configuration';
    const { servers, entries, raw } = await this.getConfiguredDnsServers();

    if (servers.length === 0) {
      return { id, name, status: 'fail', detail: 'No DNS servers found in config or resolve.conf', raw };
    }

    const detailServers = entries.length > 0
      ? entries.map((entry) => `${entry.ip} (${entry.source})`).join(', ')
      : servers.join(', ');

    return { id, name, status: 'pass', detail: `DNS servers: ${detailServers}`, raw };
  }

  private async checkDnsServerReachability(): Promise<{ result: CheckResult; reachableServers: string[]; checkedServers: string[]; raw: string }> {
    if (this.dnsReachabilityCache && this.dnsReachabilityCache.expiresAt > Date.now()) {
      return {
        result: { ...this.dnsReachabilityCache.result },
        reachableServers: [...this.dnsReachabilityCache.reachableServers],
        checkedServers: [...this.dnsReachabilityCache.checkedServers],
        raw: this.dnsReachabilityCache.raw,
      };
    }

    const id = 'dns-server-reachability';
    const name = 'DNS Server Reachability';
    const { servers, entries, raw: dnsServerRaw } = await this.getConfiguredDnsServers();

    if (servers.length === 0) {
      const result: CheckResult = {
        id,
        name,
        status: 'skip',
        detail: 'Skipped — no DNS servers were available to test',
        raw: dnsServerRaw,
      };
      const snapshot: DnsReachabilitySnapshot = {
        result,
        reachableServers: [],
        checkedServers: [],
        raw: dnsServerRaw,
        expiresAt: Date.now() + 5000,
      };
      this.dnsReachabilityCache = snapshot;
      return { result: { ...result }, reachableServers: [], checkedServers: [], raw: dnsServerRaw };
    }

    const checks: string[] = [];
    const reachableServers: string[] = [];
    const checkedServers: string[] = [];

    for (const entry of entries.slice(0, 4)) {
      checkedServers.push(entry.ip);
      const ping = await this.runner.execute(`ping inet ${entry.ip} count 1 rapid`, 10000, 1500);
      checks.push(`DNS server ${entry.ip} (${entry.source})\n${ping.output || ping.error || ''}`.trim());
      const receivedMatch = ping.output.match(/(\d+) packets received/);
      const received = receivedMatch ? parseInt(receivedMatch[1], 10) : 0;
      const hasSuccess = received > 0;
      if (hasSuccess) reachableServers.push(entry.ip);
    }

    const raw = [
      `Configured DNS servers:\n${dnsServerRaw || '(none found)'}`,
      ...checks,
    ].join('\n\n---\n\n');

    const result: CheckResult = reachableServers.length > 0
      ? {
          id,
          name,
          status: 'pass',
          detail: `Reachable DNS servers: ${reachableServers.join(', ')}`,
          raw,
        }
      : {
          id,
          name,
          status: 'fail',
          detail: `Configured DNS server(s) ${checkedServers.join(', ')} are not reachable from the switch`,
          raw,
        };

    const snapshot: DnsReachabilitySnapshot = {
      result,
      reachableServers: [...reachableServers],
      checkedServers: [...checkedServers],
      raw,
      expiresAt: Date.now() + 5000,
    };
    this.dnsReachabilityCache = snapshot;
    return {
      result: { ...result },
      reachableServers: [...reachableServers],
      checkedServers: [...checkedServers],
      raw,
    };
  }

  private async checkDnsResolution(
    cloud: MistCloud,
    reachability?: { reachableServers: string[]; checkedServers: string[]; raw: string },
  ): Promise<CheckResult> {
    const id = 'dns-resolution';
    const name = 'DNS Resolution';

    const dnsReachability = reachability || await this.checkDnsServerReachability();

    if (dnsReachability.checkedServers.length === 0) {
      return {
        id,
        name,
        status: 'skip',
        detail: 'Skipped — no DNS servers were available to test',
        raw: dnsReachability.raw,
      };
    }

    if (dnsReachability.reachableServers.length === 0) {
      return {
        id,
        name,
        status: 'skip',
        detail: 'Skipped — hostname resolution was not tested because no DNS servers were reachable',
        raw: dnsReachability.raw,
      };
    }

    // Pick the oc-term host as the primary Mist test target
    const ocTerm = cloud.switchEndpoints.find((e) => e.description.includes('oc-term'));
    const testHost = ocTerm?.host || cloud.switchEndpoints[0]?.host || 'redirect.juniper.net';
    const publicHost = 'google.com';

    const extractResolvedIp = (output: string): string | null => {
      const match = output.match(/has address\s+(\d+\.\d+\.\d+\.\d+)/i);
      return match ? match[1] : null;
    };

    const isResolveFailure = (text: string): boolean => {
      return /host name lookup failure|unknown host|not known|couldn't get address|no servers could be reached|timed out/i.test(text);
    };

    const indicatesDnsTransportFailure = (text: string): boolean => {
      return /no servers could be reached|connection timed out/i.test(text);
    };

    const indicatesUnknownHostFailure = (text: string): boolean => {
      return /host name lookup failure|unknown host|not known|couldn't get address/i.test(text);
    };

    const mistResolve = await this.runner.execute(`show host ${testHost}`, 35000, 3000);
    const publicResolve = await this.runner.execute(`show host ${publicHost}`, 35000, 3000);

    const mistResolveText = `${mistResolve.output}\n${mistResolve.error || ''}`.trim();
    const publicResolveText = `${publicResolve.output}\n${publicResolve.error || ''}`.trim();

    const raw = [
      dnsReachability.raw,
      `show host ${testHost}\n${mistResolveText}`.trim(),
      `show host ${publicHost}\n${publicResolveText}`.trim(),
    ].join('\n\n---\n\n');

    const mistIp = extractResolvedIp(mistResolve.output);
    const publicIp = extractResolvedIp(publicResolve.output);

    if (mistIp) {
      if (publicIp) {
        return {
          id,
          name,
          status: 'pass',
          detail: `${testHost} resolved to ${mistIp}; generic DNS resolution also works`,
          raw,
        };
      }
      return {
        id,
        name,
        status: 'pass',
        detail: `${testHost} resolved to ${mistIp}`,
        raw,
      };
    }

    if (publicIp && !mistIp) {
      return {
        id,
        name,
        status: 'warn',
        detail: indicatesUnknownHostFailure(mistResolveText)
          ? 'Mist hostnames are unknown to the resolver'
          : 'Hostname resolution failed for Mist domains only',
        raw,
      };
    }

    if (indicatesDnsTransportFailure(mistResolveText) && indicatesDnsTransportFailure(publicResolveText)) {
      return {
        id,
        name,
        status: 'fail',
        detail: 'Hostname resolution failed',
        raw,
      };
    }

    if (isResolveFailure(mistResolveText) && isResolveFailure(publicResolveText)) {
      return {
        id,
        name,
        status: 'fail',
        detail: indicatesUnknownHostFailure(mistResolveText) && indicatesUnknownHostFailure(publicResolveText)
          ? 'Resolver returned unknown host responses'
          : 'Hostname resolution failed',
        raw,
      };
    }

    if (isResolveFailure(mistResolveText)) {
      return {
        id,
        name,
        status: 'fail',
        detail: indicatesUnknownHostFailure(mistResolveText)
          ? 'Mist hostname was unknown to the resolver'
          : 'Mist hostname resolution failed',
        raw,
      };
    }

    return { id, name, status: 'warn', detail: `Uncertain DNS result for ${testHost}`, raw };
  }

  private async checkRouteToMistEndpoints(cloud: MistCloud): Promise<CheckResult> {
    const id = 'route-to-mist';
    const name = 'Route to Mist Endpoints';

    // Resolve the oc-term host to an IP and check the routing table
    const ocTerm = cloud.switchEndpoints.find((e) => e.description.includes('oc-term'));
    const testHost = ocTerm?.host || cloud.switchEndpoints[0]?.host;

    if (!testHost) {
      return { id, name, status: 'skip', detail: 'No endpoint to check' };
    }

    // Resolve FQDN to IP first
    const hostCmd = await this.runner.execute(`show host ${testHost}`, 15000, 2000);
    let testIp: string | null = null;
    if (hostCmd.success) {
      const addrMatch = hostCmd.output.match(/has address\s+(\d+\.\d+\.\d+\.\d+)/);
      if (addrMatch) testIp = addrMatch[1];
    }

    if (!testIp) {
      return { id, name, status: 'warn', detail: `Could not resolve ${testHost} to check route`, raw: hostCmd.output };
    }

    // Check routing table for the resolved IP
    const routeCmd = await this.runner.execute(`show route ${testIp}`, 15000);
    if (!routeCmd.success) {
      return { id, name, status: 'fail', detail: `Could not check route to ${testIp}`, raw: routeCmd.output };
    }

    // Check for a route
    const hasRoute = routeCmd.output.includes(testIp) || routeCmd.output.includes('0.0.0.0/0');
    if (!hasRoute && routeCmd.output.includes('not found')) {
      return { id, name, status: 'fail', detail: `No route to ${testIp} (${testHost})`, raw: routeCmd.output };
    }

    // Extract next-hop
    const nhMatch = routeCmd.output.match(/>\s*to\s+(\d+\.\d+\.\d+\.\d+)/i) ||
                    routeCmd.output.match(/via\s+(\S+)/i);
    const nextHop = nhMatch ? nhMatch[1] : '';
    const nhDetail = nextHop ? ` via ${nextHop}` : '';

    return { id, name, status: 'pass', detail: `Route to ${testIp} (${testHost})${nhDetail}`, raw: routeCmd.output };
  }

  private async checkTraceroute(endpoint: MistEndpoint): Promise<CheckResult> {
    const id = `trace-${endpoint.host.replace(/\./g, '-')}`;
    const name = `Traceroute ${endpoint.host}`;

    const hostCmd = await this.runner.execute(`show host ${endpoint.host}`, 15000, 2000);
    const resolvedIp = hostCmd.output.match(/has address\s+(\d+\.\d+\.\d+\.\d+)/)?.[1] ?? null;
    if (!resolvedIp) {
      return {
        id,
        name,
        status: 'warn',
        detail: `Could not resolve ${endpoint.host} for traceroute`,
        raw: hostCmd.output,
      };
    }

    // Trace to the resolved IPv4 address rather than the hostname so the command
    // stays deterministic and avoids any extra name resolution behavior.
    // Keep the hop count bounded because many Mist endpoints do not respond all
    // the way to the destination, and the operator usually cares more about the
    // last responding hop than a complete end-to-end trace.
    const cmd = await this.runner.execute(
      `traceroute inet ${resolvedIp} no-resolve wait 1 ttl 15`,
      25000,
      3000,
    );

    // Parse traceroute output to find the last responding hop
    const hopLines = cmd.output.split('\n').filter((l) => /^\s*\d+\s/.test(l));
    const respondingHops = hopLines.filter((l) => !l.includes('* * *'));
    const deadHops = hopLines.filter((l) => l.includes('* * *'));
    const timedOut = !cmd.success && (cmd.error || '').includes('timed out');

    if (respondingHops.length === 0) {
      const timeoutNote = timedOut ? ' Traceroute stopped before completion.' : '';
      return {
        id,
        name,
        status: 'info' as CheckStatus,
        detail: `No hops responded beyond the switch.${timeoutNote}`.trim(),
        raw: cmd.output,
      };
    }

    // Get the last responding hop
    const lastHop = respondingHops[respondingHops.length - 1];
    const lastHopIp = lastHop.match(/(\d+\.\d+\.\d+\.\d+)/)?.[1] || 'unknown';
    const deadCount = deadHops.length;

    let detail = `${endpoint.host} (${resolvedIp}) — ${respondingHops.length} hop(s) responded, last: ${lastHopIp}`;
    if (deadCount > 0) {
      detail += ` (${deadCount} hop(s) no response after the last visible hop)`;
    }
    if (timedOut) {
      detail += ' — bounded traceroute timed out before destination reply';
    }
    if (!cmd.success && !timedOut) {
      detail += ` — traceroute ended with: ${cmd.error}`;
    }

    return { id, name, status: 'info' as CheckStatus, detail, raw: cmd.output };
  }

  private async checkTracerouteToMist(cloud: MistCloud): Promise<CheckResult> {
    const primaryEndpoint = cloud.switchEndpoints.find(
      (endpoint) => endpoint.port === 443 && endpoint.description.toLowerCase().includes('jma terminator'),
    ) ?? cloud.switchEndpoints.find((endpoint) => endpoint.port === 443) ?? cloud.switchEndpoints[0];
    if (!primaryEndpoint) {
      return {
        id: 'traceroute-to-mist',
        name: 'Traceroute to Mist',
        status: 'skip',
        detail: 'Skipped — no Mist cloud endpoint is defined for the selected region.',
      };
    }

    const traceResult = await this.checkTraceroute(primaryEndpoint);
    return {
      ...traceResult,
      id: 'traceroute-to-mist',
      name: 'Traceroute to Mist',
      detail: `${primaryEndpoint.host}: ${traceResult.detail}`,
    };
  }

  private async checkSslCertificate(endpoint: MistEndpoint): Promise<CheckResult> {
    const id = `cert-${endpoint.host.replace(/\./g, '-')}`;
    const name = `SSL Cert: ${endpoint.host}`;

    try {
      await this.runner.ensureShellMode();
    } catch (err) {
      return {
        id,
        name,
        status: 'warn',
        detail: 'Could not enter shell mode to inspect certificates',
        raw: err instanceof Error ? err.message : String(err),
      };
    }

    let output = '';
    try {
      await this.runner.execute('rm -f /tmp/certcheck.txt', 5000, 1000);

      // csh doesn't support 2>&1 or > redirect properly
      // Wrap in /bin/sh -c to get proper shell redirects
      // curl -v outputs cert info to stderr, so we redirect stderr to a file
      await this.runner.execute(
        `/bin/sh -c 'curl -4 -vk --connect-timeout 30 https://${endpoint.host}/ -o /dev/null 2>/tmp/certcheck.txt'`,
        45000,
        3000,
      );

      const catCmd = await this.runner.execute('cat /tmp/certcheck.txt', 10000, 2000);
      output = (catCmd.success && catCmd.output.trim().length > 0) ? catCmd.output : '';
    } finally {
      await this.runner.execute('rm -f /tmp/certcheck.txt', 5000, 1000).catch(() => undefined);
      await this.runner.ensureOperationalMode().catch(() => undefined);
    }

    if (!output || output.includes('command not found') || output.includes('No such file')) {
      return { id, name, status: 'warn', detail: 'curl not available on this switch', raw: output };
    }

    if (output.includes('Connection refused')) {
      return { id, name, status: 'skip', detail: 'Connection refused — host not accepting HTTPS', raw: output };
    }

    // Check if we got cert info before any timeout
    // curl may timeout on SSL handshake but still show partial TLS info
    const hasIssuer = /issuer\s*[=:]/i.test(output);
    if (hasIssuer) {
      return this.parseSslCertOutput(id, name, endpoint.host, output);
    }

    // SSL connection timeout — connected but TLS handshake didn't complete
    if (output.includes('SSL connection timeout') || output.includes('SSL handshake timeout')) {
      return { id, name, status: 'warn', detail: 'Connected but TLS handshake timed out — unable to inspect certificate', raw: output };
    }

    // General connect timeout — couldn't reach the host at all
    if (output.includes('timed out') || output.includes('connect timeout')) {
      return { id, name, status: 'skip', detail: 'Connection timed out — host unreachable on port 443', raw: output };
    }

    return this.parseSslCertOutput(id, name, endpoint.host, output);
  }

  private parseSslCertOutput(id: string, name: string, host: string, output: string): CheckResult {
    const lines = output.split('\n');

    // curl -v format from Junos:
    //   "*  issuer: C=US; ST=CA; L=Sunnyvale; O=Juniper Networks; OU=Juniper CA; CN=RedirectServiceRSACA"
    //   "*  issuer: C=US; O=Amazon; CN=Amazon RSA 2048 M03"
    // openssl format:
    //   "issuer=C = US, O = Amazon, CN = Amazon RSA 2048 M03"
    const issuerLine = lines.find((l) => /issuer\s*[=:]/i.test(l)) || '';
    const subjectLine = lines.find((l) => /subject\s*[=:]/i.test(l) && !/issuer/i.test(l)) || '';

    if (!issuerLine && !subjectLine) {
      // Check if we got any SSL/TLS/cert output at all
      const hasSSL = /ssl|tls|certificate|verify|handshake/i.test(output);
      if (hasSSL) {
        return { id, name, status: 'warn', detail: 'SSL connection made but could not parse certificate issuer — check terminal output', raw: output };
      }
      return { id, name, status: 'warn', detail: 'Could not determine SSL certificate details', raw: output };
    }

    // Parse issuer fields — handle both ; and , separators
    const textToParse = issuerLine || subjectLine;
    const cnMatch = textToParse.match(/CN\s*[=:]\s*([^;,\n]+)/i);
    const oMatch = textToParse.match(/O\s*[=:]\s*([^;,\n]+)/i);

    const issuerCn = cnMatch?.[1]?.trim() || '';
    const issuerO = oMatch?.[1]?.trim() || '';
    const issuerDisplay = issuerCn || issuerO || textToParse.replace(/^[\s*]+(?:issuer|subject)\s*:\s*/i, '').trim();

    if (!issuerDisplay) {
      return { id, name, status: 'warn', detail: 'SSL certificate found but issuer field is empty', raw: output };
    }

    // Expected issuers for Mist cloud endpoints (verified from real switch output):
    // - Juniper Networks (redirect.juniper.net — self-signed Juniper CA)
    // - Mist Systems Inc. (jma-terminator, ztp — Mist internal CA)
    // - DigiCert (cdn.juniper.net — public CA)
    // - Amazon / Starfield (some AWS-hosted endpoints)
    // - Google Trust Services / GTS (GCP-hosted clouds)
    const expectedPatterns = [
      /juniper/i,
      /mist\s*systems/i,
      /mistsys/i,
      /digicert/i,
      /amazon/i,
      /starfield/i,
      /google\s*trust/i,
      /\bGTS\b/,
    ];

    const isExpected = expectedPatterns.some((p) => p.test(issuerLine + ' ' + subjectLine));

    if (isExpected) {
      return { id, name, status: 'pass', detail: `Certificate OK — issued by ${issuerDisplay}`, raw: output };
    }

    // Not an expected issuer — likely SSL inspection
    return {
      id,
      name,
      status: 'fail',
      detail: `POSSIBLE SSL INSPECTION — Certificate issued by "${issuerDisplay}". Expected Juniper, Mist, DigiCert, Amazon, or Google. SSL decryption must be disabled for Mist endpoints.`,
      raw: output,
    };
  }

  private async checkEndpointReachability(endpoint: MistEndpoint): Promise<CheckResult> {
    const id = `reach-${endpoint.host.replace(/\./g, '-')}`;
    const name = `${endpoint.host}:${endpoint.port}`;

    // Step 1: Quick ping inet to test DNS resolution + basic reachability
    const pingCmd = await this.runner.execute(
      `ping inet ${endpoint.host} count 1 rapid`,
      10000,
    );

    const pingOutput = pingCmd.output;

    // DNS failure
    if (pingOutput.includes('unknown host') || pingOutput.includes('not known')) {
      return { id, name, status: 'fail', detail: `Cannot resolve ${endpoint.host}`, raw: pingOutput };
    }

    // No route
    if (pingOutput.includes('No route to host') || pingOutput.includes('Network is unreachable')) {
      return { id, name, status: 'fail', detail: 'No route to host', raw: pingOutput };
    }

    // Step 2: Test TCP port with telnet inet (force IPv4)
    const cmd = await this.runner.execute(
      `telnet inet ${endpoint.host} port ${endpoint.port}`,
      10000,
      3000,
    );

    const output = cmd.output;

    // Successful connection
    if (output.includes('Connected to') || output.includes('Escape character is') ||
        output.includes('Connection established')) {
      // Clean up telnet session
      await this.runner.send('\x1d');
      await new Promise((r) => setTimeout(r, 500));
      await this.runner.send('quit\n');
      await new Promise((r) => setTimeout(r, 500));

      return { id, name, status: 'pass', detail: `Reachable (TCP ${endpoint.port})`, raw: output };
    }

    // Connection refused — host reachable but port closed/filtered
    if (output.includes('Connection refused')) {
      return { id, name, status: 'warn', detail: `Connection refused (TCP ${endpoint.port}) — host reachable but port may be filtered`, raw: output };
    }

    // No route (from telnet)
    if (output.includes('No route to host') || output.includes('Network is unreachable')) {
      return { id, name, status: 'fail', detail: 'No route to host', raw: output };
    }

    // DNS failure (from telnet)
    if (output.includes('Name or service not known') || output.includes('could not resolve') ||
        output.includes('unknown host')) {
      return { id, name, status: 'fail', detail: 'DNS resolution failed', raw: output };
    }

    // Timeout
    if (output.includes('timed out') || output.includes('Connection timed out') || !cmd.success) {
      // Ping worked but TCP timed out — likely a firewall blocking the port
      const pingWorked = pingOutput.includes('!') || /\d+ packets received/.test(pingOutput);
      if (pingWorked) {
        return { id, name, status: 'fail', detail: `Host reachable (ICMP) but TCP ${endpoint.port} timed out — likely firewall blocked`, raw: output };
      }
      return { id, name, status: 'fail', detail: `Connection timed out (TCP ${endpoint.port})`, raw: output };
    }

    // Clean up any hanging telnet
    await this.runner.send('\x03');
    await new Promise((r) => setTimeout(r, 500));

    return { id, name, status: 'fail', detail: `Unable to connect (TCP ${endpoint.port})`, raw: output };
  }

  // ---- Mist Cloud Status checks ----

  private async checkMistAgentVersion(): Promise<CheckResult> {
    const id = 'mist-agent';
    const name = 'Mist Agent Version';

    const cmd = await this.runner.execute('show version | match mist', 15000);
    if (!cmd.success) {
      return { id, name, status: 'warn', detail: 'Could not determine Mist agent version', raw: cmd.output };
    }

    // Look for "JUNOS Mist Agent [vX.X.X]" or similar
    const versionMatch = cmd.output.match(/Mist\s+Agent\s*\[?(v?[\d.]+[\w-]*)\]?/i);
    if (versionMatch) {
      return { id, name, status: 'pass', detail: `Mist Agent ${versionMatch[1]}`, raw: cmd.output };
    }

    // No Mist agent found
    if (cmd.output.trim().length === 0 || !cmd.output.toLowerCase().includes('mist')) {
      return { id, name, status: 'fail', detail: 'Mist Agent not installed', raw: cmd.output };
    }

    return { id, name, status: 'pass', detail: cmd.output.trim(), raw: cmd.output };
  }

  private async checkMistAgentProcesses(): Promise<CheckResult> {
    const id = 'mist-processes';
    const name = 'Mist Agent Processes';

    // Check for mcd (Mist Cloud Daemon) and jmd (Junos Mist Daemon)
    // Use interactive shell to avoid pipe/redirect issues with 'start shell command'
    try {
      await this.runner.ensureShellMode();
    } catch (err) {
      return {
        id,
        name,
        status: 'warn',
        detail: 'Could not check processes — shell access may be restricted',
        raw: err instanceof Error ? err.message : String(err),
      };
    }

    let cmd;
    try {
      cmd = await this.runner.execute('/bin/sh -c \'ps aux | grep -E "mcd|jmd" | grep -v grep\'', 15000, 2000);
    } finally {
      await this.runner.ensureOperationalMode().catch(() => undefined);
    }

    if (!cmd.success) {
      return { id, name, status: 'warn', detail: 'Could not check processes — shell access may be restricted', raw: cmd.output };
    }

    return this.parseMistProcesses(cmd.output);
  }

  private async executeShellSnippet(command: string, timeoutMs = 30000, settleMs = 2000): Promise<CommandResult> {
    await this.runner.ensureShellMode();
    try {
      return await this.runner.execute(
        `/bin/sh -c ${quoteForShellCommand(command)}`,
        timeoutMs,
        settleMs,
      );
    } finally {
      await this.runner.ensureOperationalMode().catch(() => undefined);
    }
  }

  private async listMcdLogFiles(): Promise<string[]> {
    const cmd = await this.executeShellSnippet(
      `ls -1 /var/log/mcd*.log.gz /var/log/mcd.log 2>/dev/null | sed 's#.*/##'`,
      20000,
      1500,
    );
    if (!cmd.success) return [];
    return cmd.output
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => /^mcd(?:-\d{4}-\d{2}-\d{2}T[\d.-]+)?\.log(?:\.gz)?$/.test(line));
  }

  private async fetchCurrentMcdSignalLog(): Promise<McdParsedLog> {
    const cmd = await this.executeShellSnippet(
      `zcat -f /var/log/mcd.log | grep -E "${MCD_SIGNAL_FILTER_ERE}" | tail -n 200`,
      30000,
      1500,
    );
    if (!cmd.success) {
      throw new Error(cmd.error || 'Could not read the live mcd log.');
    }
    return parseMcdLog(cmd.output);
  }

  private async listDisconnectReasonEntries(file: string): Promise<McdDisconnectEntry[]> {
    const grepCmd = await this.executeShellSnippet(
      `zcat -f /var/log/${file} | grep -n "updated disconnect reason"`,
      file === 'mcd.log' ? 45000 : 60000,
      1500,
    );
    if (!grepCmd.success || !grepCmd.output.trim()) return [];

    const entries: McdDisconnectEntry[] = [];
    for (const line of grepCmd.output.split('\n').map((entry) => entry.trim()).filter((entry) => /^\d+:/.test(entry))) {
      const colonIndex = line.indexOf(':');
      if (colonIndex <= 0) continue;
      const lineNumber = Number(line.slice(0, colonIndex));
      if (!Number.isFinite(lineNumber)) continue;
      const payload = line.slice(colonIndex + 1);
      const match = payload.match(DISCONNECT_REASON_JSON);
      if (!match) continue;
      try {
        const parsed = JSON.parse(match[1]) as RawDisconnectReasonJson;
        if (typeof parsed.timestamp !== 'string' || typeof parsed.event_sent !== 'boolean') continue;
        const timestampMs = Date.parse(parsed.timestamp);
        if (!Number.isFinite(timestampMs)) continue;
        entries.push({
          file,
          lineNumber,
          timestampMs,
          eventSent: parsed.event_sent,
        });
      } catch {
        continue;
      }
    }

    return entries.sort((a, b) => a.timestampMs - b.timestampMs);
  }

  private async fetchMcdContextWindow(file: string, lineNumber: number): Promise<McdParsedLog | null> {
    const start = Math.max(1, lineNumber - 100);
    const end = lineNumber + 50;
    const contextCmd = await this.executeShellSnippet(
      `zcat -f /var/log/${file} | awk 'NR >= ${start} && NR <= ${end} { print }'`,
      file === 'mcd.log' ? 45000 : 60000,
      1500,
    );
    if (!contextCmd.success || !contextCmd.output.trim()) return null;
    return parseMcdLog(contextCmd.output);
  }

  private async fetchMcdAnchorFromEventSent(files: string[]): Promise<McdAnchorWindow | null> {
    const newestFirst = [...files].sort((a, b) => {
      const aMs = a === 'mcd.log' ? Number.POSITIVE_INFINITY : (parseMcdLogRollTimestamp(a) ?? 0);
      const bMs = b === 'mcd.log' ? Number.POSITIVE_INFINITY : (parseMcdLogRollTimestamp(b) ?? 0);
      return bMs - aMs;
    });

    const entries: McdDisconnectEntry[] = [];
    for (const file of newestFirst) {
      const fileEntries = await this.listDisconnectReasonEntries(file);
      entries.push(...fileEntries);
    }

    const newestToOldest = entries.sort((a, b) => b.timestampMs - a.timestampMs);
    const successIndex = newestToOldest.findIndex((entry) => entry.eventSent);
    if (successIndex <= 0) return null;

    const candidate = newestToOldest[successIndex - 1];
    if (candidate.eventSent) return null;

    const parsed = await this.fetchMcdContextWindow(candidate.file, candidate.lineNumber);
    if (!parsed) return null;

    return {
      parsed,
      file: candidate.file,
      matchedTimestampMs: candidate.timestampMs,
      deltaMs: 0,
      source: 'event-sent-transition',
    };
  }

  private async fetchMcdAnchorLog(lastSeenMs: number): Promise<McdAnchorWindow | null> {
    const files = await this.listMcdLogFiles();
    if (files.length === 0) return null;

    const searchOrder = [...files].sort((a, b) => {
      const aMs = a === 'mcd.log' ? Number.POSITIVE_INFINITY : (parseMcdLogRollTimestamp(a) ?? 0);
      const bMs = b === 'mcd.log' ? Number.POSITIVE_INFINITY : (parseMcdLogRollTimestamp(b) ?? 0);
      return aMs - bMs;
    });

    let best: { file: string; lineNumber: number; timestampMs: number; deltaMs: number } | null = null;

    for (const file of searchOrder) {
      const entries = await this.listDisconnectReasonEntries(file);
      for (const entry of entries) {
        const deltaMs = entry.timestampMs - lastSeenMs;
        if (!best || Math.abs(deltaMs) < Math.abs(best.deltaMs)) {
          best = { file: entry.file, lineNumber: entry.lineNumber, timestampMs: entry.timestampMs, deltaMs };
        }
      }
    }
    if (!best || Math.abs(best.deltaMs) > MCD_ANCHOR_MAX_DELTA_MS) {
      return this.fetchMcdAnchorFromEventSent(files);
    }

    const parsed = await this.fetchMcdContextWindow(best.file, best.lineNumber);
    if (!parsed) return this.fetchMcdAnchorFromEventSent(files);

    return {
      parsed,
      file: best.file,
      matchedTimestampMs: best.timestampMs,
      deltaMs: best.deltaMs,
      source: 'mist-last-seen',
    };
  }

  private async checkMcdLogAnalysis(siteId?: string, deviceId?: string, liveStateCode?: number | null): Promise<CheckResult> {
    let currentParsed: McdParsedLog;
    try {
      currentParsed = await this.fetchCurrentMcdSignalLog();
    } catch (err) {
      return {
        id: 'mcd-log-analysis',
        name: 'mcd Log Analysis',
        status: 'warn',
        detail: 'Could not read the live mcd log — shell access may be restricted.',
        raw: err instanceof Error ? err.message : String(err),
      };
    }

    let anchorParsed: McdParsedLog | null = null;
    const detailNotes: string[] = [];

    if ((this.mistApi?.isConfigured || this.mistApi?.hasLaunchOverlay) && siteId && deviceId) {
      try {
        const stats = await this.mistApi.getDeviceStats(siteId, deviceId);
        if (stats?.last_seen) {
          const lastSeenMs = stats.last_seen * 1000;
          detailNotes.push(`Mist last seen: ${new Date(lastSeenMs).toISOString()}`);
          const anchorWindow = await this.fetchMcdAnchorLog(lastSeenMs);
          if (anchorWindow?.parsed.cycles.length) {
            anchorParsed = anchorWindow.parsed;
            if (anchorWindow.source === 'mist-last-seen') {
              const relative = anchorWindow.deltaMs === 0
                ? 'at Mist last_seen'
                : `${formatAnchorOffset(anchorWindow.deltaMs)} ${anchorWindow.deltaMs < 0 ? 'before' : 'after'} Mist last_seen`;
              detailNotes.push(`Anchor match: ${relative} in ${anchorWindow.file}`);
            } else {
              detailNotes.push(`Anchor match: first unsent disconnect after the last sent event in ${anchorWindow.file}`);
            }
          } else {
            detailNotes.push('Anchor match: no retained disconnect cycle was close to Mist last_seen.');
          }
        } else {
          const files = await this.listMcdLogFiles();
          const anchorWindow = await this.fetchMcdAnchorFromEventSent(files);
          if (anchorWindow?.parsed.cycles.length) {
            anchorParsed = anchorWindow.parsed;
            detailNotes.push(`Anchor match: first unsent disconnect after the last sent event in ${anchorWindow.file}`);
            detailNotes.push('Analysis scope: Mist did not provide a last_seen timestamp, so the anchor came from the mcd event_sent transition history.');
          } else {
            detailNotes.push('Analysis scope: Mist did not provide a last_seen timestamp, so analysis is based on the current live mcd window only.');
          }
        }
      } catch (err) {
        detailNotes.push(`Analysis scope: Could not retrieve the parser anchor from Mist last_seen: ${err instanceof Error ? err.message : String(err)}`);
      }
    } else {
      const files = await this.listMcdLogFiles();
      const anchorWindow = await this.fetchMcdAnchorFromEventSent(files);
      if (anchorWindow?.parsed.cycles.length) {
        anchorParsed = anchorWindow.parsed;
        detailNotes.push(`Anchor match: first unsent disconnect after the last sent event in ${anchorWindow.file}`);
        detailNotes.push('Analysis scope: Mist context was unavailable, so the anchor came from the mcd event_sent transition history.');
      } else {
        detailNotes.push('Analysis scope: Mist context was unavailable, so analysis is based on the current live mcd window only.');
      }
    }

    const combined = buildCombinedParsedLog(anchorParsed, currentParsed);
    const result = buildMcdLogAnalysisResult(combined, {
      fallbackStateCode: liveStateCode ?? null,
    });
    if (detailNotes.length > 0) {
      result.detail = `${result.detail}\n${detailNotes.join('\n')}`.trim();
    }
    return result;
  }

  private async getConfiguredDnsServers(): Promise<{ servers: string[]; entries: DnsServerEntry[]; raw: string }> {
    if (this.dnsServerCache && this.dnsServerCache.expiresAt > Date.now()) {
      return {
        servers: [...this.dnsServerCache.servers],
        entries: this.dnsServerCache.entries.map((entry) => ({ ...entry })),
        raw: this.dnsServerCache.raw,
      };
    }

    const allOutputs: string[] = [];
    const staticServers: string[] = [];
    const entries: DnsServerEntry[] = [];
    const seen = new Set<string>();

    const addEntry = (ip: string, source: DnsServerSource) => {
      if (seen.has(ip)) return;
      seen.add(ip);
      entries.push({ ip, source });
    };

    const cmd1 = await this.runner.execute('show configuration groups | display set | match name-server');
    if (cmd1.success) {
      allOutputs.push(`show configuration groups | display set | match name-server\n${cmd1.output}`.trim());
      const found = cmd1.output.match(/(\d+\.\d+\.\d+\.\d+)/g) || [];
      staticServers.push(...found);
    }

    try {
      await this.runner.ensureShellMode();
      const cmd2 = await this.runner.execute('cat /etc/resolv.conf', 10000, 1500);
      if (cmd2.success) {
        allOutputs.push(`cat /etc/resolv.conf\n${cmd2.output}`.trim());
        let inDhcpBlock = false;
        for (const line of cmd2.output.split('\n')) {
          const trimmed = line.trim();
          if (/^#jdhcpd\b/i.test(trimmed)) {
            inDhcpBlock = !/^#jdhcpd end\b/i.test(trimmed);
            continue;
          }
          const ip = trimmed.match(/^nameserver\s+(\d+\.\d+\.\d+\.\d+)/i)?.[1];
          if (!ip) continue;
          const source: DnsServerSource = staticServers.includes(ip)
            ? 'static'
            : inDhcpBlock
              ? 'dhcp'
              : 'runtime';
          addEntry(ip, source);
        }
      }
    } catch (err) {
      allOutputs.push(`cat /etc/resolv.conf\n${err instanceof Error ? err.message : String(err)}`);
    } finally {
      await this.runner.ensureOperationalMode();
    }

    for (const ip of staticServers) {
      addEntry(ip, 'static');
    }

    const snapshot = {
      servers: entries.map((entry) => entry.ip),
      entries: entries.map((entry) => ({ ...entry })),
      raw: allOutputs.join('\n---\n'),
      expiresAt: Date.now() + 5000,
    };
    this.dnsServerCache = snapshot;
    return {
      servers: [...snapshot.servers],
      entries: snapshot.entries.map((entry) => ({ ...entry })),
      raw: snapshot.raw,
    };
  }

  private parseMistProcesses(output: string): CheckResult {
    const id = 'mist-processes';
    const name = 'Mist Agent Processes';

    const lines = output.split('\n').filter((l) => l.trim().length > 0);

    const hasMcd = lines.some((l) => /\/mcd\b/.test(l) || /\bmcd\s/.test(l));
    const hasJmd = lines.some((l) => /\/jmd\b/.test(l) || /\bjmd\s/.test(l));

    if (hasMcd && hasJmd) {
      return { id, name, status: 'pass', detail: 'mcd and jmd running', raw: output };
    }

    if (hasMcd && !hasJmd) {
      return { id, name, status: 'warn', detail: 'mcd running, jmd not found', raw: output };
    }

    if (!hasMcd && hasJmd) {
      return { id, name, status: 'warn', detail: 'jmd running, mcd not found', raw: output };
    }

    // Neither running
    return { id, name, status: 'fail', detail: 'Neither mcd nor jmd processes found — Mist agent may not be running', raw: output };
  }

  private async checkOutboundSshConfig(): Promise<{ result: CheckResult; port: string | null }> {
    const id = 'outbound-ssh-config';
    const name = 'Outbound SSH Config';

    const cmd = await this.runner.execute('show configuration system services outbound-ssh', 15000);
    if (!cmd.success) {
      return {
        result: { id, name, status: 'fail', detail: 'Could not read outbound-ssh config', raw: cmd.output },
        port: null,
      };
    }

    // Check for client mist block
    if (!cmd.output.includes('client mist') && !cmd.output.includes('client "mist"')) {
      if (cmd.output.includes('inactive')) {
        return {
          result: { id, name, status: 'fail', detail: 'Outbound SSH client "mist" is deactivated', raw: cmd.output },
          port: null,
        };
      }
      return {
        result: { id, name, status: 'fail', detail: 'Outbound SSH client "mist" not configured', raw: cmd.output },
        port: null,
      };
    }

    // Extract port from config (e.g. "port 2200;" or "port 443;")
    const portMatch = cmd.output.match(/port\s+(\d+)/);
    const port = portMatch ? portMatch[1] : null;

    // Extract oc-term host
    const hostMatch = cmd.output.match(/(oc-term[\w.-]+)/);
    const host = hostMatch ? hostMatch[1] : null;

    // Check for device-id
    const deviceIdMatch = cmd.output.match(/device-id\s+(\S+)/);
    const deviceId = deviceIdMatch ? deviceIdMatch[1] : null;

    // Check for secret
    const hasSecret = cmd.output.includes('secret');

    // Check for services (should list netconf)
    const hasServices = cmd.output.includes('services') && cmd.output.includes('netconf');

    const details: string[] = ['Configured'];
    if (host && port) {
      details.push(`${host}:${port}`);
    } else if (port) {
      details.push(`Port ${port}`);
    }
    if (deviceId) {
      const shortId = deviceId.length > 36 ? deviceId.substring(0, 32) + '…' : deviceId;
      details.push(`ID: ${shortId}`);
    }
    if (!hasSecret) details.push('⚠ No secret');
    if (!hasServices) details.push('⚠ Missing netconf service');

    const status = (hasSecret && deviceId) ? 'pass' : 'warn';
    return {
      result: { id, name, status, detail: details.join(' | '), raw: cmd.output },
      port,
    };
  }

  private async checkActiveCloudConnections(_mgmtIp: string | null, _cloud?: MistCloud | null): Promise<CheckResult> {
    const id = 'cloud-connections';
    const name = 'Active Cloud Connections';

    const cmd = await this.runner.execute('show system connections | match 443', 30000, 3000);
    if (!cmd.success) {
      return { id, name, status: 'fail', detail: 'Could not check system connections', raw: cmd.output };
    }

    const lines = cmd.output.split('\n').filter((l) => {
      const trimmed = l.trim();
      return trimmed.length > 0 && /\.(443)\b/.test(trimmed);
    });

    if (lines.length === 0) {
      return {
        id,
        name,
        status: 'fail',
        detail: 'No TCP connections to port 443 found',
        raw: cmd.output,
      };
    }

    const established = lines.filter((l) => /ESTABLISHED/i.test(l));
    const other = lines.filter((l) => !(/ESTABLISHED/i.test(l)));

    if (established.length === 0) {
      const states = other.map((l) => {
        const stateMatch = l.match(/(SYN_SENT|CLOSE_WAIT|FIN_WAIT\S*|TIME_WAIT|LAST_ACK|LISTEN)/i);
        return stateMatch ? stateMatch[1] : 'unknown';
      });
      const uniqueStates = [...new Set(states)];
      return {
        id,
        name,
        status: 'warn',
        detail: `${other.length} TCP/443 connection(s) found but none ESTABLISHED (states: ${uniqueStates.join(', ')})`,
        raw: cmd.output,
      };
    }
    let detail = `${established.length} established TCP/443 connection(s)`;
    if (other.length > 0) {
      const states = other.map((l) => {
        const stateMatch = l.match(/(SYN_SENT|CLOSE_WAIT|FIN_WAIT\S*|TIME_WAIT|LAST_ACK|LISTEN)/i);
        return stateMatch ? stateMatch[1] : 'unknown';
      });
      const uniqueStates = [...new Set(states)];
      detail += ` (+${other.length} non-established: ${uniqueStates.join(', ')})`;
    }

    return {
      id,
      name,
      status: established.length === 1 ? 'pass' : 'warn',
      detail: established.length === 1
        ? detail
        : `${detail} — expected a single established TCP/443 connection when the switch is online`,
      raw: cmd.output,
    };
  }

  // ---- Offline Timeline ----

  /**
   * Check when the switch went offline in Mist and correlate with switch logs.
   */
  async checkOfflineTimeline(siteId?: string, deviceId?: string): Promise<CheckResult[]> {
    const results: CheckResult[] = [];

    // Step 1: Get last disconnect time from Mist API
    let mistDisconnectTime: Date | null = null;
    let mistEvents: MistDeviceEvent[] = [];

    if (this.mistApi?.isConfigured && siteId && deviceId) {
      // Get device stats for last_seen
      const stats = await this.mistApi.getDeviceStats(siteId, deviceId);
      if (stats?.last_seen) {
        mistDisconnectTime = new Date(stats.last_seen * 1000);
        const ago = this.timeAgo(mistDisconnectTime);
        const statusText = stats.status === 'connected' ? 'currently connected' : `last seen ${ago}`;

        results.push({
          id: 'mist-last-seen',
          name: 'Mist Last Seen',
          status: stats.status === 'connected' ? 'pass' : 'warn',
          detail: `${statusText} (${mistDisconnectTime.toISOString().replace('T', ' ').substring(0, 19)} UTC)`,
          raw: JSON.stringify(stats, null, 2),
        });
      }

      // Get device events
      try {
        mistEvents = await this.mistApi.getDeviceEvents(siteId, deviceId, 20);
        if (mistEvents.length > 0) {
          mistEvents = [...mistEvents].sort((a, b) => (b.timestamp ?? 0) - (a.timestamp ?? 0));
          // Find disconnect events
          const disconnectEvents = mistEvents.filter((e) =>
            /disconnect/i.test(e.type || '') ||
            /disconnect/i.test(e.text || '') ||
            /disconnect/i.test(e.reason || '')
          );

          const lastDisconnect = disconnectEvents[0];
          if (lastDisconnect?.timestamp) {
            mistDisconnectTime = new Date(lastDisconnect.timestamp * 1000);
          }

          // Summarise recent events
          const eventSummary = mistEvents.slice(0, 5).map((e) => {
            const time = e.timestamp ? new Date(e.timestamp * 1000).toISOString().substring(11, 19) : '?';
            return `${time} ${e.type || ''}: ${e.text || e.reason || ''}`;
          }).join('\n');

          results.push({
            id: 'mist-events',
            name: 'Recent Mist Events',
            status: 'info' as CheckStatus,
            detail: `${mistEvents.length} event(s) found. Last: ${mistEvents[0]?.type || 'unknown'}`,
            raw: eventSummary,
          });
        } else {
          results.push({
            id: 'mist-events',
            name: 'Recent Mist Events',
            status: 'info' as CheckStatus,
            detail: 'No recent events found',
          });
        }
      } catch {
        results.push({
          id: 'mist-events',
          name: 'Recent Mist Events',
          status: 'warn',
          detail: 'Could not fetch recent events from Mist API',
        });
      }
    } else {
      const safeSite = siteId ? `${String(siteId).slice(0, 8)}…` : '(empty)';
      const safeDevice = deviceId ? `${String(deviceId).slice(0, 8)}…` : '(empty)';
      results.push({
        id: 'mist-last-seen',
        name: 'Mist Last Seen',
        status: 'skip',
        detail:
          `Mist Last Seen skipped (needs Mist API + site + device id). ` +
          `mistApiConfigured=${this.mistApi?.isConfigured ? 'yes' : 'no'} siteId=${safeSite} deviceId=${safeDevice}`,
      });
    }

    // Step 2: Get switch uptime
    let uptimeRaw = '';
    const uptimeCmd = await this.runner.execute('show system uptime', 10000);
    if (uptimeCmd.success) {
      uptimeRaw = uptimeCmd.output;
      const uptimeLines = uptimeCmd.output
        .split('\n')
        .map((line) => line.replace(/\r/g, '').trim())
        .filter((line) => line.length > 0);
      const currentTimeLine = uptimeLines.find((line) => /^Current time:/i.test(line)) ?? null;
      const bootLine = uptimeLines.find((line) => /^System booted:/i.test(line)) ?? null;
      const lastConfigLine = uptimeLines.find((line) => /^Last configured:/i.test(line)) ?? null;

      const detailParts: string[] = [];
      if (currentTimeLine) detailParts.push(currentTimeLine);
      if (bootLine) detailParts.push(bootLine);
      if (lastConfigLine) detailParts.push(lastConfigLine);

      let detail = detailParts.join(' | ');
      if (!detail) {
        const fallbackLines = uptimeLines.slice(0, 3);
        if (fallbackLines.length > 0) {
          detail = fallbackLines.join(' | ');
        }
      }

      results.push({
        id: 'switch-uptime',
        name: 'Switch Uptime',
        status: 'info' as CheckStatus,
        detail: detail || 'Uptime output captured',
        raw: uptimeCmd.output,
      });
    }

    // Step 3: Check Mist audit logs for config changes around the disconnect time
    if (this.mistApi?.isConfigured && mistDisconnectTime) {
      const auditResult = await this.checkAuditLogs(mistDisconnectTime, siteId);
      results.push(auditResult);
    }

    // Step 4: Pull switch logs around the disconnect time
    const logResults = await this.getRelevantLogs(mistDisconnectTime, uptimeRaw);
    results.push(...logResults);

    return results;
  }

  /**
   * Check Mist audit logs for configuration changes around the disconnect time.
   * Looks for changes within ±30 minutes of the disconnect event.
   */
  private async checkAuditLogs(disconnectTime: Date, siteId?: string): Promise<CheckResult> {
    const id = 'mist-audit-logs';
    const name = 'Mist Audit Logs (config changes)';

    try {
      // Search ±30 minutes around the disconnect time
      const windowMs = 30 * 60 * 1000;
      const startTime = Math.floor((disconnectTime.getTime() - windowMs) / 1000);
      const endTime = Math.floor((disconnectTime.getTime() + windowMs) / 1000);

      const logs = await this.mistApi!.getAuditLogs(startTime, endTime, 50);

      if (logs.length === 0) {
        return {
          id,
          name,
          status: 'pass',
          detail: 'No configuration changes in Mist within ±30 min of disconnect',
        };
      }

      // Filter for config-change-related audit entries
      const configKeywords = [
        /update/i, /modify/i, /delete/i, /create/i, /add/i,
        /template/i, /wlan/i, /switch/i, /network/i, /port/i,
        /vlan/i, /setting/i, /config/i, /policy/i, /assign/i,
        /unassign/i, /firmware/i, /upgrade/i, /reboot/i,
      ];

      const configChanges = logs.filter((log) => {
        const msg = (log.message || '').toLowerCase();
        return configKeywords.some((kw) => kw.test(msg));
      });

      // Also filter for changes to this specific site if we have a site ID
      const siteChanges = siteId
        ? logs.filter((log) => log.site_id === siteId)
        : [];

      const relevantLogs = [...new Map(
        [...configChanges, ...siteChanges].map((l) => [l.timestamp, l])
      ).values()];

      if (relevantLogs.length === 0) {
        return {
          id,
          name,
          status: 'pass',
          detail: `${logs.length} audit log(s) found but none are config changes`,
          raw: logs.map((l) => {
            const time = l.timestamp ? new Date(l.timestamp * 1000).toISOString().substring(11, 19) : '?';
            return `${time} [${l.admin_name || '?'}] ${l.message || ''}`;
          }).join('\n'),
        };
      }

      // Format the relevant entries
      const summary = relevantLogs.map((l) => {
        const time = l.timestamp ? new Date(l.timestamp * 1000).toISOString().substring(11, 19) : '?';
        return `${time} [${l.admin_name || '?'}] ${l.message || ''}`;
      }).join('\n');

      return {
        id,
        name,
        status: 'warn',
        detail: `${relevantLogs.length} config change(s) found near disconnect time — may be related`,
        raw: summary,
      };
    } catch {
      return {
        id,
        name,
        status: 'warn',
        detail: 'Could not fetch audit logs from Mist API',
      };
    }
  }

  /**
   * Choose Mist agent log file: JMA uses jmd.log; legacy pyagent stacks often use mist.log.
   */
  private async resolveMistAgentLogFile(): Promise<{ file: string; reason: string }> {
    const cmd = await this.runner.execute('show version | match mist', 15000);
    const text = (cmd.success ? cmd.output : '').toLowerCase();
    if (text.includes('pyagent') || text.includes('python mist')) {
      return { file: 'mist.log', reason: 'pyagent / legacy (mist.log)' };
    }
    if (text.trim().length > 0) {
      return { file: 'jmd.log', reason: 'JMA / jmd (jmd.log)' };
    }
    return { file: 'jmd.log', reason: 'default jmd.log (no mist lines in show version | match mist)' };
  }

  /**
   * Pull switch logs and find entries around the Mist disconnect time.
   * Shows ~25 lines before and ~25 lines after the disconnect for context.
   */
  private async getRelevantLogs(
    disconnectTime: Date | null,
    uptimeOutput?: string,
  ): Promise<CheckResult[]> {
    const results: CheckResult[] = [];

    let uptimeText = (uptimeOutput ?? '').trim();
    if (!uptimeText) {
      const up = await this.runner.execute('show system uptime', 10000);
      if (up.success) uptimeText = up.output;
    }
    const tzRef = parseCurrentTimeFromUptime(uptimeText);
    const offsetEastMin = tzRef?.offsetEastMin ?? 0;
    const offsetKnown = tzRef?.offsetKnown ?? false;
    const uptimeCalendar = tzRef
      ? { year: tzRef.year, month: tzRef.month, day: tzRef.day }
      : null;
    let tzNote: string;
    if (tzRef && offsetKnown) {
      tzNote = `${tzRef.abbrev} (UTC${formatOffsetEastLabel(offsetEastMin)})`;
    } else if (tzRef && !offsetKnown) {
      tzNote = `${tzRef.abbrev} — unknown TZ label; using UTC+0:00 for syslog timestamps`;
    } else {
      tzNote = 'no Current time parsed from uptime; using UTC+0:00 for syslog timestamps';
    }

    const { file: mistLogFile, reason: mistLogReason } = await this.resolveMistAgentLogFile();

    // Pull a large window: Mist agent log (jmd.log or mist.log) + system messages
    const mistLogCmd = await this.runner.execute(`show log ${mistLogFile} | last 200`, 30000, 5000);
    const sysLogCmd = await this.runner.execute('show log messages | last 200', 30000, 5000);

    // Important: even if `execute()` marks the command as unsuccessful (timeout / prompt detection),
    // the serial stream often already contains the log text we need.
    // So we parse `output` regardless of `success`.
    const mistLogLines = (mistLogCmd.output || '')
      .split('\n')
      .filter((l) => l.trim().length > 0);
    const sysLogLines = (sysLogCmd.output || '')
      .split('\n')
      .filter((l) => l.trim().length > 0);

    if (mistLogLines.length === 0 && sysLogLines.length === 0) {
      results.push({
        id: 'switch-logs',
        name: 'Switch Logs',
        status: 'warn',
        detail:
          `Could not retrieve logs (tried ${mistLogFile} — ${mistLogReason}). ` +
          `Mist log ok=${mistLogCmd.success} syslog ok=${sysLogCmd.success}`,
        raw: '',
      });
      return results;
    }

    // Keywords that indicate problems
    const problemKeywords = [
      { pattern: /outbound-ssh/i, category: 'Outbound SSH' },
      { pattern: /mist/i, category: 'Mist Agent' },
      { pattern: /connection\s*(reset|refused|timed|closed|failed)/i, category: 'Connection' },
      { pattern: /link\s*(down|up)/i, category: 'Link State' },
      { pattern: /interface.*down/i, category: 'Interface' },
      { pattern: /commit/i, category: 'Config Change' },
      { pattern: /error|fail|warning|critical/i, category: 'Error' },
      { pattern: /reboot|shutdown|halt/i, category: 'Reboot' },
      { pattern: /dhcp/i, category: 'DHCP' },
      { pattern: /dns|name-server|resolve/i, category: 'DNS' },
      { pattern: /stp|spanning-tree|bpdu/i, category: 'STP' },
      { pattern: /license/i, category: 'License' },
    ];

    // Helper to categorise a log line
    const categoriseLine = (line: string): string[] => {
      return problemKeywords
        .filter((kw) => kw.pattern.test(line))
        .map((kw) => kw.category);
    };

    // Helper to extract logs around the disconnect time
    const extractAroundDisconnect = (
      lines: string[],
    ): { before: string[]; after: string[]; nearestIndex: number } => {
      if (!disconnectTime) {
        return { before: lines.slice(-50), after: [], nearestIndex: -1 };
      }

      const discMs = disconnectTime.getTime();
      let nearestIndex = -1;
      let nearestDelta = Infinity;

      for (let i = 0; i < lines.length; i++) {
        const logUtc = getJunosLogLineUtcMs(lines[i], discMs, offsetEastMin, uptimeCalendar);
        if (logUtc === null) continue;
        const delta = Math.abs(logUtc - discMs);
        if (delta < nearestDelta) {
          nearestDelta = delta;
          nearestIndex = i;
        }
      }

      if (nearestIndex === -1) {
        return { before: lines.slice(-50), after: [], nearestIndex: -1 };
      }

      const startIdx = Math.max(0, nearestIndex - 25);
      const endIdx = Math.min(lines.length, nearestIndex + 25);

      return {
        before: lines.slice(startIdx, nearestIndex),
        after: lines.slice(nearestIndex, endIdx),
        nearestIndex,
      };
    };

    // Process system messages log
    if (sysLogLines.length > 0) {
      const { before, after, nearestIndex } = extractAroundDisconnect(sysLogLines);

      const allContextLines = [...before, ...after];
      const interestingBefore = before.filter((l) => categoriseLine(l).length > 0);
      const interestingAfter = after.filter((l) => categoriseLine(l).length > 0);
      const allInteresting = [...interestingBefore, ...interestingAfter];
      const allCategories = [...new Set(allInteresting.flatMap((l) => categoriseLine(l)))];

      let detail: string;
      let raw: string;

      if (disconnectTime && nearestIndex >= 0) {
        const discIso = disconnectTime.toISOString();
        detail =
          `${allInteresting.length} relevant entries near Mist last_seen (${discIso}, UTC). ` +
          `Switch log times → UTC using ${tzNote}. ${before.length} lines before anchor, ${after.length} after.`;
        raw =
          `--- ${before.length} lines BEFORE Mist disconnect reference (${discIso} UTC) ---\n` +
          before.map((l) => {
            const cats = categoriseLine(l);
            return cats.length > 0 ? `>>> [${cats.join(',')}] ${l}` : `    ${l}`;
          }).join('\n') +
          `\n\n--- NEAREST LOG ANCHOR (~${discIso} UTC) ---\n\n` +
          `--- ${after.length} lines AFTER anchor ---\n` +
          after.map((l) => {
            const cats = categoriseLine(l);
            return cats.length > 0 ? `>>> [${cats.join(',')}] ${l}` : `    ${l}`;
          }).join('\n');
      } else {
        detail = `${allInteresting.length} relevant entries in last ${allContextLines.length} log lines.`;
        raw = allContextLines.map((l) => {
          const cats = categoriseLine(l);
          return cats.length > 0 ? `>>> [${cats.join(',')}] ${l}` : `    ${l}`;
        }).join('\n');
      }

      if (allCategories.length > 0) {
        detail += ` Categories: ${allCategories.join(', ')}`;
      }

      results.push({
        id: 'switch-logs-messages',
        name: 'System Messages (around disconnect)',
        status: allInteresting.length > 0 ? 'warn' : ('info' as CheckStatus),
        detail,
        raw,
      });
    }

    // Process Mist agent log
    if (mistLogLines.length === 0 && sysLogLines.length > 0 && !mistLogCmd.success) {
      results.push({
        id: 'switch-logs-mist-agent-missing',
        name: `Mist agent log (${mistLogFile})`,
        status: 'info',
        detail: `Could not read ${mistLogFile} (${mistLogReason}) — using system messages only`,
        raw: mistLogCmd.output || mistLogCmd.error || '',
      });
    }

    if (mistLogLines.length > 0) {
      const { before, after, nearestIndex } = extractAroundDisconnect(mistLogLines);

      const allContextLines = [...before, ...after];
      const interestingBefore = before.filter((l) => categoriseLine(l).length > 0);
      const interestingAfter = after.filter((l) => categoriseLine(l).length > 0);
      const allInteresting = [...interestingBefore, ...interestingAfter];

      let detail: string;
      let raw: string;

      if (disconnectTime && nearestIndex >= 0) {
        const discIso = disconnectTime.toISOString();
        detail =
          `${allInteresting.length} relevant entries near Mist last_seen (${discIso}, UTC). ` +
          `Switch log times → UTC using ${tzNote}. ${before.length} before, ${after.length} after.`;
        raw =
          `--- ${before.length} lines BEFORE Mist disconnect reference (${discIso} UTC) ---\n` +
          before.join('\n') +
          `\n\n--- NEAREST LOG ANCHOR (~${discIso} UTC) ---\n\n` +
          `--- ${after.length} lines AFTER anchor ---\n` +
          after.join('\n');
      } else {
        detail = `${mistLogLines.length} Mist agent log lines retrieved.`;
        raw = allContextLines.join('\n');
      }

      results.push({
        id: 'switch-logs-mist-agent',
        name: `Mist agent log (${mistLogFile}, around disconnect)`,
        status: allInteresting.length > 0 ? 'warn' : ('info' as CheckStatus),
        detail: `${detail} — ${mistLogReason}`,
        raw,
      });
    }

    return results;
  }

  /**
   * Format a date as a human-readable "time ago" string.
   */
  private timeAgo(date: Date): string {
    const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
    if (seconds < 60) return `${seconds}s ago`;
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ${minutes % 60}m ago`;
    const days = Math.floor(hours / 24);
    return `${days}d ${hours % 24}h ago`;
  }

  /**
   * Generate context-aware remediation guidance and executable commands.
   */
  getRemediation(result: CheckResult, allResults?: CheckResult[]): { text?: string; commands?: string[] } {
    if (result.status === 'pass' || result.status === 'skip') return {};

    const r = (id: string): CheckResult | undefined => allResults?.find((x) => x.id === id);
    const failed = (id: string) => r(id)?.status === 'fail';
    const detail = (id: string) => r(id)?.detail || '';

    switch (result.id) {
      case 'lldp':
        return {
          text: '1. Verify the uplink cable is securely connected.\n2. Check upstream device has LLDP enabled.\n3. Try a different cable or SFP.\n4. Manually specify the uplink port if LLDP is disabled upstream.',
          commands: ['set protocols lldp interface all'],
        };

      case 'port-status': {
        const portMatch = result.detail.match(/((?:ge|xe|et|mge)-\S+)/);
        if (result.raw?.includes('Administratively down') || result.detail.includes('admin')) {
          return {
            text: 'The port is administratively disabled.',
            commands: portMatch ? [`delete interfaces ${portMatch[1]} disable`] : undefined,
          };
        }
        return { text: 'Port has no link. Check cable, SFP, and upstream port.' };
      }

      case 'interface-errors':
        return { text: 'Non-zero error counters detected. Replace cable or SFP. Clear counters to monitor for new errors.' };

      case 'vlan-config': {
        let text = 'Ensure the uplink is configured as trunk with the management VLAN.';
        if (failed('lldp')) text += '\nNote: LLDP also failed — uplink may not be connected.';
        return { text };
      }

      case 'mgmt-ip': {
        const dhcpDtl = detail('dhcp-lease').toLowerCase();
        const isDhcp = dhcpDtl.includes('dhcp') || dhcpDtl.includes('0.0.0.0');
        const isStatic = dhcpDtl.includes('static');
        const steps: string[] = [];
        const cmds: string[] = [];

        if (result.detail.includes('up but have no IP')) {
          steps.push('Management interface is up but has no IP.');
        }
        if (failed('port-status')) {
          steps.push('→ Uplink port is down — fix physical connection first.');
        } else if (failed('vlan-config')) {
          steps.push('→ VLAN config failed — DHCP server may be unreachable.');
        }
        if (isDhcp || (!isStatic && !isDhcp)) {
          steps.push('Ensure DHCP client is configured on the management interface.');
          cmds.push('set interfaces irb unit 0 family inet dhcp');
        } else if (isStatic) {
          steps.push('Static IP not configured.');
          cmds.push('set interfaces irb unit 0 family inet address <ip>/<prefix>');
        }
        return { text: steps.join('\n'), commands: cmds.length > 0 ? cmds : undefined };
      }

      case 'dhcp-lease':
        return {
          text: 'DHCP client may not be configured, or server is unreachable.\nEnsure management VLAN is correct and DHCP server has available addresses.',
          commands: ['set interfaces irb unit 0 family inet dhcp'],
        };

      case 'arp': {
        if (failed('port-status')) return { text: 'Uplink port is down — fix physical connection first.' };
        if (failed('vlan-config')) return { text: 'VLAN config failed — gateway may be on a different VLAN.' };
        if (failed('default-route')) return { text: 'No default routes were found — fix routing first.' };
        return { text: 'No default-route gateway showed usable ARP or ping evidence. Check VLANs, gateway reachability, and upstream L3 path.' };
      }

      case 'default-route': {
        const dhcpDtl = detail('dhcp-lease').toLowerCase();
        const hasDhcp = dhcpDtl.includes('ip:') && !dhcpDtl.includes('static');
        if (failed('mgmt-ip')) return { text: 'Management IP failed — fix that first.' };
        if (hasDhcp) return { text: 'IP via DHCP but no gateway. Update DHCP scope with Option 3 (Router/Gateway).' };
        return {
          text: 'No active default routes were found in inet.0 or mgmt_junos.inet.0.',
          commands: ['set routing-options static route 0.0.0.0/0 next-hop <gateway-ip>'],
        };
      }

      case 'dns-config': {
        const dhcpDtl = detail('dhcp-lease').toLowerCase();
        const hasDhcp = dhcpDtl.includes('ip:') && !dhcpDtl.includes('static');
        let text = 'No DNS servers configured.';
        if (hasDhcp) text += '\nIP via DHCP — update DHCP scope to include DNS (Option 6).';
        return {
          text,
          commands: ['set system name-server 8.8.8.8', 'set system name-server 8.8.4.4'],
        };
      }

      case 'dns-server-reachability': {
        if (failed('dns-config')) return { text: 'DNS servers not configured — fix DNS Config first.' };
        return { text: 'Configured DNS server IPs are not reachable from the switch. Fix the upstream path or replace them with reachable resolvers.' };
      }

      case 'dns-resolution':
      case 'dns-resolve': {
        if (failed('dns-config')) return { text: 'DNS servers not configured — fix DNS Config first.' };
        if (failed('dns-server-reachability')) return { text: 'Resolution was skipped because no DNS servers were reachable. Fix DNS Server Reachability first.' };
        const rawText = `${result.raw || ''}\n${result.detail}`.toLowerCase();
        const reachableServers = detail('dns-server-reachability').replace(/^Reachable DNS servers:\s*/i, '');

        if (rawText.includes('no servers could be reached') || rawText.includes('connection timed out')) {
          return {
            text: `${reachableServers ? `Reachable DNS servers: ${reachableServers}\n` : ''}Hostname resolution failed even though the configured DNS server IPs responded to ping.\nJunos reported "no servers could be reached" for the lookup attempt.\nConclusion: upstream DNS transport is likely being blocked, for example firewall policy on UDP/TCP 53 between the switch and its resolvers.\nIf any resolver IPs come from DHCP, consider refreshing them.`,
            commands: ['request dhcp client renew all'],
          };
        }
        if ((rawText.includes('unknown host') || rawText.includes('host name lookup failure')) && rawText.includes('mist domains only'))
          return {
            text: 'The resolver is answering queries, but Mist hostnames are coming back as unknown while public DNS still works.\nConclusion: this is most likely split-DNS, selective filtering, or an internal resolver that does not know or forward Juniper Mist hostnames.',
            commands: ['request dhcp client renew all'],
          };
        if (rawText.includes('resolver returned unknown host responses'))
          return {
            text: `${reachableServers ? `Reachable DNS servers: ${reachableServers}\n` : ''}The resolver answered the queries, but returned unknown-host responses for the names tested.\nConclusion: this is more likely a resolver content, recursion, or DNS policy issue than a pure transport block.`,
            commands: ['request dhcp client renew all'],
          };
        if (rawText.includes('mist hostname was unknown to the resolver'))
          return {
            text: 'The resolver answered the lookup, but reported the Mist hostname as unknown.\nConclusion: the DNS server is reachable, but it does not know or will not resolve the Mist domain being queried.',
            commands: ['request dhcp client renew all'],
          };
        if (rawText.includes('generic dns works') || rawText.includes('mist domains only'))
          return {
            text: 'Generic public hostname resolution works, but Mist domains do not.\nFocus on selective filtering, split-DNS, or upstream policy affecting Mist hostnames.',
            commands: ['request dhcp client renew all'],
          };
        if (rawText.includes('hostname lookups still fail') || rawText.includes('dns lookup failure') || rawText.includes('mist hostname resolution failed'))
          return {
            text: `${reachableServers ? `Reachable DNS servers: ${reachableServers}\n` : ''}Hostname resolution failed even though DNS servers are configured.\nConclusion: DNS queries are still not succeeding from the switch.\nVerify the resolver IPs in use and confirm the upstream DNS service or policy allows DNS queries from this subnet.`,
            commands: ['request dhcp client renew all'],
          };
        if (result.detail.includes('not reachable from the switch'))
          return { text: 'The configured DNS server IPs are not reachable from the switch. Fix the upstream path or replace them with reachable resolvers.' };
        if (result.detail.includes('0 replies'))
          return { text: 'ICMP blocked — may be OK. Run Firewall Policy Check to verify TCP.' };
        return {};
      }

      case 'route-to-mist':
        if (failed('default-route')) return { text: 'No default routes — fix routing first.' };
        return { text: 'Default route exists but no path to Mist IP. Check policy routing or ACLs.' };

      case 'mist-agent-version':
        return { text: 'Mist Agent not installed. Use the "Adopt Switch" button.' };

      case 'mist-processes': {
        if (failed('mist-agent-version')) return { text: 'Mist Agent not installed — adopt the switch first.' };
        return { text: 'Mist agent processes not running. Restarting.', commands: ['restart mcd'] };
      }

      case 'outbound-ssh-config': {
        if (result.detail.includes('not configured') || result.detail.includes('not found'))
          return { text: 'Outbound SSH not configured — use the Adopt Switch button.' };
        if (result.detail.includes('deactivated'))
          return { text: 'Outbound SSH deactivated.', commands: ['activate system services outbound-ssh client mist'] };
        return {
          text: 'Outbound SSH may be stuck. Deactivating and reactivating.',
          commands: ['deactivate system services outbound-ssh client mist', 'activate system services outbound-ssh client mist'],
        };
      }

      case 'active-connections': {
        if (failed('mist-processes')) return { text: 'Mist agent not running — fix that first.' };
        if (failed('outbound-ssh-config')) return { text: 'Outbound SSH not configured — adopt the switch.' };
        if (result.detail.includes('SYN_SENT'))
          return { text: 'Connections stuck in SYN_SENT — firewall blocking. Run Firewall Policy Check.' };
        if (result.detail.includes('FIN_WAIT') || result.detail.includes('CLOSE_WAIT'))
          return { text: 'Stale connections detected.', commands: ['restart mcd'] };
        return {
          text: 'No connections. Trying deactivate/reactivate outbound SSH.',
          commands: ['deactivate system services outbound-ssh client mist', 'activate system services outbound-ssh client mist'],
        };
      }

      default:
        return {};
    }
  }
}
