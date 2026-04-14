/**
 * Parse Junos `messages` / `*.log` syslog-style lines and align them with UTC instants
 * using `show system uptime` "Current time" (switch-local wall clock + TZ abbrev).
 *
 * Example line: "Apr  2 16:50:35  EX2300-C mgd[1]: ..."
 */

const MONTHS: Record<string, number> = {
  Jan: 0,
  Feb: 1,
  Mar: 2,
  Apr: 3,
  May: 4,
  Jun: 5,
  Jul: 6,
  Aug: 7,
  Sep: 8,
  Oct: 9,
  Nov: 10,
  Dec: 11,
};

/** Minutes east of UTC (e.g. AEDT → +660). */
function parseGmtStyleOffset(token: string): number | null {
  const t = token.trim();
  const m = t.match(/^(?:GMT|UTC)([+-])(\d{1,2})(?::(\d{2}))?$/i);
  if (!m) return null;
  const sign = m[1] === '-' ? -1 : 1;
  const hours = parseInt(m[2], 10);
  const mins = m[3] ? parseInt(m[3], 10) : 0;
  return sign * (hours * 60 + mins);
}

/**
 * Map common Junos `Current time` timezone labels to minutes east of UTC.
 * Unknown or ambiguous tokens return null.
 */
export function timezoneAbbrevToOffsetMinutesEast(abbrev: string): number | null {
  const raw = abbrev.trim();
  const g = parseGmtStyleOffset(raw);
  if (g !== null) return g;

  const a = raw.toUpperCase().replace(/\.$/, '');
  const map: Record<string, number> = {
    UTC: 0,
    GMT: 0,
    UT: 0,
    Z: 0,
    WET: 0,
    CET: 60,
    CEST: 120,
    EET: 120,
    EEST: 180,
    BST: 60,
    MSK: 180,
    IST: 330,
    HKT: 480,
    AWST: 480,
    SGT: 480,
    PHT: 480,
    MYT: 480,
    WIB: 420,
    JST: 540,
    KST: 540,
    ACST: 570,
    ACDT: 630,
    AEST: 600,
    AEDT: 660,
    NZST: 720,
    NZDT: 780,
    HST: -600,
    AKST: -540,
    AKDT: -480,
    PST: -480,
    PDT: -420,
    MST: -420,
    MDT: -360,
    /** US Central; ambiguous with China Standard Time — prefer GMT±N in uptime if wrong. */
    CST: -360,
    CDT: -300,
    EST: -300,
    EDT: -240,
  };
  return map[a] ?? null;
}

export function parseJunosTimezoneToken(abbrev: string): number | null {
  return timezoneAbbrevToOffsetMinutesEast(abbrev);
}

export interface JunosUptimeTimeRef {
  year: number;
  month: number;
  day: number;
  abbrev: string;
  offsetEastMin: number;
  offsetKnown: boolean;
}

/**
 * Parse `Current time: 2026-04-02 16:53:37 AEDT` from `show system uptime`.
 */
