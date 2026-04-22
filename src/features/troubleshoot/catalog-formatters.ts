import type { CheckResult } from '../../services/troubleshoot.service';

function truncateBadgeText(text: string, max = 42): string {
  return text.length > max ? `${text.slice(0, max - 2)}…` : text;
}

type ParsedDetail = {
  rows: Array<{ label: string; value: string }>;
  extras: string[];
};

export function formatBrowserLocalTimestamp(
  value: string,
  locale?: string,
  timeZone?: string,
): string {
  const timestampMs = Date.parse(value);
  if (!Number.isFinite(timestampMs)) return value;
  try {
    return new Intl.DateTimeFormat(locale, {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
      timeZoneName: 'short',
      ...(timeZone ? { timeZone } : {}),
    }).format(new Date(timestampMs));
  } catch {
    return value;
  }
}

function parseLabeledDetail(detail: string): ParsedDetail {
  const rows: Array<{ label: string; value: string }> = [];
  const extras: string[] = [];
  for (const line of detail.split('\n').map((entry) => entry.trim()).filter(Boolean)) {
    const separator = line.indexOf(':');
    if (separator <= 0) {
      extras.push(line);
      continue;
    }
    rows.push({
      label: line.slice(0, separator).trim(),
      value: line.slice(separator + 1).trim(),
    });
  }
  return { rows, extras };
}

function formatMcdRowValue(label: string, value: string): string {
  if (label.toLowerCase().includes('timestamp') || label.toLowerCase().includes('last seen')) {
    return formatBrowserLocalTimestamp(value);
  }
  return value;
}

export function formatMcdAnalysisDetailLines(detail: string): string[] {
  const parsed = parseLabeledDetail(detail);
  const lines = parsed.rows.map((row) => `${row.label}: ${formatMcdRowValue(row.label, row.value)}`);
  return [...lines, ...parsed.extras];
}

function extractMcdLabelValue(detail: string, label: string): string | null {
  const parsed = parseLabeledDetail(detail);
  return parsed.rows.find((row) => row.label === label)?.value ?? null;
}

function buildMcdAnalysisHtml(result: CheckResult, escapeHtml: (text: string) => string): string {
  const { rows, extras } = parseLabeledDetail(result.detail);

  const currentStateValue = rows.find((row) => row.label === 'Current state')?.value ?? 'Unknown';
  const currentState = currentStateValue.toLowerCase() === 'unknown'
    ? 'State unresolved in current window'
    : currentStateValue;
  const summaryRow = rows.find((row) => row.label === 'Last disconnect');
  const summary = summaryRow
    ? `Last recorded disconnect: ${summaryRow.value}`
    : 'No disconnect reason was found in the retained evidence window.';
  const otherRows = rows.filter((row) => row.label !== 'Current state' && row.label !== 'Last disconnect');

  return `
    <div class="detail-output ${result.status} mcd-analysis">
      <div class="mcd-analysis-card">
        <div class="mcd-analysis-eyebrow">mcd parser summary</div>
        <div class="mcd-analysis-summary">${escapeHtml(currentState)}</div>
        <div class="mcd-analysis-copy">${escapeHtml(summary)}</div>
        ${otherRows.length > 0
          ? `
            <div class="mcd-analysis-grid">
              ${otherRows.map((row) => `
                <div class="mcd-analysis-row">
                  <span class="mcd-analysis-label">${escapeHtml(row.label)}</span>
                  <span class="mcd-analysis-value">${escapeHtml(formatMcdRowValue(row.label, row.value))}</span>
                </div>
              `).join('')}
            </div>
          `
          : ''}
        ${extras.length > 0
          ? `
            <div class="mcd-analysis-notes">
              ${extras.map((line) => `<div class="mcd-analysis-note">${escapeHtml(line)}</div>`).join('')}
            </div>
          `
          : ''}
      </div>
    </div>
  `;
}

export function catalogWorstStatus(results: CheckResult[]): string {
  const priority: Record<string, number> = { fail: 5, warn: 4, info: 3, skip: 2, pass: 1, pending: 0 };
  return results.reduce((worst, result) => {
    const candidatePriority = priority[result.status] ?? 0;
    return candidatePriority > (priority[worst] ?? 0) ? result.status : worst;
  }, 'pass');
}

export function catalogBadgeText(catalogId: string, results: CheckResult[]): string {
  if (results.length === 0) return '—';
  if (catalogId === 'fw-check') {
    const pass = results.filter((result) => result.status === 'pass').length;
    const fail = results.filter((result) => result.status === 'fail').length;
    const total = results.length;
    if (fail === 0) return `${total}/${total} ok`;
    return `${fail} blocked`;
  }
  if (catalogId === 'mist-last-seen') {
    const seen = results.find((result) => result.id === 'mist-last-seen');
    if (seen) return seen.detail.length > 40 ? `${seen.detail.slice(0, 38)}…` : seen.detail;
  }
  if (catalogId === 'mcd-log-analysis') {
    const last = results[results.length - 1];
    const currentState = extractMcdLabelValue(last.detail, 'Current state');
    if (currentState && currentState.toLowerCase() !== 'unknown') return truncateBadgeText(currentState);
    const lastDisconnect = extractMcdLabelValue(last.detail, 'Last disconnect');
    if (lastDisconnect) return truncateBadgeText(lastDisconnect);
  }
  const last = results[results.length - 1];
  const text = last.detail;
  return truncateBadgeText(text);
}

export function catalogBadgeTooltipText(catalogId: string, results: CheckResult[]): string {
  if (results.length === 0) return '';
  if (catalogId === 'fw-check') {
    return results.map((result) => result.detail).filter(Boolean).join('\n');
  }
  const last = [...results]
    .reverse()
    .find((result) => result.status !== 'running' && result.status !== 'pending') ?? results[results.length - 1];
  const parts = [last.detail, last.remediation].filter(Boolean);
  return parts.join('\n\n');
}

export function buildCatalogDetailHtml(
  results: CheckResult[],
  escapeHtml: (text: string) => string,
): string {
  if (results.length === 0) return '';
  let html = '';
  for (const result of results) {
    if (result.commands && result.commands.length > 0) {
      for (const cmd of result.commands) {
        html += `<div class="detail-cmd"><span class="detail-cmd-prompt">&gt;</span><span class="detail-cmd-text">${escapeHtml(cmd)}</span></div>`;
      }
    }
    if (result.detail) {
      if (result.id === 'mcd-log-analysis') {
        html += buildMcdAnalysisHtml(result, escapeHtml);
      } else {
        html += `<div class="detail-output ${result.status}">${escapeHtml(result.detail)}</div>`;
      }
    }
    if (result.raw && result.raw.trim() && result.raw.trim() !== result.detail.trim()) {
      html += `
          <details class="detail-raw-toggle">
            <summary>Raw console output</summary>
            <div class="detail-output ${result.status}">${escapeHtml(result.raw)}</div>
          </details>
        `;
    }
    if (result.remediation && (result.status === 'fail' || result.status === 'warn' || result.status === 'info')) {
      const remClass = result.status === 'fail' ? 'fail' : result.status === 'info' ? 'info' : '';
      const icon = result.status === 'fail' ? '✕' : '⚠';
      html += `<div class="detail-remediation ${remClass}"><span class="detail-remediation-icon">${icon}</span><span>${escapeHtml(result.remediation)}</span></div>`;
    }
  }
  return html;
}
