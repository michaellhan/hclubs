import {
  JOIN_MODES,
  ORG_TYPES,
  RECOGNITION_STATUSES,
  RECRUITING_SEASONS,
  type JoinMode,
  type OrgType,
  type RecognitionStatus,
  type RecruitingSeason,
} from "@hci/core/browser";
import type { JoiningSummary } from "../queries/types";

/**
 * Directory filters and sort keys. Pure (no database imports) so the static site can
 * filter in the browser with exactly the same semantics as the Postgres provider.
 * Validated by hand rather than with Zod, which would add about 90 KB to every page.
 */
export const SORT_KEYS = ["relevance", "featured", "name", "deadline", "updated", "completeness"] as const;
export type SortKey = (typeof SORT_KEYS)[number];
export const isSortKey = (v: unknown): v is SortKey => (SORT_KEYS as readonly unknown[]).includes(v);

const CLASS_YEAR_FILTERS = ["first_year", "sophomore", "junior", "senior"] as const;
const SLUG = /^[a-z0-9-]+$/;

export interface ClubFilters {
  categories: string[];
  joinModes: JoinMode[];
  recognition: RecognitionStatus[];
  orgTypes: OrgType[];
  recruitingNow: boolean;
  freshmenEligible: boolean;
  includeInactive: boolean;
  /** Graduate/professional-school groups are hidden unless requested (undergraduate focus). */
  includeGraduate: boolean;
  /** Only clubs a source opens to this class year (unknown ≠ eligible); first-years via `joining.firstYears`. */
  classYear: (typeof CLASS_YEAR_FILTERS)[number] | null;
  /**
   * Clubs whose usual recruiting pattern includes any of these terms (unknown ≠ match).
   * Static-site only for now: PostgresSearchProvider does not apply it yet.
   */
  recruitingSeasons: RecruitingSeason[];
  /**
   * Leave out clubs with little info: no short description and no website or Instagram
   * link (see `isSparseClub`). The directory sets this when browsing without a text query.
   */
  hideSparse: boolean;
  /**
   * Open membership (`joining.access === "open"`): a source says anyone can join or that
   * membership comes from showing up, and no source names a process for general members.
   */
  openJoin: boolean;
  /** No comp for general membership (`joining.comp === false`); an application may remain. */
  noComp: boolean;
  /** A source states the club charges no dues (unknown ≠ match). */
  noDues: boolean;
  /** A page states no experience is needed (`joining.noExperience === true`; never false, unknown ≠ match). */
  noExperience: boolean;
  /**
   * Clubs whose stated time commitment tops out at this many hours a week or fewer
   * (`hoursPerWeek.max <= N`; URL `hours=N`). Unknown ≠ match: a club that states no hours,
   * or only a minimum, is in neither bucket.
   */
  maxHours: number | null;
  /** "What do you want to do?" intent slug (see `INTENTS`). Static-site only. */
  intent: string | null;
}

function list<T extends string>(input: Record<string, unknown>, key: string, ok: (v: string) => boolean): T[] {
  const v = input[key];
  if (v === undefined) return [];
  if (!Array.isArray(v) || !v.every((x) => typeof x === "string" && ok(x)))
    throw new TypeError(`ClubFilters.${key}: invalid value`);
  return v as T[];
}
function bool(input: Record<string, unknown>, key: string): boolean {
  const v = input[key];
  if (v === undefined) return false;
  if (typeof v !== "boolean") throw new TypeError(`ClubFilters.${key}: expected a boolean`);
  return v;
}
const oneOf =
  (values: readonly string[]) =>
  (v: string): boolean =>
    values.includes(v);

/** Complete filters from a partial object, with defaults; throws on invalid values. */
export const ClubFilters = {
  parse(raw: unknown): ClubFilters {
    const input = (raw ?? {}) as Record<string, unknown>;
    if (typeof input !== "object") throw new TypeError("ClubFilters: expected an object");
    const classYear = input.classYear ?? null;
    if (classYear !== null && !(CLASS_YEAR_FILTERS as readonly unknown[]).includes(classYear))
      throw new TypeError("ClubFilters.classYear: invalid value");
    const intent = input.intent ?? null;
    if (intent !== null && !(typeof intent === "string" && SLUG.test(intent)))
      throw new TypeError("ClubFilters.intent: invalid value");
    const maxHours = input.maxHours ?? null;
    if (
      maxHours !== null &&
      !(typeof maxHours === "number" && Number.isFinite(maxHours) && maxHours > 0 && maxHours <= 100)
    )
      throw new TypeError("ClubFilters.maxHours: invalid value");
    return {
      categories: list(input, "categories", (v) => SLUG.test(v)),
      joinModes: list(input, "joinModes", oneOf(JOIN_MODES)),
      recognition: list(input, "recognition", oneOf(RECOGNITION_STATUSES)),
      orgTypes: list(input, "orgTypes", oneOf(ORG_TYPES)),
      recruitingNow: bool(input, "recruitingNow"),
      freshmenEligible: bool(input, "freshmenEligible"),
      includeInactive: bool(input, "includeInactive"),
      includeGraduate: bool(input, "includeGraduate"),
      classYear: classYear as ClubFilters["classYear"],
      recruitingSeasons: list(input, "recruitingSeasons", oneOf(RECRUITING_SEASONS)),
      hideSparse: bool(input, "hideSparse"),
      openJoin: bool(input, "openJoin"),
      noComp: bool(input, "noComp"),
      noDues: bool(input, "noDues"),
      noExperience: bool(input, "noExperience"),
      maxHours: maxHours as number | null,
      intent: intent as string | null,
    };
  },
};

