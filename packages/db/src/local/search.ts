import { dateValueEnd, isRecruitingNow, normalizeAcronym, normalizeName } from "@hci/core/browser";
import { CONCEPT_BY_TERM, type Concept } from "./concepts";
import { pickCurrentCycle, withLiveStatus } from "./cycles";
import { isSparseClub, matchesOpenJoin, type ClubFilters, type SortKey } from "./filters";
import { INTENTS, matchesIntent } from "./intents";
import type { IndexClub } from "./types";
import { clubWords } from "./words";

/**
 * In-browser directory search over the static index (CLAUDE.md §13, ADR 0034). A small,
 * transparent relevance model. PURE.
 *
 * The query is split into units: a concept phrase from the synonym table ("volunteering",
 * "computer science", "a cappella") or a plain word. Filler words ("harvard", "club") are
 * dropped. A club matches when every unit matches something about it; its score is the sum
 * of the units' best field weights (`WEIGHTS`) plus whole-query bonuses (exact name or
 * acronym, name prefix). A word the index has never seen is corrected to the closest known
 * word (one or two letters off) before matching, and the correction is reported.
 */

export const WEIGHTS = {
  exactName: 100,
  exactAcronym: 90,
  namePrefix: 30,
  allWordsInName: 10,
  acronymWord: 14,
  nameWord: 12,
  namePrefixWord: 8,
  aboutWord: 4,
  aboutPrefixWord: 3,
  topicWord: 3,
  topicPrefixWord: 2,
  /** The concept's word as typed, in the club's name / text. */
  conceptLiteralName: 12,
  conceptLiteralText: 9,
  /** The word as typed only among tags/activities (broad labels like "theater and dance"). */
  conceptLiteralTopic: 5,
  /** A related word in the club's name. */
  conceptRelatedName: 6,
  /** The club is in one of the concept's categories. */
  conceptCategory: 5,
  /** A related word in the club's text. */
  conceptRelatedText: 2,
  /** The name minus "Harvard"/"Club"-style words equals the query ("crimson" → Harvard Crimson). */
  coreName: 80,
  /** Ties among equally good matches go to clubs with more information (0–1 × this). */
  completeness: 2,
} as const;

const MAX_QUERY_LENGTH = 100;

/** Words that say nothing about which club (every name has them). */
const FILLER = new Set(
  "harvard radcliffe college undergraduate undergraduates undergrad club clubs society societies group groups organization organizations org orgs association the of and for at in a an to on with about student students team teams".split(
    " ",
  ),
);

// --- Prepared, per-club search data (computed once per index object) -----------------------------

interface Prepared {
  names: string[];
  nameWords: Set<string>;
  acronyms: Set<string>;
  aboutWords: Set<string>;
  topicWords: Set<string>;
  textWords: Set<string>;
  /** " word word … " strings for phrase checks. */
  aboutLine: string;
  topicLine: string;
  cats: Set<string>;
}

const prepared = new WeakMap<IndexClub, Prepared>();
const words = (s: string) => s.split(/\s+|\|/).filter(Boolean);

function prepare(club: IndexClub): Prepared {
  let p = prepared.get(club);
  if (!p) {
    const cw = clubWords(club);
    p = {
      names: club.searchNames.split(" | "),
      nameWords: new Set(words(club.searchNames)),
      acronyms: new Set(club.searchAcronyms),
      aboutWords: new Set(words(cw.about)),
      topicWords: new Set(words(cw.topics)),
      textWords: new Set([...words(cw.about), ...words(cw.topics)]),
      aboutLine: ` ${cw.about} `,
      topicLine: ` ${cw.topics} `,
      cats: new Set(club.categorySlugs),
    };
    prepared.set(club, p);
  }
  return p;
}

/** Every word the index knows (names, text, concept terms), for spelling correction. */
const vocabularies = new WeakMap<readonly IndexClub[], Set<string>>();
function vocabulary(clubs: readonly IndexClub[]): Set<string> {
  let v = vocabularies.get(clubs);
  if (!v) {
    v = new Set<string>();
    for (const c of clubs) {
      const p = prepare(c);
      for (const set of [p.nameWords, p.aboutWords, p.topicWords]) for (const w of set) v.add(w);
    }
    for (const term of CONCEPT_BY_TERM.keys()) if (!term.includes(" ")) v.add(term);
    vocabularies.set(clubs, v);
  }
  return v;
}

// --- Query parsing ----------------------------------------------------------------------------------

