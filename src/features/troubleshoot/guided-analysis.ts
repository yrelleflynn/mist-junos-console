import { getJmaRecommendation } from '../../config/jma-recommendations';
import type { CheckResult } from '../../services/troubleshoot.service';

export interface GuidedAnalysisCard {
  eyebrow: string;
  title: string;
  summary: string;
  conclusion?: string;
  findings?: string[];
}

export function buildDnsGuidedAnalysis(results: CheckResult[]): GuidedAnalysisCard | null {
  const dnsConfig = results.find((result) => result.id === 'dns-config');
  const dnsReachability = results.find((result) => result.id === 'dns-server-reachability');
  const dnsResolution = results.find((result) => result.id === 'dns-resolution');
  const dnsResults = [dnsConfig, dnsReachability, dnsResolution].filter(Boolean) as CheckResult[];
  if (dnsResults.length === 0) return null;

  const relevantDnsIssues = dnsResults.filter((result) => result.status === 'fail' || result.status === 'warn' || result.status === 'skip');
  if (relevantDnsIssues.length === 0) return null;

  const findings = dnsResults
    .filter((result) => result.detail)
    .map((result) => `${result.name}: ${result.detail}`);

  if (!dnsResolution) {
    const title = dnsConfig?.status === 'fail'
      ? 'DNS is not configured'
      : 'DNS path needs attention';
    const summary = dnsConfig?.status === 'fail'
      ? 'The switch does not currently have usable DNS resolvers configured, so cloud hostname resolution cannot succeed yet.'
      : 'DNS-related checks found a problem before hostname resolution completed. Review the findings below to restore resolver configuration or DNS-path reachability.';
    const conclusion = dnsConfig?.status === 'fail'
      ? 'Restore DNS servers first, either through DHCP Option 6 or static name-server configuration, then rerun the DNS checks.'
      : 'Fix the earliest failing DNS prerequisite first, then rerun the DNS group to confirm hostname resolution is working again.';
    return {
      eyebrow: 'Guided Analysis',
      title,
      summary,
      findings,
      conclusion,
    };
  }

  const raw = `${dnsResolution.raw || ''}`.toLowerCase();
  let conclusion = 'DNS resolution failed, so the switch still cannot resolve the hostnames it needs for cloud connectivity.';
  if ((dnsConfig?.detail || '').toLowerCase().includes('no dns servers found')) {
    conclusion = 'No DNS resolvers are currently available to the switch. There are no usable entries in the runtime resolver configuration, so DNS cannot work until resolvers are supplied via static configuration or DHCP.';
  } else if ((dnsReachability?.detail || '').toLowerCase().includes('no dns servers were available to test')) {
    conclusion = 'No DNS resolvers are currently available to the switch, so hostname resolution could not even be attempted. Restore resolver entries first, then retry the lookup.';
  } else if ((dnsReachability?.detail || '').toLowerCase().includes('reachable dns servers')
    && (raw.includes('no servers could be reached') || raw.includes('connection timed out'))) {
    conclusion = 'Configured DNS servers respond to ping, but Junos cannot reach them for actual DNS queries. This strongly suggests upstream DNS transport is being blocked, most likely firewall policy on UDP/TCP 53 between the switch and its resolvers.';
  } else if (dnsResolution.detail === 'Mist hostnames are unknown to the resolver') {
    conclusion = 'Public DNS still works, but the resolver reported the Mist hostname as unknown. This suggests split-DNS, selective filtering, or an internal DNS server that does not know or forward Juniper Mist domains.';
  } else if (dnsResolution.detail === 'Resolver returned unknown host responses') {
    conclusion = 'The resolver answered the queries, but returned unknown-host responses for both public and Mist names. That points to a resolver content, recursion, or DNS policy problem rather than pure transport blocking.';
  } else if (dnsResolution.detail === 'Mist hostname was unknown to the resolver') {
    conclusion = 'The resolver answered the lookup, but it does not know the Mist hostname being queried. This points to a resolver content or forwarding problem rather than a raw connectivity issue.';
  } else if (raw.includes('unknown host') || raw.includes('host name lookup failure')) {
    conclusion = 'The resolver answered the lookup, but reported the hostname as unknown. That points to a DNS content or hostname problem rather than pure transport blocking.';
  }

  return {
    eyebrow: 'Guided Analysis',
    title: 'DNS lookup is failing',
    summary: 'The switch can see configured DNS servers, but name resolution is still failing. Use the findings below to decide whether the issue is transport, resolver content, or stale DHCP-supplied DNS settings.',
    findings,
    conclusion,
  };
}

export function buildGenericCheckSummary(
  results: CheckResult[],
  options: { title?: string | null } = {},
): GuidedAnalysisCard | null {
  if (results.length === 0) return null;

  const counts = { pass: 0, fail: 0, warn: 0, skip: 0, info: 0 };
  results.forEach((result) => {
    if (result.status in counts) counts[result.status as keyof typeof counts] += 1;
  });

  const title = options.title ?? 'Check Summary';
  const findings = results
    .filter((result) => result.status === 'fail' || result.status === 'warn' || result.status === 'skip')
    .slice(0, 4)
    .map((result) => `${result.name}: ${result.detail}`);

  const summary = `${results.length} checks completed: ${counts.pass} pass, ${counts.fail} fail, ${counts.warn} warn, ${counts.skip} skip.`;
  let conclusion: string | undefined;
  if (counts.fail > 0) {
    conclusion = 'Address the failing checks first, then rerun the group to confirm the path is healthy end to end.';
  } else if (counts.warn > 0) {
    conclusion = 'The group completed without hard failures, but there are still warnings worth resolving before treating the path as healthy.';
  } else if (counts.skip > 0) {
    conclusion = 'Some checks were skipped because an earlier prerequisite was missing. Fix the prerequisite and rerun the group if you need full coverage.';
  } else if (results.length > 1) {
    conclusion = 'The group completed cleanly with no failing checks.';
  } else {
    return null;
  }

  return {
    eyebrow: 'Guided Analysis',
    title,
    summary,
    findings,
    conclusion,
  };
}

export function buildGuidedAnalysisForJma(code: number | null, results: CheckResult[]): GuidedAnalysisCard | null {
  if (results.length === 0) return null;

  const dnsAnalysis = buildDnsGuidedAnalysis(results);
  if (dnsAnalysis) return dnsAnalysis;

  if (!code) return null;

  const recommendation = getJmaRecommendation(code);
  if (!recommendation) return null;
  const failing = results.filter((result) => result.status === 'fail' || result.status === 'warn');
  const findings = failing.slice(0, 3).map((result) => `${result.name}: ${result.detail}`);
  return {
    eyebrow: 'Guided Analysis',
    title: recommendation.title,
    summary: recommendation.summary,
    findings,
  };
}

export function buildGuidedAnalysisForRun(
  results: CheckResult[],
  options: { jmaCode?: number | null; title?: string | null } = {},
): GuidedAnalysisCard | null {
  return buildGuidedAnalysisForJma(options.jmaCode ?? null, results)
    ?? buildGenericCheckSummary(results, { title: options.title ?? null });
}
