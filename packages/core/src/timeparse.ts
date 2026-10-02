import { newYorkDateParts, newYorkWallTimeToUtc, termForDate, termKey, type Season } from "./terms";

/**
 * Harvard-style recruiting time references. CLAUDE.md §8.
 *
 * Every result keeps the original text and a parse confidence. Relative expressions
 * ("this fall", "Friday", "next week") are resolved ONLY against an explicit reference
 * date (normally the snapshot fetch date); without one they are returned unresolved.
 */

export type ParseConfidence = "high" | "medium" | "low";

export interface ParsedDate {
  /** "YYYY-MM-DD" (date precision) or ISO with offset (datetime precision). */
  at: string;
  precision: "date" | "datetime";
  originalText: string;
  confidence: ParseConfidence;
  /** Why confidence is not high (e.g. "year inferred from reference date"). */
  notes: string[];
}

export interface ParsedTerm {
  termKey: string;
  originalText: string;
  confidence: ParseConfidence;
  relative: boolean;
}

const MONTHS: Record<string, number> = {
  jan: 1,
  january: 1,
  feb: 2,
  february: 2,
  mar: 3,
  march: 3,
  apr: 4,
  april: 4,
  may: 5,
  jun: 6,
  june: 6,
  jul: 7,
  july: 7,
  aug: 8,
  august: 8,
  sep: 9,
  sept: 9,
  september: 9,
  oct: 10,
  october: 10,
  nov: 11,
  november: 11,
  dec: 12,
  december: 12,
};
const WEEKDAYS: Record<string, number> = {
  sunday: 0,
  sun: 0,
  monday: 1,
  mon: 1,
  tuesday: 2,
  tue: 2,
  tues: 2,
  wednesday: 3,
  wed: 3,
  thursday: 4,
  thu: 4,
  thur: 4,
  thurs: 4,
  friday: 5,
  fri: 5,
  saturday: 6,
  sat: 6,
};

const pad = (n: number) => String(n).padStart(2, "0");
const ymd = (y: number, m: number, d: number) => `${y}-${pad(m)}-${pad(d)}`;

