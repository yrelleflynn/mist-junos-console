import type { CheckContext, CheckResult } from './base';
import type { CheckStatus } from '../services/troubleshoot.service';
import type { MistDeviceEvent } from '../services/mist-api.service';
import {
  formatOffsetEastLabel,
  getJunosLogLineUtcMs,
  parseCurrentTimeFromUptime,
} from '../utils/junos-log-time';

/**
 * Run the offline timeline analysis.
 * Correlates Mist API events/stats/audit-logs with switch-side syslog entries
 * to determine why and when a switch went offline.
 *
 * Not a standard Check — returns multiple CheckResult objects for display.
 */
export async function runOfflineTimeline(
  ctx: CheckContext,
  siteId?: string,
  deviceId?: string,
): Promise<CheckResult[]> {
  const { runner, mistApi } = ctx;
  const results: CheckResult[] = [];

  // Step 1: Get last disconnect time from Mist API
  let mistDisconnectTime: Date | null = null;
  let mistEvents: MistDeviceEvent[] = [];

  if (mistApi?.isConfigured && siteId && deviceId) {
    // Get device stats for last_seen
    const stats = await mistApi.getDeviceStats(siteId, deviceId);
    if (stats?.last_seen) {
      mistDisconnectTime = new Date(stats.last_seen * 1000);
      const ago = timeAgo(mistDisconnectTime);
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
      mistEvents = await mistApi.getDeviceEvents(siteId, deviceId, 20);
      if (mistEvents.length > 0) {
        // Find disconnect events
        const disconnectEvents = mistEvents.filter((e) =>
          e.type?.includes('DISCONNECTED') ||
          e.type?.includes('disconnect') ||
          e.text?.includes('disconnected')
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
        detail: 'Could not fetch events from Mist API',
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
        `mistApiConfigured=${mistApi?.isConfigured ? 'yes' : 'no'} siteId=${safeSite} deviceId=${safeDevice}`,
    });
  }

  // Step 2: Get switch uptime
  let uptimeRaw = '';
  const uptimeCmd = await runner.execute('show system uptime', 10000);
  if (uptimeCmd.success) {
    uptimeRaw = uptimeCmd.output;
    const bootMatch = uptimeCmd.output.match(/System booted:\s*(.+?)(?:\s*\(|$)/m);
    const lastConfigMatch = uptimeCmd.output.match(/Last configured:\s*(.+?)(?:\s*\(|$)/m);
    const lastConfigBy = uptimeCmd.output.match(/Last configured:.*by\s+(\S+)/m);

    let detail = '';
    if (bootMatch) detail += `Booted: ${bootMatch[1].trim()}`;
    if (lastConfigMatch) detail += ` | Last config: ${lastConfigMatch[1].trim()}`;
    if (lastConfigBy) detail += ` by ${lastConfigBy[1]}`;

    results.push({
      id: 'switch-uptime',
      name: 'Switch Uptime',
      status: 'info' as CheckStatus,
      detail: detail || 'Could not parse uptime',
      raw: uptimeCmd.output,
    });
  }

  // Step 3: Check Mist audit logs for config changes around the disconnect time
  if (mistApi?.isConfigured && mistDisconnectTime) {
    const auditResult = await checkAuditLogs(mistApi, mistDisconnectTime, siteId);
    results.push(auditResult);
  }

  // Step 4: Pull switch logs around the disconnect time
  const logResults = await getRelevantLogs(runner, mistDisconnectTime, uptimeRaw);
  results.push(...logResults);

  return results;
}

/**
 * Check Mist audit logs for configuration changes around the disconnect time.
 * Looks for changes within ±30 minutes of the disconnect event.
 */
async function checkAuditLogs(
  mistApi: NonNullable<CheckContext['mistApi']>,
  disconnectTime: Date,
  siteId?: string,
): Promise<CheckResult> {
  const id = 'mist-audit-logs';
  const name = 'Mist Audit Logs (config changes)';

  try {
    // Search ±30 minutes around the disconnect time
    const windowMs = 30 * 60 * 1000;
    const startTime = Math.floor((disconnectTime.getTime() - windowMs) / 1000);
    const endTime = Math.floor((disconnectTime.getTime() + windowMs) / 1000);

    const logs = await mistApi.getAuditLogs(startTime, endTime, 50);

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
async function resolveMistAgentLogFile(
  runner: CheckContext['runner'],
): Promise<{ file: string; reason: string }> {
  const cmd = await runner.execute('show version | match mist', 15000);
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
async function getRelevantLogs(
  runner: CheckContext['runner'],
  disconnectTime: Date | null,
  uptimeOutput?: string,
): Promise<CheckResult[]> {
  const results: CheckResult[] = [];

  let uptimeText = (uptimeOutput ?? '').trim();
  if (!uptimeText) {
    const up = await runner.execute('show system uptime', 10000);
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

  const { file: mistLogFile, reason: mistLogReason } = await resolveMistAgentLogFile(runner);

  // Pull a large window: Mist agent log (jmd.log or mist.log) + system messages
  const mistLogCmd = await runner.execute(`show log ${mistLogFile} | last 200`, 30000, 5000);
  const sysLogCmd = await runner.execute('show log messages | last 200', 30000, 5000);

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

  const categoriseLine = (line: string): string[] => {
    return problemKeywords
      .filter((kw) => kw.pattern.test(line))
      .map((kw) => kw.category);
  };

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
function timeAgo(date: Date): string {
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ${minutes % 60}m ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ${hours % 24}h ago`;
}
