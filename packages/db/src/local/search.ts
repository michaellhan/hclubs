import { dateValueEnd, isRecruitingNow, normalizeAcronym, normalizeName } from "@hci/core";
import { pickCurrentCycle, withLiveStatus } from "./cycles";
import type { ClubFilters, SortKey } from "./filters";
import type { IndexClub } from "./types";

/**
 * In-browser directory search over the static index (CLAUDE.md §13 "compact client
 * index"). Mirrors PostgresSearchProvider: same filters; ranking is exact acronym ≫ exact
 * name/alias ≫ name prefix ≫ word matches ≫ fuzzy trigram similarity.
 */

const MAX_QUERY_LENGTH = 100;

function trigrams(s: string): Set<string> {
  const out = new Set<string>();
  for (const w of s.split(" ").filter(Boolean)) {
    const p = `  ${w} `;
    for (let i = 0; i + 3 <= p.length; i++) out.add(p.slice(i, i + 3));
  }
  return out;
}

/** pg_trgm-style word_similarity: best overlap of the query with any window of the text. */
function wordSimilarity(query: string, text: string): number {
  const q = trigrams(query);
  if (q.size === 0) return 0;
  const words = text.split(/\s+|\|/).filter(Boolean);
  const n = query.split(" ").filter(Boolean).length;
  let best = 0;
  for (let i = 0; i < words.length; i++) {
    const window = trigrams(words.slice(i, i + Math.max(1, n)).join(" "));
    let shared = 0;
    for (const t of q) if (window.has(t)) shared++;
    best = Math.max(best, shared / q.size);
  }
  return best;
}

/** Relevance of a club for a query; 0 means "not a match". */
export function scoreClub(club: IndexClub, text: string): number {
  const qNorm = normalizeName(text.slice(0, MAX_QUERY_LENGTH));
  if (!qNorm) return 0;
  const qAcr = text.length <= 12 && !/\s/.test(text.trim()) ? normalizeAcronym(text) : "";
  const names = club.searchNames.split(" | ");
  const tokens = qNorm.split(" ").filter(Boolean);
  const haystack = `${club.searchNames} ${club.searchText}`;
  const nameWords = new Set(club.searchNames.split(/\s+|\|/).filter(Boolean));
  const allWords = haystack.split(/\s+|\|/).filter(Boolean);

  const acr = qAcr.length >= 2 && club.searchAcronyms.includes(qAcr);
  const exact = names.includes(qNorm);
  const prefix = names.some((n) => n.startsWith(qNorm));
  // Every query token is a prefix of some word (names weigh more than other text).
  const tokenHits = tokens.map((t) =>
    [...nameWords].some((w) => w.startsWith(t)) ? 2 : allWords.some((w) => w.startsWith(t)) ? 1 : 0,
  );
  const allTokens = tokenHits.every((h) => h > 0);
  const sim = wordSimilarity(qNorm, club.searchNames);
  const contains = club.searchNames.includes(qNorm);

  if (!(acr || allTokens || sim >= 0.45 || contains)) return 0;
  return (
    (acr ? 10 : 0) +
    (exact ? 8 : 0) +
    (prefix ? 3 : 0) +
    (allTokens ? tokenHits.reduce<number>((a, b) => a + b, 0) / tokens.length : 0) +
    sim * 2
  );
}

export interface LocalSearchResult {
  clubs: IndexClub[];
  total: number;
}

/** Live view of a club at `now`: cycle statuses and the featured cycle recomputed. */
export function liveClub(club: IndexClub, now: Date): IndexClub {
  const cycles = club.cycles.map((c) => withLiveStatus(c, now));
  return { ...club, cycles, currentCycle: pickCurrentCycle(cycles, now) };
}

export function nextDeadline(club: IndexClub, now: Date): number | null {
  let best: number | null = null;
  for (const c of club.cycles) {
    if (!c.deadline) continue;
    const t = dateValueEnd(c.deadline).getTime();
    if (t > now.getTime() && (best === null || t < best)) best = t;
  }
  return best;
}

export function searchLocal(
  clubs: readonly IndexClub[],
  req: { text: string | null; filters: ClubFilters; sort: SortKey; offset: number; limit: number; now: Date },
): LocalSearchResult {
  const { filters: f, now } = req;
  const text = req.text?.trim() ?? "";
  const scored: { club: IndexClub; score: number }[] = [];
  for (const raw of clubs) {
    const c = liveClub(raw, now);
    if (!f.includeInactive && (c.activityStatus === "inactive" || c.activityStatus === "defunct")) continue;
    if (!f.includeGraduate && c.affiliationScope === "graduate_school") continue;
    if (f.categories.length && !f.categories.some((s) => c.categorySlugs.includes(s))) continue;
    if (f.joinModes.length && !f.joinModes.some((m) => c.joinModes.includes(m))) continue;
    if (f.recognition.length && !f.recognition.includes(c.recognitionStatus)) continue;
    if (f.orgTypes.length && (!c.orgType || !f.orgTypes.includes(c.orgType))) continue;
    if (f.freshmenEligible && c.freshmenEligible !== true) continue;
    if (f.classYear) {
      const ok =
        f.classYear === "first_year"
          ? c.freshmenEligible === true || (c.eligibleClasses ?? []).includes("first_year")
          : (c.eligibleClasses ?? []).includes(f.classYear);
      if (!ok) continue;
    }
    if (f.recruitingSeasons.length && !f.recruitingSeasons.some((s) => (c.recruitingSeasons ?? []).includes(s)))
      continue;
    if (f.recruitingNow && !c.cycles.some((cy) => isRecruitingNow(cy.status))) continue;
    const score = text ? scoreClub(c, text) : 0;
    if (text && score === 0) continue;
    scored.push({ club: c, score });
  }

  const byName = (a: IndexClub, b: IndexClub) =>
    a.name.toLowerCase().localeCompare(b.name.toLowerCase()) || a.id.localeCompare(b.id);
  const sort = req.sort === "relevance" && !text ? "name" : req.sort;
  const nullsLast = (a: number | null, b: number | null) => (a === b ? 0 : a === null ? 1 : b === null ? -1 : a - b);
  scored.sort((x, y) => {
    const a = x.club;
    const b = y.club;
    switch (sort) {
      case "relevance":
        return y.score - x.score || byName(a, b);
      case "deadline":
        return nullsLast(nextDeadline(a, now), nextDeadline(b, now)) || byName(a, b);
      case "updated":
        return (b.lastObservedAt ?? "").localeCompare(a.lastObservedAt ?? "") || byName(a, b);
      case "completeness":
        return b.completeness - a.completeness || byName(a, b);
      case "name":
        return byName(a, b);
    }
  });
  return {
    total: scored.length,
    clubs: scored.slice(req.offset, req.offset + req.limit).map((s) => s.club),
  };
}
