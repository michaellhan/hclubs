import { CAMPUS_TIME_ZONE, dateValueEnd, formatTerm, newYorkDateParts, type DateValue } from "@hci/core/browser";

const dateFmt = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: CAMPUS_TIME_ZONE });
const dateYearFmt = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
  timeZone: CAMPUS_TIME_ZONE,
});
const dateTimeFmt = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
  timeZone: CAMPUS_TIME_ZONE,
  timeZoneName: "short",
});
const dateTimeYearFmt = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
  hour: "numeric",
  minute: "2-digit",
  timeZone: CAMPUS_TIME_ZONE,
  timeZoneName: "short",
});

/**
 * Format a DateValue faithfully: date-only values never gain an invented time, and the
 * year is shown whenever it isn't the current campus year (so last year's deadline never
 * reads as this year's).
 */
export function formatDateValue(v: DateValue | null | undefined, now: Date = new Date()): string | null {
  if (!v) return null;
  const thisYear = newYorkDateParts(now).year;
  if (v.precision === "datetime") {
    const d = new Date(v.at);
    return (newYorkDateParts(d).year === thisYear ? dateTimeFmt : dateTimeYearFmt).format(d);
  }
  const [y, m, d] = v.at.split("-").map(Number) as [number, number, number];
  const noonUtc = new Date(Date.UTC(y, m - 1, d, 16));
  return y === thisYear ? dateFmt.format(noonUtc) : dateYearFmt.format(noonUtc);
}

