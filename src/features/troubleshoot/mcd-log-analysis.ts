import { getJmaParserConfig, type JmaParserEvidenceKey } from '../../config/jma-recommendations';
import type { CheckResult, CheckStatus } from '../../services/troubleshoot.service';
import { MCD_STATE_NAMES, type McdParsedCycle, type McdParsedLog } from './mcd-log-parser.types';

type EvidenceRow = { label: string; value: string };
type EvidenceFacts = Partial<Record<JmaParserEvidenceKey, string[]>>;
type McdLogAnalysisOptions = {
  fallbackStateCode?: number | null;
};

const GENERIC_EVIDENCE_ORDER: JmaParserEvidenceKey[] = [
  'management_ip',
  'default_gateway',
  'gateway_reachability',
  'dns_server',
  'mist_hostname_lookup',
  'fallback_dns_lookup',
  'fallback_resolver_probe',
  'resolver_library_result',
  'cloud_tcp_dial',
  'cloud_websocket_dial',
  'cached_cloud_endpoint',
  'mcd_conclusion',
];

const DEFAULT_EVIDENCE_LABELS: Record<JmaParserEvidenceKey, string> = {
  management_ip: 'Management IP',
  default_gateway: 'Default gateway',
  gateway_reachability: 'Gateway reachability',
  dns_server: 'DNS server',
  mist_hostname_lookup: 'Mist hostname lookup',
  fallback_dns_lookup: 'Fallback DNS lookup',
  fallback_resolver_probe: 'Fallback resolver probe',
  resolver_library_result: 'Resolver library result',
  cloud_tcp_dial: 'Cloud TCP dial',
  cloud_websocket_dial: 'Cloud websocket dial',
  cached_cloud_endpoint: 'Cached cloud endpoint',
  current_cycle: 'Current cycle',
  mist_last_seen: 'Mist last seen',
  disconnect_delivery: 'Disconnect delivery',
  mcd_conclusion: 'mcd conclusion',
};

function latestState(cycle: McdParsedCycle): number | null {
  return cycle.states.length > 0 ? cycle.states[cycle.states.length - 1] : null;
}

function describeState(state: number | null): string {
  if (state == null) return 'unknown';
  const label = MCD_STATE_NAMES[state];
  return label ? `${label} (${state})` : `State ${state}`;
}

function describeKillPath(cycle: McdParsedCycle): string | null {
  if (cycle.killPath === 'keep-alive-timeout') return 'jmd keep-alive timeout';
  if (cycle.killPath === 'cloud-disconnect') return 'cloud disconnect';
  return null;
}

