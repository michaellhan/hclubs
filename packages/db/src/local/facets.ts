import { isRecruitingNow, type JoinMode, type RecognitionStatus, type RecruitingSeason } from "@hci/core/browser";
import { isSparseClub, matchesFirstYears, matchesOpenJoin, type ClubFilters } from "./filters";
import { liveClub, matchClub, parseQueryIn, passesFilters } from "./search";
import type { IndexClub } from "./types";

/**
 * Result counts for every directory filter option, given the rest of the current view
 * (CLAUDE.md §13). Standard facet semantics: an option's count is how many clubs the view
 * would show with that option added to its group, so options in one group (OR) don't
 * zero each other out. PURE.
 */
export interface FacetCounts {
  categories: Record<string, number>;
  joinModes: Partial<Record<JoinMode, number>>;
  recognition: Partial<Record<RecognitionStatus, number>>;
  recruitingSeasons: Partial<Record<RecruitingSeason, number>>;
  recruitingNow: number;
  freshmenEligible: number;
  openJoin: number;
  noDues: number;
  /** Clubs the toggle would add to the current view. */
  includeGraduate: number;
  includeInactive: number;
}

export function facetCounts(
  clubs: readonly IndexClub[],
  req: { text: string | null; filters: ClubFilters; now: Date },
): FacetCounts {
  const f = req.filters;
  const text = req.text?.trim() ?? "";
  const q = text ? parseQueryIn(clubs, text) : null;
  // Text matching doesn't depend on filters: do it once.
  const base: IndexClub[] = [];
  for (const raw of clubs) {
    if (q && !matchClub(raw, q, text)) continue;
    const c = liveClub(raw, req.now);
    if (f.hideSparse && isSparseClub(c)) continue;
    base.push(c);
  }
  const among = (patch: Partial<ClubFilters>) => {
    const g = { ...f, ...patch };
    return base.filter((c) => passesFilters(c, g));
  };
  const tally = <K extends string>(list: IndexClub[], keysOf: (c: IndexClub) => readonly K[]) => {
    const out: Partial<Record<K, number>> = {};
    for (const c of list) for (const k of new Set(keysOf(c))) out[k] = (out[k] ?? 0) + 1;
    return out;
  };
  const current = among({}).length;
  return {
    categories: tally(among({ categories: [] }), (c) => c.categorySlugs) as Record<string, number>,
    joinModes: tally(among({ joinModes: [] }), (c) => c.joinModes),
    recognition: tally(among({ recognition: [] }), (c) => [c.recognitionStatus]),
    recruitingSeasons: tally(among({ recruitingSeasons: [] }), (c) => c.recruitingSeasons ?? []),
    recruitingNow: among({ recruitingNow: false }).filter((c) => c.cycles.some((cy) => isRecruitingNow(cy.status)))
      .length,
    freshmenEligible: among({ freshmenEligible: false }).filter(matchesFirstYears).length,
    openJoin: among({ openJoin: false }).filter(matchesOpenJoin).length,
    noDues: among({ noDues: false }).filter((c) => c.noDues === true).length,
    includeGraduate: f.includeGraduate ? 0 : among({ includeGraduate: true }).length - current,
    includeInactive: f.includeInactive ? 0 : among({ includeInactive: true }).length - current,
  };
}

/**
 * For an empty or tiny result: how many clubs each single relaxation would show (drop one
 * filter, or the text query), best first. Only relaxations that help are returned.
 */
export function relaxations<T extends { key: string; patch: Partial<ClubFilters> | null }>(
  clubs: readonly IndexClub[],
  req: { text: string | null; filters: ClubFilters; now: Date },
  candidates: readonly T[],
): (T & { count: number })[] {
  const text = req.text?.trim() ?? "";
  const out: (T & { count: number })[] = [];
  for (const cand of candidates) {
    const filters = cand.patch ? { ...req.filters, ...cand.patch } : req.filters;
    const q = cand.patch === null || !text ? null : parseQueryIn(clubs, text);
    let count = 0;
    for (const raw of clubs) {
      const c = liveClub(raw, req.now);
      if (!passesFilters(c, filters)) continue;
      if (q && !matchClub(raw, q, text)) continue;
      if (filters.hideSparse && isSparseClub(c)) continue;
      count++;
    }
    if (count > 0) out.push({ ...cand, count });
  }
  return out.sort((a, b) => b.count - a.count);
}
