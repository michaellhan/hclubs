import { compareTermKeys, computeCycleStatus, termForDate, termKey } from "@hci/core";
import type { CycleSummary } from "../queries/types";

/**
 * Cycle helpers shared by the server queries and the static site. Status is always
 * recomputed from dates and `now` (CLAUDE.md §8), so a page built last week still shows
 * today's open/closed state in the browser.
 */
export function withLiveStatus<T extends CycleSummary>(cycle: T, now: Date): T {
  const status = computeCycleStatus(
    { opensAt: cycle.opens, deadline: cycle.deadline, statedStatus: cycle.statedStatus },
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
  // A closed cycle from an old term isn't "current" information.
  if (best && best.status === "closed" && compareTermKeys(best.termKey, currentTerm) < 0) {
    const [bestYear] = best.termKey.split("-");
    const [curYear] = currentTerm.split("-");
    if (Number(curYear) - Number(bestYear) > 1) return null;
  }
  return best;
}
