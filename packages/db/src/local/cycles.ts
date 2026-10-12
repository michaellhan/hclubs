import { compareTermKeys, computeCycleStatus, newYorkDateParts, termForDate, termKey } from "@hci/core/browser";
import type { CycleSummary } from "../queries/types";

/**
 * Cycle helpers shared by the server queries and the static site. Status is always
 * recomputed from dates and `now` (CLAUDE.md §8), so a page built last week still shows
 * today's open/closed state in the browser.
 */
export function withLiveStatus<T extends CycleSummary>(cycle: T, now: Date): T {
  const status = computeCycleStatus(
    {
      opensAt: cycle.opens,
      deadline: cycle.deadline,
      statedStatus: cycle.statedStatus,
      termKey: cycle.termKey,
      lastVerifiedAt: cycle.lastVerifiedAt,
    },
    now,
  );
  return status === cycle.status ? cycle : { ...cycle, status };
}

const STATUS_PRIORITY: Record<CycleSummary["status"], number> = {
  open: 0,
  deadline_ahead: 1,
  upcoming: 2,
  closed: 3,
  unknown: 4,
};

/**
 * The cycle to feature: an open/upcoming one (soonest deadline first); otherwise the most
 * recent cycle in the current or a past term. Cycles with no dates at all are shown only
 * if nothing better exists.
 */
export function pickCurrentCycle<T extends CycleSummary>(cycles: readonly T[], now: Date): T | null {
  if (cycles.length === 0) return null;
  const currentTerm = termKey(termForDate(now));
  const sorted = [...cycles].sort((a, b) => {
    const p = STATUS_PRIORITY[a.status] - STATUS_PRIORITY[b.status];
    if (p !== 0) return p;
    if (a.status === "closed" || a.status === "unknown") return compareTermKeys(b.termKey, a.termKey);
    const da = a.deadline?.at ?? "9999";
    const db = b.deadline?.at ?? "9999";
    return da < db ? -1 : da > db ? 1 : 0;
  });
  const best = sorted[0] ?? null;
  // A cycle from an earlier term isn't current information: it stays under "other cycles".
  if (best && (best.status === "closed" || best.status === "unknown") && compareTermKeys(best.termKey, currentTerm) < 0)
    return null;
  return best;
}

/** A cycle from an earlier term than `now`'s: "closed" with no date is old news, not "recently closed". */
export function isPastTerm(term: string, now: Date): boolean {
  return compareTermKeys(term, termKey(termForDate(now))) < 0;
}

/**
 * The last term of `now`'s academic year: fall through the following summer, and from June
 * on the year ahead (a fall round announced in July is this coming year's). Campus time. PURE.
 */
export function academicYearEndTerm(now: Date): string {
  const { year, month } = newYorkDateParts(now);
  return `${month >= 6 ? year + 1 : year}-summer`;
}

/** A term after `now`'s academic year: "Fall 2027" read in October 2026. PURE. */
export function beyondAcademicYear(term: string, now: Date): boolean {
  return compareTermKeys(term, academicYearEndTerm(now)) > 0;
}

/**
 * A later round the club's own pages announce before any date is set ("The Pitches' next
 * audition cycle will begin in the Fall of 2027"): a cycle in a term after `now`'s, with no
 * opening date, deadline or stated status, whose facts a club or official page states
 * (`lastVerifiedAt`, tiers 1-5; a cycle whose facts were all rejected has none). The earliest,
 * or null. It says when the club recruits next, so it outranks the usual-season pattern on
 * the profile, compare, saved and Still time to join (ADR 0051 amendment). PURE.
 */
export function announcedLaterRound<T extends CycleSummary>(cycles: readonly T[], now: Date): T | null {
  const current = termKey(termForDate(now));
  let best: T | null = null;
  for (const c of cycles) {
    if (c.opens || c.deadline || c.statedStatus || !c.lastVerifiedAt) continue;
    if (compareTermKeys(c.termKey, current) <= 0) continue;
    if (!best || compareTermKeys(c.termKey, best.termKey) < 0) best = c;
  }
  return best;
}