/** Just the campus day of a DateValue ("Sep 5", or "Sep 5, 2025"), for compact labels. */
export function formatDay(v: DateValue | null | undefined, now: Date = new Date()): string | null {
  if (!v) return null;
  if (v.precision === "date") return formatDateValue(v, now);
  const p = newYorkDateParts(new Date(v.at));
  const ymd = `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
  return formatDateValue({ at: ymd, precision: "date" }, now);
}

export function formatDate(iso: string | null | undefined): string | null {
  if (!iso) return null;
  return dateYearFmt.format(new Date(iso));
}

/** Whole calendar months from `a` to `b` (both UTC), earlier first: Oct 3 to Oct 13 a year on is 12. */
function wholeMonths(a: Date, b: Date): number {
  let m = (b.getUTCFullYear() - a.getUTCFullYear()) * 12 + b.getUTCMonth() - a.getUTCMonth();
  if (b.getUTCDate() < a.getUTCDate()) m -= 1;
  return Math.max(m, 0);
}

/** "3 mo", "11 months", "1 year", "2 years": calendar months, then whole years from 12 months. */
function spanWords(from: Date, to: Date, short: boolean): string {
  const [a, b] = from <= to ? [from, to] : [to, from];
  const months = Math.max(wholeMonths(a, b), 2);
  if (months >= 12) {
    const years = Math.floor(months / 12);
    return `${years} ${years === 1 ? "year" : "years"}`;
  }
  return short ? `${months} mo` : `${months} months`;
}

/** "3 days ago", "in 5 days", "today". */
export function relativeDays(iso: string | Date, now: Date = new Date()): string {
  const t = typeof iso === "string" ? new Date(iso) : iso;
  const days = Math.round((t.getTime() - now.getTime()) / 86_400_000);
  if (days === 0) return "today";
  if (days === 1) return "tomorrow";
  if (days === -1) return "yesterday";
  if (Math.abs(days) >= 60) {
    const span = spanWords(now, t, true);
    return days > 0 ? `in ${span}` : `${span} ago`;
  }
  return days > 0 ? `in ${days} days` : `${-days} days ago`;
}

/**
 * Relative label for a DateValue in campus calendar days ("today", "tomorrow", "in 3 days",
 * "2 days ago"). A timed deadline later today is "today", never "tomorrow".
 */
/** Calendar days in Boston from `now` to the date (0 = today, 1 = tomorrow, negative = past). */
export function calendarDaysUntil(v: DateValue, now: Date = new Date()): number {
  const today = newYorkDateParts(now);
  const [y, m, d] =
    v.precision === "datetime"
      ? (() => {
          const p = newYorkDateParts(dateValueEnd(v));
          return [p.year, p.month, p.day] as const;
        })()
      : (v.at.split("-").map(Number) as [number, number, number]);
  return Math.round((Date.UTC(y, m - 1, d) - Date.UTC(today.year, today.month - 1, today.day)) / 86_400_000);
}

export function relativeDateValue(v: DateValue, now: Date = new Date()): string {
  const days = calendarDaysUntil(v, now);
  if (days === 0) return "today";
  if (days === 1) return "tomorrow";
  if (days === -1) return "yesterday";
  if (Math.abs(days) >= 60) {
    const span = spanWords(now, new Date(now.getTime() + days * 86_400_000), false);
    return days > 0 ? `in ${span}` : `${span} ago`;
  }
  return days > 0 ? `in ${days} days` : `${-days} days ago`;
}

export function formatRange(r: { min: number | null; max: number | null } | null, unit = ""): string | null {
  if (!r) return null;
  const u = unit ? ` ${unit}` : "";
  if (r.min !== null && r.max !== null) return r.min === r.max ? `${r.min}${u}` : `${r.min}–${r.max}${u}`;
  if (r.min !== null) return `${r.min}+${u}`;
  if (r.max !== null) return `up to ${r.max}${u}`;
  return null;
}

export function formatPercent(rate: number): string {
  return `${(rate * 100).toFixed(rate < 0.1 ? 1 : 0)}%`;
}

export { formatTerm };

export function pluralize(n: number, word: string, plural = `${word}s`): string {
  return `${n.toLocaleString("en-US")} ${n === 1 ? word : plural}`;
}

/** A listing label's suffix: "Soccer M", "Volleyball W", "Ultimate (Women's)", "Boxing (Club Sport)". */
const SEX_SUFFIX =
  /\s*\(?\s*\b(?:(?:(?:men|women)['’]?s\s+)?club\s+sports?|m|w|men|women|mens|womens|men['’]s|women['’]s)\s*\)?\s*$/i;
const nameWords = (s: string) =>
  s
    .toLowerCase()
    .replace(/['’]s\b/g, "")
    .match(/[a-z0-9]+/g) ?? [];

/**
 * A directory label that is the club's own name words plus a sex suffix ("Ultimate Frisbee M"
 * beside "Harvard Men's Ultimate Frisbee Club", SOCO's club-sport list): it says nothing new. PURE.
 */
export function restatesWithSexSuffix(alias: string, name: string): boolean {
  if (!SEX_SUFFIX.test(alias)) return false;
  const core = nameWords(alias.replace(SEX_SUFFIX, ""));
  if (!core.length) return false;
  const inName = new Set(nameWords(name));
  return core.every((w) => inName.has(w));
}

/**
 * Aliases worth showing under a club's name: not its name again, its acronym, "The …",
 * "Name (ACR)" ("Also known as Harvard Political Review (HPR)" said nothing), or the name's
 * words with a sex suffix ("Soccer M", round 7). PURE.
 */
export function distinctAliases<A extends { alias: string }>(club: {
  name: string;
  acronym: string | null;
  aliases: readonly A[];
}): A[] {
  const key = (s: string) =>
    s
      .toLowerCase()
      .replace(/^the\s+/, "")
      .replace(/[^a-z0-9]/g, "");
  const same = new Set([key(club.name), key(club.acronym ?? ""), key(`${club.name}${club.acronym ?? ""}`)]);
  const seen = new Set<string>();
  return club.aliases.filter((a) => {
    const k = key(a.alias);
    if (!k || same.has(k) || seen.has(k) || restatesWithSexSuffix(a.alias, club.name)) return false;
    seen.add(k);
    return true;
  });
}
