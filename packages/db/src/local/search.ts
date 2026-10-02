import { dateValueEnd, isRecruitingNow, normalizeAcronym, normalizeName } from "@hci/core/browser";
import { CONCEPT_BY_TERM, type Concept } from "./concepts";
import { pickCurrentCycle, withLiveStatus } from "./cycles";
import { isSparseClub, matchesFirstYears, matchesOpenJoin, type ClubFilters, type SortKey } from "./filters";
import { INTENTS, matchesIntent } from "./intents";
import type { IndexClub } from "./types";
import { wordVariants } from "./variants";
import { clubWords, wordSet } from "./words";

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
 *
 * Words match in their plural/singular and US/UK spellings ("robot" ↔ "robots",
 * "theatre" ↔ "theater"; see `wordVariants`). Only the last word of a query also matches
 * as a prefix ("comp" while typing "computer"): a finished word never stands for a longer,
 * different one ("math" never finds "Mather").
 */

export const WEIGHTS = {
  exactName: 100,
  exactAcronym: 90,
  /** The query is the initials of the club's name ("hccg"). Below a stated acronym. */
  exactInitials: 70,
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
  /**
   * Extra when the description says the word itself and a related one ("improv comedy
   * troupe") but the club isn't in the concept's category: it is about the topic, which
   * its categories missed — not a passing word ("programming" meaning events). Stands in
   * for the category, so it never lifts a description match above a club named for it.
   */
  conceptCorroboratedText: 3,
  /** The name minus "Harvard"/"Club"-style words equals the query ("crimson" → Harvard Crimson). */
  coreName: 80,
  /**
   * Ties among equally good matches used to go to clubs with more information. That ranked
   * clubs by how well-documented they are (business and tech clubs have richer sites), not
   * by the query, so ties now go by name (ADR 0039).
   */
  completeness: 0,
} as const;

const MAX_QUERY_LENGTH = 100;

/** Words that say nothing about which club (every name has them). */
const FILLER = new Set(
  "harvard radcliffe college undergraduate undergraduates undergrad club clubs society societies group groups organization organizations org orgs association the of and for at in a an to on with about student students team teams".split(
    " ",
  ),
);
/**
 * Request words in natural queries ("learn to code", "i want to write for a newspaper"):
 * they say what the student wants to do, not what a club's page says, so requiring them
 * emptied the results (ADR 0039).
 */
for (const w of "i im i'm me my want wanna would like looking look find learn learning join get involved do some something where can how".split(
  " ",
))
  FILLER.add(w);
/**
 * Verbs and people words around the thing a student wants ("play poker", "build robots",
 * "perform theater", "meet other chinese students"): the noun says it; requiring "play" or
 * "other" in a club's text emptied the results (ADR 0040). A query of only these words
 * still searches them as written.
 */
for (const w of "play playing build building make making perform performing meet other others people fellow try start starting".split(
  " ",
))
  FILLER.add(w);

/** Words left out of a name's initials, as clubs write them (Harvard College Consulting Group → HCCG). */
const INITIALS_SKIP = new Set(["of", "and", "the", "for", "at", "in", "on", "a", "an", "to"]);

// --- Prepared, per-club search data (computed once per index object) -----------------------------

interface Prepared {
  /** Normalized names: [0] is the canonical name, the rest are aliases. */
  names: string[];
  nameWords: Set<string>;
  /** Words of the canonical name only (alias-only hits are reported as aliases). */
  canonicalWords: Set<string>;
  /** Lowercase stated acronyms. */
  acronyms: Set<string>;
  /** Lowercase initials of every name ("harvard college consulting group" → "hccg"). */
  initials: Set<string>;
  /**
   * Initials without the "Harvard Undergraduate"-style prefix ("consulting on business and
   * the environment" → "cbe"). Ignored for a query that is an ordinary word ("new", "mba").
   */
  coreInitials: Set<string>;
  aboutWords: Set<string>;
  /** Tags and activities (not category names). */
  topicWords: Set<string>;
  textWords: Set<string>;
  /** Category-name word → that category's slug and name. */
  categoryWords: Map<string, { slug: string; name: string }>;
  /** " word word … " strings for phrase checks. */
  aboutLine: string;
  topicLine: string;
  cats: Set<string>;
}

