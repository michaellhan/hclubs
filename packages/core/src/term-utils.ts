/**
 * Academic terms. CLAUDE.md §8. A term key looks like "2026-fall". No Zod here, so the
 * browser bundle can use these (launch audit); the schemas are in terms.ts.
 */
export const SEASONS = ["spring", "summer", "fall", "winter"] as const;
export type Season = (typeof SEASONS)[number];
export type TermKey = string;

const SEASON_ORDER: Record<Season, number> = { winter: 0, spring: 1, summer: 2, fall: 3 };

export interface Term {
  year: number;
  season: Season;
}

export function termKey(term: Term): string {
  return `${term.year}-${term.season}`;
}

export function parseTermKey(key: string): Term | null {
  const m = /^(\d{4})-(spring|summer|fall|winter)$/.exec(key);
  if (!m?.[1] || !m[2]) return null;
  return { year: Number(m[1]), season: m[2] as Season };
}

export function compareTermKeys(a: string, b: string): number {
  const ta = parseTermKey(a);
  const tb = parseTermKey(b);
  if (!ta || !tb) return a.localeCompare(b);
  return ta.year - tb.year || SEASON_ORDER[ta.season] - SEASON_ORDER[tb.season];
}

/** The term containing `now`, by America/New_York calendar month. Winter session is folded into spring. */
export function termForDate(now: Date): Term {
  const { year, month } = newYorkDateParts(now);
  if (month <= 5) return { year, season: "spring" };
  if (month <= 8) return { year, season: "summer" };
  return { year, season: "fall" };
}

/**
 * The recruiting term a dated recruiting step belongs to: `termForDate`, except that August is
 * the fall's. The fall semester starts at the end of August, and a step dated then ("auditions
 * … Monday, August 31 through Friday, September 4") opens the fall round, not a summer one.
 * `termForDate` stays the calendar's "current term" (August is still summer for what is
 * recruiting now). Campus time. PURE.
 */
export function recruitingTermForDate(date: Date): Term {
  const { year, month } = newYorkDateParts(date);
  return month === 8 ? { year, season: "fall" } : termForDate(date);
}

export function formatTerm(key: string): string {
  const t = parseTermKey(key);
  if (!t) return key;
  return `${t.season[0]?.toUpperCase()}${t.season.slice(1)} ${t.year}`;
}

// --- America/New_York helpers (no date library) -------------------------------------------

export const CAMPUS_TIME_ZONE = "America/New_York";

const partsFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: CAMPUS_TIME_ZONE,
  year: "numeric",
  month: "numeric",
  day: "numeric",
  hour: "numeric",
  minute: "numeric",
  second: "numeric",
  hourCycle: "h23",
});

export function newYorkDateParts(date: Date): {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
} {
  const parts = Object.fromEntries(partsFormatter.formatToParts(date).map((p) => [p.type, p.value]));
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour),
    minute: Number(parts.minute),
    second: Number(parts.second),
  };
}

/** Offset (minutes) of America/New_York from UTC at `date` (e.g. -240 in EDT). */
function newYorkOffsetMinutes(date: Date): number {
  const p = newYorkDateParts(date);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return Math.round((asUtc - date.getTime()) / 60000);
}

/** Convert a wall-clock time in America/New_York to a UTC Date. */
export function newYorkWallTimeToUtc(year: number, month: number, day: number, hour = 0, minute = 0, second = 0): Date {
  const guess = Date.UTC(year, month - 1, day, hour, minute, second);
  const offset1 = newYorkOffsetMinutes(new Date(guess));
  const candidate = guess - offset1 * 60000;
  const offset2 = newYorkOffsetMinutes(new Date(candidate));
  return new Date(guess - offset2 * 60000);
}
