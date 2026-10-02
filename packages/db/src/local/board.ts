import {
  dateValueEnd,
  dateValueStart,
  newYorkDateParts,
  termForDate,
  termKey,
  type ClassYear,
  type JoinMode,
  type RecruitingSeason,
} from "@hci/core/browser";
import type { RecruitingBoard, RecruitingEntry } from "../queries/recruiting";
import { isPastTerm } from "./cycles";
import { isSparseClub, matchesFirstYears, matchesOpenJoin } from "./filters";
import { liveClub } from "./search";
import type { IndexClub } from "./types";

const DAY = 86_400_000;

/**
 * Whether a club belongs on the recruiting board at all: never an organization that ended
 * or went inactive, and graduate/professional-school groups only when asked for (hclubs is
 * for College students; a law-school clinic's application isn't one they can join).
 * Unknown scope stays in: unknown is not "graduate" (ADR 0038). PURE.
 */
export function boardEligible(club: IndexClub, includeGraduate = false): boolean {
  if (club.activityStatus === "inactive" || club.activityStatus === "defunct") return false;
  return includeGraduate || club.affiliationScope !== "graduate_school";
}

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
    includeGraduate?: boolean;
  },
): RecruitingBoard {
  const board: RecruitingBoard = { open: [], upcoming: [], recentlyClosed: [] };
  const now = q.now.getTime();
  for (const raw of clubs) {
    if (!boardEligible(raw, q.includeGraduate)) continue;
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
  // By instant, not by the stored string: a date-only deadline ends at 23:59 campus time, so it
  // sorts after a 5 PM deadline the same day, and EDT/EST offsets compare correctly.
  const byDeadline = (a: RecruitingEntry, b: RecruitingEntry) =>
    (a.cycle.deadline ? dateValueEnd(a.cycle.deadline).getTime() : Infinity) -
      (b.cycle.deadline ? dateValueEnd(b.cycle.deadline).getTime() : Infinity) || 0;
  const byOpens = (a: RecruitingEntry, b: RecruitingEntry) =>
    (a.cycle.opens ? dateValueStart(a.cycle.opens).getTime() : Infinity) -
      (b.cycle.opens ? dateValueStart(b.cycle.opens).getTime() : Infinity) || 0;
  board.open.sort(byDeadline);
  board.upcoming.sort(byOpens);
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
 * board with real dates — and no round that already closed this term. Inactive/defunct clubs,
 * open-membership clubs (nothing to catch) and unknown patterns are left out.
 */
export function buildUsuallyRecruiting(
  clubs: readonly IndexClub[],
  q: {
    now: Date;
    category?: string | null;
    joinMode?: JoinMode | null;
    classYear?: Exclude<ClassYear, "graduate"> | null;
    includeGraduate?: boolean;
  },
): IndexClub[] {
  const season = recruitingSeasonForDate(q.now);
  const out: IndexClub[] = [];
  for (const raw of clubs) {
    if (!(raw.recruitingSeasons ?? []).includes(season)) continue;
    // Anyone can join an open-membership club ("Join anytime"), and a rolling recruiter has no
    // round to wait for this term (it's a next chance): neither is "usually recruits this term".
    if ((raw.recruitingSeasons ?? []).includes("rolling")) continue;
    if (matchesOpenJoin(raw) || !boardEligible(raw, q.includeGraduate)) continue;
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
    // Any round on record for this term (closed, or started with no deadline) is this term's
    // recruiting: "usually recruits this term, no date for this round" would contradict it.
    if (!dated && !hasCycleThisTerm(club, q.now)) out.push(club);
  }
  return out.sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()) || a.id.localeCompare(b.id));
}

/**
 * Comps, auditions and applications that have started this term with no deadline listed
 * (status "unknown": a recent opening date and nothing else; see `startedWindowDays`). Worth a
 * look in September, but never presented as "open" — the club may have closed it already.
 */