const prepared = new WeakMap<IndexClub, Prepared>();
const words = (s: string) => s.split(/\s+|\|/).filter(Boolean);

/** Leading words clubs drop when they abbreviate (Harvard Undergraduate Consulting on Business and the Environment → CBE). */
const INITIALS_PREFIX = new Set(["harvard", "radcliffe", "college", "undergraduate", "undergraduates", "university"]);

/** Lowercase initials of a normalized name; "" when too short or long to be typed as one. */
export function nameInitials(normalized: string): string {
  const init = normalized
    .split(" ")
    .filter((w) => w && !INITIALS_SKIP.has(w))
    .map((w) => w[0])
    .join("");
  return init.length >= 3 && init.length <= 8 ? init : "";
}

/** Initials of a name without its leading "Harvard College"-style words; "" when it has none. */
export function coreInitials(normalized: string): string {
  const ws = normalized.split(" ").filter(Boolean);
  let i = 0;
  while (i < ws.length - 1 && INITIALS_PREFIX.has(ws[i]!)) i++;
  return i > 0 ? nameInitials(ws.slice(i).join(" ")) : "";
}

function prepare(club: IndexClub): Prepared {
  let p = prepared.get(club);
  if (!p) {
    const cw = clubWords(club);
    const names = club.searchNames.split(" | ");
    const topics = words(wordSet([club.searchTopics ?? ""]));
    const categoryWords = new Map<string, { slug: string; name: string }>();
    for (const c of club.categories) for (const w of words(wordSet([c.name]))) categoryWords.set(w, c);
    p = {
      names,
      nameWords: new Set(words(club.searchNames)),
      canonicalWords: new Set(words(names[0] ?? "")),
      acronyms: new Set(club.searchAcronyms.map((a) => a.toLowerCase())),
      initials: new Set(names.map(nameInitials).filter(Boolean)),
      coreInitials: new Set(names.map(coreInitials).filter(Boolean)),
      aboutWords: new Set(words(cw.about)),
      topicWords: new Set(topics),
      textWords: new Set([...words(cw.about), ...topics]),
      categoryWords,
      aboutLine: ` ${cw.about} `,
      topicLine: ` ${topics.join(" ")} `,
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
      for (const set of [p.nameWords, p.aboutWords, p.topicWords, p.acronyms, p.categoryWords.keys()])
        for (const w of set) v.add(w);
      for (const i of [...p.initials, ...p.coreInitials]) v.add(i);
    }
    for (const term of CONCEPT_BY_TERM.keys()) if (!term.includes(" ")) v.add(term);
    vocabularies.set(clubs, v);
  }
  return v;
}

/** Words that appear as ordinary words in names or text (not initials or acronyms). */
const ordinaries = new WeakMap<readonly IndexClub[], Set<string>>();
function ordinaryWords(clubs: readonly IndexClub[]): Set<string> {
  let v = ordinaries.get(clubs);
  if (!v) {
    v = new Set<string>();
    for (const c of clubs) {
      const p = prepare(c);
      for (const set of [p.nameWords, p.aboutWords, p.topicWords])
        for (const w of set) if (!p.acronyms.has(w)) v.add(w);
    }
    ordinaries.set(clubs, v);
  }
  return v;
}

// --- Query parsing ----------------------------------------------------------------------------------

export type QueryUnit =
  { kind: "concept"; concept: Concept; phrase: string } | { kind: "word"; word: string; last: boolean };

