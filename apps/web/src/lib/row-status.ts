import {
  dateValueEnd,
  isRecruitingNow,
  type CycleStatus,
  type DateValue,
  type JoinMode,
  type RecruitingSeason,
} from "@hci/core/browser";
import { nextChanceShort, type AnnouncedRound } from "./compare-summary";

/** A closed cycle's date stays on a directory row this long: long enough to say "missed it". */
export const CLOSED_ROW_DAYS = 120;

const lowerFirst = (t: string) => t.charAt(0).toLowerCase() + t.slice(1);

/**
 * The line a directory or /saved row shows when the club has no live round to chip: when the
 * last round closed (if recently) and when the club next recruits, from the same
 * `nextChanceShort` the profile and compare use ("Closed Sep 5 · next round likely in
 * spring", "Next round likely in spring"). Null when nothing is known (never a guess) or the
 * club is recruiting now, announced a round, or open to everyone (those have their own pills).
 * `cycle` must already carry its live status. PURE.
 */
export function rowNextText(
  c: {
    cycle: { status: CycleStatus; termKey: string; deadline: DateValue | null } | null;
    seasons: readonly RecruitingSeason[];
    openAccess: boolean;
    later: AnnouncedRound | null;
    joinModes?: readonly JoinMode[] | undefined;
  },
  now: Date,
  fmtDay: (v: DateValue) => string | null,
): string | null {
  const cy = c.cycle;
  if (c.openAccess || (cy && (isRecruitingNow(cy.status) || cy.status === "upcoming"))) return null;
  const next = nextChanceShort({ ...c, cycle: cy }, now, fmtDay);
  let closed: string | null = null;
  if (cy?.status === "closed" && cy.deadline) {
    const age = now.getTime() - dateValueEnd(cy.deadline).getTime();
    const day = age <= CLOSED_ROW_DAYS * 86_400_000 ? fmtDay(cy.deadline) : null;
    closed = day ? `Closed ${day}` : null;
  }
  if (closed) return next ? `${closed} · ${lowerFirst(next)}` : closed;
  return next;
}
