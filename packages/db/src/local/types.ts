import type { RecruitingSeason } from "@hci/core";
import type { CategoryWithCount } from "../queries/clubs";
import type { ClubSummary, CycleSummary } from "../queries/types";

/**
 * The static site's data file (`/data/index.json`). Built from projections at build time;
 * everything time-dependent (cycle status, "recruiting now") is recomputed in the browser.
 */
export interface IndexClub extends ClubSummary {
  /** Every cycle with at least one date or stated status (the recruiting board's input). */
  cycles: CycleSummary[];
  /** Normalized names: canonical + aliases, " | "-joined (as in club_search_document). */
  searchNames: string;
  /** Normalized acronyms/abbreviations. */
  searchAcronyms: string[];
  /** Normalized category names, tags and short description (lower-weight text matching). */
  searchText: string;
  /** Every category slug the club is in, including parents of its categories. */
  categorySlugs: string[];
  /**
   * Terms the club usually recruits in (`club.recruiting_seasons`, a pattern from past
   * recruiting — not a current deadline). Empty when unknown.
   */
  recruitingSeasons: RecruitingSeason[];
}

export interface StaticIndex {
  version: 1;
  generatedAt: string;
  categories: CategoryWithCount[];
  clubs: IndexClub[];
}
