import type { TroubleshootContext } from '@marvis/shared';
import type { CliExecutor } from '../runner.js';

const WINDOW_SECONDS = 15 * 60; // ±15 minutes around offline event
const MAX_LINES = 300;

export default async function resolveMcdLogs(
  cli: CliExecutor,
  ctx: TroubleshootContext,
): Promise<Partial<TroubleshootContext>> {
  const { mcdLogFile, offlineAt } = ctx;
  if (!mcdLogFile || !offlineAt) return {};

  const out = await cli.run(`show log ${mcdLogFile} | last ${MAX_LINES}`).catch(() => '');
  if (!out.trim()) return {};

  const windowStart = offlineAt - WINDOW_SECONDS;
  const windowEnd = offlineAt + WINDOW_SECONDS;
  const filtered = out.split('\n').filter((line) => isInWindow(line, windowStart, windowEnd));

  // Fall back to all lines if timestamp parsing yielded nothing.
  const mcdLogLines = filtered.length > 0 ? filtered : out.split('\n').filter(Boolean);
  return { mcdLogLines };
}

function isInWindow(line: string, start: number, end: number): boolean {
  const ts = parseTimestamp(line);
  if (ts === null) return true;
  return ts >= start && ts <= end;
}

function parseTimestamp(line: string): number | null {
  const iso = line.match(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
  if (iso) {
    const ms = Date.parse(iso[0]);
    return isNaN(ms) ? null : Math.floor(ms / 1000);
  }
  // Syslog: "Apr  1 10:00:00" — assume current year
  const syslog = line.match(/^(\w{3}\s+\d{1,2}\s+\d{2}:\d{2}:\d{2})/);
  if (syslog) {
    const ms = Date.parse(`${syslog[1]} ${new Date().getFullYear()}`);
    return isNaN(ms) ? null : Math.floor(ms / 1000);
  }
  return null;
}