function summarizeFailureReason(reason: string): string {
  return reason
    .replace(/^lookup\s+/i, '')
    .replace(/^dial\s+tcp:\s*/i, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function pushFact(facts: EvidenceFacts, key: JmaParserEvidenceKey, value: string | null): void {
  if (!value) return;
  const normalized = value.trim();
  if (!normalized) return;
  const current = facts[key] ?? [];
  if (!current.includes(normalized)) current.push(normalized);
  facts[key] = current;
}

function extractEvidenceFacts(cycle: McdParsedCycle | null): EvidenceFacts {
  const facts: EvidenceFacts = {};
  if (!cycle) return facts;

  for (const rawLine of cycle.rawLines) {
    const line = rawLine.replace(/^\[mcd\]\s+/, '').trim();

    let match = line.match(/management ip address\s+([0-9.]+)/i);
    if (match) {
      pushFact(facts, 'management_ip', match[1]);
      continue;
    }

    if (/no management ip address/i.test(line)) {
      pushFact(facts, 'management_ip', 'not present');
      continue;
    }

    if (/no default gateway/i.test(line)) {
      pushFact(facts, 'default_gateway', 'not present');
      continue;
    }

    if (/default gateway is reachable/i.test(line)) {
      pushFact(facts, 'gateway_reachability', 'reachable');
      continue;
    }

    if (/default gateway not reachable/i.test(line)) {
      pushFact(facts, 'gateway_reachability', 'not reachable');
      match = line.match(/default gateway ip:\s+([0-9.]+)/i);
      if (match) {
        pushFact(facts, 'default_gateway', match[1]);
      }
      continue;
    }

    match = line.match(/default gateway(?: ip:)?\s+([0-9.]+)/i);
    if (match) {
      pushFact(facts, 'default_gateway', match[1]);
      continue;
    }

    match = line.match(/DNS Server ip:\s+([0-9.:a-fA-F]+)/i);
    if (match) {
      pushFact(facts, 'dns_server', match[1]);
      continue;
    }

    match = line.match(/DNS lookup failed for\s+(\S+)\s+via\s+([0-9.:a-fA-F]+):\s+(.+)$/i);
    if (match) {
      const key: JmaParserEvidenceKey = match[1].toLowerCase() === 'google.com'
        ? 'fallback_dns_lookup'
        : 'mist_hostname_lookup';
      pushFact(facts, key, `via ${match[2]} failed: ${summarizeFailureReason(match[3])}`);
      continue;
    }

    match = line.match(/checking\s+(\S+)\s+is reachable via .* dns server\s+([0-9.:a-fA-F]+):?\s*(\w+)$/i);
    if (match) {
      pushFact(facts, 'fallback_resolver_probe', `${match[1]} via ${match[2]}: ${match[3].toLowerCase()}`);
      continue;
    }

    match = line.match(/LookupIP\(\)\s+failed:\s+(.+)$/i);
    if (match) {
      pushFact(facts, 'resolver_library_result', summarizeFailureReason(match[1]));
      continue;
    }

    match = line.match(/calling dialer\.Dial\(tcp,\s*([^)]+)\)/i);
    if (match) {
      pushFact(facts, 'cloud_tcp_dial', match[1]);
      continue;
    }

    match = line.match(/dial\("([^"]+)"\)\s+failed:\s+(.+)$/i);
    if (match) {
      pushFact(facts, 'cloud_websocket_dial', `${match[1]} failed: ${summarizeFailureReason(match[2])}`);
      continue;
    }

    match = line.match(/Using cached cloud ip address\s+(.+)$/i);
    if (match) {
      pushFact(facts, 'cached_cloud_endpoint', match[1]);
      continue;
    }
  }

  return facts;
}

function extractGenericEvidence(cycle: McdParsedCycle | null): EvidenceRow[] {
  if (!cycle) return [];
  const facts = extractEvidenceFacts(cycle);
  const rows: EvidenceRow[] = [];
  let index = 1;
  for (const key of GENERIC_EVIDENCE_ORDER) {
    const values = facts[key] ?? [];
    for (const value of values) {
      rows.push({ label: `Observed test ${index}`, value: `${DEFAULT_EVIDENCE_LABELS[key]}: ${value}` });
      index += 1;
    }
  }
  return rows.slice(0, 7);
}

function deriveStateConclusion(state: number | null, facts: EvidenceFacts): string | null {
  switch (state) {
    case 102:
      return 'The switch did not have a usable management IP when this cycle ran.';
    case 103:
      return 'The switch had management IP but no default gateway in the routing view mcd used.';
    case 104:
      return 'The switch found a default gateway but could not reach it, so upstream L3 failed before DNS.';
    case 106:
    case 113:
    case 114: {
      const gatewayReachable = facts.gateway_reachability?.[0];
      const hasMistLookupFailure = (facts.mist_hostname_lookup?.length ?? 0) > 0;
      const hasFallbackFailure = (facts.fallback_dns_lookup?.length ?? 0) > 0 || (facts.fallback_resolver_probe?.length ?? 0) > 0;
      if (gatewayReachable === 'reachable' && hasMistLookupFailure && hasFallbackFailure) {
        return 'Gateway reachability passed, but both Mist and fallback DNS probes failed. This points to a DNS-path problem rather than basic IP reachability.';
      } else {
        return 'mcd reached the DNS stage and failed there, so focus on resolver configuration and DNS transport before cloud-path checks.';
      }
    }
    case 108:
      return 'DNS succeeded and mcd reached the cloud dial stage, so the remaining problem is upstream cloud reachability.';
    case 109:
      return 'Transport reached Mist, but the session failed at the authentication stage.';
    case 111:
      return 'mcd reported a connected state in this cycle.';
    default:
      return null;
  }
}

function evidenceLabelForKey(state: number | null, key: JmaParserEvidenceKey): string {
  return getJmaParserConfig(state)?.evidenceFields.find((field) => field.key === key)?.label
    ?? DEFAULT_EVIDENCE_LABELS[key]
    ?? key;
}

function extractStateSpecificEvidence(cycle: McdParsedCycle | null, state: number | null): EvidenceRow[] {
  if (!cycle || state == null) return [];

  const facts = extractEvidenceFacts(cycle);
  const conclusion = deriveStateConclusion(state, facts);
  if (conclusion) {
    pushFact(facts, 'mcd_conclusion', conclusion);
  }

  const configuredKeys = getJmaParserConfig(state)?.evidenceFields.map((field) => field.key) ?? GENERIC_EVIDENCE_ORDER;
  const orderedKeys = configuredKeys.filter((key, index) => configuredKeys.indexOf(key) === index);
  const rows: EvidenceRow[] = [];
  for (const key of orderedKeys) {
    const values = facts[key] ?? [];
    for (const value of values) {
      rows.push({ label: evidenceLabelForKey(state, key), value });
    }
  }

  return rows;
}

function statusFromLatestCycle(cycle: McdParsedCycle | null): CheckStatus {
  if (!cycle) return 'warn';

  const state = latestState(cycle);
  if (state === 111) return 'pass';
  if (state === 107) return 'info';
  if (state != null) return 'fail';
  if (cycle.disconnectReason) return 'warn';
  return 'warn';
}

function remediationForState(state: number | null): string | undefined {
  switch (state) {
    case 102:
      return 'Restore management IP configuration or DHCP reachability first, then rerun the parser-backed analysis.';
    case 103:
      return 'Fix the default route before running downstream DNS or cloud-path checks.';
    case 104:
      return 'Validate gateway reachability and the management-path VLAN/uplink before focusing on cloud checks.';
    case 106:
    case 113:
    case 114:
      return 'Focus on DNS configuration and resolver reachability rather than adding duplicate app-side DNS tests.';
    case 108:
      return 'Investigate the routed/firewall path to Mist. DNS has already succeeded, so the remaining problem is cloud reachability.';
    case 109:
      return 'Check outbound-SSH identity, credentials, and auth policy rather than basic transport.';
    case 111:
      return 'mcd currently reports healthy connectivity. Only keep additional checks that add value beyond this device-native evidence.';
    default:
      return undefined;
  }
}

function remediationForCycle(cycle: McdParsedCycle | null, fallbackStateCode?: number | null): string | undefined {
  if (!cycle) {
    return 'Expand the mcd log window or verify file selection before relying on parser-backed conclusions.';
  }

  const state = latestState(cycle);
  if (state == null && fallbackStateCode != null) {
    const fallbackRemediation = remediationForState(fallbackStateCode);
    if (fallbackRemediation) {
      return fallbackRemediation;
    }
  }

  if (cycle.killPath === 'keep-alive-timeout') {
    return 'mcd stopped receiving jmd heartbeats. Check Mist agent health and consider restarting the Mist agent after reviewing the surrounding cycle.';
  }
  if (cycle.killPath === 'cloud-disconnect') {
    return 'The agent lost its cloud session and tore down jmd as part of recovery. Check the upstream path to Mist before focusing on local agent restarts.';
  }

  const stateRemediation = remediationForState(state ?? fallbackStateCode ?? null);
  if (stateRemediation) {
    return stateRemediation;
  }

  return cycle.disconnectReason
    ? 'Use the recorded disconnect reason and surrounding cycle evidence to decide whether any additional live checks add value.'
    : undefined;
}

function buildDetail(
  parsed: McdParsedLog,
  latestCycleData: McdParsedCycle | null,
  lastDisconnectCycle: McdParsedCycle | null,
  options: McdLogAnalysisOptions,
): string {
  if (!latestCycleData) {
    return 'No mcd diagnostic signal was found in the supplied log window.';
  }

  const currentState = latestState(latestCycleData);
  const effectiveState = currentState ?? options.fallbackStateCode ?? null;
  const lines: string[] = [`Current state: ${describeState(effectiveState)}`];

  if (currentState == null && options.fallbackStateCode != null) {
    lines.push('State source: live switch cloud status (no SetState transition was present in the current live mcd window)');
  } else if (currentState == null && latestCycleData.rawLines.length > 0) {
    lines.push('State source: no SetState transition was present in the current live mcd window');
  }

  if (latestCycleData.retryIntervalSeconds != null) {
    lines.push(`Retry interval: ${latestCycleData.retryIntervalSeconds}s`);
  }

  const killPath = describeKillPath(latestCycleData);
  if (killPath) {
    lines.push(`Current cycle: ${killPath}`);
  }

  const disconnectCycle = latestCycleData.disconnectReason ? latestCycleData : lastDisconnectCycle;
  if (disconnectCycle?.disconnectReason) {
    const sent = disconnectCycle.disconnectReason.event_sent ? 'sent to Mist' : 'not yet sent to Mist';
    lines.push(`Last disconnect: ${disconnectCycle.disconnectReason.reason}`);
    lines.push(`Disconnect timestamp: ${disconnectCycle.disconnectReason.timestamp}`);
    lines.push(`Disconnect delivery: ${sent}`);
    lines.push(`Disconnect state: ${describeState(disconnectCycle.disconnectReason.cc_state)}`);
  }

  const evidenceState = disconnectCycle?.disconnectReason?.cc_state ?? effectiveState;
  const stateSpecificEvidence = extractStateSpecificEvidence(disconnectCycle, evidenceState);
  const evidenceRows = stateSpecificEvidence.length > 0 ? stateSpecificEvidence : extractGenericEvidence(disconnectCycle);
  evidenceRows.forEach((row, index) => {
    const label = row.label === 'Observed test' ? `Observed test ${index + 1}` : row.label;
    lines.push(`${label}: ${row.value}`);
  });

  if (!disconnectCycle && currentState == null && options.fallbackStateCode != null) {
    lines.push('Retained evidence: the switch reported a live cloud state, but no disconnect cycle was captured in the retained mcd evidence window.');
  }

  lines.push(`Evidence window: ${parsed.cycles.length} cycle${parsed.cycles.length === 1 ? '' : 's'} from ${parsed.signalLines} signal line${parsed.signalLines === 1 ? '' : 's'}`);

  return lines.join('\n');
}

function buildRaw(latestCycleData: McdParsedCycle | null, lastDisconnectCycle: McdParsedCycle | null): string | undefined {
  const sections: string[] = [];

  if (lastDisconnectCycle?.rawLines.length) {
    sections.push(['[disconnect cycle]', ...lastDisconnectCycle.rawLines].join('\n'));
  }

  if (latestCycleData?.rawLines.length) {
    const sameCycle = lastDisconnectCycle?.cycleNumber === latestCycleData.cycleNumber;
    if (!sameCycle) {
      sections.push(['[current cycle]', ...latestCycleData.rawLines].join('\n'));
    }
  }

  return sections.length > 0 ? sections.join('\n\n') : undefined;
}

export function buildMcdLogAnalysisResult(parsed: McdParsedLog, options: McdLogAnalysisOptions = {}): CheckResult {
  const latestCycleData = parsed.cycles.length > 0 ? parsed.cycles[parsed.cycles.length - 1] : null;
  const lastDisconnectCycle = [...parsed.cycles].reverse().find((cycle) => cycle.disconnectReason) ?? null;
  const effectiveState = latestCycleData ? (latestState(latestCycleData) ?? options.fallbackStateCode ?? null) : options.fallbackStateCode ?? null;
  const status = latestCycleData
    ? (latestState(latestCycleData) == null && effectiveState != null
      ? (effectiveState === 111 ? 'pass' : 'fail')
      : statusFromLatestCycle(latestCycleData))
    : 'warn';

  return {
    id: 'mcd-log-analysis',
    name: 'mcd Log Analysis',
    status,
    detail: buildDetail(parsed, latestCycleData, lastDisconnectCycle, options),
    raw: buildRaw(latestCycleData, lastDisconnectCycle),
    remediation: remediationForCycle(latestCycleData, options.fallbackStateCode),
  };
}
