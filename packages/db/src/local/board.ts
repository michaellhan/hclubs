import { dateValueEnd, type ClassYear, type JoinMode } from "@hci/core";
import type { RecruitingBoard, RecruitingEntry } from "../queries/recruiting";
import { liveClub } from "./search";
import type { IndexClub } from "./types";

const DAY = 86_400_000;

/**
 * Recruiting board computed in the browser from the static index — same grouping as
 * getRecruitingBoard: open/deadline-ahead, upcoming, and closed within the last 30 days.
 */
export function buildRecruitingBoard(
  clubs: readonly IndexClub[],
  q: {
    now: Date;
    category?: string | null;
    joinMode?: JoinMode | null;
    classYear?: Exclude<ClassYear, "graduate"> | null;
    withinDays?: number | null;
  },
): RecruitingBoard {
  const board: RecruitingBoard = { open: [], upcoming: [], recentlyClosed: [] };
  const now = q.now.getTime();
  for (const raw of clubs) {
    if (q.category && !raw.categorySlugs.includes(q.category)) continue;
    const club = liveClub(raw, q.now);
    for (const cycle of club.cycles) {
      const due = cycle.deadline ? dateValueEnd(cycle.deadline).getTime() : null;
      if (due !== null && due < now - 30 * DAY) continue;
      if (q.joinMode && !club.joinModes.includes(q.joinMode) && !cycle.processTypes.includes(q.joinMode)) continue;
      if (q.classYear) {
        const classes = [...(club.eligibleClasses ?? []), ...(cycle.eligibleClasses ?? [])];
        const ok = classes.includes(q.classYear) || (q.classYear === "first_year" && club.freshmenEligible === true);
        if (!ok) continue;
      }
      const entry: RecruitingEntry = { club, cycle };
      if (cycle.status === "open" || cycle.status === "deadline_ahead") {
        if (q.withinDays && (due === null || due - now > q.withinDays * DAY)) continue;
        board.open.push(entry);
      } else if (cycle.status === "upcoming") board.upcoming.push(entry);
      else if (cycle.status === "closed") board.recentlyClosed.push(entry);
    }
  }
  const byDeadline = (a: RecruitingEntry, b: RecruitingEntry) =>
    (a.cycle.deadline?.at ?? "9999").localeCompare(b.cycle.deadline?.at ?? "9999");
  board.open.sort(byDeadline);
  board.upcoming.sort((a, b) => (a.cycle.opens?.at ?? "9999").localeCompare(b.cycle.opens?.at ?? "9999"));
  board.recentlyClosed.sort((a, b) => byDeadline(b, a));
  return board;
}
