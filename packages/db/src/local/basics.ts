import type { RecruitingSeason } from "@hci/core/browser";
import { pickCurrentCycle, withLiveStatus } from "./cycles";
import type { ClubFilters } from "./filters";
import type { IndexClub } from "./types";

/**
 * The small, table-free half of the search module (Round 12 build budget): what rows, chips,
 * the board and the directory's frame need without the relevance model and its concept
 * tables, which load on first search (`apps/web/src/lib/search-engine.ts`). Re-exported by
 * `@hci/db/local`. PURE, browser-safe.
 */

/** Career categories: a club in one is a pre-professional group, not a broad community one. */
export const CAREER_CATEGORIES: ReadonlySet<string> = new Set([
  "pre-professional",
  "consulting",
  "finance",
  "law",
  "technology",
  "entrepreneurship",
  "medicine-health",
  "academic-stem",
]);

/** The longest query read, in characters. */
export const MAX_QUERY_LENGTH = 100;

/** A query as typed, without control characters (a pasted NUL or newline), trimmed and capped. */
export function cleanQuery(text: string | null | undefined): string {
  // eslint-disable-next-line no-control-regex -- removing control characters is the point
  const CONTROL = /[\u0000-\u001f\u007f-\u009f]+/g;
  return (text ?? "").replace(CONTROL, " ").trim().slice(0, MAX_QUERY_LENGTH);
}

/** Live view of a club at `now`: cycle statuses and the featured cycle recomputed. */
export function liveClub(club: IndexClub, now: Date): IndexClub {
  const cycles = club.cycles.map((c) => withLiveStatus(c, now));
  return { ...club, cycles, currentCycle: pickCurrentCycle(cycles, now) };
}

// --- Match reasons ----------------------------------------------------------------------------------

/**
 * Why a club matched, in terms a student recognizes — never a score. `name` is implicit
 * in the visible name and usually not shown.
 */
export type MatchReason =
  | { kind: "name" }
  | { kind: "alias"; alias: string }
  | { kind: "acronym"; acronym: string }
  | { kind: "initials"; initials: string }
  /** A word related to the query's topic is in the club's name ("orchestra" for "music"). */
  | { kind: "related"; topic: string; word: string }
  | { kind: "category"; slug: string; name: string }
  | { kind: "description"; word: string }
  /** Tags, activities or category names. */
  | { kind: "topics"; word: string }
  /** A derived joining fact that answers a soft word ("beginner" → no experience needed). */
  | { kind: "joining"; text: string };

/** One reason as a short phrase ("Description mentions “trading”"). PURE. */
export function reasonText(r: MatchReason): string {
  switch (r.kind) {
    case "name":
      return "Name";
    case "alias":
      return `Also known as ${r.alias}`;
    case "acronym":
      return `Acronym ${r.acronym.toUpperCase()}`;
    case "initials":
      return `Initials ${r.initials.toUpperCase()}`;
    case "related":
      return `${r.topic}: “${r.word}” in the name`;
    case "category":
      return `Category: ${r.name}`;
    case "description":
      return `Description mentions “${r.word}”`;
    case "topics":
      return `Listed activities mention “${r.word}”`;
    case "joining":
      return r.text;
  }
}

/**
 * The directory filters a phrase can turn on: keys of `ClubFilters`, except
 * `recruitingSeason`, which adds its `season` to `recruitingSeasons` (URL `season=`).
 */
export type ConstraintFilter =
  "openJoin" | "noComp" | "noDues" | "noExperience" | "recruitingNow" | "stillTime" | "maxHours" | "recruitingSeason";

export interface QueryConstraint {
  filter: ConstraintFilter;
  /** The words as typed (normalized), for "Read “no comp” as …". */
  phrase: string;
  /** `maxHours` only: the most hours a week the club may state ("under 3 hours a week" → 3). */
  value?: number;
  /** `recruitingSeason` only: the term asked for ("finance spring" → spring). */
  season?: RecruitingSeason;
  /**
   * The filter the phrase names, when another stands in for it: "recruiting" reads as Still
   * time to join when no club in the directory has a round open (`effectiveQuery`).
   */
  instead?: "recruitingNow";
}

/** The `ClubFilters` fields constraint phrases can set. */
export type ConstraintPatch = Partial<
  Pick<
    ClubFilters,
    "openJoin" | "noComp" | "noDues" | "noExperience" | "recruitingNow" | "stillTime" | "maxHours" | "recruitingSeasons"
  >
>;

/** The `ClubFilters` fields a list of constraints turns on. PURE. */
export function constraintPatch(constraints: readonly QueryConstraint[]): ConstraintPatch {
  const patch: ConstraintPatch = {};
  for (const c of constraints) {
    if (c.filter === "maxHours") {
      if (c.value !== undefined) patch.maxHours = c.value;
    } else if (c.filter === "recruitingSeason") {
      if (c.season && !patch.recruitingSeasons?.includes(c.season))
        patch.recruitingSeasons = [...(patch.recruitingSeasons ?? []), c.season];
    } else patch[c.filter] = true;
  }
  return patch;
}

/**
 * What the joining words mean, worded as /about#joining says them (Round 13). The directory
 * shows one above the results when a search asks ("what's a comp", "what is punch"). `lead`
 * and `rest` go around the bolded `term` on /about. PURE data.
 */
export const JOIN_TERMS = {
  comp: {
    lead: "A",
    term: "comp",
    rest: " (short for competition) is a stretch of doing the club's work, such as writing, coding or case practice, before joining; it can last a few weeks or a whole semester. Whether anyone is cut varies by club, and some keep everyone who finishes (“no cuts”).",
  },
  punch: {
    lead: "A",
    term: "punch",
    rest: " is how final clubs and social groups choose members: invitations after a series of events.",
  },
  audition: { lead: "An", term: "audition", rest: " is how performing groups choose members: you perform." },
  tryout: { lead: "A", term: "tryout", rest: " is how teams choose members: you play or practice." },
} as const;

export type JoinTerm = keyof typeof JOIN_TERMS;

/** A joining word's definition as one sentence ("A punch is how …"). PURE. */
export function joinTermText(key: JoinTerm): string {
  const t = JOIN_TERMS[key];
  return `${t.lead} ${t.term}${t.rest}`;
}

/** A graduate school named in a name or one-liner (not "graduate students", which mixed groups say). */
const GRADUATE_SCHOOL =
  /\b(gsas|gse|hbs|hks|hls|hms|hsph|harvard chan|chan school|graduate school|business school|law school|medical school|kennedy school|divinity school|extension school|school of public health|school of education)\b/i;

/**
 * Scope unknown (or cross-school), but the club's own name or one-liner says it belongs to a
 * graduate school (Round 10: the Harvard Chan PHIT Student Forum; Round 14: the Chinese Students
 * & Scholars Association, "Graduate School of Arts and Sciences chapter…"). Similar clubs set it
 * aside; Still time to join and the topics leave it out. PURE.
 */
export function graduateNamed(c: Pick<IndexClub, "name" | "shortDescription" | "affiliationScope">): boolean {
  if (c.affiliationScope === "harvard_college") return false;
  if (c.affiliationScope === "graduate_school") return true;
  return GRADUATE_SCHOOL.test(`${c.name} ${c.shortDescription ?? ""}`);
}