export type QueryUnit = { kind: "concept"; concept: Concept; phrase: string } | { kind: "word"; word: string };

export interface ParsedQuery {
  norm: string;
  units: QueryUnit[];
  /** "acapela" → "a cappella": the words that were corrected, if any. */
  corrected: string | null;
}

/** Edit distance with an early exit above `max`. */
export function editDistance(a: string, b: string, max = 2): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let rowMin = i;
    for (let j = 1; j <= b.length; j++) {
      const sub = prev[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1);
      // Adjacent swap ("chiense") counts as one edit.
      const swap =
        i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1] ? (prev[j - 2] ?? Infinity) : Infinity;
      cur[j] = Math.min(prev[j]! + 1, cur[j - 1]! + 1, sub, swap === Infinity ? Infinity : swap);
      rowMin = Math.min(rowMin, cur[j]!);
    }
    if (rowMin > max) return max + 1;
    prev = cur;
  }
  return prev[b.length]!;
}

/** The closest known word for an unknown one, or null (4+ letters; 1 edit, 2 from 8 letters). */
function correct(word: string, vocab: Set<string>): string | null {
  if (word.length < 4 || /\d/.test(word)) return null;
  const max = word.length >= 8 ? 2 : 1;
  let best: string | null = null;
  let bestD = max + 1;
  for (const v of vocab) {
    if (v.length < 3) continue;
    const d = editDistance(word, v, max);
    if (d < bestD || (d === bestD && best !== null && v < best)) {
      best = v;
      bestD = d;
    }
  }
  return bestD <= max ? best : null;
}

const sortedVocab = new WeakMap<Set<string>, string[]>();
/** Whether a word is in the vocabulary, or (3+ letters) begins a vocabulary word. */
function known(word: string, vocab: Set<string>): boolean {
  if (vocab.has(word)) return true;
  if (word.length < 3) return false;
  let sorted = sortedVocab.get(vocab);
  if (!sorted) sortedVocab.set(vocab, (sorted = [...vocab].sort()));
  let lo = 0;
  let hi = sorted.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (sorted[mid]! < word) lo = mid + 1;
    else hi = mid;
  }
  return lo < sorted.length && sorted[lo]!.startsWith(word);
}

/** Split a query into concept phrases and plain words. PURE (vocabulary optional). */
export function parseQuery(text: string, vocab?: Set<string>): ParsedQuery {
  const norm = normalizeName(text.slice(0, MAX_QUERY_LENGTH));
  const all = norm.split(" ").filter(Boolean);
  const units: QueryUnit[] = [];
  const fixes: string[] = [];
  let changed = false;
  for (let i = 0; i < all.length;) {
    // Longest concept phrase starting here (up to four words: "model united nations").
    let matched = false;
    for (let n = Math.min(4, all.length - i); n >= 1; n--) {
      const phrase = all.slice(i, i + n).join(" ");
      const concept = CONCEPT_BY_TERM.get(phrase);
      if (concept) {
        units.push({ kind: "concept", concept, phrase });
        fixes.push(phrase);
        i += n;
        matched = true;
        break;
      }
    }
    if (matched) continue;
    const w = all[i]!;
    i++;
    if (FILLER.has(w)) continue;
    if (vocab && !known(w, vocab)) {
      const fix = correct(w, vocab);
      if (fix) {
        changed = true;
        fixes.push(fix);
        const concept = CONCEPT_BY_TERM.get(fix);
        units.push(concept ? { kind: "concept", concept, phrase: fix } : { kind: "word", word: fix });
        continue;
      }
    }
    fixes.push(w);
    units.push({ kind: "word", word: w });
  }
  // A query made only of filler words ("harvard club") searches for them as written.
  if (units.length === 0) for (const w of all) units.push({ kind: "word", word: w });
  return { norm, units, corrected: changed ? fixes.join(" ") : null };
}

// --- Scoring ----------------------------------------------------------------------------------------

const hasPrefix = (set: Set<string>, w: string) => {
  for (const x of set) if (x.startsWith(w)) return true;
  return false;
};

/** Why a club matched one unit, and how much. */
interface UnitHit {
  score: number;
  reason: string;
}

