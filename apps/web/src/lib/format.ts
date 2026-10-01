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

/** Format a DateValue faithfully: date-only values never gain an invented time. */
export function formatDateValue(v: DateValue | null | undefined, now: Date = new Date()): string | null {
  if (!v) return null;
  if (v.precision === "datetime") return dateTimeFmt.format(new Date(v.at));
  const [y, m, d] = v.at.split("-").map(Number) as [number, number, number];
  const noonUtc = new Date(Date.UTC(y, m - 1, d, 16));
  return y === now.getUTCFullYear() ? dateFmt.format(noonUtc) : dateYearFmt.format(noonUtc);
}

export function formatDate(iso: string | null | undefined): string | null {
  if (!iso) return null;
  return dateYearFmt.format(new Date(iso));
}

/** "3 days ago", "in 5 days", "today". */
export function relativeDays(iso: string | Date, now: Date = new Date()): string {
  const t = typeof iso === "string" ? new Date(iso) : iso;
  const days = Math.round((t.getTime() - now.getTime()) / 86_400_000);
  if (days === 0) return "today";
  if (days === 1) return "tomorrow";
  if (days === -1) return "yesterday";
  if (Math.abs(days) >= 60) {
    const months = Math.round(Math.abs(days) / 30);
    return days > 0 ? `in ${months} mo` : `${months} mo ago`;
  }
  return days > 0 ? `in ${days} days` : `${-days} days ago`;
}

/** Relative label for a DateValue: date-only values count campus calendar days. */
export function relativeDateValue(v: DateValue, now: Date = new Date()): string {
  if (v.precision === "datetime") return relativeDays(dateValueEnd(v), now);
  const today = newYorkDateParts(now);
  const [y, m, d] = v.at.split("-").map(Number) as [number, number, number];
  const days = Math.round((Date.UTC(y, m - 1, d) - Date.UTC(today.year, today.month - 1, today.day)) / 86_400_000);
  if (days === 0) return "today";
  if (days === 1) return "tomorrow";
  if (days === -1) return "yesterday";
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