export interface ParsedQuery {
  norm: string;
  units: QueryUnit[];
  /** "acapela" → "a cappella": the words that were corrected, if any. */
  corrected: string | null;
  /** Query words that are ordinary words in the index: never read as a name's short initials. */
  ordinary: Set<string>;
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

/**
 * The closest known word for an unknown one, or null (4+ letters; 1 edit, 2 from 8 letters).
 * The first letter must stay (or swap with the second): people rarely mistype it, and
 * allowing it turns real words into unrelated ones ("rowing" → "growing").
 */
function correct(word: string, vocab: Set<string>): string | null {
  if (word.length < 4 || /\d/.test(word)) return null;
  const max = word.length >= 8 ? 2 : 1;
  let best: string | null = null;
  let bestD = max + 1;
  for (const v of vocab) {
    if (v.length < 3) continue;
    if (v[0] !== word[0] && !(v[0] === word[1] && v[1] === word[0])) continue;
    const d = editDistance(word, v, max);
    if (d < bestD || (d === bestD && best !== null && v < best)) {
      best = v;
      bestD = d;
    }
  }
  return bestD <= max ? best : null;
}

const sortedVocab = new WeakMap<Set<string>, string[]>();
/** Whether a word (or a variant of it) is in the vocabulary, or (3+ letters, last word) begins one. */
function known(word: string, vocab: Set<string>, allowPrefix: boolean): boolean {
  if (wordVariants(word).some((v) => vocab.has(v))) return true;
  if (!allowPrefix || word.length < 3) return false;
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

/** A concept for a phrase as typed or in a variant spelling ("theatres" → theater). */
function conceptFor(phrase: string): Concept | undefined {
  const direct = CONCEPT_BY_TERM.get(phrase);
  if (direct || phrase.includes(" ")) return direct;
  for (const v of wordVariants(phrase)) {
    const c = CONCEPT_BY_TERM.get(v);
    if (c) return c;
  }
  return undefined;
}

/** Split a query into concept phrases and plain words. PURE (vocabulary optional). */
export function parseQuery(text: string, vocab?: Set<string>, ordinary?: Set<string>): ParsedQuery {
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
      const concept = conceptFor(phrase);
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
    const last = i === all.length;
    if (FILLER.has(w)) continue;
    if (vocab && !known(w, vocab, last)) {
      const fix = correct(w, vocab);
      if (fix) {
        changed = true;
        fixes.push(fix);
        const concept = CONCEPT_BY_TERM.get(fix);
        units.push(concept ? { kind: "concept", concept, phrase: fix } : { kind: "word", word: fix, last: false });
        continue;
      }
    }
    fixes.push(w);
    units.push({ kind: "word", word: w, last });
  }
  // A query made only of filler words ("harvard club") searches for them as written.
  if (units.length === 0) all.forEach((w, i) => units.push({ kind: "word", word: w, last: i === all.length - 1 }));
  return {
    norm,
    units,
    corrected: changed ? fixes.join(" ") : null,
    ordinary: new Set(all.filter((w) => ordinary?.has(w))),
  };
}

/** `parseQuery` with the index's vocabulary (spelling correction), as the directory searches. */
export function parseQueryIn(clubs: readonly IndexClub[], text: string): ParsedQuery {
  return parseQuery(text, vocabulary(clubs), ordinaryWords(clubs));
}

// --- Match reasons ----------------------------------------------------------------------------------

/**
 * Why a club matched, in terms a student recognizes — never a score. `name` is implicit
 * in the visible name and usually not shown.
 */
export type MatchReason =
  | { kind: "name" }
  | { kind: "alias"; alias: string }
  | { kind: "acronym"; acronym: string }
  | { kind: "initials"; initials: string }
  /** A word related to the query's topic is in the club's name ("orchestra" for "music"). */
  | { kind: "related"; topic: string; word: string }
  | { kind: "category"; slug: string; name: string }
  | { kind: "description"; word: string }
  /** Tags, activities or category names. */
  | { kind: "topics"; word: string };

/** One reason as a short phrase ("Description mentions “trading”"). PURE. */
export function reasonText(r: MatchReason): string {
  switch (r.kind) {
    case "name":
      return "Name";
    case "alias":
      return `Also known as ${r.alias}`;
    case "acronym":
      return `Acronym ${r.acronym.toUpperCase()}`;
    case "initials":
      return `Initials ${r.initials.toUpperCase()}`;
    case "related":
      return `${r.topic}: “${r.word}” in the name`;
    case "category":
      return `Category: ${r.name}`;
    case "description":
      return `Description mentions “${r.word}”`;
    case "topics":
      return `Listed activities mention “${r.word}”`;
  }
}

const sameReason = (a: MatchReason, b: MatchReason) => reasonText(a) === reasonText(b);

// --- Scoring ----------------------------------------------------------------------------------------

const hasPrefix = (set: Set<string>, w: string) => {
  for (const x of set) if (x.startsWith(w)) return true;
  return false;
};
const firstPrefixed = (set: Set<string>, w: string) => {
  for (const x of set) if (x.startsWith(w)) return x;
  return null;
};
const hasAny = (set: Set<string>, variants: readonly string[]) => variants.find((v) => set.has(v)) ?? null;

/** Why a club matched one unit, and how much. */
interface UnitHit {
  score: number;
  reason: MatchReason;
}

/** The alias (as displayed) a normalized name word comes from, when it's not in the canonical name. */
function aliasFor(club: IndexClub, p: Prepared, w: string): MatchReason {
  if (p.canonicalWords.has(w)) return { kind: "name" };
  const idx = p.names.findIndex((n, i) => i > 0 && ` ${n} `.includes(` ${w} `));
  const display = idx > 0 ? (club.aliases?.find((a) => normalizeName(a) === p.names[idx]) ?? null) : null;
  if (display) return { kind: "alias", alias: display };
  return idx > 0 && p.names[idx]!.length <= 8 && !p.names[idx]!.includes(" ")
    ? { kind: "acronym", acronym: p.names[idx]! }
    : { kind: "name" };
}

/** The query word is one of the club's initials (core initials only when it isn't an ordinary word). */
const isInitials = (p: Prepared, w: string, q: ParsedQuery) =>
  w.length >= 3 && (p.initials.has(w) || (!q.ordinary.has(w) && p.coreInitials.has(w)));

function wordHit(club: IndexClub, p: Prepared, w: string, allowPrefix: boolean, q: ParsedQuery): UnitHit | null {
  const variants = wordVariants(w);
  let name = 0;
  let reason: MatchReason = { kind: "name" };
  const nameWord = hasAny(p.nameWords, variants);
  if (w.length >= 2 && p.acronyms.has(w)) {
    name = WEIGHTS.acronymWord;
    reason = p.canonicalWords.has(w) ? { kind: "name" } : { kind: "acronym", acronym: w };
  } else if (nameWord) {
    name = WEIGHTS.nameWord;
    reason = aliasFor(club, p, nameWord);
  } else if (isInitials(p, w, q)) {
    name = WEIGHTS.acronymWord;
    reason = { kind: "initials", initials: w };
  } else if (allowPrefix && w.length >= 3) {
    const pre = firstPrefixed(p.nameWords, w);
    if (pre) {
      name = WEIGHTS.namePrefixWord;
      reason = aliasFor(club, p, pre);
    }
  }
  let text = 0;
  let textWord: string | null = null;
  let textKind: "description" | "topics" = "description";
  const about = hasAny(p.aboutWords, variants);
  const topic = about ? null : hasAny(p.topicWords, variants);
  if (about) {
    text = WEIGHTS.aboutWord;
    textWord = about;
  } else if (topic) {
    text = WEIGHTS.topicWord;
    textWord = topic;
    textKind = "topics";
  } else if (allowPrefix && w.length >= 4) {
    const a = firstPrefixed(p.aboutWords, w);
    const t = a ? null : firstPrefixed(p.topicWords, w);
    if (a) {
      text = WEIGHTS.aboutPrefixWord;
      textWord = a;
    } else if (t) {
      text = WEIGHTS.topicPrefixWord;
      textWord = t;
      textKind = "topics";
    }
  }
  if (name) return { score: name + text / 2, reason };
  if (textWord) return { score: text, reason: { kind: textKind, word: textWord } };
  const catWord = hasAny(new Set(p.categoryWords.keys()), variants);
  const category = catWord ? p.categoryWords.get(catWord) : undefined;
  return category
    ? { score: WEIGHTS.topicWord, reason: { kind: "category", slug: category.slug, name: category.name } }
    : null;
}

/** A word or phrase in a set/lines, in any variant spelling for single words. */
function phraseFound(set: Set<string>, lines: string[], phrase: string): string | null {
  if (phrase.includes(" ")) return lines.some((n) => ` ${n} `.includes(` ${phrase} `)) ? phrase : null;
  return hasAny(set, wordVariants(phrase));
}

/**
 * Whether a query phrase abbreviates a multi-word phrase, word by word: each query word is
 * the start of the next phrase word or the initials of the next few ("mun" → model united
 * nations, "cs" → computer science, "model un" → model united nations). PURE.
 */
export function abbreviates(query: string, phrase: string): boolean {
  if (query === phrase) return false;
  const pw = phrase.split(" ");
  if (pw.length < 2) return false;
  const fits = (qw: readonly string[], rest: readonly string[]): boolean => {
    if (qw.length === 0) return rest.length === 0;
    const [w, ...more] = qw as [string, ...string[]];
    if (rest[0]?.startsWith(w) && fits(more, rest.slice(1))) return true;
    for (let k = 2; k <= Math.min(w.length, rest.length); k++)
      if (rest.slice(0, k).every((x, i) => x[0] === w[i]) && k === w.length && fits(more, rest.slice(k))) return true;
    return false;
  };
  return fits(query.split(" "), pw);
}

/**
 * A concept unit scores in tiers, added up: the word as typed (name, else text), else a
 * related word in the name; plus the concept's category; plus a related word in the text.
 * Additive on purpose: a related word in the name ("orchestra" for "music") plus the
 * category is better evidence than one passing mention in a description ("programming"
 * meaning events), while "newspaper" in a description still beats "magazine" in a name.
 */
function conceptHit(
  club: IndexClub,
  p: Prepared,
  c: Concept,
  phrase: string,
  categoryName: (slug: string) => string,
): UnitHit | null {
  let score = 0;
  let reason: MatchReason | null = null;
  const aboutText = [p.aboutLine, p.topicLine];
  const single = !phrase.includes(" ");
  let found: string | null;
  if ((found = phraseFound(p.nameWords, p.names, phrase)) || (single && p.acronyms.has(phrase))) {
    score += WEIGHTS.conceptLiteralName;
    reason = found && !found.includes(" ") ? aliasFor(club, p, found) : { kind: "name" };
  } else if (single && phrase.length >= 6 && hasPrefix(p.nameWords, phrase)) {
    // "premed" begins "premedical"; short words ("quant" / "quantum") never count this way.
    score += WEIGHTS.conceptLiteralName - 2;
    reason = { kind: "name" };
  } else if ((found = c.related.find((r) => abbreviates(phrase, r) && phraseFound(p.nameWords, p.names, r)) ?? null)) {
    // The query abbreviates a full form in the name ("mun" → Model United Nations): the name
    // itself. Only abbreviations: "web development" isn't "Computer Science" in a name.
    score += WEIGHTS.conceptLiteralName;
    reason = { kind: "name" };
  } else if ((found = phraseFound(p.aboutWords, [p.aboutLine], phrase))) {
    score += WEIGHTS.conceptLiteralText;
    reason = { kind: "description", word: found };
    const literal = found;
    if (
      c.categories.length > 0 &&
      !c.categories.some((x) => p.cats.has(x)) &&
      firstRelated(c, (r) => (r !== phrase && r !== literal ? phraseFound(p.aboutWords, [p.aboutLine], r) : null))
    )
      score += WEIGHTS.conceptCorroboratedText;
  } else if ((found = firstRelated(c, (r) => phraseFound(p.nameWords, p.names, r)))) {
    score += WEIGHTS.conceptRelatedName - relatedRank(c, found) * 0.1;
    reason = { kind: "related", topic: c.label, word: found };
  } else if ((found = phraseFound(p.topicWords, [p.topicLine], phrase))) {
    // A multi-word phrase listed verbatim ("web development") is specific, unlike one
    // common word among the activities: it counts like a description mention.
    score += found.includes(" ") ? WEIGHTS.conceptLiteralText : WEIGHTS.conceptLiteralTopic;
    reason = { kind: "topics", word: found };
  }
  const cat = c.categories.find((s) => p.cats.has(s));
  if (cat) {
    score += WEIGHTS.conceptCategory;
    reason ??= { kind: "category", slug: cat, name: categoryName(cat) };
  }
  const related = firstRelated(c, (r) => (r !== phrase ? phraseFound(p.textWords, aboutText, r) : null));
  if (related) {
    score += WEIGHTS.conceptRelatedText - relatedRank(c, related) * 0.1;
    reason ??=
      p.aboutWords.has(related) || p.aboutLine.includes(` ${related} `)
        ? { kind: "description", word: related }
        : { kind: "topics", word: related };
  }
  return reason ? { score, reason } : null;
}

/**
 * Position of a found word in the concept's related list (most telling first), capped so
 * the order only breaks ties: "computer" outranks "computing" for "coding".
 */
function relatedRank(c: Concept, found: string): number {
  const i = c.related.findIndex((r) => r === found || wordVariants(r).includes(found));
  return Math.min(5, Math.max(0, i));
}

/** The first related word (as found in the club's text) that `find` locates. */
function firstRelated(c: Concept, find: (r: string) => string | null): string | null {
  for (const r of c.related) {
    const hit = find(r);
    if (hit) return hit;
  }
  return null;
}

export interface ClubMatch {
  score: number;
  /** What matched, deduplicated, strongest first. */
  reasons: MatchReason[];
  /** How many of the query's units matched (all of them for a full match). */
  matchedUnits: number;
}

/**
 * Relevance of a club for a parsed query; null when it doesn't match every unit (or, with
 * `partial`, any unit at all).
 */
export function matchClub(
  club: IndexClub,
  q: ParsedQuery,
  rawText: string,
  categoryName: (slug: string) => string = (s) => s,
  partial = false,
): ClubMatch | null {
  if (!q.norm) return null;
  const p = prepare(club);
  let score = 0;
  let matchedUnits = 0;
  const reasons: MatchReason[] = [];
  for (const u of q.units) {
    const hit =
      u.kind === "concept"
        ? conceptHit(club, p, u.concept, u.phrase, categoryName)
        : wordHit(club, p, u.word, u.last, q);
    if (!hit) {
      if (partial) continue;
      return null;
    }
    matchedUnits++;
    score += hit.score;
    if (!reasons.some((r) => sameReason(r, hit.reason))) reasons.push(hit.reason);
  }
  if (matchedUnits === 0) return null;
  const acr = rawText.length <= 12 && !/\s/.test(rawText.trim()) ? normalizeAcronym(rawText).toLowerCase() : "";
  if (p.names.includes(q.norm)) score += WEIGHTS.exactName;
  if (acr.length >= 2 && p.acronyms.has(acr)) score += WEIGHTS.exactAcronym;
  else if (isInitials(p, acr, q)) score += WEIGHTS.exactInitials;
  if (p.names.some((n) => n.startsWith(q.norm))) score += WEIGHTS.namePrefix;
  const core = (n: string) =>
    n
      .split(" ")
      .filter((w) => !FILLER.has(w))
      .join(" ");
  const qCore = core(q.norm);
  if (qCore && !p.names.includes(q.norm) && p.names.some((n) => core(n) === qCore)) score += WEIGHTS.coreName;
  const qWords = q.norm.split(" ").filter((w) => !FILLER.has(w));
  if (qWords.length > 1 && qWords.every((w) => wordVariants(w).some((v) => p.nameWords.has(v))))
    score += WEIGHTS.allWordsInName;
  score += club.completeness * WEIGHTS.completeness;
  return { score, reasons, matchedUnits };
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
  reasons: Record<string, MatchReason[]>;
  /** The query as corrected for spelling, when a word was unknown. */
  corrected: string | null;
  /** Concepts the query names (for "related topics" and empty-result help). */
  concepts: Concept[];
  /**
   * When nothing matches every part of a multi-part query: the clubs matching most parts,
   * best first (at most 10), each with the parts it matched. Clearly weaker results.
   */
  partial: { club: IndexClub; matched: string[] }[];
  /** The query's parts as typed (concept phrases and words), for describing partial matches. */
  queryParts: string[];
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

const SHOW_HIDDEN = { includeInactive: true, includeGraduate: true } as const;

/**
 * Does the query name this club: its acronym or an alias, or a phrase of at least two
 * words from its name ("undergraduate council", not "council")? PURE.
 */
export function namesClub(club: Pick<IndexClub, "name" | "acronym" | "aliases">, text: string): boolean {
  const q = normalizeName(text);
  if (q.length < 3) return false;
  if (club.acronym && normalizeAcronym(text) === normalizeAcronym(club.acronym) && !q.includes(" ")) return true;
  const names = [club.name, ...(club.aliases ?? [])].map((n) => ` ${normalizeName(n)} `);
  if (names.some((n) => n.trim() === q)) return true;
  return q.includes(" ") && names.some((n) => n.includes(` ${q} `));
}

/** Whether a club passes the (non-text) filters. */
export function passesFilters(c: IndexClub, f: ClubFilters): boolean {
  if (!f.includeInactive && (c.activityStatus === "inactive" || c.activityStatus === "defunct")) return false;
  if (!f.includeGraduate && c.affiliationScope === "graduate_school") return false;
  if (f.categories.length && !f.categories.some((s) => c.categorySlugs.includes(s))) return false;
  if (f.joinModes.length && !f.joinModes.some((m) => c.joinModes.includes(m))) return false;
  if (f.recognition.length && !f.recognition.includes(c.recognitionStatus)) return false;
  if (f.orgTypes.length && (!c.orgType || !f.orgTypes.includes(c.orgType))) return false;
  if (f.freshmenEligible && !matchesFirstYears(c)) return false;
  if (f.classYear) {
    const ok = f.classYear === "first_year" ? matchesFirstYears(c) : (c.eligibleClasses ?? []).includes(f.classYear);
    if (!ok) return false;
  }
  if (f.recruitingSeasons.length && !f.recruitingSeasons.some((s) => (c.recruitingSeasons ?? []).includes(s)))
    return false;
  if (f.recruitingNow && !c.cycles.some((cy) => isRecruitingNow(cy.status))) return false;
  if (f.openJoin && !matchesOpenJoin(c)) return false;
  if (f.noDues && c.noDues !== true) return false;
  if (f.intent) {
    const intent = INTENTS.find((i) => i.slug === f.intent);
    if (intent && !matchesIntent(c, intent)) return false;
  }
  return true;
}

const PARTIAL_LIMIT = 10;

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
  const query = text ? parseQueryIn(clubs, text) : null;
  const scored: { club: IndexClub; score: number; reasons: MatchReason[] }[] = [];
  const partials: { club: IndexClub; score: number; m: ClubMatch }[] = [];
  const multi = (query?.units.length ?? 0) > 1;
  let hiddenSparse = 0;
  for (const raw of clubs) {
    const c = liveClub(raw, now);
    // A club hidden by default (ended, graduate-school) still answers a search for its own
    // name, so old links and word of mouth find it (ADR 0038).
    if (!passesFilters(c, f) && !(text && namesClub(raw, text) && passesFilters(c, { ...f, ...SHOW_HIDDEN }))) continue;
    const m = query ? matchClub(raw, query, text, req.categoryName, multi) : null;
    if (query && !m) continue;
    if (query && m && m.matchedUnits < query.units.length) {
      // Partial matches are kept aside; sparse rows never fill the fallback.
      if (!isSparseClub(c)) partials.push({ club: c, score: m.score, m });
      continue;
    }
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
  const queryParts = query ? query.units.map((u) => (u.kind === "concept" ? u.phrase : u.word)) : [];
  const partial =
    scored.length === 0 && query && multi
      ? partials
          .sort((a, b) => b.m.matchedUnits - a.m.matchedUnits || b.score - a.score || byName(a.club, b.club))
          .slice(0, PARTIAL_LIMIT)
          .map(({ club }) => ({
            club,
            matched: query.units.flatMap((u, i) => {
              const hit =
                u.kind === "concept"
                  ? conceptHit(club, prepare(club), u.concept, u.phrase, req.categoryName ?? ((s) => s))
                  : wordHit(club, prepare(club), u.word, u.last, query);
              return hit ? [queryParts[i]!] : [];
            }),
          }))
      : [];
  return {
    total: scored.length,
    hiddenSparse,
    clubs: page.map((s) => s.club),
    reasons: Object.fromEntries(page.map((s) => [s.club.id, s.reasons])),
    corrected: query?.corrected ?? null,
    concepts: query ? query.units.flatMap((u) => (u.kind === "concept" ? [u.concept] : [])) : [],
    partial,
    queryParts,
  };
}