function wordHit(p: Prepared, w: string, allowPrefix: boolean): UnitHit | null {
  let name = 0;
  if (w.length >= 2 && p.acronyms.has(w)) name = WEIGHTS.acronymWord;
  else if (p.nameWords.has(w)) name = WEIGHTS.nameWord;
  else if (allowPrefix && w.length >= 3 && hasPrefix(p.nameWords, w)) name = WEIGHTS.namePrefixWord;
  let text = 0;
  if (p.aboutWords.has(w)) text = WEIGHTS.aboutWord;
  else if (p.topicWords.has(w)) text = WEIGHTS.topicWord;
  else if (allowPrefix && w.length >= 4 && hasPrefix(p.aboutWords, w)) text = WEIGHTS.aboutPrefixWord;
  else if (allowPrefix && w.length >= 4 && hasPrefix(p.topicWords, w)) text = WEIGHTS.topicPrefixWord;
  if (name) return { score: name + text / 2, reason: "name" };
  return text ? { score: text, reason: `mentions “${w}”` } : null;
}

function phraseIn(set: Set<string>, lines: string[], phrase: string): boolean {
  return phrase.includes(" ") ? lines.some((n) => ` ${n} `.includes(` ${phrase} `)) : set.has(phrase);
}

/**
 * A concept unit scores in tiers, added up: the word as typed (name, else text), else a
 * related word in the name; plus the concept's category; plus a related word in the text.
 * "newspaper" therefore ranks a club whose description says "newspaper" above one whose
 * name merely contains a related word ("magazine").
 */
function conceptHit(p: Prepared, c: Concept, phrase: string, categoryName: (slug: string) => string): UnitHit | null {
  let score = 0;
  let reason: string | null = null;
  const textWords = p.textWords;
  const aboutText = [p.aboutLine, p.topicLine];
  if (phraseIn(p.nameWords, p.names, phrase) || (!phrase.includes(" ") && p.acronyms.has(phrase))) {
    score += WEIGHTS.conceptLiteralName;
    reason = "name";
  } else if (!phrase.includes(" ") && phrase.length >= 6 && hasPrefix(p.nameWords, phrase)) {
    // "premed" begins "premedical"; short words ("quant" / "quantum") never count this way.
    score += WEIGHTS.conceptLiteralName - 2;
    reason = "name";
  } else if (phraseIn(p.aboutWords, [p.aboutLine], phrase)) {
    score += WEIGHTS.conceptLiteralText;
    reason = `mentions “${phrase}”`;
  } else if (c.related.some((r) => r.includes(" ") && phraseIn(p.nameWords, p.names, r))) {
    // A multi-word full form in the name ("model united nations") is the name itself.
    score += WEIGHTS.conceptLiteralName;
    reason = "name";
  } else if (c.related.some((r) => phraseIn(p.nameWords, p.names, r))) {
    score += WEIGHTS.conceptRelatedName;
    reason = "name";
  } else if (phraseIn(p.topicWords, [p.topicLine], phrase)) {
    score += WEIGHTS.conceptLiteralTopic;
    reason = `mentions “${phrase}”`;
  }
  const cat = c.categories.find((s) => p.cats.has(s));
  if (cat) {
    score += WEIGHTS.conceptCategory;
    reason ??= `category ${categoryName(cat)}`;
  }
  const related = c.related.find((r) => r !== phrase && phraseIn(textWords, aboutText, r));
  if (related) {
    score += WEIGHTS.conceptRelatedText;
    reason ??= `mentions “${related}”`;
  }
  return reason ? { score, reason } : null;
}

export interface ClubMatch {
  score: number;
  /** Short, human-readable reasons ("name", "category Consulting", "mentions “software”"). */
  reasons: string[];
}

/** Relevance of a club for a parsed query; null when it doesn't match every unit. */
export function matchClub(
  club: IndexClub,
  q: ParsedQuery,
  rawText: string,
  categoryName: (slug: string) => string = (s) => s,
): ClubMatch | null {
  if (!q.norm) return null;
  const p = prepare(club);
  let score = 0;
  const reasons: string[] = [];
  for (const u of q.units) {
    const hit = u.kind === "concept" ? conceptHit(p, u.concept, u.phrase, categoryName) : wordHit(p, u.word, true);
    if (!hit) return null;
    score += hit.score;
    if (!reasons.includes(hit.reason)) reasons.push(hit.reason);
  }
  const acr = rawText.length <= 12 && !/\s/.test(rawText.trim()) ? normalizeAcronym(rawText) : "";
  if (p.names.includes(q.norm)) score += WEIGHTS.exactName;
  if (acr.length >= 2 && p.acronyms.has(acr)) score += WEIGHTS.exactAcronym;
  if (p.names.some((n) => n.startsWith(q.norm))) score += WEIGHTS.namePrefix;
  const core = (n: string) =>
    n
      .split(" ")
      .filter((w) => !FILLER.has(w))
      .join(" ");
  const qCore = core(q.norm);
  if (qCore && !p.names.includes(q.norm) && p.names.some((n) => core(n) === qCore)) score += WEIGHTS.coreName;
  const qWords = q.norm.split(" ").filter((w) => !FILLER.has(w));
  if (qWords.length > 1 && qWords.every((w) => p.nameWords.has(w))) score += WEIGHTS.allWordsInName;
  score += club.completeness * WEIGHTS.completeness;
  return { score, reasons };
}

