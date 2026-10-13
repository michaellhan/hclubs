import {
  dateValueEnd,
  dateValueStart,
  newYorkDateParts,
  parseTermKey,
  termForDate,
  termKey,
  type ClassYear,
  type JoinMode,
  type RecruitingSeason,
} from "@hci/core/browser";
import type { RecruitingBoard, RecruitingEntry } from "../queries/recruiting";
import { announcedLaterRound, beyondAcademicYear, isPastTerm } from "./cycles";
import { isSparseClub, matchesFirstYears, matchesOpenJoin } from "./filters";
import { liveClub } from "./basics";
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
 * When this term's usual round has most likely already happened (campus time): from Oct 1 in
 * the fall and Mar 1 in the spring. Harvard's fall term starts in the first week of September
 * and its spring term in the last week of January; club comps, applications and auditions
 * open and close in the first three to four weeks (every dated fall-2026 opening on record
 * is in Aug–Sep and every deadline is in September). After that a seasonal pattern with no
 * date for this term reads as "still coming" when it almost certainly isn't, so it points to
 * the next usual round instead. A pattern, never a date (CLAUDE.md §8). PURE.
 */
export const USUAL_ROUND_PAST_FROM = { fall: { month: 10, day: 1 }, spring: { month: 3, day: 1 } } as const;

export function usualRoundLikelyPast(now: Date): boolean {
  const season = recruitingSeasonForDate(now);
  if (season === "summer") return false;
  const { month, day } = newYorkDateParts(now);
  const from = USUAL_ROUND_PAST_FROM[season];
  return month > from.month || (month === from.month && day >= from.day);
}

/**
 * The next round a club's sourced pattern points to, on the reader's day: this term's while
 * it is early in the term, otherwise the next term the club usually recruits in (`nextYear`
 * when that is the same season a year on, e.g. a fall-only club in October). Null for no
 * pattern or a rolling one. Shared by the board, the profile's "When" and compare. PURE.
 */
export interface UsualNext {
  season: "fall" | "spring";
  /** This term's usual round (early in the term), not a later one. */
  thisTerm: boolean;
  /** The same season next academic year. */
  nextYear: boolean;
}

