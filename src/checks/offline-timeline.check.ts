import type { CheckContext, CheckResult, CheckStatus } from './base';
import type { MistDeviceEvent } from '../services/mist-api.service';

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

const parseLogMinutes = (line: string): number | null => {
  const match = line.match(/(\w{3})\s+(\d{1,2})\s+(\d{2}):(\d{2}):(\d{2})/);
  if (!match) return null;
  return parseInt(match[3], 10) * 60 + parseInt(match[4], 10);
};

const categoriseLine = (line: string): string[] =>
  problemKeywords.filter((kw) => kw.pattern.test(line)).map((kw) => kw.category);

function extractAroundDisconnect(
  lines: string[],
  disconnectTime: Date | null,
): { before: string[]; after: string[]; nearestIndex: number } {
  if (!disconnectTime) {
    return { before: lines.slice(-50), after: [], nearestIndex: -1 };
  }

  const discMinutes = disconnectTime.getUTCHours() * 60 + disconnectTime.getUTCMinutes();
  let nearestIndex = -1;
  let nearestDelta = Infinity;

  for (let i = 0; i < lines.length; i++) {
    const logMin = parseLogMinutes(lines[i]);
    if (logMin === null) continue;
    const delta = Math.abs(logMin - discMinutes);
    const wrappedDelta = Math.min(delta, 1440 - delta);
    if (wrappedDelta < nearestDelta) {
      nearestDelta = wrappedDelta;
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
}

async function checkAuditLogs(
  ctx: CheckContext,
  disconnectTime: Date,
  siteId?: string,
): Promise<CheckResult> {
  const id = 'mist-audit-logs';
  const name = 'Mist Audit Logs (config changes)';

  try {
    const windowMs = 30 * 60 * 1000;
    const startTime = Math.floor((disconnectTime.getTime() - windowMs) / 1000);
    const endTime = Math.floor((disconnectTime.getTime() + windowMs) / 1000);

    const logs = await ctx.mistApi!.getAuditLogs(startTime, endTime, 50);

    if (logs.length === 0) {
      return {
        id, name, status: 'pass',
        detail: 'No configuration changes in Mist within ±30 min of disconnect',
      };
    }

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

    const siteChanges = siteId ? logs.filter((log) => log.site_id === siteId) : [];

    const relevantLogs = [...new Map(
      [...configChanges, ...siteChanges].map((l) => [l.timestamp, l])
    ).values()];

    if (relevantLogs.length === 0) {
      return {
        id, name, status: 'pass',
        detail: `${logs.length} audit log(s) found but none are config changes`,
        raw: logs.map((l) => {
          const time = l.timestamp ? new Date(l.timestamp * 1000).toISOString().substring(11, 19) : '?';
          return `${time} [${l.admin_name || '?'}] ${l.message || ''}`;
        }).join('\n'),
      };
    }

    const summary = relevantLogs.map((l) => {
      const time = l.timestamp ? new Date(l.timestamp * 1000).toISOString().substring(11, 19) : '?';
      return `${time} [${l.admin_name || '?'}] ${l.message || ''}`;
    }).join('\n');

    return {
      id, name, status: 'warn',
      detail: `${relevantLogs.length} config change(s) found near disconnect time — may be related`,
      raw: summary,
    };
  } catch {
    return { id, name, status: 'warn', detail: 'Could not fetch audit logs from Mist API' };
  }
}

async function getRelevantLogs(
  runner: CheckContext['runner'],
  disconnectTime: Date | null,
): Promise<CheckResult[]> {
  const results: CheckResult[] = [];

  const mistLogCmd = await runner.execute('show log mist_agent.log | last 20', 30000, 5000);
  const sysLogCmd = await runner.execute('show log messages | last 20', 30000, 5000);

  const mistLogLines = mistLogCmd.success ? mistLogCmd.output.split('\n').filter((l) => l.trim().length > 0) : [];
  const sysLogLines = sysLogCmd.success ? sysLogCmd.output.split('\n').filter((l) => l.trim().length > 0) : [];

  if (mistLogLines.length === 0 && sysLogLines.length === 0) {
    results.push({ id: 'switch-logs', name: 'Switch Logs', status: 'warn', detail: 'Could not retrieve logs', raw: '' });
    return results;
  }

  if (sysLogLines.length > 0) {
    const { before, after, nearestIndex } = extractAroundDisconnect(sysLogLines, disconnectTime);
    const allContextLines = [...before, ...after];
    const interestingBefore = before.filter((l) => categoriseLine(l).length > 0);
    const interestingAfter = after.filter((l) => categoriseLine(l).length > 0);
    const allInteresting = [...interestingBefore, ...interestingAfter];
    const allCategories = [...new Set(allInteresting.flatMap((l) => categoriseLine(l)))];

    let detail: string;
    let raw: string;

    if (disconnectTime && nearestIndex >= 0) {
      const discTimeStr = disconnectTime.toISOString().substring(11, 19);
      detail = `${allInteresting.length} relevant entries near disconnect (${discTimeStr} UTC). ${before.length} before, ${after.length} after.`;
      raw = `--- ${before.length} lines BEFORE disconnect (${discTimeStr} UTC) ---\n` +
        before.map((l) => {
          const cats = categoriseLine(l);
          return cats.length > 0 ? `>>> [${cats.join(',')}] ${l}` : `    ${l}`;
        }).join('\n') +
        `\n\n--- DISCONNECT POINT (~${discTimeStr} UTC) ---\n\n` +
        `--- ${after.length} lines AFTER disconnect ---\n` +
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

    if (allCategories.length > 0) detail += ` Categories: ${allCategories.join(', ')}`;

    results.push({
      id: 'switch-logs-messages',
      name: 'System Messages (around disconnect)',
      status: allInteresting.length > 0 ? 'warn' : ('info' as CheckStatus),
      detail,
      raw,
    });
  }

  if (mistLogLines.length > 0) {
    const { before, after, nearestIndex } = extractAroundDisconnect(mistLogLines, disconnectTime);
    const allContextLines = [...before, ...after];
    const interestingBefore = before.filter((l) => categoriseLine(l).length > 0);
    const interestingAfter = after.filter((l) => categoriseLine(l).length > 0);
    const allInteresting = [...interestingBefore, ...interestingAfter];

    let detail: string;
    let raw: string;

    if (disconnectTime && nearestIndex >= 0) {
      const discTimeStr = disconnectTime.toISOString().substring(11, 19);
      detail = `${allInteresting.length} relevant entries near disconnect. ${before.length} before, ${after.length} after.`;
      raw = `--- ${before.length} lines BEFORE disconnect (${discTimeStr} UTC) ---\n` +
        before.join('\n') +
        `\n\n--- DISCONNECT POINT (~${discTimeStr} UTC) ---\n\n` +
        `--- ${after.length} lines AFTER disconnect ---\n` +
        after.join('\n');
    } else {
      detail = `${mistLogLines.length} Mist agent log lines retrieved.`;
      raw = allContextLines.join('\n');
    }

    results.push({
      id: 'switch-logs-mist-agent',
      name: 'Mist Agent Log (around disconnect)',
      status: allInteresting.length > 0 ? 'warn' : ('info' as CheckStatus),
      detail,
      raw,
    });
  }

  return results;
}

/** Not a Check interface implementation — called directly from runAll() */
export async function runOfflineTimeline(ctx: CheckContext): Promise<CheckResult[]> {
  const { runner, mistApi, siteId, deviceId } = ctx;
  const results: CheckResult[] = [];

  let mistDisconnectTime: Date | null = null;
  let mistEvents: MistDeviceEvent[] = [];

  if (mistApi?.isConfigured && siteId && deviceId) {
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

    try {
      mistEvents = await mistApi.getDeviceEvents(siteId, deviceId, 20);
      if (mistEvents.length > 0) {
        const disconnectEvents = mistEvents.filter((e) =>
          e.type?.includes('DISCONNECTED') ||
          e.type?.includes('disconnect') ||
          e.text?.includes('disconnected')
        );

        const lastDisconnect = disconnectEvents[0];
        if (lastDisconnect?.timestamp) {
          mistDisconnectTime = new Date(lastDisconnect.timestamp * 1000);
        }

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
    results.push({
      id: 'mist-last-seen',
      name: 'Mist Last Seen',
      status: 'skip',
      detail: 'Mist API not configured or device not identified — cannot check offline time',
    });
  }

  const uptimeCmd = await runner.execute('show system uptime', 10000);
  if (uptimeCmd.success) {
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

  if (mistApi?.isConfigured && mistDisconnectTime) {
    const auditResult = await checkAuditLogs(ctx, mistDisconnectTime, siteId);
    results.push(auditResult);
  }

  const logResults = await getRelevantLogs(runner, mistDisconnectTime);
  results.push(...logResults);

  return results;
}