/** Relevance of a club for a query string; 0 means "not a match". */
export function scoreClub(club: IndexClub, text: string): number {
  return matchClub(club, parseQuery(text), text)?.score ?? 0;
}

// --- Directory search -------------------------------------------------------------------------------

export interface LocalSearchResult {
  clubs: IndexClub[];
  total: number;
  /** Clubs that matched everything else but were left out by `hideSparse`. */
  hiddenSparse: number;
  /** Why each returned club matched the text query (by club id). */
  reasons: Record<string, string[]>;
  /** The query as corrected for spelling, when a word was unknown. */
  corrected: string | null;
  /** Concepts the query names (for "related topics" and empty-result help). */
  concepts: Concept[];
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

/** Whether a club passes the (non-text) filters. */
export function passesFilters(c: IndexClub, f: ClubFilters): boolean {
  if (!f.includeInactive && (c.activityStatus === "inactive" || c.activityStatus === "defunct")) return false;
  if (!f.includeGraduate && c.affiliationScope === "graduate_school") return false;
  if (f.categories.length && !f.categories.some((s) => c.categorySlugs.includes(s))) return false;
  if (f.joinModes.length && !f.joinModes.some((m) => c.joinModes.includes(m))) return false;
  if (f.recognition.length && !f.recognition.includes(c.recognitionStatus)) return false;
  if (f.orgTypes.length && (!c.orgType || !f.orgTypes.includes(c.orgType))) return false;
  if (f.freshmenEligible && c.freshmenEligible !== true) return false;
  if (f.classYear) {
    const ok =
      f.classYear === "first_year"
        ? c.freshmenEligible === true || (c.eligibleClasses ?? []).includes("first_year")
        : (c.eligibleClasses ?? []).includes(f.classYear);
    if (!ok) return false;
  }
  if (f.recruitingSeasons.length && !f.recruitingSeasons.some((s) => (c.recruitingSeasons ?? []).includes(s)))
    return false;
  if (f.recruitingNow && !c.cycles.some((cy) => isRecruitingNow(cy.status))) return false;
  if (f.openJoin && !matchesOpenJoin(c)) return false;
  if (f.intent) {
    const intent = INTENTS.find((i) => i.slug === f.intent);
    if (intent && !matchesIntent(c, intent)) return false;
  }
  return true;
}

export function searchLocal(
  clubs: readonly IndexClub[],
  req: {
    text: string | null;
    filters: ClubFilters;
    sort: SortKey;
    offset: number;
    limit: number;
    now: Date;
    categoryName?: (slug: string) => string;
  },
): LocalSearchResult {
  const { filters: f, now } = req;
  const text = req.text?.trim() ?? "";
  const query = text ? parseQuery(text, vocabulary(clubs)) : null;
  const scored: { club: IndexClub; score: number; reasons: string[] }[] = [];
  let hiddenSparse = 0;
  for (const raw of clubs) {
    const c = liveClub(raw, now);
    if (!passesFilters(c, f)) continue;
    const m = query ? matchClub(raw, query, text, req.categoryName) : null;
    if (query && !m) continue;
    if (f.hideSparse && isSparseClub(c)) {
      hiddenSparse++;
      continue;
    }
    scored.push({ club: c, score: m?.score ?? 0, reasons: m?.reasons ?? [] });
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
  const page = scored.slice(req.offset, req.offset + req.limit);
  return {
    total: scored.length,
    hiddenSparse,
    clubs: page.map((s) => s.club),
    reasons: Object.fromEntries(page.map((s) => [s.club.id, s.reasons])),
    corrected: query?.corrected ?? null,
    concepts: query ? query.units.flatMap((u) => (u.kind === "concept" ? [u.concept] : [])) : [],
  };
}
