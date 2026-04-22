import { describe, expect, it } from 'vitest';

import {
  buildCatalogDetailHtml,
  catalogBadgeText,
  catalogBadgeTooltipText,
  catalogWorstStatus,
  formatBrowserLocalTimestamp,
  formatMcdAnalysisDetailLines,
} from '../src/features/troubleshoot/catalog-formatters';
import type { CheckResult } from '../src/services/troubleshoot.service';

function makeResult(overrides: Partial<CheckResult> & Pick<CheckResult, 'id' | 'name' | 'status' | 'detail'>): CheckResult {
  return {
    ...overrides,
  };
}

const escapeHtml = (text: string): string => (
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
);

describe('troubleshoot catalog formatters', () => {
  it('chooses the worst status by severity', () => {
    const results: CheckResult[] = [
      makeResult({ id: 'a', name: 'A', status: 'pass', detail: 'ok' }),
      makeResult({ id: 'b', name: 'B', status: 'warn', detail: 'warn' }),
      makeResult({ id: 'c', name: 'C', status: 'fail', detail: 'fail' }),
    ];

    expect(catalogWorstStatus(results)).toBe('fail');
  });

  it('formats firewall badge text as a summary count', () => {
    const results: CheckResult[] = [
      makeResult({ id: 'a', name: 'A', status: 'pass', detail: 'ok' }),
      makeResult({ id: 'b', name: 'B', status: 'fail', detail: 'blocked' }),
      makeResult({ id: 'c', name: 'C', status: 'fail', detail: 'blocked' }),
    ];

    expect(catalogBadgeText('fw-check', results)).toBe('2 blocked');
  });

  it('formats timeline badge text from mist-last-seen detail', () => {
    const results: CheckResult[] = [
      makeResult({ id: 'mist-last-seen', name: 'Mist Last Seen', status: 'warn', detail: 'last seen 5 minutes ago' }),
    ];

    expect(catalogBadgeText('mist-last-seen', results)).toBe('last seen 5 minutes ago');
  });

  it('builds tooltip text from the last non-running result and remediation', () => {
    const results: CheckResult[] = [
      makeResult({ id: 'a', name: 'A', status: 'running', detail: 'working' }),
      makeResult({ id: 'b', name: 'B', status: 'fail', detail: 'Broken', remediation: 'Fix it' }),
    ];

    expect(catalogBadgeTooltipText('dns-config', results)).toBe('Broken\n\nFix it');
  });

  it('formats mcd analysis as a structured summary card and concise badge', () => {
    const results: CheckResult[] = [
      makeResult({
        id: 'mcd-log-analysis',
        name: 'mcd Log Analysis',
        status: 'pass',
        detail: [
          'Current state: Connected (111)',
          'Last disconnect: DNSLookupFailed',
          'Disconnect timestamp: 2026-04-22 03:08:49 UTC',
          'Analysis scope: Mist context was unavailable, so analysis is based on the current live mcd window only.',
        ].join('\n'),
      }),
    ];

    const html = buildCatalogDetailHtml(results, escapeHtml);
    expect(catalogBadgeText('mcd-log-analysis', results)).toBe('Connected (111)');
    expect(html).toContain('mcd parser summary');
    expect(html).toContain('Connected (111)');
    expect(html).toContain('Analysis scope');
    expect(html).toContain('Last recorded disconnect: DNSLookupFailed');
  });

  it('formats mcd timestamps in the browser local timezone for display helpers', () => {
    expect(formatBrowserLocalTimestamp('2026-04-22T05:20:50Z', 'en-AU', 'Australia/Melbourne')).toContain('15:20:50');
    const lines = formatMcdAnalysisDetailLines([
      'Disconnect timestamp: 2026-04-22T05:20:50Z',
      'Mist last seen: 2026-04-22T05:20:56Z',
    ].join('\n'));
    expect(lines[0]).not.toContain('2026-04-22T05:20:50Z');
    expect(lines[1]).not.toContain('2026-04-22T05:20:56Z');
  });

  it('renders detail HTML with commands, raw output, and remediation', () => {
    const results: CheckResult[] = [
      makeResult({
        id: 'b',
        name: 'B',
        status: 'fail',
        detail: 'Broken <thing>',
        remediation: 'Fix > now',
        commands: ['set system host-name sw1'],
        raw: 'raw output',
      }),
    ];

    const html = buildCatalogDetailHtml(results, escapeHtml);
    expect(html).toContain('detail-cmd');
    expect(html).toContain('set system host-name sw1');
    expect(html).toContain('Broken &lt;thing&gt;');
    expect(html).toContain('Fix &gt; now');
    expect(html).toContain('Raw console output');
  });
});
