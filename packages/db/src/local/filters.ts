import { z } from "zod";
import { JoinMode, OrgType, RecognitionStatus, RecruitingSeason } from "@hci/core";

/**
 * Directory filters and sort keys. Pure (no database imports) so the static site can
 * filter in the browser with exactly the same semantics as the Postgres provider.
 */
export const SORT_KEYS = ["relevance", "name", "deadline", "updated", "completeness"] as const;
export const SortKey = z.enum(SORT_KEYS);
export type SortKey = z.infer<typeof SortKey>;

export const ClubFilters = z.object({
  categories: z.array(z.string().regex(/^[a-z0-9-]+$/)).default([]),
  joinModes: z.array(JoinMode).default([]),
  recognition: z.array(RecognitionStatus).default([]),
  orgTypes: z.array(OrgType).default([]),
  recruitingNow: z.boolean().default(false),
  freshmenEligible: z.boolean().default(false),
  includeInactive: z.boolean().default(false),
  /** Graduate/professional-school groups are hidden unless requested (undergraduate focus). */
  includeGraduate: z.boolean().default(false),
  /** Only clubs explicitly open to this class year (unknown ≠ eligible). */
  classYear: z.enum(["first_year", "sophomore", "junior", "senior"]).nullable().default(null),
  /**
   * Clubs whose usual recruiting pattern includes any of these terms (unknown ≠ match).
   * Static-site only for now: PostgresSearchProvider does not apply it yet.
   */
  recruitingSeasons: z.array(RecruitingSeason).default([]),
  /**
   * Leave out clubs with little info: no short description and no website or Instagram
   * link (see `isSparseClub`). The directory sets this when browsing without a text query.
   */
  hideSparse: z.boolean().default(false),
  /**
   * No comp, audition or application needed: the club says membership is open (or based on
   * attendance), or the College directory flags it "no comping requirement". Static-site only.
   */
  openJoin: z.boolean().default(false),
  /** "What do you want to do?" intent slug (see `INTENTS`). Static-site only. */
  intent: z
    .string()
    .regex(/^[a-z0-9-]+$/)
    .nullable()
    .default(null),
});
export type ClubFilters = z.infer<typeof ClubFilters>;

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
