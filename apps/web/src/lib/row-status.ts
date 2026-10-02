import { RECRUITING_SEASON_LABEL, dateValueEnd, type DateValue, type RecruitingSeason } from "@hci/core/browser";

/** A closed cycle stays on a directory row this long: long enough to say "missed it, next is spring". */
export const CLOSED_ROW_DAYS = 120;

/**
 * The text of a directory row's chip for a CLOSED cycle, or null when it's too old to be
 * news or has no deadline to report. "Closed Sep 9" plus, when the club's recruiting
 * pattern (from past years) names a different season than the closed cycle's, "usually
 * Spring". Never invents: with no pattern it says only what closed.
 */
export function closedRowText(
  cycle: { termKey: string; deadline: DateValue | null },
  seasons: readonly RecruitingSeason[] | undefined,
  now: Date,
  formatDay: (v: DateValue) => string | null,
): string | null {
  if (!cycle.deadline) return null;
  const age = now.getTime() - dateValueEnd(cycle.deadline).getTime();
  if (age > CLOSED_ROW_DAYS * 86_400_000) return null;
  const day = formatDay(cycle.deadline);
  if (!day) return null;
  const closedSeason = cycle.termKey.split("-")[1];
  // "Rolling" is not a term to wait for; say nothing rather than "usually Rolling".
  const other = (seasons ?? []).filter((s) => s !== closedSeason && s !== "rolling");
  const usually = other.length && !(seasons ?? []).includes(closedSeason as RecruitingSeason) ? other : [];
  return usually.length
    ? `Closed ${day} · usually ${usually.map((s) => RECRUITING_SEASON_LABEL[s]).join(" & ")}`
    : `Closed ${day}`;
}
