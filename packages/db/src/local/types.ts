import type { RecruitingSeason } from "@hci/core/browser";
import type { CategoryWithCount } from "../queries/clubs";
import type { CycleSummary, ListedClub } from "../queries/types";

/**
 * The static site's data file (`/data/index.json`). Built from projections at build time;
 * everything time-dependent (cycle status, "recruiting now") is recomputed in the browser.
 */
export interface IndexClub extends ListedClub {
  /** Every cycle with at least one date or stated status (the recruiting board's input). */
  cycles: CycleSummary[];
  /** Normalized names: canonical + aliases, " | "-joined (as in club_search_document). */
  searchNames: string;
  /** Alternate names as written (not acronyms), for "Also known as" match reasons. Omitted when none. */
  aliases?: string[];
  /** Normalized acronyms/abbreviations. */
  searchAcronyms: string[];
  /** Unique normalized words of the club's tags and activities (see `clubWords`). */
  searchTopics: string;
  /** A source states the club charges no dues (only when true). */
  noDues?: true;
  /** The College directory flags the club "no comping requirement" (only when true). */
  noComp?: true;
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