export function buildStartedNoDeadline(
  clubs: readonly IndexClub[],
  q: {
    now: Date;
    category?: string | null;
    joinMode?: JoinMode | null;
    classYear?: Exclude<ClassYear, "graduate"> | null;
    includeGraduate?: boolean;
  },
): RecruitingEntry[] {
  const now = q.now.getTime();
  const out: RecruitingEntry[] = [];
  for (const raw of clubs) {
    if (!boardEligible(raw, q.includeGraduate)) continue;
    if (q.category && !raw.categorySlugs.includes(q.category)) continue;
    const club = liveClub(raw, q.now);
    for (const cycle of club.cycles) {
      if (cycle.status !== "unknown" || !cycle.opens || cycle.deadline || cycle.statedStatus === "closed") continue;
      if (isPastTerm(cycle.termKey, q.now)) continue;
      const opened = dateValueStart(cycle.opens).getTime();
      if (opened > now || opened < now - startedWindowDays(cycle.processTypes, club.joinModes) * DAY) continue;
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

/**
 * How long a start date with no deadline stays on the board. Auditions and tryouts are held
 * over a few days, so a ten-day-old audition date is almost certainly over; a comp or an
 * application usually runs for weeks. PURE.
 */
export function startedWindowDays(cycleProcesses: readonly JoinMode[], clubModes: readonly JoinMode[]): number {
  const modes = cycleProcesses.length ? cycleProcesses : clubModes;
  const shortOnly = modes.length > 0 && modes.every((m) => m === "audition" || m === "tryout");
  return shortOnly ? STARTED_SHORT_DAYS : STARTED_LONG_DAYS;
}
export const STARTED_SHORT_DAYS = 10;
export const STARTED_LONG_DAYS = 30;

/** The club has a round on record for the current term, in any status. */
export function hasCycleThisTerm(club: IndexClub, now: Date): boolean {
  const term = termKey(termForDate(now));
  return club.cycles.some((c) => c.termKey === term);
}

type BoardQuery = {
  now: Date;
  category?: string | null;
  joinMode?: JoinMode | null;
  classYear?: Exclude<ClassYear, "graduate"> | null;
  includeGraduate?: boolean;
};

const ACTIVITY_RANK: Partial<Record<IndexClub["activityStatus"], number>> = { active: 0, likely_active: 1 };

/**
 * Join anytime: clubs a source says anyone can join (derived `joining.access = open`, ADR 0041),
 * so there is no deadline to miss. Never inferred from a missing process. Ranked so the clubs a
 * student can act on with confidence come first: active, says first-years are welcome, has a
 * description; then by name. Clubs we know almost nothing about are left out. PURE.
 */
export function buildJoinAnytime(clubs: readonly IndexClub[], q: BoardQuery): IndexClub[] {
  const out = clubs.filter((c) => {
    if (!matchesOpenJoin(c) || isSparseClub(c) || !boardEligible(c, q.includeGraduate)) return false;
    // A process filter keeps only clubs whose general members join that way ("open" keeps all
    // of them; asking for comps, auditions or tryouts leaves none, since access is open).
    if (q.joinMode && q.joinMode !== "open" && !c.joinModes.includes(q.joinMode)) return false;
    if (q.category && !c.categorySlugs.includes(q.category)) return false;
    if (q.classYear === "first_year" && !matchesFirstYears(c)) return false;
    // A stated class list that leaves this class out wins over "anyone can join".
    const classes = c.eligibleClasses ?? [];
    if (q.classYear && q.classYear !== "first_year" && classes.length && !classes.includes(q.classYear)) return false;
    return true;
  });
  const rank = (c: IndexClub) => [
    ACTIVITY_RANK[c.activityStatus] ?? 2,
    matchesFirstYears(c) ? 0 : 1,
    c.shortDescription?.trim() ? 0 : 1,
  ];
  return out.sort((a, b) => {
    const ra = rank(a);
    const rb = rank(b);
    for (let i = 0; i < ra.length; i++) if (ra[i] !== rb[i]) return (ra[i] ?? 0) - (rb[i] ?? 0);
    return a.name.toLowerCase().localeCompare(b.name.toLowerCase()) || a.id.localeCompare(b.id);
  });
}

/** Why a club is a next chance for someone who missed this term's round. */
export type NextChanceReason = "rolling" | "next_term";

export interface NextChance {
  club: IndexClub;
  reason: NextChanceReason;
  /** The season of the next usual round (`rolling` = any time). */
  next: RecruitingSeason;
  /** This term's round that already closed, if we have one. */
  closed: IndexClub["cycles"][number] | null;
}

/** The season after `season` in the academic calendar (summer rounds are rare; skip to fall). */
export function followingSeason(season: "fall" | "spring" | "summer"): "fall" | "spring" {
  return season === "fall" ? "spring" : "fall";
}

/**
 * "Missed it?": where a student who missed this term's recruiting can still get in, from
 * sourced patterns only (`club.recruiting_seasons`; never a guessed date):
 *  - clubs that recruit on a rolling basis (actionable now), first;
 *  - clubs whose round closed this term and that usually recruit again next term;
 *  - clubs that recruit only in the next term (nothing to miss yet).
 * Clubs with an open or announced round are on the board already; open-membership clubs are
 * under "Join anytime". PURE.
 */
export function buildNextChances(clubs: readonly IndexClub[], q: BoardQuery): NextChance[] {
  const season = recruitingSeasonForDate(q.now);
  const next = followingSeason(season);
  const out: NextChance[] = [];
  for (const raw of clubs) {
    const seasons = raw.recruitingSeasons ?? [];
    if (!seasons.length || matchesOpenJoin(raw) || !boardEligible(raw, q.includeGraduate)) continue;
    if (q.category && !raw.categorySlugs.includes(q.category)) continue;
    if (q.joinMode && !raw.joinModes.includes(q.joinMode)) continue;
    if (q.classYear) {
      const ok =
        (raw.eligibleClasses ?? []).includes(q.classYear) ||
        (q.classYear === "first_year" && raw.freshmenEligible === true);
      if (!ok) continue;
    }
    const club = liveClub(raw, q.now);
    if (club.cycles.some((c) => c.status === "open" || c.status === "deadline_ahead" || c.status === "upcoming"))
      continue;
    const term = termKey(termForDate(q.now));
    const closed =
      club.cycles
        .filter((c) => c.termKey === term && c.status === "closed")
        .sort((a, b) => (b.deadline?.at ?? "").localeCompare(a.deadline?.at ?? ""))[0] ?? null;
    if (seasons.includes("rolling")) out.push({ club, reason: "rolling", next: "rolling", closed });
    else if (seasons.includes(next) && (closed || !seasons.includes(season)))
      out.push({ club, reason: "next_term", next, closed });
  }
  const order = (c: NextChance) => (c.reason === "rolling" ? 0 : c.closed ? 1 : 2);
  return out.sort(
    (a, b) =>
      order(a) - order(b) ||
      a.club.name.toLowerCase().localeCompare(b.club.name.toLowerCase()) ||
      a.club.id.localeCompare(b.club.id),
  );
}

export interface BoardSections {
  board: RecruitingBoard;
  started: RecruitingEntry[];
  anytime: IndexClub[];
  usually: IndexClub[];
  chances: NextChance[];
}

/**
 * Every board section at once, each club listed in at most one of the "what can I do" sections,
 * in priority order: a dated or started round > join anytime > usually recruits this term >
 * next chances. (A rolling club with a started round shows the round; an open club with a role
 * audition shows the audition.) Closed rounds stay in their own collapsed list. Used by
 * /recruiting and the home page's off-season box so both say the same thing. PURE.
 */
export function buildBoardSections(
  clubs: readonly IndexClub[],
  q: BoardQuery & { withinDays?: number | null },
): BoardSections {
  const board = buildRecruitingBoard(clubs, q);
  const started = q.withinDays ? [] : buildStartedNoDeadline(clubs, q);
  const taken = new Set([...board.open, ...board.upcoming, ...started].map((e) => e.club.id));
  const anytime = buildJoinAnytime(clubs, q).filter((c) => !taken.has(c.id));
  for (const c of anytime) taken.add(c.id);
  const usually = q.withinDays ? [] : buildUsuallyRecruiting(clubs, q).filter((c) => !taken.has(c.id));
  for (const c of usually) taken.add(c.id);
  const chances = buildNextChances(clubs, q).filter((c) => !taken.has(c.club.id));
  return { board, started, anytime, usually, chances };
}
