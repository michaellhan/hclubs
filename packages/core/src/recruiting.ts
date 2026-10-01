import type { DateValue } from "./fields/values";
import { dateValueEnd, dateValueStart } from "./fields/values";
import { compareTermKeys, termForDate, termKey } from "./terms";

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
  },
  now: Date,
): CycleStatus {
  const status = statusFromDates(cycle, now);
  if (
    cycle.termKey &&
    status !== "closed" &&
    compareTermKeys(cycle.termKey, termKey(termForDate(now))) < 0 &&
    !(cycle.deadline && dateValueEnd(cycle.deadline).getTime() > now.getTime())
  )
    // "Applications are open" said in an earlier term, with no date still ahead.
    return "unknown";
  return status;
}

function statusFromDates(
  cycle: { opensAt: DateValue | null; deadline: DateValue | null; statedStatus: "open" | "closed" | null },
  now: Date,
): CycleStatus {
  const t = now.getTime();
  const deadlineEnd = cycle.deadline ? dateValueEnd(cycle.deadline).getTime() : null;
  const opensStart = cycle.opensAt ? dateValueStart(cycle.opensAt).getTime() : null;

  if (deadlineEnd !== null && t > deadlineEnd) return "closed";
  if (opensStart !== null && t < opensStart) return "upcoming";
  if (cycle.statedStatus === "closed") return "closed";
  if (opensStart !== null && t >= opensStart)
    return deadlineEnd !== null || cycle.statedStatus === "open" ? "open" : "unknown";
  if (cycle.statedStatus === "open") return "open";
  if (deadlineEnd !== null) return "deadline_ahead";
  return "unknown";
}

/** "Recruiting now" = the cycle is open or has a known future deadline. */
export function isRecruitingNow(status: CycleStatus): boolean {
  return status === "open" || status === "deadline_ahead";
}
