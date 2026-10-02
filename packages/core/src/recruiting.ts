import type { DateValue } from "./fields/values";
import { dateValueEnd, dateValueStart } from "./fields/value-utils";
import { compareTermKeys, termForDate, termKey } from "./term-utils";

/**
 * Recruiting-cycle status is COMPUTED at read time from date claims and `now`
 * (CLAUDE.md §8); it is never stored as a fact unless a source states it.
 *
 *  - "open":          opening date has passed (or source states open) and deadline not passed
 *  - "deadline_ahead": a future deadline is known but the opening date is not
 *  - "upcoming":      opening date is in the future
 *  - "closed":        deadline has passed (or source states closed)
 *  - "unknown":       not enough information
 */
export type CycleStatus = "open" | "deadline_ahead" | "upcoming" | "closed" | "unknown";

export const CYCLE_STATUS_LABEL: Record<CycleStatus, string> = {
  open: "Applications open",
  deadline_ahead: "Deadline ahead",
  upcoming: "Opens soon",
  closed: "Closed",
  unknown: "Status unknown",
};

export function computeCycleStatus(
  cycle: {
    opensAt: DateValue | null;
    deadline: DateValue | null;
    statedStatus: "open" | "closed" | null;
    /** The cycle's term: a past term's cycle is never current (ADR 0031). */
    termKey?: string;
    /**
     * When a club or official page last showed this cycle's facts. A bare "applications are
     * open" (no dates) seen longer ago than `STATED_OPEN_FRESH_DAYS` is no longer "open"
     * (ADR 0041): recruiting windows are short, and the page may have changed since.
     */
    lastVerifiedAt?: string | null;
  },
  now: Date,
): CycleStatus {
  const status = statusFromDates(cycle, now);
  if (
    status === "open" &&
    cycle.statedStatus === "open" &&
    !cycle.deadline &&
    cycle.lastVerifiedAt &&
    now.getTime() - Date.parse(cycle.lastVerifiedAt) > STATED_OPEN_FRESH_DAYS * 86_400_000
  )
    return "unknown";
  if (
    cycle.termKey &&
    status !== "closed" &&
    compareTermKeys(cycle.termKey, termKey(termForDate(now))) < 0 &&
    !(cycle.deadline && dateValueEnd(cycle.deadline).getTime() > now.getTime())
  )
    // "Applications are open" said in an earlier term, with no date still ahead.
    return "unknown";
  if (
    status === "deadline_ahead" &&
    cycle.termKey &&
    compareTermKeys(cycle.termKey, termKey(termForDate(now))) > 0 &&
    cycle.deadline &&
    dateValueEnd(cycle.deadline).getTime() - now.getTime() > FAR_DEADLINE_DAYS * 86_400_000
  )
    // Next term's deadline months away, opening date unknown: not "recruiting now".
    return "upcoming";
  return status;
}

/**
 * A deadline in a later term this far off (with no opening date) is "upcoming", not
 * "deadline ahead": in October a February deadline doesn't mean applications are open. Short
 * enough that August's notice of a September deadline still counts as recruiting.
 */
export const FAR_DEADLINE_DAYS = 75;

/** How long an undated "applications are open" stays "open" after we last saw it. */
export const STATED_OPEN_FRESH_DAYS = 21;

function statusFromDates(
  cycle: { opensAt: DateValue | null; deadline: DateValue | null; statedStatus: "open" | "closed" | null },
  now: Date,
): CycleStatus {
  const t = now.getTime();
  const deadlineEnd = cycle.deadline ? dateValueEnd(cycle.deadline).getTime() : null;
  // An opening after the deadline can't both be right (often an event or results date read
  // as an opening); the stated deadline is the actionable fact, so the opening is ignored.
  const opensStart = cycle.opensAt && !opensAfterDeadline(cycle) ? dateValueStart(cycle.opensAt).getTime() : null;

  if (deadlineEnd !== null && t > deadlineEnd) return "closed";
  if (opensStart !== null && t < opensStart) return "upcoming";
  if (cycle.statedStatus === "closed") return "closed";
  if (opensStart !== null && t >= opensStart)
    return deadlineEnd !== null || cycle.statedStatus === "open" ? "open" : "unknown";
  if (cycle.statedStatus === "open") return "open";
  if (deadlineEnd !== null) return "deadline_ahead";
  return "unknown";
}

/** The cycle's stated opening is after its stated deadline (inconsistent sources). */
export function opensAfterDeadline(cycle: { opensAt: DateValue | null; deadline: DateValue | null }): boolean {
  return Boolean(
    cycle.opensAt && cycle.deadline && dateValueStart(cycle.opensAt).getTime() > dateValueEnd(cycle.deadline).getTime(),
  );
}

/** "Recruiting now" = the cycle is open or has a known future deadline. */
export function isRecruitingNow(status: CycleStatus): boolean {
  return status === "open" || status === "deadline_ahead";
}
