import type { CheckId, CheckResult, CheckStatus } from '@marvis/shared';
import { CHECKS, GROUPS } from '@marvis/shared';

interface TroubleshootPanelProps {
  results: Map<CheckId, CheckResult>;
  running: boolean;
  onRunAll: () => void;
  onRunOne: (id: CheckId) => void;
}

const STATUS_COLOR: Record<CheckStatus, string> = {
  pass: 'var(--color-pass)',
  fail: 'var(--color-fail)',
  warn: 'var(--color-warn)',
  skip: 'var(--color-skip)',
  pending: 'var(--color-text-muted)',
  running: 'var(--color-running)',
  error: 'var(--color-fail)',
};

const STATUS_LABEL: Record<CheckStatus, string> = {
  pass: 'PASS',
  fail: 'FAIL',
  warn: 'WARN',
  skip: 'SKIP',
  pending: '—',
  running: '...',
  error: 'ERR',
};

function Badge({ status }: { status: CheckStatus }) {
  return (
    <span
      style={{
        display: 'inline-block',
        minWidth: '3rem',
        textAlign: 'center',
        padding: '1px 6px',
        borderRadius: '4px',
        fontSize: '11px',
        fontWeight: 600,
        letterSpacing: '0.05em',
        color: STATUS_COLOR[status],
        border: `1px solid ${STATUS_COLOR[status]}`,
        opacity: status === 'pending' ? 0.4 : 1,
      }}
    >
      {STATUS_LABEL[status]}
    </span>
  );
}

function CheckRow({
  check,
  result,
  onRun,
  running,
}: {
  check: (typeof CHECKS)[number];
  result: CheckResult | undefined;
  onRun: () => void;
  running: boolean;
}) {
  const status: CheckStatus = result?.status ?? 'pending';

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'flex-start',
        gap: '8px',
        padding: '6px 8px',
        borderRadius: '4px',
        background: status === 'fail' || status === 'error' ? '#f95f5f10' : 'transparent',
      }}
    >
      <Badge status={status} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: '12px', fontWeight: 500, color: 'var(--color-text)' }}>
          {check.label}
        </div>
        {result?.summary && (
          <div style={{ fontSize: '11px', color: 'var(--color-text-muted)', marginTop: '2px' }}>
            {result.summary}
          </div>
        )}
        {result?.detail && (
          <pre
            style={{
              fontSize: '10px',
              color: 'var(--color-text-muted)',
              marginTop: '4px',
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-all',
            }}
          >
            {result.detail}
          </pre>
        )}
      </div>
      <button
        onClick={onRun}
        disabled={running}
        style={{
          flexShrink: 0,
          padding: '2px 6px',
          fontSize: '10px',
          background: 'var(--color-surface-2)',
          color: 'var(--color-text-muted)',
          border: '1px solid var(--color-border)',
          borderRadius: '3px',
        }}
      >
        Run
      </button>
    </div>
  );
}

export function TroubleshootPanel({ results, running, onRunAll, onRunOne }: TroubleshootPanelProps) {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        background: 'var(--color-surface)',
        borderLeft: '1px solid var(--color-border)',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '10px 12px',
          borderBottom: '1px solid var(--color-border)',
          flexShrink: 0,
        }}
      >
        <span style={{ fontSize: '12px', fontWeight: 600, color: 'var(--color-text-muted)', letterSpacing: '0.08em' }}>
          DIAGNOSTICS
        </span>
        <button
          onClick={onRunAll}
          disabled={running}
          style={{
            padding: '4px 10px',
            fontSize: '11px',
            fontWeight: 600,
            background: running ? 'var(--color-surface-2)' : 'var(--color-accent)',
            color: running ? 'var(--color-text-muted)' : '#fff',
            border: 'none',
            borderRadius: '4px',
          }}
        >
          {running ? 'Running…' : 'Run All'}
        </button>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '8px' }}>
        {GROUPS.map((group) => {
          const groupChecks = CHECKS.filter((c) => c.groupId === group.id);
          return (
            <div key={group.id} style={{ marginBottom: '16px' }}>
              <div
                style={{
                  fontSize: '10px',
                  fontWeight: 700,
                  letterSpacing: '0.1em',
                  color: 'var(--color-text-muted)',
                  padding: '0 8px 4px',
                  borderBottom: '1px solid var(--color-border)',
                  marginBottom: '4px',
                }}
              >
                {group.label.toUpperCase()}
              </div>
              {groupChecks.map((check) => (
                <CheckRow
                  key={check.id}
                  check={check}
                  result={results.get(check.id)}
                  onRun={() => onRunOne(check.id)}
                  running={running}
                />
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}