export function usualNextRound(
  seasons: readonly RecruitingSeason[],
  now: Date,
  /** This term's round is over (it closed): only a later round counts. */
  afterThisTerm = false,
): UsualNext | null {
  const terms = seasons.filter((s): s is "fall" | "spring" => s === "fall" || s === "spring");
  if (!terms.length) return null;
  const season = recruitingSeasonForDate(now);
  if (season !== "summer" && terms.includes(season) && !afterThisTerm && !usualRoundLikelyPast(now))
    return { season, thisTerm: true, nextYear: false };
  const next = followingSeason(season);
  if (terms.includes(next)) return { season: next, thisTerm: false, nextYear: false };
  // Only this season: next year's (in summer, `next` is fall, so this is spring next year).
  return { season: terms[0]!, thisTerm: false, nextYear: true };
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
  // Late in the term the pattern points to the next round instead (`buildNextChances`).
  if (usualRoundLikelyPast(q.now)) return [];
  const out: IndexClub[] = [];
  for (const raw of clubs) {
    if (!(raw.recruitingSeasons ?? []).includes(season)) continue;
    // Anyone can join an open-membership club ("Join anytime"), and a rolling recruiter has no
    // round to wait for this term (it's a next chance): neither is "usually recruits this term".
    if ((raw.recruitingSeasons ?? []).includes("rolling")) continue;
    if (matchesOpenJoin(raw) || !boardEligible(raw, q.includeGraduate)) continue;
    // The club's own pages put its next round in a later term: not this term's (ADR 0051 amendment).
    if (announcedLaterRound(raw.cycles, q.now)) continue;
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
  const out: RecruitingEntry[] = [];
  for (const raw of clubs) {
    if (!boardEligible(raw, q.includeGraduate)) continue;
    if (q.category && !raw.categorySlugs.includes(q.category)) continue;
    const club = liveClub(raw, q.now);
    for (const cycle of club.cycles) {
      if (!isStartedRound(cycle, club.joinModes, q.now)) continue;
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
 * A round listed under "Started, no deadline listed" on `now`'s day (live status): an opening
 * date in this term, already passed and within `startedWindowDays`, no deadline, and not
 * stated closed. PURE.
 */
export function isStartedRound(cycle: IndexClub["cycles"][number], clubModes: readonly JoinMode[], now: Date): boolean {
  if (cycle.status !== "unknown" || !cycle.opens || cycle.deadline || cycle.statedStatus === "closed") return false;
  if (isPastTerm(cycle.termKey, now)) return false;
  const opened = dateValueStart(cycle.opens).getTime();
  return opened <= now.getTime() && opened >= now.getTime() - startedWindowDays(cycle.processTypes, clubModes) * DAY;
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

/**
 * A round on record this term that still reads as current (live status): anything but a closed
 * round or a start date older than the Started window (which the board no longer lists, so the
 * club's pattern speaks instead). A stages-only round counts: the profile shows it as this
 * term's round. PURE.
 */
function currentRoundThisTerm(club: IndexClub, term: string, now: Date): boolean {
  return club.cycles.some((c) => {
    if (c.termKey !== term || c.status === "closed") return false;
    const staleStart =
      c.status === "unknown" && c.opens !== null && !c.deadline && !isStartedRound(c, club.joinModes, now);
    return !staleStart;
  });
}

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
  /** The next usual round is a year away (the club recruits only in this season). */
  nextYear?: boolean;
  /** This term's round that already closed, if we have one. */
  closed: IndexClub["cycles"][number] | null;
  /** The term of the next round the club's own pages announce (`announcedLaterRound`), if any. */
  announced?: string;
}

/** The season after `season` in the academic calendar (summer rounds are rare; skip to fall). */
export function followingSeason(season: "fall" | "spring" | "summer"): "fall" | "spring" {
  return season === "fall" ? "spring" : "fall";
}

/**
 * "Missed it?": where a student who missed this term's recruiting can still get in, from
 * sourced patterns only (`club.recruiting_seasons`; never a guessed date), or the next round
 * the club's own pages announce, which outranks its pattern (`announced`):
 *  - clubs that recruit on a rolling basis (actionable now), first;
 *  - clubs whose round closed this term and that usually recruit again next term;
 *  - clubs that recruit only in the next term (nothing to miss yet);
 *  - late in the term (`usualRoundLikelyPast`), clubs whose usual round this term has most
 *    likely passed with no date on record: their next usual round, next term or next year.
 * Clubs with an open or announced round are on the board already; open-membership clubs are
 * under "Join anytime". PURE.
 */
export function buildNextChances(clubs: readonly IndexClub[], q: BoardQuery): NextChance[] {
  const season = recruitingSeasonForDate(q.now);
  const next = followingSeason(season);
  const late = usualRoundLikelyPast(q.now);
  const out: NextChance[] = [];
  for (const raw of clubs) {
    const seasons = raw.recruitingSeasons ?? [];
    const later = announcedLaterRound(raw.cycles, q.now);
    if ((!seasons.length && !later) || matchesOpenJoin(raw) || !boardEligible(raw, q.includeGraduate)) continue;
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
    // The club named its next round: that, not its usual seasons, is the next chance.
    const announced = later ? parseTermKey(later.termKey) : null;
    if (later && announced) {
      const nextSeason = announced.season === "spring" || announced.season === "winter" ? "spring" : "fall";
      out.push({
        club,
        reason: "next_term",
        next: nextSeason,
        nextYear: beyondAcademicYear(later.termKey, q.now),
        closed,
        announced: later.termKey,
      });
    } else if (seasons.includes("rolling")) out.push({ club, reason: "rolling", next: "rolling", closed });
    else if (seasons.includes(next) && (closed || !seasons.includes(season)))
      out.push({ club, reason: "next_term", next, closed });
    else if (late && seasons.includes(season) && !currentRoundThisTerm(club, term, q.now)) {
      const usual = usualNextRound(seasons, q.now);
      if (usual) out.push({ club, reason: "next_term", next: usual.season, nextYear: usual.nextYear, closed });
    }
  }
  // For a student who missed this term's round, the next round they can plan for comes first;
  // rolling programs (mostly volunteer programs) follow, and rounds a year away come last.
  const order = (c: NextChance) => (c.nextYear ? 3 : c.reason === "rolling" ? 2 : c.closed ? 0 : 1);
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
 * the closed-in-30-days list > next chances. (A rolling club with a started round shows the
 * round; an open club with a role audition shows the audition; a round that just closed is
 * listed once, under closed, with the club's next usual round.) Used by
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
  // A club whose round closed in the last 30 days lives in the closed list, which names its next
  // usual round inline; once per club (its latest round), and not beside a live or open option.
  const recentlyClosed: RecruitingEntry[] = [];
  for (const e of board.recentlyClosed) {
    if (taken.has(e.club.id)) continue;
    taken.add(e.club.id);
    recentlyClosed.push(e);
  }
  const chances = buildNextChances(clubs, q).filter((c) => !taken.has(c.club.id));
  return { board: { ...board, recentlyClosed }, started, anytime, usually, chances };
}
