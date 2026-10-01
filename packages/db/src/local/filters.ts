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

/**
 * Directory filters and sort keys. Pure (no database imports) so the static site can
 * filter in the browser with exactly the same semantics as the Postgres provider.
 * Validated by hand rather than with Zod, which would add about 90 KB to every page.
 */
export const SORT_KEYS = ["relevance", "name", "deadline", "updated", "completeness"] as const;
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
  /** Only clubs explicitly open to this class year (unknown ≠ eligible). */
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
   * No comp, audition or application needed: the club says membership is open (or based on
   * attendance), or the College directory flags it "no comping requirement". Static-site only.
   */
  openJoin: boolean;
  /** A source states the club charges no dues (unknown ≠ match). Static-site only. */
  noDues: boolean;
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
      noDues: bool(input, "noDues"),
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
 * Joining needs no comp, audition or application: an "open" or attendance-based join mode,
 * or the College directory's "no comping requirement" flag — and no selective mode stated. PURE.
 */
export function matchesOpenJoin(c: { joinModes: readonly string[]; noComp?: boolean }): boolean {
  const selective = c.joinModes.some((m) => ["application", "comp", "audition", "tryout", "invite_only"].includes(m));
  if (selective) return false;
  return c.joinModes.includes("open") || c.joinModes.includes("attendance_based") || c.noComp === true;
}

/**
 * Open to first-years, as stated: the club says first-years are eligible, or lists them
 * among the class years it takes (for itself or a current recruiting cycle). An explicit
 * "not eligible" wins; unknown is never a match. PURE.
 */
export function matchesFirstYears(c: {
  freshmenEligible: boolean | null;
  eligibleClasses: string[] | null;
  cycles?: readonly { eligibleClasses: string[] | null }[];
}): boolean {
  if (c.freshmenEligible !== null) return c.freshmenEligible;
  if ((c.eligibleClasses ?? []).includes("first_year")) return true;
  return (c.cycles ?? []).some((cy) => (cy.eligibleClasses ?? []).includes("first_year"));
}
