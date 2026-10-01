import {
  dateValueEnd,
  dateValueStart,
  newYorkDateParts,
  type ClassYear,
  type JoinMode,
  type RecruitingSeason,
} from "@hci/core/browser";
import type { RecruitingBoard, RecruitingEntry } from "../queries/recruiting";
import { isPastTerm } from "./cycles";
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
      else if (cycle.status === "closed" && (cycle.deadline || !isPastTerm(cycle.termKey, q.now)))
        board.recentlyClosed.push(entry);
    }
  }
  const byDeadline = (a: RecruitingEntry, b: RecruitingEntry) =>
    (a.cycle.deadline?.at ?? "9999").localeCompare(b.cycle.deadline?.at ?? "9999");
  board.open.sort(byDeadline);
  board.upcoming.sort((a, b) => (a.cycle.opens?.at ?? "9999").localeCompare(b.cycle.opens?.at ?? "9999"));
  board.recentlyClosed.sort((a, b) => byDeadline(b, a));
  return board;
}

/**
 * The recruiting season a date falls in, for matching `club.recruiting_seasons` patterns
 * (campus time): spring = Jan–May, summer = Jun–Jul, fall = Aug–Dec.
 */
export function recruitingSeasonForDate(now: Date): Exclude<RecruitingSeason, "winter" | "rolling"> {
  const { month } = newYorkDateParts(now);
  if (month <= 5) return "spring";
  if (month <= 7) return "summer";
  return "fall";
}

/**
 * Clubs that usually recruit in the current season (a pattern from past recruiting, not
 * a current deadline) and have no dated open/upcoming cycle — those already appear on the
 * board with real dates. Inactive/defunct clubs and unknown patterns are left out.
 */
export function buildUsuallyRecruiting(
  clubs: readonly IndexClub[],
  q: {
    now: Date;
    category?: string | null;
    joinMode?: JoinMode | null;
    classYear?: Exclude<ClassYear, "graduate"> | null;
  },
): IndexClub[] {
  const season = recruitingSeasonForDate(q.now);
  const out: IndexClub[] = [];
  for (const raw of clubs) {
    if (!(raw.recruitingSeasons ?? []).includes(season)) continue;
    if (raw.activityStatus === "inactive" || raw.activityStatus === "defunct") continue;
    if (q.category && !raw.categorySlugs.includes(q.category)) continue;
    if (q.joinMode && !raw.joinModes.includes(q.joinMode)) continue;
    if (q.classYear) {
      const ok =
        (raw.eligibleClasses ?? []).includes(q.classYear) ||
        (q.classYear === "first_year" && raw.freshmenEligible === true);
      if (!ok) continue;
    }
    const club = liveClub(raw, q.now);
    const dated = club.cycles.some(
      (c) => c.status === "open" || c.status === "deadline_ahead" || c.status === "upcoming",
    );
    if (!dated) out.push(club);
  }
  return out.sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()) || a.id.localeCompare(b.id));
}

/**
 * Comps, auditions and applications that have started this term with no deadline listed
 * (status "unknown": an opening date in the last 60 days and nothing else). Worth a look in
 * September, but never presented as "open" — the club may have closed it already.
 */
export function buildStartedNoDeadline(
  clubs: readonly IndexClub[],
  q: {
    now: Date;
    category?: string | null;
    joinMode?: JoinMode | null;
    classYear?: Exclude<ClassYear, "graduate"> | null;
  },
): RecruitingEntry[] {
  const now = q.now.getTime();
  const out: RecruitingEntry[] = [];
  for (const raw of clubs) {
    if (q.category && !raw.categorySlugs.includes(q.category)) continue;
    if (raw.activityStatus === "inactive" || raw.activityStatus === "defunct") continue;
    const club = liveClub(raw, q.now);
    for (const cycle of club.cycles) {
      if (cycle.status !== "unknown" || !cycle.opens || cycle.deadline || cycle.statedStatus === "closed") continue;
      if (isPastTerm(cycle.termKey, q.now)) continue;
      const opened = dateValueStart(cycle.opens).getTime();
      if (opened > now || opened < now - 60 * DAY) continue;
      if (q.joinMode && !club.joinModes.includes(q.joinMode) && !cycle.processTypes.includes(q.joinMode)) continue;
      if (q.classYear) {
        const classes = [...(club.eligibleClasses ?? []), ...(cycle.eligibleClasses ?? [])];
        if (!(classes.includes(q.classYear) || (q.classYear === "first_year" && club.freshmenEligible === true)))
          continue;
      }
      out.push({ club, cycle });
    }
  }
  return out.sort((a, b) => (b.cycle.opens?.at ?? "").localeCompare(a.cycle.opens?.at ?? ""));
}
