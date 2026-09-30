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
});
export type ClubFilters = z.infer<typeof ClubFilters>;
