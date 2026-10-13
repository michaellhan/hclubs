import {
  compareTermKeys,
  computeCycleStatus,
  newYorkDateParts,
  termForDate,
  termKey,
  termNamedInText,
  type DateValue,
  type JoinMode,
} from "@hci/core/browser";
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

/** The parts of a round's stages that say anything beyond the process: a label and dates. */
export interface RoundStage {
  kind: string;
  label: string | null;
  startsAt?: DateValue | null;
  endsAt?: DateValue | null;
}

/** A round as the past-round and bare-round helpers read it (a summary, optionally with stages). */
export type RoundLike = Pick<
  CycleSummary,
  "termKey" | "opens" | "deadline" | "statedStatus" | "processTypes" | "applicationUrl" | "eligibleClasses"
> & {
  stages?: readonly RoundStage[];
  applicants?: number | null;
  admits?: number | null;
};

/** A stage that only names the process ("Comp", "Comp period", "Auditions"), with no date. */
const BARE_STAGE_KINDS = new Set(["comp_period", "audition", "tryout", "written_application"]);
const BARE_STAGE_LABEL =
  /^(?:the\s+)?(?:comp(?:s|ing)?(?:\s+(?:period|process))?|auditions?|try-?outs?|(?:written\s+)?applications?)$/i;

const stageNamesTerm = (s: RoundStage, term: string) => s.label !== null && termNamedInText(s.label) === term;

/**
 * A round with nothing to say beyond how the club's members join: no date, stated status,
 * form, counts or class list, in this or an earlier term, and at most stages that only
 * restate the process ("Comp" / Comp period, read off a recruitment page whose term came from
 * the day we read it). The profile shows the process under How to join and no round block,
 * so it agrees with compare's "Recruiting: Unknown". A round in a later term, or one a stage
 * label names by its term ("Spring 2026 Comp"), is a real announcement, never bare. PURE.
 */
export function isBareRound(c: RoundLike, now: Date): boolean {
  if (c.opens || c.deadline || c.statedStatus || c.applicationUrl || c.eligibleClasses?.length) return false;
  if ((c.applicants ?? null) !== null || (c.admits ?? null) !== null) return false;
  if (compareTermKeys(c.termKey, termKey(termForDate(now))) > 0) return false;
  return (c.stages ?? []).every(
    (s) =>
      !s.startsAt &&
      !s.endsAt &&
      BARE_STAGE_KINDS.has(s.kind) &&
      (s.label === null || BARE_STAGE_LABEL.test(s.label.trim())) &&
      !stageNamesTerm(s, c.termKey),
  );
}

/**
 * A round on record really happened in its term: a date, a stated status ("Applications for
 * the Fall 2026 semester have closed"), or a stage that names the term or carries a date
 * ("Spring 2026 Comp"). A round whose only facts are a process and the term we read it in is
 * not evidence of when the club recruited. PURE.
 */
export function roundEvidenced(c: RoundLike): boolean {
  if (c.opens || c.deadline || c.statedStatus) return true;
  return (c.stages ?? []).some((s) => s.startsAt || s.endsAt || stageNamesTerm(s, c.termKey));
}

/** A round from the past: its term and process. */
export type PastRound = { termKey: string; processTypes: readonly JoinMode[] };

/**
 * A term earlier than `now`'s and no more than a year back ("Spring 2026" read in Oct 2026;
 * not "Fall 2024"): recent enough to tell a student when the club last recruited. PURE.
 */
export function isRecentPastTerm(term: string, now: Date): boolean {
  const current = termForDate(now);
  const floor = `${current.year - 1}-${current.season}`;
  return isPastTerm(term, now) && compareTermKeys(term, floor) >= 0;
}

/**
 * The club's most recent evidenced round from an earlier term (within a year), for "Last comp:
 * Spring 2026" when nothing says when it recruits next. It is history, not a pattern: one past
 * round never becomes "usually recruits in spring" (CLAUDE.md §2.2), so it feeds no season
 * filter and no Still time to join. `extra` is a round already known to be evidenced (the
 * static index's `lastRound`). PURE.
 */
export function lastPastRound(
  cycles: readonly RoundLike[],
  now: Date,
  extra: PastRound | null = null,
): PastRound | null {
  const rounds: PastRound[] = cycles.filter(roundEvidenced);
  if (extra) rounds.push(extra);
  let best: PastRound | null = null;
  for (const r of rounds) {
    if (!isRecentPastTerm(r.termKey, now)) continue;
    if (!best || compareTermKeys(r.termKey, best.termKey) > 0) best = r;
  }
  return best ? { termKey: best.termKey, processTypes: [...best.processTypes] } : null;
}
