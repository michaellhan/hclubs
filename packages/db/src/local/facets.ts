import { isRecruitingNow, type JoinMode, type RecognitionStatus, type RecruitingSeason } from "@hci/core/browser";
import {
  isSparseClub,
  matchesMaxHours,
  matchesNoComp,
  matchesNoDues,
  matchesNoExperience,
  matchesOpenJoin,
  triCounts,
  type ClubFilters,
} from "./filters";
import {
  dropsPassingMentions,
  passingUnder,
  effectiveQuery,
  liveClub,
  matchClub,
  matchesStillTime,
  parseQueryIn,
  passesFilters,
  softSelected,
  processNameStarts,
  processNameWord,
} from "./search";
import { constraintPatch } from "./constraints";
import { INTENTS, matchesIntent } from "./intents";
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
  openJoin: number;
  noComp: number;
  noDues: number;
  noExperience: number;
  stillTime: number;
  /** Clubs each "What do you want to do?" intent would show, by slug, in the view without one. */
  intents: Record<string, number>;
  /**
   * Time commitment, over the view without any hours limit: how many clubs state a weekly
   * maximum, how many don't ("unknown", never counted as under any limit), and — when
   * `filters.maxHours` is set — how many state at most that many hours.
   */
  hours: { stated: number; unknown: number; within: number };
  /**
   * For each yes/no/unknown filter, the clubs in the view without it that are known yes, known
   * no, or unknown — so "37" can read as "37 confirmed; 650 don't say", never "only 37".
   */
  known: Record<"openJoin" | "noComp" | "noDues" | "noExperience", { yes: number; no: number; unknown: number }>;
  /** Clubs the toggle would add to the current view. */
  includeGraduate: number;
  includeInactive: number;
}

export function facetCounts(
  clubs: readonly IndexClub[],
  req: { text: string | null; filters: ClubFilters; now: Date },
): FacetCounts {
  // Constraint phrases in the text ("no comp finance") count as the filters they turn on.
  const eff = effectiveQuery(clubs, req.text, req.filters, req.now);
  const f = eff.filters;
  const text = eff.text;
  const q = text ? parseQueryIn(clubs, text) : null;
  // Text matching doesn't depend on filters: do it once.
  const base: IndexClub[] = [];
  const dropWeak = dropsPassingMentions(clubs, eff, q, req.now);
  const pn = q ? null : processNameWord(req.text, eff);
  for (const raw of clubs) {
    const m = q ? matchClub(raw, q, text) : null;
    if (q && (!m || (passingUnder(m, eff) && dropWeak))) continue;
    const c = liveClub(raw, req.now);
    if (!q && eff.soft.length && !softSelected(raw, eff.soft, req.now, c) && !(pn && processNameStarts(raw, pn)))
      continue;
    if (f.hideSparse && isSparseClub(c)) continue;
    base.push(c);
  }
  const among = (patch: Partial<ClubFilters>) => {
    const g = { ...f, ...patch };
    return base.filter((c) => passesFilters(c, g, req.now));
  };
  const tally = <K extends string>(list: IndexClub[], keysOf: (c: IndexClub) => readonly K[]) => {
    const out: Partial<Record<K, number>> = {};
    for (const c of list) for (const k of new Set(keysOf(c))) out[k] = (out[k] ?? 0) + 1;
    return out;
  };
  const current = among({}).length;
  const without = {
    openJoin: among({ openJoin: false }),
    noComp: among({ noComp: false }),
    noDues: among({ noDues: false }),
    noExperience: among({ noExperience: false }),
    maxHours: among({ maxHours: null }),
  };
  const limit = f.maxHours;
  const stated = without.maxHours.filter((c) => c.hoursPerWeek?.max != null).length;
  return {
    categories: tally(among({ categories: [] }), (c) => c.categorySlugs) as Record<string, number>,
    joinModes: tally(among({ joinModes: [] }), (c) => c.joinModes),
    recognition: tally(among({ recognition: [] }), (c) => [c.recognitionStatus]),
    recruitingSeasons: tally(among({ recruitingSeasons: [] }), (c) => c.recruitingSeasons ?? []),
    recruitingNow: among({ recruitingNow: false }).filter((c) => c.cycles.some((cy) => isRecruitingNow(cy.status)))
      .length,
    openJoin: without.openJoin.filter(matchesOpenJoin).length,
    noComp: without.noComp.filter(matchesNoComp).length,
    noDues: without.noDues.filter(matchesNoDues).length,
    noExperience: without.noExperience.filter(matchesNoExperience).length,
    stillTime: among({ stillTime: false }).filter((c) => matchesStillTime(c, req.now)).length,
    intents: (() => {
      const list = among({ intent: null });
      return Object.fromEntries(INTENTS.map((i) => [i.slug, list.filter((c) => matchesIntent(c, i)).length]));
    })(),
    hours: {
      stated,
      unknown: without.maxHours.length - stated,
      within: limit === null ? 0 : without.maxHours.filter((c) => matchesMaxHours(c, limit)).length,
    },
    known: {
      // Open vs a stated process for members; "mixed" (sources say both) counts as unknown.
      openJoin: triCounts(without.openJoin, (j) =>
        j.access === "open" ? true : j.access === "process" ? false : null,
      ),
      noComp: triCounts(without.noComp, (j) => (j.comp === null ? null : !j.comp)),
      noDues: triCounts(without.noDues, (j) => (j.dues === null ? null : !j.dues)),
      // Never false: a club that doesn't say is unknown, not "experience needed".
      noExperience: triCounts(without.noExperience, (j) => (j.noExperience === true ? true : null)),
    },
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
  const eff = effectiveQuery(clubs, req.text, req.filters, req.now);
  const text = eff.text;
  const pn = text ? null : processNameWord(req.text, eff);
  const out: (T & { count: number })[] = [];
  for (const cand of candidates) {
    // The link keeps the typed text, and the next page reads its constraint phrases ("no comp
    // finance") as filters again: count what that page will show, not the bare patch.
    // Dropping the text drops what it implied, too.
    const filters = cand.patch ? { ...eff.base, ...cand.patch, ...constraintPatch(eff.constraints) } : eff.base;
    const q = cand.patch === null || !text ? null : parseQueryIn(clubs, text);
    let count = 0;
    for (const raw of clubs) {
      const c = liveClub(raw, req.now);
      if (!passesFilters(c, filters, req.now)) continue;
      if (q && !matchClub(raw, q, text)) continue;
      if (
        cand.patch !== null &&
        !text &&
        eff.soft.length &&
        !softSelected(raw, eff.soft, req.now, c) &&
        !(pn && processNameStarts(raw, pn))
      )
        continue;
      if (filters.hideSparse && isSparseClub(c)) continue;
      count++;
    }
    if (count > 0) out.push({ ...cand, count });
  }
  return out.sort((a, b) => b.count - a.count);
}