function validDay(y: number, m: number, d: number): boolean {
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

/**
 * Eastern offset ("-04:00"/"-05:00") in effect at a wall-clock time on a date. Computed at
 * that time, not at noon: 12:00 AM on the first Sunday of November is still EDT.
 */
function easternOffset(y: number, m: number, d: number, hour = 12, minute = 0): string {
  const utc = newYorkWallTimeToUtc(y, m, d, hour, minute);
  const diffMin = Math.round((Date.UTC(y, m - 1, d, hour, minute) - utc.getTime()) / 60_000);
  const abs = Math.abs(diffMin);
  return `${diffMin < 0 ? "-" : "+"}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`;
}

const TIME_RE =
  /\b(?:at\s+|by\s+)?(\d{1,2})(?::(\d{2}))?\s*(a\.?m\.?|p\.?m\.?)\s*(?:(?:e[sd]?t|eastern)\b)?|\b(noon|midnight)\b/i;

const MONTH_BEFORE = /\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s*$/i;

function parseTime(text: string): { hour: number; minute: number } | null {
  const m = TIME_RE.exec(text);
  if (!m) return null;
  if (m[4]) return m[4].toLowerCase() === "noon" ? { hour: 12, minute: 0 } : { hour: 23, minute: 59 };
  const endHour = Number(m[1]);
  const minute = m[2] ? Number(m[2]) : 0;
  const pm = (m[3] ?? "").toLowerCase().startsWith("p");
  if (endHour < 1 || endHour > 12 || minute > 59) return null;
  const to24 = (h: number, isPm: boolean) => (isPm ? (h === 12 ? 12 : h + 12) : h === 12 ? 0 : h);
  // "12:30-2:30 PM", "7-9pm", "from 12:30 to 2:30": the first time is when it starts. The match
  // above is the END of the window, and the am/pm it carries is shared with the start.
  const before = text.slice(0, m.index);
  const r = /(?<![\d:])(\d{1,2})(?::(\d{2}))?\s*(a\.?m\.?|p\.?m\.?)?\s*(?:[-\u2013\u2014]|to|until|till)\s*$/i.exec(
    before,
  );
  if (r) {
    const startHour = Number(r[1]);
    const startMinute = r[2] ? Number(r[2]) : 0;
    // "Sept 5-7pm" is a day range, not a time range.
    const bareDay = !r[2] && !r[3] && MONTH_BEFORE.test(before.slice(0, r.index));
    if (!bareDay && startHour >= 1 && startHour <= 12 && startMinute <= 59) {
      let startPm = r[3] ? r[3].toLowerCase().startsWith("p") : pm;
      // "11-1pm" starts in the morning: sharing "pm" would put the start after the end.
      if (!r[3] && pm && startHour !== 12 && startHour > endHour) startPm = false;
      return { hour: to24(startHour, startPm), minute: startMinute };
    }
  }
  return { hour: to24(endHour, pm), minute };
}

function build(
  y: number,
  mo: number,
  d: number,
  time: { hour: number; minute: number } | null,
  originalText: string,
  confidence: ParseConfidence,
  notes: string[],
): ParsedDate | null {
  if (!validDay(y, mo, d)) return null;
  if (!time) return { at: ymd(y, mo, d), precision: "date", originalText, confidence, notes };
  return {
    at: `${ymd(y, mo, d)}T${pad(time.hour)}:${pad(time.minute)}:00${easternOffset(y, mo, d, time.hour, time.minute)}`,
    precision: "datetime",
    originalText,
    confidence,
    notes,
  };
}

/**
 * Choose a year for a month/day given without one: the year placing the date closest
 * to the reference date (within ±6 months). Confidence drops to medium.
 */
function inferYear(mo: number, d: number, reference: Date): number {
  const ref = newYorkDateParts(reference);
  const refT = Date.UTC(ref.year, ref.month - 1, ref.day);
  let best = ref.year;
  let bestDist = Infinity;
  for (const y of [ref.year - 1, ref.year, ref.year + 1]) {
    const dist = Math.abs(Date.UTC(y, mo - 1, d) - refT);
    if (dist < bestDist) {
      best = y;
      bestDist = dist;
    }
  }
  return best;
}

const MONTH_NAMES = Object.keys(MONTHS)
  .sort((a, b) => b.length - a.length)
  .join("|");
const MONTH_DAY_RE = new RegExp(
  `\\b(?:(?:mon|tues?|wed(?:nes)?|thu(?:rs?)?|fri|sat(?:ur)?|sun)(?:day)?,?\\s+)?(${MONTH_NAMES})\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:,?\\s+(\\d{4}))?\\b`,
  "i",
);
const NUMERIC_RE = /\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/;
const ISO_RE = /\b(\d{4})-(\d{2})-(\d{2})\b/;
const WEEKDAY_RE =
  /\b(this\s+|next\s+)?(sunday|monday|tuesday|wednesday|thursday|friday|saturday|sun|mon|tues?|wed|thur?s?|fri|sat)\b/i;

/**
 * Parse the first date expression in `text`. Returns null if none, or if the expression
 * is relative and no reference date is supplied.
 */
export function parseDateExpression(text: string, reference: Date | null): ParsedDate | null {
  const original = text.trim().slice(0, 300);
  const time = parseTime(text);

  const iso = ISO_RE.exec(text);
  if (iso) return build(Number(iso[1]), Number(iso[2]), Number(iso[3]), time, original, "high", []);

  const md = MONTH_DAY_RE.exec(text);
  if (md?.[1] && md[2]) {
    const mo = MONTHS[md[1].toLowerCase()];
    const d = Number(md[2]);
    if (mo) {
      if (md[3]) return build(Number(md[3]), mo, d, time, original, "high", []);
      if (!reference) return null;
      return build(inferYear(mo, d, reference), mo, d, time, original, "medium", ["year inferred from reference date"]);
    }
  }

  const num = NUMERIC_RE.exec(text);
  if (num?.[1] && num[2]) {
    const mo = Number(num[1]);
    const d = Number(num[2]);
    if (mo >= 1 && mo <= 12) {
      if (num[3]) {
        const y = num[3].length === 2 ? 2000 + Number(num[3]) : Number(num[3]);
        return build(y, mo, d, time, original, "high", ["US month/day order assumed"]);
      }
      if (!reference) return null;
      return build(inferYear(mo, d, reference), mo, d, time, original, "low", [
        "US month/day order assumed",
        "year inferred from reference date",
      ]);
    }
  }

  const wd = WEEKDAY_RE.exec(text);
  if (wd?.[2] && reference) {
    const target = WEEKDAYS[wd[2].toLowerCase()];
    if (target === undefined) return null;
    const ref = newYorkDateParts(reference);
    const refDow = new Date(Date.UTC(ref.year, ref.month - 1, ref.day)).getUTCDay();
    let delta = (target - refDow + 7) % 7;
    if (wd[1]?.toLowerCase().startsWith("next")) delta += 7;
    const dt = new Date(Date.UTC(ref.year, ref.month - 1, ref.day + delta));
    return build(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate(), time, original, "low", [
      "relative weekday resolved against reference date",
    ]);
  }
  return null;
}

const TERM_RE = /\b(spring|summer|fall|autumn|winter)\s*(?:semester|term)?\s*(?:of\s+)?'?(\d{4}|\d{2})\b/i;
const RELATIVE_TERM_RE = /\b(this|next|last)\s+(spring|summer|fall|autumn|winter|semester)\b/i;

function normSeason(s: string): Season {
  const l = s.toLowerCase();
  return (l === "autumn" ? "fall" : l) as Season;
}

/** Parse "Fall 2026", "Spring '27", "this fall", "next semester" (relative needs a reference). */
export function parseTermExpression(text: string, reference: Date | null): ParsedTerm | null {
  const abs = TERM_RE.exec(text);
  if (abs?.[1] && abs[2]) {
    const year = abs[2].length === 2 ? 2000 + Number(abs[2]) : Number(abs[2]);
    return {
      termKey: termKey({ year, season: normSeason(abs[1]) }),
      originalText: abs[0],
      confidence: "high",
      relative: false,
    };
  }
  const rel = RELATIVE_TERM_RE.exec(text);
  if (rel?.[1] && rel[2] && reference) {
    const current = termForDate(reference);
    const order: Season[] = ["spring", "summer", "fall"];
    const which = rel[1].toLowerCase();
    if (rel[2].toLowerCase() === "semester") {
      // Academic semesters: spring <-> fall.
      const isFall = current.season === "fall";
      if (which === "this")
        return {
          termKey: termKey(current.season === "summer" ? { year: current.year, season: "fall" } : current),
          originalText: rel[0],
          confidence: "medium",
          relative: true,
        };
      const next =
        which === "next"
          ? isFall
            ? { year: current.year + 1, season: "spring" as Season }
            : { year: current.year, season: "fall" as Season }
          : isFall
            ? { year: current.year, season: "spring" as Season }
            : { year: current.year - 1, season: "fall" as Season };
      return { termKey: termKey(next), originalText: rel[0], confidence: "medium", relative: true };
    }
    const season = normSeason(rel[2]);
    const curIdx = order.indexOf(current.season === "winter" ? "spring" : current.season);
    const tgtIdx = order.indexOf(season === "winter" ? "spring" : season);
    let year = current.year;
    if (which === "this") year = tgtIdx < curIdx ? current.year + 1 : current.year;
    if (which === "next") year = tgtIdx <= curIdx ? current.year + 1 : current.year;
    if (which === "last") year = tgtIdx >= curIdx ? current.year - 1 : current.year;
    return { termKey: termKey({ year, season }), originalText: rel[0], confidence: "medium", relative: true };
  }
  return null;
}

/** Relative phrases we recognize but deliberately do NOT convert to dates. */
export function isVagueTimeReference(text: string): boolean {
  return /\b(next week|this week|soon|coming weeks?|later this (?:month|semester)|in the coming days|tba|tbd)\b/i.test(
    text,
  );
}
