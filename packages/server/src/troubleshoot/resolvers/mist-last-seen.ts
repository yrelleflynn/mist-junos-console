import type { MistEvent, TroubleshootContext } from '@marvis/shared';
import { cloudConfig } from '@marvis/shared';
import type { CliExecutor } from '../runner.js';

const EVENT_WINDOW = 15 * 60; // ±15 min around offline event

export default async function resolveMistLastSeen(
  _cli: CliExecutor,
  ctx: TroubleshootContext,
): Promise<Partial<TroubleshootContext>> {
  const { mistSession, deviceMatch } = ctx;
  if (!mistSession || !deviceMatch || !mistSession.orgId) return {};
  const orgId = mistSession.orgId;

  const { apiBase } = cloudConfig(mistSession.cloud);
  const headers = {
    'Content-Type': 'application/json',
    'Cookie': `csrftoken=${mistSession.csrfToken}; sessionid=${mistSession.sessionId}`,
    'X-CSRFToken': mistSession.csrfToken,
  };

  const deviceRes = await fetch(
    `${apiBase}/api/v1/orgs/${orgId}/devices/search?mac=${encodeURIComponent(deviceMatch.mac)}&limit=1`,
    { headers },
  ).catch(() => null);

  if (!deviceRes?.ok) return {};

  const deviceJson = await deviceRes.json() as { results?: Array<{ last_seen?: number }> };
  const lastSeen = deviceJson.results?.[0]?.last_seen;
  if (!lastSeen) return {};

  const offlineAt = lastSeen;
  const start = offlineAt - EVENT_WINDOW;
  const end = offlineAt + EVENT_WINDOW;

  const eventsRes = await fetch(
    `${apiBase}/api/v1/orgs/${orgId}/devices/events?mac=${encodeURIComponent(deviceMatch.mac)}&type=SW_CONFIG_CHANGED_BY_USER&start=${start}&end=${end}`,
    { headers },
  ).catch(() => null);

  let mistEventsNearOffline: MistEvent[] = [];
  if (eventsRes?.ok) {
    const eventsJson = await eventsRes.json() as { results?: MistEvent[] };
    mistEventsNearOffline = eventsJson.results ?? [];
  }

  return { mistLastSeen: lastSeen, offlineAt, mistEventsNearOffline };
}