export function parseCurrentTimeFromUptime(output: string): JunosUptimeTimeRef | null {
  // 1) Preferred: explicit "Current time: YYYY-MM-DD HH:MM:SS <TZ>"
  const mCurrent = output.match(
    /Current time:\s*(\d{4})-(\d{2})-(\d{2})\s+(\d{2}):(\d{2}):(\d{2})\s+(\S+)/im,
  );
  if (mCurrent) {
    const year = parseInt(mCurrent[1], 10);
    const month = parseInt(mCurrent[2], 10) - 1;
    const day = parseInt(mCurrent[3], 10);
    const abbrev = mCurrent[7];
    let offsetEastMin = parseJunosTimezoneToken(abbrev);
    const offsetKnown = offsetEastMin !== null;
    if (offsetEastMin === null) offsetEastMin = 0;
    return { year, month, day, abbrev, offsetEastMin, offsetKnown };
  }

  // 2) Fallback: timezone is commonly present on booted / last configured lines.
  // Some devices/serial captures omit or mangle "Current time", so we still try to
  // extract a timezone token and a calendar anchor date.
  const mLastCfg = output.match(
    /Last configured:\s*(\d{4})-(\d{2})-(\d{2})\s+(\d{2}):(\d{2}):(\d{2})\s+(\S+)/im,
  );
  if (mLastCfg) {
    const year = parseInt(mLastCfg[1], 10);
    const month = parseInt(mLastCfg[2], 10) - 1;
    const day = parseInt(mLastCfg[3], 10);
    const abbrev = mLastCfg[7];
    let offsetEastMin = parseJunosTimezoneToken(abbrev);
    const offsetKnown = offsetEastMin !== null;
    if (offsetEastMin === null) offsetEastMin = 0;
    return { year, month, day, abbrev, offsetEastMin, offsetKnown };
  }

  const mBooted = output.match(
    /System booted:\s*(\d{4})-(\d{2})-(\d{2})\s+(\d{2}):(\d{2}):(\d{2})\s+(\S+)/im,
  );
  if (mBooted) {
    const year = parseInt(mBooted[1], 10);
    const month = parseInt(mBooted[2], 10) - 1;
    const day = parseInt(mBooted[3], 10);
    const abbrev = mBooted[7];
    let offsetEastMin = parseJunosTimezoneToken(abbrev);
    const offsetKnown = offsetEastMin !== null;
    if (offsetEastMin === null) offsetEastMin = 0;
    return { year, month, day, abbrev, offsetEastMin, offsetKnown };
  }

  return null;
}

export function utcToSwitchLocalCalendar(
  utcMs: number,
  offsetEastMin: number,
): { year: number; month: number; day: number } {
  const shifted = new Date(utcMs + offsetEastMin * 60 * 1000);
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth(),
    day: shifted.getUTCDate(),
  };
}

export function switchLocalWallToUtcMs(
  year: number,
  monthIndex: number,
  day: number,
  hour: number,
  min: number,
  sec: number,
  offsetEastMin: number,
): number {
  return Date.UTC(year, monthIndex, day, hour, min, sec) - offsetEastMin * 60 * 1000;
}

/**
 * UTC instant for a `messages`-style line, using switch TZ offset and a calendar anchor.
 */
export function getJunosLogLineUtcMs(
  line: string,
  disconnectUtcMs: number,
  offsetEastMin: number,
  uptimeRef: Pick<JunosUptimeTimeRef, 'year' | 'month' | 'day'> | null,
): number | null {
  const t = line.trim();
  const m = t.match(/^(\w{3})\s+(\d{1,2})\s+(\d{2}):(\d{2}):(\d{2})\b/);
  if (!m) return null;
  const mon0 = MONTHS[m[1]];
  if (mon0 === undefined) return null;
  const day = parseInt(m[2], 10);
  const hour = parseInt(m[3], 10);
  const min = parseInt(m[4], 10);
  const sec = parseInt(m[5], 10);

  const dl = utcToSwitchLocalCalendar(disconnectUtcMs, offsetEastMin);
  const year = uptimeRef?.year ?? dl.year;

  let utcMs = switchLocalWallToUtcMs(year, mon0, day, hour, min, sec, offsetEastMin);
  const huge = 200 * 24 * 60 * 60 * 1000;
  if (Math.abs(utcMs - disconnectUtcMs) > huge) {
    const y2 = utcMs < disconnectUtcMs ? year + 1 : year - 1;
    const t2 = switchLocalWallToUtcMs(y2, mon0, day, hour, min, sec, offsetEastMin);
    if (Math.abs(t2 - disconnectUtcMs) < Math.abs(utcMs - disconnectUtcMs)) utcMs = t2;
  }
  return utcMs;
}

export function formatOffsetEastLabel(offsetEastMin: number): string {
  const sign = offsetEastMin >= 0 ? '+' : '-';
  const abs = Math.abs(offsetEastMin);
  const hh = Math.floor(abs / 60);
  const mm = abs % 60;
  return `${sign}${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}