export const COMPLETENESS_TIERS = ["rich", "partial", "sparse", "name_only"] as const;
export type CompletenessTier = (typeof COMPLETENESS_TIERS)[number];

/** The public facts behind a club's completeness tier (ADR 0032). */
export interface CompletenessInput {
  shortDescription: string | null;
  quickLinks: { website: string | null; instagram: string | null } | null;
  joinModes: readonly string[];
  currentCycle: unknown | null;
  memberCount: unknown | null;
  hoursPerWeek: unknown | null;
  logo: string | null;
  pressCount?: number;
}

/**
 * Completeness tier from public facts, never from inherited index data (category, SOCO
 * tags/flags, recognition, dues, affiliation). PURE.
 *  - name_only: nothing beyond identity and index data
 *  - sparse:    one kind of fact, or no description and no website/social
 *  - partial:   a description or an official channel, plus something more
 *  - rich:      description + official channel + how to join (or a recruiting cycle)
 */
export function completenessTier(c: CompletenessInput): CompletenessTier {
  const desc = Boolean(c.shortDescription?.trim());
  const channel = Boolean(c.quickLinks?.website || c.quickLinks?.instagram);
  const join = c.joinModes.length > 0 || c.currentCycle !== null;
  const extra = [c.memberCount !== null, c.hoursPerWeek !== null, Boolean(c.logo), (c.pressCount ?? 0) > 0].filter(
    Boolean,
  ).length;
  const count = Number(desc) + Number(channel) + Number(join) + extra;
  if (count === 0) return "name_only";
  if (desc && channel && join) return "rich";
  if ((desc || channel) && count >= 2) return "partial";
  return "sparse";
}

/**
 * "Little info" rule for the directory: no short description and no website or Instagram
 * link. Such rows show only a name, so the directory hides them by default when browsing.
 */
export function isSparseClub(c: {
  shortDescription: string | null;
  quickLinks: { website: string | null; instagram: string | null } | null;
}): boolean {
  return !c.shortDescription?.trim() && !c.quickLinks?.website && !c.quickLinks?.instagram;
}

/**
 * Joining filters read the derived joining facts (ADR 0041), never the absence of a claim:
 * a club with no evidence is in neither the "yes" nor the "no" bucket of any of them.
 */
type WithJoining = {
  joining: Pick<JoiningSummary, "access" | "comp" | "firstYears" | "dues" | "noCuts" | "noExperience">;
};

/** Open membership: a source says anyone can join (or membership comes from showing up) and none names a process for members. PURE. */
export const matchesOpenJoin = (c: WithJoining): boolean => c.joining.access === "open";

/** No comp for general membership: the College directory's flag, or open membership; never contradicted. PURE. */
export const matchesNoComp = (c: WithJoining): boolean => c.joining.comp === false;

/** First-years can join: named, listed, or in an "all undergraduates" population; a more specific "no" wins. PURE. */
export const matchesFirstYears = (c: WithJoining): boolean => c.joining.firstYears === true;

/** A source says no dues are charged (and none disagrees). PURE. */
export const matchesNoDues = (c: WithJoining): boolean => c.joining.dues === false;

/** A page states no experience is needed (yes / unknown only, ADR 0042). PURE. */
export const matchesNoExperience = (c: WithJoining): boolean => c.joining.noExperience === true;

/** A stated time commitment of at most `hours` a week (a stated minimum alone says nothing). PURE. */
export const matchesMaxHours = (c: { hoursPerWeek: { max: number | null } | null }, hours: number): boolean =>
  c.hoursPerWeek?.max != null && c.hoursPerWeek.max <= hours;

/**
 * How many clubs in a list are known yes, known no, and unknown for one tri-state fact, so
 * the directory can say "120 confirmed · 568 don't say" instead of implying the rest are "no".
 */
export function triCounts(
  clubs: readonly WithJoining[],
  pick: (j: WithJoining["joining"]) => boolean | null,
): { yes: number; no: number; unknown: number } {
  const out = { yes: 0, no: 0, unknown: 0 };
  for (const c of clubs) {
    const v = pick(c.joining);
    if (v === true) out.yes++;
    else if (v === false) out.no++;
    else out.unknown++;
  }
  return out;
}

/** Joining facts for a club nothing is known about (every fact unknown). */
export const NO_JOINING_FACTS: JoiningSummary = {
  access: null,
  general: [],
  roles: [],
  noCuts: false,
  comp: null,
  firstYears: null,
  dues: null,
  noExperience: null,
  conflicts: [],
};
