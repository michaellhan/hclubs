import { newYorkWallTimeToUtc } from "../term-utils";

/**
 * Value helpers and constants without Zod, so the browser bundle can use them (launch
 * audit). The schemas of the same names are in values.ts.
 */

/** The parts of a DateValue the helpers read. */
interface DateLike {
  at: string;
  precision: "date" | "datetime";
}

/** Instant at which a DateValue ends (date-only values end at 23:59:59 campus time). */
export function dateValueEnd(v: DateLike): Date {
  if (v.precision === "datetime") return new Date(v.at);
  const [y, m, d] = v.at.split("-").map(Number) as [number, number, number];
  return newYorkWallTimeToUtc(y, m, d, 23, 59, 59);
}

/** Instant at which a DateValue starts (date-only values start at 00:00 campus time). */
export function dateValueStart(v: DateLike): Date {
  if (v.precision === "datetime") return new Date(v.at);
  const [y, m, d] = v.at.split("-").map(Number) as [number, number, number];
  return newYorkWallTimeToUtc(y, m, d, 0, 0, 0);
}

/** Class years a club or cycle is open to. */
export const CLASS_YEARS = ["first_year", "sophomore", "junior", "senior", "graduate"] as const;
export type ClassYear = (typeof CLASS_YEARS)[number];

export const CLASS_YEAR_LABEL: Record<ClassYear, string> = {
  first_year: "First-years",
  sophomore: "Sophomores",
  junior: "Juniors",
  senior: "Seniors",
  graduate: "Graduate students",
};

/** Terms a club usually recruits in (a pattern, distinct from specific cycles). CLAUDE.md §8. */
export const RECRUITING_SEASONS = ["fall", "spring", "summer", "winter", "rolling"] as const;
export type RecruitingSeason = (typeof RECRUITING_SEASONS)[number];
export const RECRUITING_SEASON_LABEL: Record<RecruitingSeason, string> = {
  fall: "Fall",
  spring: "Spring",
  summer: "Summer",
  winter: "Winter",
  rolling: "Rolling",
};
