import { describe, expect, it } from 'vitest';

import {
  buildDnsGuidedAnalysis,
  buildGenericCheckSummary,
  buildGuidedAnalysisForRun,
} from '../src/features/troubleshoot/guided-analysis';
import type { CheckResult } from '../src/services/troubleshoot.service';

function makeResult(overrides: Partial<CheckResult> & Pick<CheckResult, 'id' | 'name' | 'status' | 'detail'>): CheckResult {
  return {
    ...overrides,
  };
}

describe('troubleshoot guided analysis', () => {
  it('returns null for DNS analysis when there are no DNS issues', () => {
    const results: CheckResult[] = [
      makeResult({ id: 'dns-config', name: 'DNS Config', status: 'pass', detail: 'Resolvers found' }),
      makeResult({ id: 'dns-server-reachability', name: 'DNS Reachability', status: 'pass', detail: 'Reachable' }),
      makeResult({ id: 'dns-resolution', name: 'DNS Resolution', status: 'pass', detail: 'Resolved' }),
    ];

    expect(buildDnsGuidedAnalysis(results)).toBeNull();
  });

  it('builds a missing-DNS analysis when resolvers are absent', () => {
    const results: CheckResult[] = [
      makeResult({ id: 'dns-config', name: 'DNS Config', status: 'fail', detail: 'No DNS servers found' }),
      makeResult({ id: 'dns-server-reachability', name: 'DNS Reachability', status: 'skip', detail: 'No DNS servers were available to test' }),
    ];

    expect(buildDnsGuidedAnalysis(results)).toMatchObject({
      title: 'DNS is not configured',
      conclusion: 'Restore DNS servers first, either through DHCP Option 6 or static name-server configuration, then rerun the DNS checks.',
    });
  });

  it('builds a transport-blocking DNS analysis when ping works but queries time out', () => {
    const results: CheckResult[] = [
      makeResult({ id: 'dns-config', name: 'DNS Config', status: 'pass', detail: 'Configured DNS servers: 8.8.8.8' }),
      makeResult({ id: 'dns-server-reachability', name: 'DNS Reachability', status: 'pass', detail: 'Found reachable DNS servers' }),
      makeResult({
        id: 'dns-resolution',
        name: 'DNS Resolution',
        status: 'fail',
        detail: 'Resolution failed',
        raw: 'no servers could be reached; connection timed out',
      }),
    ];

    expect(buildDnsGuidedAnalysis(results)?.conclusion).toContain('firewall policy on UDP/TCP 53');
  });

  it('builds a generic summary for failing multi-check runs', () => {
    const results: CheckResult[] = [
      makeResult({ id: 'a', name: 'Check A', status: 'pass', detail: 'OK' }),
      makeResult({ id: 'b', name: 'Check B', status: 'fail', detail: 'Broken' }),
      makeResult({ id: 'c', name: 'Check C', status: 'warn', detail: 'Caution' }),
    ];

    expect(buildGenericCheckSummary(results, { title: 'My Summary' })).toMatchObject({
      title: 'My Summary',
      summary: '3 checks completed: 1 pass, 1 fail, 1 warn, 0 skip.',
    });
  });

  it('returns null for a single all-pass result', () => {
    const results: CheckResult[] = [
      makeResult({ id: 'a', name: 'Check A', status: 'pass', detail: 'OK' }),
    ];

    expect(buildGenericCheckSummary(results)).toBeNull();
  });

  it('prefers DNS analysis over JMA fallback guidance', () => {
    const results: CheckResult[] = [
      makeResult({ id: 'dns-config', name: 'DNS Config', status: 'fail', detail: 'No DNS servers found' }),
      makeResult({ id: 'dns-server-reachability', name: 'DNS Reachability', status: 'skip', detail: 'No DNS servers were available to test' }),
    ];

    expect(buildGuidedAnalysisForRun(results, { jmaCode: 108 })?.title).toBe('DNS is not configured');
  });

  it('falls back to JMA guidance when no DNS-specific analysis applies', () => {
    const results: CheckResult[] = [
      makeResult({ id: 'fw-check', name: 'Firewall Policy Check', status: 'fail', detail: 'TCP 443 blocked' }),
    ];

    expect(buildGuidedAnalysisForRun(results, { jmaCode: 108 })?.title).toBe('Mist cloud unreachable');
  });
});
