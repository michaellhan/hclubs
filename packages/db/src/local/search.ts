import { dateValueEnd, isRecruitingNow, newYorkDateParts, normalizeAcronym, normalizeName } from "@hci/core/browser";
import { clubAudiences, conceptAudiences, namesAudience, queryAudiences } from "./audience";
import { CAREER_CATEGORIES, CONCEPT_BY_TERM, CONCEPTS, SHORTHANDS, type Concept } from "./concepts";
import {
  baseHasConstraint,
  constraintPatch,
  interpretQuery,
  QUESTION_WORDS,
  STOP_WORDS,
  withoutConstraint,
  type ConstraintFilter,
  type QueryConstraint,
  type SoftModifier,
} from "./constraints";
import { announcedLaterRound, beyondAcademicYear, pickCurrentCycle, withLiveStatus } from "./cycles";
import {
  isSparseClub,
  matchesFirstYears,
  matchesMaxHours,
  matchesNoComp,
  matchesNoDues,
  matchesNoExperience,
  matchesOpenJoin,
  ClubFilters,
  type SortKey,
} from "./filters";
import { INTENTS, intentReason, intentRank, matchesIntent } from "./intents";
import type { IndexClub } from "./types";
import { otherSpelling, wordVariants } from "./variants";
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
  /**
   * The word being typed begins one of the club's acronyms ("hc" → HCS). Above a name word
   * it begins: "pb" is PBHA itself before the "PBHA's …" programs.
   */
  acronymPrefix: 9,
  /** The word being typed begins the club's initials ("hcc" → HCCG). Below a name word. */
  initialsPrefix: 5,
  /** The word being typed begins only a filler word of the name ("har" → "Harvard"). */
  fillerPrefixWord: 1,
  aboutWord: 4,
  aboutPrefixWord: 3,
  topicWord: 3,
  topicPrefixWord: 2,
  /**
   * The concept's word as typed, in the club's name / text. In the name it outranks a related
   * name word plus the category and a related word in the text (6 + 5 + 2): "stand up" is the
   * Stand-Up Comics Society before a theater group.
   */
  conceptLiteralName: 14,
  conceptLiteralText: 9,
  /**
   * Extra when that word is in the part of the one-liner saying what the club is
   * ("student-run hip-hop dance group"), not in a list of what it does (Round 10).
   */
  conceptSelfDescribed: 0.5,
  /** The word as typed only among tags/activities (broad labels like "theater and dance"). */
  conceptLiteralTopic: 5,
  /** A related word in the club's name. */
  conceptRelatedName: 6,
  /** The club is in one of the concept's categories. */
  conceptCategory: 5,
  /** A related word in the club's text. */
  conceptRelatedText: 2,
  /** Taken off when the concept matched through a synonym ("latinx" for "latino"), not the word typed. */
  conceptSynonym: 2,
  /** Taken off a club picked only by a concept's intent rule, outside the concept's own categories. */
  intentOnly: 2,
  /** Taken off a club where a typed concept word means something else (`Concept.otherSense`). */
  otherSense: 20,
  /**
   * Extra when the description says the word itself and a related one ("improv comedy
   * troupe") but the club isn't in the concept's category: it is about the topic, which
   * its categories missed — not a passing word ("programming" meaning events). Stands in
   * for the category, so it never lifts a description match above a club named for it.
   */
  conceptCorroboratedText: 3,
  /** The query is the name of one of the club's categories ("competition teams"). */
  categoryName: 20,
  /** Taken off a bare description mention by a club outside the concept's category (9 → 4). */
  conceptBareMention: 5,
  /**
   * Taken off a one-word activity-list mention by a club outside the concept's category (5 → 4):
   * just below the category's own clubs, still lifted by soft words ("dance beginner").
   */
  conceptBareTopic: 1,
  /** The name minus "Harvard"/"Club"-style words equals the query ("crimson" → Harvard Crimson). */
  coreName: 80,
  /**
   * A broad identity group (Cultural & identity, no career category) for an identity concept
   * ("latinx": Fuerza Latina before Latines in Health Careers).
   */
  identityHome: 3,
  /**
   * A related word in the name of a club outside the concept’s categories stands in for the
   * category: a group named for a dance form ("Ghungroo") is a dance group.
   */
  conceptNameStandIn: 5,
  /**
   * A word for an identity concept's people in a club's name (`Concept.people`): the
   * community's group (Round 10: "middle eastern" → the Turkish and Kurdish associations
   * before a Middle East conference). One below the typed word in the name with its category.
   */
  identityNameStandIn: 4,
  /**
   * Taken off a club whose name or one-liner says who it is for (women, a community, a faith)
   * on a topic query that doesn’t name that audience: it follows general clubs of equal
   * relevance. When the query names none of its audiences, its name also counts no more than
   * its other evidence ("coding": the Computer Society before Women in Computer Science).
   */
  audience: 1,
  /**
   * Taken off a public-service program on a topic that isn't service (`serviceProgramAside`):
   * a program teaching kids theater follows the theater groups.
   */
  serviceProgram: 6,
  /** Taken off a sparse club (`isSparseClub`) matched through a topic: described clubs first. */
  sparse: 0.5,
  /** Every alternative of "coding or startups" matched: clubs matching both come first. */
  allAlternatives: 20,
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
  "harvard radcliffe college undergraduate undergraduates undergrad club clubs society societies group groups organization organizations org orgs association the of and or for at in a an to on with about student students team teams".split(
    " ",
  ),
);
/**
 * Request words in natural queries ("learn to code", "i want to write for a newspaper"):
 * they say what the student wants to do, not what a club's page says, so requiring them
 * emptied the results (ADR 0039).
 */
for (const w of "i im i'm me my want wanna would like looking look find learn learning join get involved do some something where can how help helping pickup".split(
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
/**
 * Question and helper words ("what is punching", "when are auditions", "clubs i can still
 * join"): never required, never spelling-corrected (`STOP_WORDS` in constraints.ts).
 */
for (const w of STOP_WORDS) FILLER.add(w);

/** "The Harvard(-Radcliffe) (College)" at the start of a name. */
const HARVARD_LEAD = /^(the )?harvard (radcliffe )?(college )?/;

/** Words left out of a name's initials, as clubs write them (Harvard College Consulting Group → HCCG). */
const INITIALS_SKIP = new Set(["of", "and", "the", "for", "at", "in", "on", "a", "an", "to"]);

// --- Prepared, per-club search data (computed once per index object) -----------------------------

interface Prepared {
  /** Normalized names: [0] is the canonical name, the rest are aliases. */
  names: string[];
  /** Each name without its leading "Harvard College"-style words ("the harvard crimson" → "crimson"). */
  cores: string[];
  nameWords: Set<string>;
  /** Words of the canonical name only (alias-only hits are reported as aliases). */
  canonicalWords: Set<string>;
  /** Lowercase stated acronyms. */
  acronyms: Set<string>;
  /** Lowercase initials of every name, also keeping "of" ("hccg"; "institute of politics" → "ip", "iop"). */
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
  /**
   * " word word " of the one-liner up to the noun that says what the club is ("student-run
   * hip-hop dance group" → "student run hip hop dance"): words there describe the club itself,
   * not one item of a list. " " when none.
   */
  head: string;
}

/** Nouns that say what kind of thing a club is, ending its one-liner's self-description. */
const HEAD_NOUNS = new Set(
  "group groups team troupe company club society ensemble organization association collective community crew choir chorus orchestra band publication magazine newspaper journal network forum program initiative league council committee fellowship".split(
    " ",
  ),
);
const HEAD_MAX_WORDS = 7;

/** The one-liner's self-description (see `Prepared.head`). PURE. */
function oneLinerHead(description: string | null): string {
  const ws = normalizeName(description ?? "")
    .split(" ")
    .filter(Boolean);
  const end = ws.findIndex((w) => HEAD_NOUNS.has(w));
  return end > 0 && end <= HEAD_MAX_WORDS ? ` ${ws.slice(0, end).join(" ")} ` : " ";
}

const prepared = new WeakMap<IndexClub, Prepared>();
const words = (s: string) => s.split(/\s+|\|/).filter(Boolean);

/** Leading words clubs drop when they abbreviate (Harvard Undergraduate Consulting on Business and the Environment → CBE). */
const INITIALS_PREFIX = new Set(["harvard", "radcliffe", "college", "undergraduate", "undergraduates", "university"]);

/** Leading words people skip when typing a name ("the harvard crimson" → "crimson"). */
const LEAD = new Set([...INITIALS_PREFIX, "the"]);

/** A normalized name without its leading "The Harvard College"-style words. PURE. */
export function coreName(normalized: string): string {
  const ws = normalized.split(" ").filter(Boolean);
  let i = 0;
  while (i < ws.length - 1 && LEAD.has(ws[i]!)) i++;
  return ws.slice(i).join(" ");
}

/** Only articles left out: some clubs keep "of" in their initials (Institute of Politics → IOP). */
const INITIALS_SKIP_ARTICLES = new Set(["the", "a", "an", "and"]);

/** Lowercase initials of a normalized name; "" when too short or long to be typed as one. */
export function nameInitials(normalized: string, skip: ReadonlySet<string> = INITIALS_SKIP): string {
  const init = normalized
    .split(" ")
    .filter((w) => w && !skip.has(w))
    .map((w) => w[0])
    .join("");
  return init.length >= 3 && init.length <= 8 ? init : "";
}

/** Both ways a name's initials are written ("isowe" and "swe"; "iop" and "ip" → "iop"). */
export function allInitials(normalized: string): string[] {
  return [...new Set([nameInitials(normalized), nameInitials(normalized, INITIALS_SKIP_ARTICLES)])].filter(Boolean);
}

/** "Harvard (Radcliffe)" alone, which clubs drop while keeping "Undergraduate" (UVCG). */
const HARVARD_ONLY = new Set(["harvard", "radcliffe"]);

/**
 * Initials of a name without its leading "Harvard College"-style words, both ways they are
 * written ("women in business" → "wb", "wib"), and without just "Harvard" ("uvcg"); [] when it has none.
 */
export function coreInitials(normalized: string): string[] {
  const ws = normalized.split(" ").filter(Boolean);
  const out = new Set<string>();
  for (const lead of [INITIALS_PREFIX, HARVARD_ONLY]) {
    let i = 0;
    while (i < ws.length - 1 && lead.has(ws[i]!)) i++;
    if (i > 0 && i < ws.length) for (const x of allInitials(ws.slice(i).join(" "))) out.add(x);
  }
  return [...out];
}

/**
 * Names as their initials are read: the normalized names, plus the canonical name with
 * hyphenated words kept whole, since clubs abbreviate "World Pre-Health Conference" as WPC.
 */
function initialsNames(club: IndexClub, names: readonly string[]): string[] {
  const joined = normalizeName(club.name.replace(/(\p{L})-(?=\p{L})/gu, "$1"));
  return joined && !names.includes(joined) ? [...names, joined] : [...names];
}

/** A club's name initials ("huwpc") and its initials without the "Harvard Undergraduate"-style prefix ("wpc"). PURE. */
export function clubInitials(club: IndexClub): { initials: Set<string>; core: Set<string> } {
  const names = initialsNames(club, club.searchNames.split(" | "));
  return {
    initials: new Set(names.flatMap(allInitials)),
    core: new Set(names.flatMap(coreInitials)),
  };
}

function prepare(club: IndexClub): Prepared {
  let p = prepared.get(club);
  if (!p) {
    const cw = clubWords(club);
    const names = club.searchNames.split(" | ");
    const topics = words(wordSet([club.searchTopics ?? ""]));
    const { initials, core } = clubInitials(club);
    const categoryWords = new Map<string, { slug: string; name: string }>();
    for (const c of club.categories) for (const w of words(wordSet([c.name]))) categoryWords.set(w, c);
    p = {
      names,
      cores: names.map(coreName),
      nameWords: new Set(words(club.searchNames)),
      canonicalWords: new Set(words(names[0] ?? "")),
      acronyms: new Set(club.searchAcronyms.map((a) => a.toLowerCase())),
      initials,
      coreInitials: core,
      aboutWords: new Set(words(cw.about)),
      topicWords: new Set(topics),
      textWords: new Set([...words(cw.about), ...topics]),
      categoryWords,
      aboutLine: ` ${cw.about} `,
      topicLine: ` ${topics.join(" ")} `,
      cats: new Set(club.categorySlugs),
      head: oneLinerHead(club.shortDescription),
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

/** How many clubs have each word in some name or alias (acronyms excluded). */
const nameDfs = new WeakMap<readonly IndexClub[], Map<string, number>>();
export function nameWordDf(clubs: readonly IndexClub[]): Map<string, number> {
  let v = nameDfs.get(clubs);
  if (!v) {
    v = new Map();
    for (const c of clubs) for (const w of prepare(c).nameWords) v.set(w, (v.get(w) ?? 0) + 1);
    nameDfs.set(clubs, v);
  }
  return v;
}

/** Most clubs a name word may appear in and still count as distinctive ("krokodiloes", not "social"). */
const DISTINCTIVE_NAME_WORD = 3;
/**
 * The distinctive name words a typed word begins, through its plural/singular forms ("kroks"
 * and "krok" → "krokodiloes"): the activities-fair nicknames people use. Only a word of 4+
 * letters that is not itself a word the index knows ("math" never reaches "Mather"), and
 * never a filler word ("harv", "soci") or one in more than a few names. Never an alias we
 * made up: it only reads what the name says. PURE.
 */
export function distinctiveNamePrefixes(
  word: string,
  df: ReadonlyMap<string, number>,
  vocab: { has(word: string): boolean },
  isFiller: (w: string) => boolean = (w) => FILLER.has(w),
): string[] {
  if (word.length < 4 || /\d/.test(word)) return [];
  const variants = wordVariants(word);
  if (variants.some((v) => vocab.has(v))) return [];
  const out: string[] = [];
  for (const [w, n] of df) {
    if (n > DISTINCTIVE_NAME_WORD || w.length <= 4 || isFiller(w)) continue;
    if (variants.some((v) => v.length >= 4 && w.length > v.length && w.startsWith(v))) out.push(w);
  }
  return out;
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
  | { kind: "concept"; concept: Concept; phrase: string }
  | {
      kind: "word";
      word: string;
      last: boolean;
      /**
       * Topics the word being typed may be the start of ("dan" → dance, "acap" → a cappella),
       * each with the term it begins. At most two: "com" begins too many to guess.
       */
      completions?: { concept: Concept; term: string }[];
      /**
       * A filler word typed last that may be the start of a name word ("for" of "Foreign",
       * "a" of "American"): it lifts clubs it begins a name word of, never required.
       */
      optional?: boolean;
    }
  /**
   * Alternatives joined by "or" ("coding or startups"), or topics joined by "and" or a comma
   * ("coding and startups", "music, dance"): a club matches any of them, and clubs matching
   * all come first (`WEIGHTS.allAlternatives`).
   */
  | {
      kind: "any";
      units: QueryUnit[];
      /**
       * The first alternative is what was typed; the others are what it also means, ranked
       * after it ("korean american": the Korean groups, then Asian American ones). They count
       * at `LESSER` of their score and are never summed with the first.
       */
      lesser?: boolean;
    };

export interface ParsedQuery {
  norm: string;
  units: QueryUnit[];
  /** "acapela" → "a cappella": the words that were corrected, if any. */
  corrected: string | null;
  /** Query words that are ordinary words in the index: never read as a name's short initials. */
  ordinary: Set<string>;
  /** Typed word → the distinctive name words it begins ("kroks" → "krokodiloes"); see `distinctiveNamePrefixes`. */
  namePrefixes: Map<string, string[]>;
  /**
   * The last word may be half-typed: one or two letters, or not a word of any club's name
   * ("cri", but not "black"). Then a name whose core begins with it ("crimson") counts as
   * starting with the query; a finished word only starts a name at a word boundary.
   */
  lastPartial: boolean;
  /** The last word is two letters that begin no name word or acronym ("io"): initials may stand in. */
  deadEnd: boolean;
  /** How many words were typed, filler included ("undergraduate as" is two). */
  typedWords: number;
  /** Words put in for unknown ones by spelling correction ("porter" for "potter"). */
  fixes: Set<string>;
  /**
   * Categories whose name is the whole query ("technology & engineering", "competition
   * teams"): their clubs match whatever else the words find, and come first.
   */
  categoryNamed: Set<string>;
  /** Whether a word is one the index knows (for compound names: "data" + "match"). */
  isKnown: (w: string) => boolean;
  /**
   * Audiences the query names ("women", "id:black"; `queryAudiences`): a club for another
   * audience follows general clubs on the query's topics. Null turns that ordering off.
   */
  audiences: Set<string> | null;
}

/** A query's units with "or" groups opened up. */
export function flatUnits(units: readonly QueryUnit[]): QueryUnit[] {
  return units.flatMap((u) => (u.kind === "any" ? flatUnits(u.units) : [u]));
}

/** A unit as typed ("coding", "coding or startups"). */
function unitText(u: QueryUnit): string {
  return u.kind === "any" ? u.units.map(unitText).join(" or ") : u.kind === "word" ? u.word : u.phrase;
}

/**
 * A multi-word topic term one letter off a typed phrase with a word the index doesn't know
 * ("a capela" → "a cappella"): the phrase-level spelling fix a single word gets from `correct`.
 */
function fuzzyConceptPhrase(phrase: string, vocab: Set<string>): { concept: Concept; term: string } | null {
  if (phrase.length < 7 || !phrase.split(" ").some((w) => !known(w, vocab, false))) return null;
  const n = phrase.split(" ").length;
  for (const [term, concept] of CONCEPT_BY_TERM)
    if (term.split(" ").length === n && term[0] === phrase[0] && editDistance(phrase, term, 1) <= 1)
      return { concept, term };
  return null;
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
    if (d < bestD || (d === bestD && best !== null && betterFix(word, v, best))) {
      best = v;
      bestD = d;
    }
  }
  return bestD <= max ? best : null;
}

const letters = (w: string) => [...w].sort().join("");
/**
 * Between two equally close fixes, the one with the same letters (two swapped: "pateint" is
 * "patient", not "patent"; "chours" is "chorus", not "choirs"), else the first alphabetically.
 */
function betterFix(word: string, a: string, b: string): boolean {
  const sa = letters(a) === letters(word);
  const sb = letters(b) === letters(word);
  return sa !== sb ? sa : a < b;
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

/**
 * The one multi-word topic term that words (2+, the last half-typed, 2+ letters) begin:
 * every word but the last equal, the last a strict prefix ("student gov"). Null when none
 * or several topics fit. PURE.
 */
function phraseCompletion(ws: readonly string[]): { concept: Concept; term: string } | null {
  const lastW = ws[ws.length - 1];
  if (ws.length < 2 || ws.length > 4 || !lastW || lastW.length < 2) return null;
  const head = ws.slice(0, -1).join(" ");
  let found: { concept: Concept; term: string } | null = null;
  for (const [term, concept] of CONCEPT_BY_TERM) {
    const tw = term.split(" ");
    if (tw.length !== ws.length || tw.slice(0, -1).join(" ") !== head) continue;
    const t = tw[tw.length - 1]!;
    if (t.length <= lastW.length || !t.startsWith(lastW)) continue;
    if (found && found.concept !== concept) return null;
    if (!found || term.length < found.term.length) found = { concept, term };
  }
  return found;
}

/** A longer name word that `w` begins and more names use than use `w` itself. PURE. */
function beginsCommoner(w: string, nameDf: ReadonlyMap<string, number>): boolean {
  const own = nameDf.get(w) ?? 0;
  // At least three letters more: "asia" is a word of its own, not "asian" half-typed.
  for (const [x, n] of nameDf)
    if (n > own && x.length >= w.length + 3 && x.startsWith(w) && !FILLER.has(x)) return true;
  return false;
}

const MAX_COMPLETIONS = 2;
/** Topics a half-typed word (3+ letters) begins, one term each, shortest first; none when too many. */
function conceptCompletions(w: string): { concept: Concept; term: string }[] {
  if (w.length < 3 || /\d/.test(w)) return [];
  // "har" is "harvard" on its way, not "hardware"; "soc" is "society".
  // Helper words ("could", "will") don't block: "cou", "wil" begin topics as often. Question
  // words do ("whe" is "where" on its way).
  for (const f of [...FILLER, ...LEAD])
    if (f.length > w.length && f.startsWith(w) && (!STOP_WORDS.has(f) || QUESTION_WORDS.has(f))) return [];
  const out = new Map<Concept, string>();
  for (const [term, concept] of CONCEPT_BY_TERM) {
    if (term.includes(" ") || term.length <= w.length || !term.startsWith(w)) continue;
    const had = out.get(concept);
    if (had === undefined || term.length < had.length) out.set(concept, term);
  }
  return out.size <= MAX_COMPLETIONS ? [...out].map(([concept, term]) => ({ concept, term })) : [];
}

/**
 * An unknown word written as two words of club names run together ("standup" → "stand up",
 * as in Stand-Up Comics Society): both words, the split with the longer shorter part. Never a
 * word the index knows or begins ("datamatch", "standu"). PURE.
 */
export function splitCompound(
  w: string,
  last: boolean,
  vocab: Set<string> | undefined,
  nameDf: ReadonlyMap<string, number> | undefined,
): string[] | null {
  if (!vocab || !nameDf || w.length < 5 || /\d/.test(w) || known(w, vocab, last)) return null;
  let best: string[] | null = null;
  for (let i = 3; i <= w.length - 2; i++) {
    const a = w.slice(0, i);
    const b = w.slice(i);
    if (!nameDf.has(a) || !nameDf.has(b) || FILLER.has(a) || FILLER.has(b)) continue;
    if (!best || Math.min(a.length, b.length) > Math.min(best[0]!.length, best[1]!.length)) best = [a, b];
  }
  return best;
}

const CONCEPT_BY_KEY: ReadonlyMap<string, Concept> = new Map(CONCEPTS.map((c) => [c.key, c]));

/**
 * The concept "<w> American" also means, when `w` names an identity concept's people
 * ("korean" → Asian American, "mexican" → Latino & Latinx), or null. PURE.
 */
function diasporaOf(w: string): Concept | null {
  for (const c of CONCEPTS) {
    if (!c.identity || !c.diaspora || !c.people?.some((x) => wordVariants(x).includes(w))) continue;
    return CONCEPT_BY_KEY.get(c.diaspora) ?? null;
  }
  return null;
}

/** Two-word shorthands ("comp lit") replaced by their full words ("comparative literature"). */
function expandShorthands(tokens: readonly string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const full = SHORTHANDS.get(`${tokens[i]} ${tokens[i + 1] ?? ""}`);
    if (full) {
      out.push(...full.split(" "));
      i++;
    } else out.push(tokens[i]!);
  }
  return out;
}

/** Split a query into concept phrases and plain words. PURE (vocabulary optional). */
export function parseQuery(
  text: string,
  vocab?: Set<string>,
  ordinary?: Set<string>,
  nameDf?: ReadonlyMap<string, number>,
): ParsedQuery {
  const norm = normalizeName(text.slice(0, MAX_QUERY_LENGTH));
  // A comma between parts ("music, dance") is kept as a token: it joins topics like "and".
  const typed = text
    .slice(0, MAX_QUERY_LENGTH)
    .split(",")
    .map((part) => normalizeName(part).split(" ").filter(Boolean))
    .filter((ws) => ws.length > 0)
    .flatMap((ws, k) => (k > 0 ? [",", ...ws] : ws));
  const all = expandShorthands(
    typed.flatMap((w, i, ws) => (w === "," ? [w] : (splitCompound(w, i === ws.length - 1, vocab, nameDf) ?? [w]))),
  );
  const words = all.filter((w) => w !== ",");
  const units: QueryUnit[] = [];
  const fixes: string[] = [];
  const namePrefixes = new Map<string, string[]>();
  const fixed = new Set<string>();
  let changed = false;
  // "or" before the next unit groups it with the one before; "and" or a comma does between two topics.
  let join: "or" | "and" | null = null;
  const allConcepts = (u: QueryUnit): boolean =>
    u.kind === "concept" || (u.kind === "any" && u.units.every(allConcepts));
  const add = (unit: QueryUnit) => {
    const prev = units.at(-1);
    if (prev && join && (join === "or" || (allConcepts(prev) && unit.kind === "concept")))
      units[units.length - 1] =
        prev.kind === "any" ? { kind: "any", units: [...prev.units, unit] } : { kind: "any", units: [prev, unit] };
    else units.push(unit);
    join = null;
  };
  // The same topic said twice ("social clubs to make friends") counts once: a club shouldn't
  // earn the concept's category and rule twice.
  const addConcept = (concept: Concept, phrase: string) => {
    if (flatUnits(units).some((u) => u.kind === "concept" && u.concept === concept)) join = null;
    else add({ kind: "concept", concept, phrase });
  };
  for (let i = 0; i < all.length;) {
    // The rest of the query begins a multi-word topic, its last word half-typed ("student
    // gov" → student government, "public hea" → public health).
    const begun = vocab ? phraseCompletion(all.slice(i)) : null;
    if (begun) {
      addConcept(begun.concept, begun.term);
      fixes.push(all.slice(i).join(" "));
      break;
    }
    // Longest concept phrase starting here (up to four words: "model united nations"), as
    // typed or one letter off ("a capela").
    let matched = false;
    for (let n = Math.min(4, all.length - i); n >= 1; n--) {
      const phrase = all.slice(i, i + n).join(" ");
      if (phrase.includes(",")) continue;
      const concept = conceptFor(phrase);
      const fuzzy = !concept && n >= 2 && vocab ? fuzzyConceptPhrase(phrase, vocab) : null;
      const found = concept ?? fuzzy?.concept;
      if (found) {
        const term = fuzzy?.term ?? phrase;
        addConcept(found, term);
        fixes.push(term);
        if (fuzzy) changed = true;
        i += n;
        matched = true;
        break;
      }
    }
    if (matched) continue;
    // "korean american", "mexican americans": the community's own groups first, then the
    // concept its Americans also belong to (`Concept.diaspora`).
    const diaspora = all[i + 1] === "american" || all[i + 1] === "americans" ? diasporaOf(all[i]!) : null;
    if (diaspora) {
      add({
        kind: "any",
        lesser: true,
        units: [
          { kind: "word", word: all[i]!, last: false },
          { kind: "concept", concept: diaspora, phrase: diaspora.terms[0]! },
        ],
      });
      fixes.push(all[i]!, all[i + 1]!);
      i += 2;
      continue;
    }
    const w = all[i]!;
    i++;
    const last = i === all.length;
    if ((w === "," || w === "or" || w === "and") && !last) {
      if (units.length > 0) join = w === "or" ? "or" : "and";
      continue;
    }
    if (w === ",") continue;
    if (FILLER.has(w)) {
      if (
        last &&
        units.length > 0 &&
        nameDf &&
        [...nameDf.keys()].some((x) => x.length > w.length && x.startsWith(w) && !FILLER.has(x))
      )
        units.push({ kind: "word", word: w, last: true, optional: true });
      continue;
    }
    if (vocab && !known(w, vocab, last)) {
      const fix = correct(w, vocab);
      if (fix) {
        changed = true;
        fixes.push(fix);
        fixed.add(fix);
        const concept = CONCEPT_BY_TERM.get(fix);
        if (concept) addConcept(concept, fix);
        else add({ kind: "word", word: fix, last: false });
        continue;
      }
    }
    fixes.push(w);
    const completions = last ? conceptCompletions(w) : [];
    add({ kind: "word", word: w, last, ...(completions.length ? { completions } : {}) });
    if (vocab && nameDf) {
      const pre = distinctiveNamePrefixes(w, nameDf, vocab);
      if (pre.length) namePrefixes.set(w, pre);
    }
  }
  // A query made only of filler words ("harvard club") searches for them as written.
  if (units.length === 0) words.forEach((w, i) => units.push({ kind: "word", word: w, last: i === words.length - 1 }));
  const tail = units.at(-1);
  const end = tail?.kind === "any" ? tail.units.at(-1) : tail;
  // Half-typed: one or two letters, not a name word, or a rare name word that begins a more
  // common one ("inter" in one name, "international" in many).
  const lastPartial =
    end?.kind === "word" &&
    end.last &&
    (end.optional === true ||
      end.word.length <= 2 ||
      !nameDf ||
      !nameDf.has(end.word) ||
      beginsCommoner(end.word, nameDf));
  const deadEnd =
    end?.kind === "word" &&
    end.last &&
    end.word.length === 2 &&
    nameDf !== undefined &&
    ![...nameDf.keys()].some((x) => x.startsWith(end.word));
  const corrected = changed ? fixes.join(" ") : null;
  const audiences = queryAudiences(corrected ? `${norm} ${corrected}` : norm);
  for (const u of flatUnits(units))
    if (u.kind === "concept") for (const a of conceptAudiences(u.concept)) audiences.add(a);
  return {
    lastPartial,
    deadEnd,
    typedWords: words.length,
    categoryNamed: new Set(),
    fixes: fixed,
    isKnown: (w) => (vocab ? wordVariants(w).some((v) => vocab.has(v)) : false),
    norm,
    units,
    corrected,
    ordinary: new Set(words.filter((w) => ordinary?.has(w))),
    namePrefixes,
    audiences,
  };
}

/** `parseQuery` with the index's vocabulary (spelling correction), as the directory searches. */
export function parseQueryIn(clubs: readonly IndexClub[], text: string): ParsedQuery {
  const q = parseQuery(text, vocabulary(clubs), ordinaryWords(clubs), nameWordDf(clubs));
  const slug = categoryNames(clubs).get(q.norm.replace(/^(harvard |the )+/, "").replace(/ clubs?$/, ""));
  if (slug) q.categoryNamed.add(slug);
  return q;
}

/** Normalized category name → slug, from the categories clubs carry ("social and community"). */
const categoryNameMaps = new WeakMap<readonly IndexClub[], Map<string, string>>();
function categoryNames(clubs: readonly IndexClub[]): Map<string, string> {
  let m = categoryNameMaps.get(clubs);
  if (!m) {
    m = new Map();
    // Multi-word names only ("social and community"): a one-word category ("dance") is already
    // its topic's category, and a name match must not outweigh soft words ("dance beginner").
    for (const c of clubs)
      for (const k of c.categories) {
        const name = normalizeName(k.name);
        if (name.includes(" ")) m.set(name, k.slug);
      }
    categoryNameMaps.set(clubs, m);
  }
  return m;
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
  | { kind: "topics"; word: string }
  /** A derived joining fact that answers a soft word ("beginner" → no experience needed). */
  | { kind: "joining"; text: string };

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
    case "joining":
      return r.text;
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

/**
 * The name word a partly typed word begins, a real word before a filler one ("c": "crimson",
 * not "college"). A filler word only from three letters, or after other words ("consulting
 * g" → "group").
 */
function namePrefixed(p: Prepared, w: string, afterWords: boolean): string | null {
  let filler: string | null = null;
  for (const x of p.nameWords) {
    if (x.length <= w.length || !x.startsWith(w)) continue;
    if (!FILLER.has(x)) return x;
    if (w.length >= 3 || afterWords) filler ??= x;
  }
  return filler;
}

/** Why a club matched one unit, and how much. */
interface UnitHit {
  score: number;
  reason: MatchReason;
  /** Only a related word in the description, no category: a passing mention ("financial aid" for "finance"). */
  weak?: boolean;
  /** The typed word means something else at this club ("indian" at a Native American troupe). */
  otherSense?: boolean;
  /** Only a related word in the club's text matched ("legal" for "law"), not the word typed. */
  relatedText?: boolean;
  /** Reasons of the other alternatives matched ("coding or startups"). */
  more?: MatchReason[];
}

/**
 * How a club for an audience (`clubAudiences`) is ordered on a topic query: "full" when the
 * query names none of its audiences, "partial" when it names some ("black students" at the
 * Black Men's Forum), "none" otherwise. See `WEIGHTS.audience`.
 */
type Demotion = "none" | "partial" | "full";

function demotion(club: IndexClub, q: ParsedQuery): Demotion {
  if (!q.audiences || !flatUnits(q.units).some((u) => u.kind === "concept")) return "none";
  const aud = clubAudiences(club);
  if (aud.size === 0) return "none";
  let named = 0;
  for (const a of aud) if (namesAudience(q.audiences, a)) named++;
  return named === 0 ? "full" : named < aud.size ? "partial" : "none";
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
    // A single letter ("m" in "Volleyball M") is as likely the start of a word as a word.
    name = w.length === 1 ? WEIGHTS.namePrefixWord : WEIGHTS.nameWord;
    reason = aliasFor(club, p, nameWord);
  } else if (isInitials(p, w, q)) {
    name = WEIGHTS.acronymWord;
    reason = { kind: "initials", initials: w };
  } else if (allowPrefix) {
    // The word being typed ("c", "cri", "consulting g"): any name word it begins. Filler words
    // ("harvard", "club") only from three letters, and below a real word, so "c" means
    // Crimson or Consulting, not every "College" and "Club".
    const pre = namePrefixed(p, w, q.typedWords > 1);
    let initial: string | undefined;
    const acronym = w.length >= 2 ? [...p.acronyms].find((a) => a.length > w.length && a.startsWith(w)) : undefined;
    if (acronym && (!pre || FILLER.has(pre) || p.acronyms.has(pre))) {
      name = WEIGHTS.acronymPrefix;
      reason = { kind: "acronym", acronym };
    } else if (pre && !FILLER.has(pre)) {
      name = WEIGHTS.namePrefixWord;
      reason = aliasFor(club, p, pre);
    } else if (
      (w.length >= 3 || (w.length === 2 && q.deadEnd)) &&
      !q.ordinary.has(w) &&
      (initial = [...p.initials, ...p.coreInitials].find((x) => x.length > w.length && x.startsWith(w)))
    ) {
      // Initials on their way ("hcc" → HCCG; "io" → IOP when no name word starts "io").
      name = WEIGHTS.initialsPrefix;
      reason = { kind: "initials", initials: initial };
    } else if (pre) {
      name = WEIGHTS.fillerPrefixWord;
      reason = aliasFor(club, p, pre);
    }
  }
  if (!name) {
    // A nickname that begins a distinctive name word ("kroks" → Krokodiloes).
    const pre = q.namePrefixes.get(w)?.find((x) => p.nameWords.has(x));
    if (pre) {
      name = WEIGHTS.namePrefixWord;
      reason = aliasFor(club, p, pre);
    }
  }
  let text = 0;
  let textWord: string | null = null;
  let textKind: "description" | "topics" = "description";
  // One or two letters ("co", "so") in a description are word fragments, not what was meant.
  const about = w.length >= 3 ? hasAny(p.aboutWords, variants) : null;
  const topic = about || w.length < 3 ? null : hasAny(p.topicWords, variants);
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
  full: Prepared,
  concept: Concept,
  phrase: string,
  categoryName: (slug: string) => string,
  /** The whole query, normalized: a `notSense` phrase it says is meant ("black diamond"). */
  queryNorm = phrase,
  /** Read the club without its names (an audience club on another topic; see `WEIGHTS.audience`). */
  nameless = false,
): UnitHit | null {
  const p = conceptView(full, concept, queryNorm, nameless);
  const c = phraseFirst(concept, phrase);
  let score = 0;
  let reason: MatchReason | null = null;
  const aboutText = [p.aboutLine, p.topicLine];
  const single = !phrase.includes(" ");
  // What the typed words stand for: the phrase, plus the concept's full forms it abbreviates
  // ("vc" → "venture capital", "ml" → "machine learning"). A description saying the full
  // form says the same thing as one saying the abbreviation.
  const forms = [phrase, ...c.terms.filter((t) => abbreviates(phrase, t))];
  // The typed word's own stem among the related words is the word itself ("composing" →
  // "composers", "voting" → "votes").
  if (single && phrase.length >= 4) {
    // In either spelling ("theatre" is "theater", whose stem "theatricals" shares).
    const stems = new Set([phrase, otherSpelling(phrase) ?? phrase].map(stem));
    forms.push(...c.related.filter((r) => r !== phrase && !r.includes(" ") && r.length >= 4 && stems.has(stem(r))));
  }
  // Written as one word in a name ("board games" → Boardgame, "stand up" → StandUp).
  if (!single && phrase.replace(/ /g, "").length >= 6) forms.push(phrase.replace(/ /g, ""));
  // The concept's synonyms ("latinx" for "latino"), a little below the word as typed.
  const synonyms = (c.forms ?? []).filter((f) => !forms.includes(f));
  let synonym = false;
  const literal = (set: Set<string>, lines: string[]) => {
    for (const f of forms) {
      const hit = phraseFound(set, lines, f);
      if (hit) return hit;
    }
    for (const f of synonyms) {
      const hit = phraseFound(set, lines, f);
      if (hit) {
        synonym = true;
        return hit;
      }
    }
    return null;
  };
  let found: string | null;
  // Related words may count only inside the concept's categories (`relatedInCategory`).
  const relatedHere = !c.relatedInCategory || c.categories.some((x) => p.cats.has(x));
  const firstRelated = (cc: Concept, find: (r: string) => string | null) =>
    relatedHere ? firstRelatedWord(cc, find) : null;
  let relatedNameWord: string | null = null;
  let relatedNameScore = 0;
  if (c.clubNames?.some((n) => p.names.includes(n))) {
    score += WEIGHTS.conceptLiteralName;
    reason = { kind: "name" };
  } else if ((found = literal(p.nameWords, p.names)) || (single && p.acronyms.has(phrase))) {
    score += WEIGHTS.conceptLiteralName;
    reason = found && !found.includes(" ") ? aliasFor(club, p, found) : { kind: "name" };
  } else if (single && phrase.length >= 6 && hasPrefix(p.nameWords, phrase)) {
    // "premed" begins "premedical"; short words ("quant" / "quantum") never count this way.
    score += WEIGHTS.conceptLiteralName - 2;
    reason = { kind: "name" };
  } else if (
    relatedHere &&
    (found = c.related.find((r) => abbreviates(phrase, r) && phraseFound(p.nameWords, p.names, r)) ?? null)
  ) {
    // The query abbreviates a full form in the name ("mun" → Model United Nations): the name
    // itself. Only abbreviations: "web development" isn't "Computer Science" in a name.
    score += WEIGHTS.conceptLiteralName;
    reason = { kind: "name" };
  } else if ((found = literal(p.aboutWords, [p.aboutLine]))) {
    score += WEIGHTS.conceptLiteralText;
    reason = { kind: "description", word: found };
    const said = found;
    // The word says what the club is ("hip-hop dance group"), not one item of a list.
    if (p.head.includes(` ${found} `)) score += WEIGHTS.conceptSelfDescribed;
    if (c.categories.length > 0 && !c.categories.some((x) => p.cats.has(x))) {
      // Outside the topic's category: corroborated by a related word, it stands in for the
      // category; a bare mention ("theatre" in an a cappella group's list of genres) ranks
      // below the category's own clubs.
      if (firstRelated(c, (r) => (r !== phrase && r !== said ? phraseFound(p.aboutWords, [p.aboutLine], r) : null)))
        score += WEIGHTS.conceptCorroboratedText;
      else score -= WEIGHTS.conceptBareMention;
    }
  } else if (
    (found =
      firstRelated(c, (r) => (c.textOnly?.includes(r) ? null : phraseFound(p.nameWords, p.names, r))) ??
      (relatedHere ? (c.nameOnly ?? []) : []).map((r) => phraseFound(p.nameWords, p.names, r)).find(Boolean) ??
      (c.namesAnywhere ?? []).map((r) => phraseFound(p.nameWords, p.names, r)).find(Boolean) ??
      null)
  ) {
    const nameWord = found;
    relatedNameScore = WEIGHTS.conceptRelatedName - relatedRank(c, nameWord) * 0.1;
    // Named for a form of the topic ("Ghungroo", "Breakers") but filed elsewhere: the name
    // stands in for the category, so it ranks with the category's own clubs, above activity-list
    // mentions. Only a word that is no query term itself: a general one ("Writing", "Strategy")
    // names many things.
    if (
      c.categories.length > 0 &&
      !c.categories.some((x) => p.cats.has(x)) &&
      !c.terms.some((t) => wordVariants(t).includes(nameWord))
    )
      relatedNameScore += WEIGHTS.conceptNameStandIn;
    // A community's own people in the name ("Turkish Student Association" for "middle
    // eastern", "Nigerian Students Association" for "african"): the community's group, though
    // no category says so. Below a name saying the typed word itself.
    else if (c.identity && c.people?.some((x) => x === nameWord || wordVariants(x).includes(nameWord)))
      relatedNameScore += WEIGHTS.identityNameStandIn;
    score += relatedNameScore;
    reason = { kind: "related", topic: c.label, word: found };
    relatedNameWord = found;
  } else if ((found = literal(p.topicWords, [p.topicLine]))) {
    // A multi-word phrase listed verbatim ("web development") is specific, unlike one
    // common word among the activities: it counts like a description mention.
    // An expanded abbreviation ("cs" → "computer science") listed among many activities is
    // not that specific.
    score += found.includes(" ") && found === phrase ? WEIGHTS.conceptLiteralText : WEIGHTS.conceptLiteralTopic;
    // One word among a club's activities, outside the topic's category, follows the category's
    // own clubs ("consulting" listed by an energy group).
    if (!found.includes(" ") && c.categories.length > 0 && !c.categories.some((x) => p.cats.has(x)))
      score -= WEIGHTS.conceptBareTopic;
    // Filed under the topic, the word among its activities and two related words in its
    // one-liner ("comic opera" and "actors" at Gilbert & Sullivan for "theater"): about the
    // topic, like a description saying the word.
    else if (
      !(found.includes(" ") && found === phrase) &&
      c.categories.some((x) => p.cats.has(x)) &&
      new Set(
        c.related.filter((r) => r !== phrase && r !== found && phraseFound(p.aboutWords, [p.aboutLine], r)).map(stem),
      ).size >= 2
    )
      score += WEIGHTS.conceptLiteralText - WEIGHTS.conceptLiteralTopic;
    reason = { kind: "topics", word: found };
  }
  const cat = c.categories.find((s) => p.cats.has(s));
  if (cat) {
    score += WEIGHTS.conceptCategory;
    reason ??= { kind: "category", slug: cat, name: categoryName(cat) };
    // An umbrella category's own word in the name ("Technology" in "… Life Science &
    // Technology", filed under Technology & Engineering) is one piece of evidence, often the
    // reason for the category: count it once, so it never outranks clubs whose own text is
    // about the topic.
    if (relatedNameWord && BROAD_CATEGORIES.has(cat) && p.categoryWords.get(relatedNameWord)?.slug === cat)
      score -= relatedNameScore;
  }
  // A single related word only among the listed activities ("games" at a dance team's
  // football sidelines, "camping" at a summer day camp) is too weak to match on its own: it
  // counts beside other evidence, and alone only from the description or as a specific
  // phrase ("machine learning").
  // The typed word in another spelling ("theatre" for "theater") is the word itself, never a
  // related word adding to it.
  // So is a synonym ("latina" for "latinx"): one name of the community, said twice.
  const typed = new Set([...forms, ...wordVariants(phrase), ...synonyms.flatMap((s) => wordVariants(s))]);
  const related = reason
    ? firstRelated(c, (r) => (!typed.has(r) ? phraseFound(p.textWords, aboutText, r) : null))
    : firstRelated(c, (r) =>
        typed.has(r)
          ? null
          : r.includes(" ")
            ? phraseFound(p.textWords, aboutText, r)
            : phraseFound(p.aboutWords, [p.aboutLine], r),
      );
  const onlyRelated = !reason && related !== null;
  if (related) {
    score += WEIGHTS.conceptRelatedText - relatedRank(c, related) * 0.1;
    reason ??=
      p.aboutWords.has(related) || p.aboutLine.includes(` ${related} `)
        ? { kind: "description", word: related }
        : { kind: "topics", word: related };
  }
  if (!reason) return null;
  if (synonym) score -= WEIGHTS.conceptSynonym;
  // An identity word: the community's own broad groups before its pre-professional ones.
  if (c.identity && p.cats.has("cultural-identity") && ![...p.cats].some((s) => CAREER_CATEGORIES.has(s)))
    score += WEIGHTS.identityHome;
  // Another sense of the word ("indian" in a Native American troupe): kept, as a passing mention.
  // Only when the ambiguous word itself was typed ("indian", not "desi").
  if (c.otherSense && c.senseTerms?.includes(phrase) && hasOtherSense(p, c.otherSense))
    return { score: Math.min(score, WEIGHTS.conceptRelatedText), reason, weak: true, otherSense: true };
  return {
    score,
    reason,
    ...(!cat && score <= WEIGHTS.conceptRelatedText ? { weak: true } : {}),
    ...(onlyRelated ? { relatedText: true } : {}),
  };
}

/** A word without its common ending, for "same word" checks ("composing", "composers" → "compos"). */
function stem(w: string): string {
  // "theatricals" and "theater" are one word ("Hasty Pudding Theatricals" for "theater").
  return w.replace(/(ricals?|ings?|ers?|ions?|ed|es|s)$/, "");
}

/**
 * The concept with the typed phrase's own words first among its related words: "rock
 * climbing" is the Climbing Club before the Outing Club, though both are Outdoors; and
 * "composing" the Composers Association before an orchestra. PURE.
 */
const phraseOrdered = new Map<string, Concept>();
function phraseFirst(c: Concept, phrase: string): Concept {
  const key = `${c.key}|${phrase}`;
  let out = phraseOrdered.get(key);
  if (!out) {
    const stems = new Set(
      phrase
        .split(" ")
        .filter((w) => w.length >= 4)
        .map(stem),
    );
    const said = (r: string) =>
      ` ${phrase} `.includes(` ${r} `) || (!r.includes(" ") && r.length >= 4 && stems.has(stem(r)));
    out = { ...c, related: [...c.related.filter(said), ...c.related.filter((r) => !said(r))] };
    if (phraseOrdered.size < 500) phraseOrdered.set(key, out);
  }
  return out;
}

const views = new WeakMap<Prepared, Map<string, Prepared>>();
/**
 * A club as one concept reads it: without the phrases where the concept's words mean
 * something else (`notSense`, unless the query says the phrase), without its activity list
 * (`notInActivities`), without its text outside `textCategories`, and, for an audience club on
 * a topic that doesn't name its audience, without its names. Cached. PURE.
 */
function conceptView(p: Prepared, c: Concept, queryNorm: string, nameless: boolean): Prepared {
  if (!c.notSense && !c.notInActivities && !c.textCategories && !c.inCategoryText && !nameless) return p;
  const q = ` ${queryNorm} `;
  const lines = [...p.names.map((n) => ` ${n} `), p.aboutLine, p.topicLine];
  const strip = (c.notSense ?? []).filter((x) => !q.includes(` ${x} `) && lines.some((l) => l.includes(` ${x} `)));
  const noTopics = c.notInActivities === true;
  const noText = c.textCategories !== undefined && !c.textCategories.some((s) => p.cats.has(s));
  // Words that say the topic only inside its categories (`inCategoryText`), out of the text elsewhere.
  // Not inside a phrase the query says ("sanders theatre" still finds who plays there).
  const said = (c.notSense ?? []).filter((x) => q.includes(` ${x} `)).map((x) => ` ${x} `);
  const textStrip =
    c.inCategoryText && !c.categories.some((s) => p.cats.has(s))
      ? c.inCategoryText.filter(
          (x) =>
            (p.aboutLine.includes(` ${x} `) || p.topicLine.includes(` ${x} `)) &&
            !said.some((s) => s.includes(` ${x} `)),
        )
      : [];
  if (!strip.length && !textStrip.length && !noTopics && !noText && !nameless) return p;
  const key = `${strip.join("|")}#${textStrip.join("|")}#${noTopics}#${noText}#${nameless}`;
  let m = views.get(p);
  if (!m) views.set(p, (m = new Map()));
  let v = m.get(key);
  if (!v) {
    const cut = (line: string) => {
      let s = ` ${line} `;
      for (const x of strip) while (s.includes(` ${x} `)) s = s.replace(` ${x} `, "  ");
      return s;
    };
    const ws = (s: string) => s.split(/\s+/).filter(Boolean);
    const cutText = (line: string) => {
      let s = cut(line);
      for (const x of textStrip) while (s.includes(` ${x} `)) s = s.replace(` ${x} `, "  ");
      return s;
    };
    const names = nameless ? [] : p.names.map((n) => ws(cut(n)).join(" "));
    const aboutLine = noText ? " " : cutText(p.aboutLine);
    const topicLine = noText || noTopics ? " " : cutText(p.topicLine);
    v = {
      ...p,
      names,
      nameWords: new Set(names.flatMap(ws)),
      canonicalWords: new Set(ws(names[0] ?? "")),
      acronyms: nameless ? new Set() : p.acronyms,
      aboutWords: new Set(ws(aboutLine)),
      topicWords: new Set(ws(topicLine)),
      textWords: new Set([...ws(aboutLine), ...ws(topicLine)]),
      aboutLine,
      topicLine,
    };
    m.set(key, v);
  }
  return v;
}

/** Whether a club's name or text uses a phrase that means another sense of a concept's term. */
function hasOtherSense(p: Prepared, phrases: readonly string[]): boolean {
  return phrases.some(
    (x) => (phraseFound(p.nameWords, p.names, x) ?? phraseFound(p.textWords, [p.aboutLine, p.topicLine], x)) !== null,
  );
}

/**
 * Position of a found word in the concept's related list (most telling first), capped so
 * the order only breaks ties: "computer" outranks "computing" for "coding".
 */
function relatedRank(c: Concept, found: string): number {
  const i = c.related.findIndex((r) => r === found || wordVariants(r).includes(found));
  // A name-only word ("outing") ranks after the concept's own related words.
  return Math.min(5, i < 0 ? 5 : i);
}

/** The first related word (as found in the club's text) that `find` locates. */
function firstRelatedWord(c: Concept, find: (r: string) => string | null): string | null {
  for (const r of c.related) {
    const hit = find(r);
    if (hit) return hit;
  }
  return null;
}

/**
 * A concept hit, under the concept's intent rule when it has one ("social", "meet people":
 * the Meet-people rule). A word in the club's text only counts when the rule picks the club
 * (so selective social orgs and a dance team's "socials" don't match), the rule's own picks
 * match with a reason, and its order (open first) lifts clubs. A club *named* for the word
 * keeps its name match. PURE.
 */
function gatedConceptHit(
  club: IndexClub,
  p: Prepared,
  c: Concept,
  phrase: string,
  categoryName: (slug: string) => string,
  queryNorm = phrase,
  nameless = false,
): UnitHit | null {
  const hit = conceptHit(club, p, c, phrase, categoryName, queryNorm, nameless);
  const intent = c.intent ? INTENTS.find((i) => i.slug === c.intent) : undefined;
  if (!intent) return hit;
  const named = hit && (hit.reason.kind === "name" || hit.reason.kind === "alias" || hit.reason.kind === "acronym");
  const picked = matchesIntent(club, intent);
  // Named for the word but outside the rule ("Tech for Social Good" for "social"): still
  // found, after the rule's own picks.
  if (named) return picked ? hit : { ...hit, score: hit.score - WEIGHTS.conceptCategory };
  if (!picked) return null;
  // The rule's order (open first) breaks ties among equally good matches; it is smaller than
  // the gap between a description and an activity-list mention, so a club whose activities
  // list one "social event" never outranks one whose description is about community.
  const lift = intentRank(club, intent);
  if (hit) return { ...hit, score: hit.score + lift };
  const why = intentReason(club, intent);
  if (!why) return null;
  const isCategory = intent.categories.includes(why);
  // The rule's wider picks (a cultural group for "make friends") follow the concept's own
  // category (Social & Community).
  return {
    score: WEIGHTS.conceptCategory - (c.categories.includes(why) ? 0 : WEIGHTS.intentOnly) + lift,
    reason: isCategory ? { kind: "category", slug: why, name: categoryName(why) } : { kind: "description", word: why },
  };
}

export interface ClubMatch {
  score: number;
  /** What matched, deduplicated, strongest first. */
  reasons: MatchReason[];
  /** How many of the query's units matched (all of them for a full match). */
  matchedUnits: number;
  /** Every matched unit was only a related word in the description (see `UnitHit.weak`). */
  weak: boolean;
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
  const inNamed = [...q.categoryNamed].find((s) => p.cats.has(s));
  let score = 0;
  let matchedUnits = 0;
  let weakUnits = 0;
  let otherSense = false;
  const reasons: MatchReason[] = [];
  const kinds: MatchReason["kind"][] = [];
  let relatedText = false;
  const demote = demotion(club, q);
  for (const u of q.units) {
    const hit = unitHit(club, p, u, q, categoryName, demote);
    // An optional unit that misses counts as met: it only lifts.
    if (!hit && u.kind === "word" && u.optional) {
      matchedUnits++;
      continue;
    }
    if (!hit) {
      if (partial || inNamed) continue;
      return null;
    }
    matchedUnits++;
    kinds.push(hit.reason.kind);
    if (hit.relatedText) relatedText = true;
    if (hit.weak) weakUnits++;
    if (hit.otherSense) otherSense = true;
    score += hit.score;
    for (const r of [hit.reason, ...(hit.more ?? [])]) if (!reasons.some((x) => sameReason(x, r))) reasons.push(r);
  }
  if (demote !== "none") score -= WEIGHTS.audience;
  if (serviceProgramAside(club, q)) score -= WEIGHTS.serviceProgram;
  // A sparse club (no one-liner, website or Instagram: known only by its name and categories)
  // follows described clubs on a topic.
  if (isSparseClub(club) && flatUnits(q.units).some((u) => u.kind === "concept")) score -= WEIGHTS.sparse;
  if (inNamed) {
    // The query names this club's category: a full match, its other words only adding.
    const r: MatchReason = { kind: "category", slug: inNamed, name: categoryName(inNamed) };
    if (!reasons.some((x) => sameReason(x, r))) reasons.unshift(r);
    return { score: score + WEIGHTS.categoryName, reasons, matchedUnits: q.units.length, weak: false };
  }
  if (matchedUnits === 0) return null;
  if (scatteredInText(p, q, kinds, relatedText)) return null;
  const acr = rawText.length <= 12 && !/\s/.test(rawText.trim()) ? normalizeAcronym(rawText).toLowerCase() : "";
  // Whole-query bonuses read the query as corrected ("crimsom" is the Crimson's own name).
  const norm = q.corrected ?? q.norm;
  // "Harvard X" is named X ("undergraduate association" → Harvard Undergraduate Association).
  if (p.names.includes(norm) || p.names.some((n) => n.replace(HARVARD_LEAD, "") === norm)) score += WEIGHTS.exactName;
  if (acr.length >= 2 && p.acronyms.has(acr)) score += WEIGHTS.exactAcronym;
  else if (isInitials(p, acr, q)) score += WEIGHTS.exactInitials;
  // The name begins with what was typed; while a word is half-typed, also the name's core
  // without "The Harvard College" ("c", "harvard c", "consulting g" → Consulting Group).
  // Not for a finished word: "finance" is as much Harvard Investment Association's topic as
  // Harvard Finance Forum's.
  const qLead = coreName(norm);
  // An audience club the query doesn't name isn't named by its topic words either ("computer
  // science" isn't Women in Computer Science's name).
  const fullName = demote !== "full";
  if (
    fullName &&
    (p.names.some((n) => n.startsWith(norm)) || (q.lastPartial && p.cores.some((n) => n.startsWith(qLead))))
  )
    score += WEIGHTS.namePrefix;
  const core = (n: string) =>
    n
      .split(" ")
      .filter((w) => !FILLER.has(w))
      .join(" ");
  const qCore = core(norm);
  if (qCore && !p.names.includes(norm) && p.names.some((n) => core(n) === qCore)) score += WEIGHTS.coreName;
  const qWords = norm.split(" ").filter((w) => !FILLER.has(w));
  // Not when a word means something else here: "indian dance" isn't the Intertribal Indian
  // Dance Troupe's name read as South Asian dance.
  if (
    fullName &&
    !otherSense &&
    qWords.length > 1 &&
    qWords.every((w) => wordVariants(w).some((v) => p.nameWords.has(v)))
  )
    score += WEIGHTS.allWordsInName;
  score += club.completeness * WEIGHTS.completeness;
  // A club where a typed word means something else follows every club read in the intended
  // sense, however well its other words match ("indian dance": Bhangra before the Intertribal
  // Indian Dance Troupe, which still shows).
  if (otherSense) score -= WEIGHTS.otherSense;
  return { score, reasons, matchedUnits, weak: weakUnits === matchedUnits };
}

/** One-word people words of identity concepts, 5+ letters ("black", "asian", "latina"). */
const PEOPLE_WORDS: readonly string[] = [
  ...new Set(
    CONCEPTS.filter((c) => c.identity).flatMap((c) =>
      (c.people ?? []).filter((w) => !w.includes(" ") && w.length >= 5),
    ),
  ),
];
const nameAudience = new WeakMap<IndexClub, boolean>();
/** Whether a club's own name says who it is for ("Women in Computer Science"), not only its one-liner. */
function nameMarksAudience(club: IndexClub): boolean {
  let v = nameAudience.get(club);
  if (v === undefined) {
    const words = normalizeName(club.name).split(" ");
    v =
      clubAudiences({ name: club.name, shortDescription: null }).size > 0 ||
      // A people word run into a coined name ("BlackCAST").
      words.some((w) => PEOPLE_WORDS.some((x) => w.length > x.length && w.startsWith(x)));
    nameAudience.set(club, v);
  }
  return v;
}

/** Whether the club's name says the name of one of its categories that is the concept's ("A Cappella"). */
function nameIsCategory(club: IndexClub, p: Prepared, c: Concept): boolean {
  return club.categories.some(
    (k) => c.categories.includes(k.slug) && p.names.some((n) => ` ${n} `.includes(` ${normalizeName(k.name)} `)),
  );
}

/** Categories of service work: a topic in one of them is what a service program does. */
const SERVICE_CATEGORIES = new Set(["public-service", "mentoring-education", "adult-services", "health-service"]);

/**
 * A public-service program (teaching, tutoring or running activities for others) on a topic
 * query that isn't about service: it does the topic for someone else, so it follows the clubs
 * whose members do it themselves ("theater": the Dramatic Club before a theater program for
 * third graders). Never on a name or word query. PURE.
 */
function serviceProgramAside(club: IndexClub, q: ParsedQuery): boolean {
  if (club.orgType !== "public_service_program") return false;
  const concepts = flatUnits(q.units).flatMap((u) => (u.kind === "concept" ? [u.concept] : []));
  return concepts.length > 0 && !concepts.some((c) => c.categories.some((s) => SERVICE_CATEGORIES.has(s)));
}

/** A name word made of `w` and another known word of 3+ letters ("datamatch"), or null. */
function compoundNameWord(p: Prepared, w: string, q: ParsedQuery): string | null {
  for (const x of p.nameWords) {
    const rest = x.slice(w.length);
    if (rest.length >= 3 && x.startsWith(w) && q.isKnown(rest)) return x;
  }
  return null;
}

/**
 * Every part of a multi-part query found only in a club's text, never side by side, and
 * either all of them only in its activity list ("law" and "school" among a moot court's
 * activities, for "law school") or one only through a related word ("legal" for "law"): a
 * list of unrelated things, not what was asked. A typed word in the one-line description
 * still counts beside one in the activities ("nonprofits" and "consulting"). PURE.
 */
function scatteredInText(
  p: Prepared,
  q: ParsedQuery,
  kinds: readonly MatchReason["kind"][],
  relatedText: boolean,
): boolean {
  if (q.units.length < 2 || kinds.length < q.units.length || q.units.some((u) => u.kind === "any")) return false;
  if (!kinds.every((k) => k === "description" || k === "topics")) return false;
  if (!kinds.every((k) => k === "topics") && !relatedText) return false;
  // Side by side in any word form ("bible studies" for "bible study").
  const forms = q.units.map((u) => {
    const w = unitText(u);
    return w.includes(" ") ? [w] : wordVariants(w);
  });
  let phrases = [""];
  for (const f of forms) phrases = phrases.flatMap((x) => f.map((w) => (x ? `${x} ${w}` : w))).slice(0, 64);
  return !phrases.some((ph) => p.topicLine.includes(` ${ph} `) || p.aboutLine.includes(` ${ph} `));
}

/** Share of a lesser alternative's score kept ("asian american" for "korean american"). */
const LESSER = 0.6;

/** Share of a topic match kept when the topic is only guessed from a half-typed word ("dan" → dance). */
const COMPLETION = 0.6;

/** How a club matches one query unit, or null. */
function unitHit(
  club: IndexClub,
  p: Prepared,
  u: QueryUnit,
  q: ParsedQuery,
  categoryName: (slug: string) => string,
  demote: Demotion = "none",
): UnitHit | null {
  if (u.kind === "any" && u.lesser) {
    // What was typed first; what it also means after it ("korean american").
    const [first, ...others] = u.units.map((x) => unitHit(club, p, x, q, categoryName, demote));
    const alt = others
      .filter((h): h is UnitHit => h !== null)
      .map((h) => ({ ...h, score: h.score * LESSER }))
      .sort((a, b) => b.score - a.score)[0];
    return first && (!alt || first.score >= alt.score) ? first : (alt ?? null);
  }
  if (u.kind === "any") {
    // Any alternative; every one matched comes first ("coding or startups").
    const hits = u.units
      .map((x) => unitHit(club, p, x, q, categoryName, demote))
      .filter((h): h is UnitHit => h !== null)
      .sort((a, b) => b.score - a.score);
    const [best, ...rest] = hits;
    if (!best) return null;
    return {
      ...best,
      score: hits.reduce((s, h) => s + h.score, 0) + (hits.length === u.units.length ? WEIGHTS.allAlternatives : 0),
      more: rest.map((h) => h.reason),
      ...(hits.every((h) => h.weak) ? {} : { weak: false }),
    };
  }
  if (u.kind === "word" && u.optional) {
    const pre = namePrefixed(p, u.word, true);
    return pre && !FILLER.has(pre) ? { score: WEIGHTS.namePrefixWord, reason: aliasFor(club, p, pre) } : null;
  }
  if (u.kind === "concept") {
    let hit = gatedConceptHit(club, p, u.concept, u.phrase, categoryName, q.norm);
    // A club for an audience the query doesn't name: its name says who it is for, so the
    // topic counts only as much as its other evidence ("cs": Women in Computer Science's name
    // is not why it is a computer science club). Never dropped.
    // Only when the name itself says who the club is for: "Ballet Folklórico de Aztlán" is
    // named for its dance, though its one-liner names its community (Round 10).
    // Nor when the name only says the kind of group its category already says ("ApiChorus A
    // Cappella" for "a cappella").
    if (hit && demote === "full" && (nameMarksAudience(club) || nameIsCategory(club, p, u.concept))) {
      const bare = gatedConceptHit(club, p, u.concept, u.phrase, categoryName, q.norm, true);
      hit = { ...hit, score: Math.min(hit.score, bare?.score ?? WEIGHTS.conceptRelatedText) };
    }
    // A topic word that begins a compound name ("data" → Datamatch, "hack" → HackHarvard),
    // as the last word: never a longer, different word ("math" isn't Mather).
    const compound = u === q.units.at(-1) && !u.phrase.includes(" ") ? compoundNameWord(p, u.phrase, q) : null;
    if (compound && (!hit || hit.score < WEIGHTS.namePrefixWord))
      return { score: WEIGHTS.namePrefixWord, reason: aliasFor(club, p, compound) };
    return hit;
  }
  let hit = wordHit(club, p, u.word, u.last, q);
  for (const { concept, term } of u.completions ?? []) {
    const h = gatedConceptHit(club, p, concept, term, categoryName, q.norm);
    if (h && (!hit || h.score * COMPLETION > hit.score)) hit = { ...h, score: h.score * COMPLETION };
  }
  return hit;
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
  /**
   * Constraint phrases read as filters ("no comp" → No comp), already applied on top of the
   * request's filters. The directory says so and offers the filter instead.
   */
  constraints: QueryConstraint[];
  /** Soft words ("beginner", "casually") as typed: they only lifted clubs saying them; not required. */
  soft: string[];
  /**
   * Process words as typed ("comp", "application", "deadline"): never required text; they
   * lifted clubs with that process or a known/live cycle, and alone selected those clubs.
   */
  process: string[];
  /** The text actually searched after constraints and soft words came out ("" for none). */
  searchedText: string;
  /** Negated constraint phrases ("not recruiting") that were dropped rather than filtered on. */
  negated: string[];
  /**
   * When a constraint phrase left fewer than 3 clubs but the topic alone has many: one entry
   * per constraint, "Only 1 finance club says no comp: show all 52 finance clubs". `without`
   * is how many clubs match the text with that constraint dropped; `unknown` how many of them
   * don't say either way. Empty when nothing needs relaxing.
   */
  relaxed: RelaxedConstraint[];
}

export interface RelaxedConstraint {
  constraint: ConstraintFilter;
  /** The words as typed ("no comp"). */
  phrase: string;
  /** `maxHours` only. */
  value?: number;
  /** `recruitingSeason` only. */
  season?: QueryConstraint["season"];
  /** Clubs matching the text with this constraint dropped. */
  without: number;
  /** Of those, clubs that don't state the fact either way. */
  unknown: number;
  /**
   * `noComp` only: clubs among them whose comp has no cuts (everyone who finishes it is in),
   * the nearest thing to no comp ("no comp finance" → the Alternative Investment Club). At most 3.
   */
  noCuts?: { slug: string; name: string }[];
}

/** Whether a club's source says nothing either way about a constraint's fact. */
function dontSay(c: IndexClub, filter: ConstraintFilter, now: Date): boolean {
  const j = c.joining;
  switch (filter) {
    // No round, open membership or recruiting pattern stated: unknown, not "no".
    case "stillTime":
      return !matchesStillTime(c, now);
    case "recruitingSeason":
      return !c.recruitingSeasons?.length;
    case "openJoin":
      return j.access === null || j.access === "mixed";
    case "noComp":
      return j.comp === null;
    case "noDues":
      return j.dues === null;
    case "noExperience":
      return j.noExperience !== true;
    case "maxHours":
      return c.hoursPerWeek?.max == null;
    case "recruitingNow":
      return false;
  }
}

/** Below this many strong text matches, a passing mention may still stand in under a constraint. */
const STRONG_TOPIC_MIN = 3;
/** Fewer results than this under a constraint prompts the "show all" hint. */
const FEW_RESULTS = 3;

/** Live view of a club at `now`: cycle statuses and the featured cycle recomputed. */
export function liveClub(club: IndexClub, now: Date): IndexClub {
  const cycles = club.cycles.map((c) => withLiveStatus(c, now));
  return { ...club, cycles, currentCycle: pickCurrentCycle(cycles, now) };
}

/**
 * The browse order with no search ("Suggested"): what a student can act on first — clubs
 * recruiting now (soonest deadline first), then clubs anyone can join — and every other club
 * in a shuffle that changes daily and is the same for everyone that day. Never by how much
 * we know about a club (ADR 0039): the rest are in no order of merit, so no club sits at
 * the bottom for its name or its web presence. PURE.
 */
export function featuredCompare(a: IndexClub, b: IndexClub, now: Date, day: string): number {
  const tier = (c: IndexClub) =>
    c.currentCycle && isRecruitingNow(c.currentCycle.status) ? 0 : c.joining?.access === "open" ? 1 : 2;
  const ta = tier(a);
  const tb = tier(b);
  if (ta !== tb) return ta - tb;
  if (ta === 0) {
    const da = nextDeadline(a, now);
    const db = nextDeadline(b, now);
    if (da !== db) return da === null ? 1 : db === null ? -1 : da - db;
  }
  return shuffleKey(day, a.id) - shuffleKey(day, b.id);
}

/**
 * "Popularity" (ADR 0046): clubs with a stated Instagram follower count first, most
 * followers first; clubs without a count follow in the Suggested order, then by name. Only
 * a count a source states orders a club, so an unknown count is "not counted", never zero.
 * PURE.
 */
export function popularityCompare(a: IndexClub, b: IndexClub, now: Date, day: string): number {
  const fa = a.instagramFollowers ?? null;
  const fb = b.instagramFollowers ?? null;
  if (fa !== null && fb !== null) return fb - fa;
  if (fa !== null) return -1;
  if (fb !== null) return 1;
  return featuredCompare(a, b, now, day);
}

/**
 * Among equally good search matches, the better-known club first (ADR 0046): typing "c"
 * should show the Crimson before an alphabetical run of small clubs. Clubs without a stated
 * count follow, by name. Never outweighs relevance. PURE.
 */
export function followersCompare(a: IndexClub, b: IndexClub): number {
  const fa = a.instagramFollowers ?? null;
  const fb = b.instagramFollowers ?? null;
  if (fa !== null && fb !== null) return fb - fa;
  return fa !== null ? -1 : fb !== null ? 1 : 0;
}

/** The shuffle's seed: the date in Cambridge, so the order turns over at local midnight. */
export function featuredDay(now: Date): string {
  const p = newYorkDateParts(now);
  return `${p.year}-${p.month}-${p.day}`;
}

/** FNV-1a of seed + id: a stable pseudo-random rank. PURE. */
function shuffleKey(seed: string, id: string): number {
  let h = 0x811c9dc5;
  const s = `${seed}:${id}`;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
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
/**
 * "Still time to join": what a student who missed a round can still get into — a round open
 * or opening (live statuses at `now`), open membership, rolling recruiting, or, from August
 * through December, a club whose past rounds were in spring (a pattern, not a date: the chip
 * says so). Join-anytime facts are as `matchesOpenJoin`. A round the club announces for a
 * later term (`announcedLaterRound`) replaces the pattern: still time only within this
 * academic year. PURE.
 */
export function matchesStillTime(c: IndexClub, now: Date): boolean {
  // A round opening after this academic year isn't still time (ADR 0051 amendment).
  const live = (cy: IndexClub["cycles"][number]) =>
    isRecruitingNow(cy.status) || (cy.status === "upcoming" && !beyondAcademicYear(cy.termKey, now));
  if (c.cycles.some(live)) return true;
  if (matchesOpenJoin(c)) return true;
  // The club's own pages name its next round: that, not its usual seasons, says when.
  const later = announcedLaterRound(c.cycles, now);
  if (later) return !beyondAcademicYear(later.termKey, now);
  const seasons = c.recruitingSeasons ?? [];
  if (seasons.includes("rolling")) return true;
  return newYorkDateParts(now).month >= 8 && seasons.includes("spring");
}

/** The season of a term key ("2027-spring" → "spring"). PURE. */
function termSeason(term: string): string {
  return term.slice(term.indexOf("-") + 1);
}

/** Whether `now` is a real moment (callers without one pass the epoch). */
const knowsNow = (now: Date) => now.getTime() > 0;

/**
 * The recruiting-season filter (`season=`, "what can I join in spring"): the club's usual
 * terms (`club.recruiting_seasons`), or a dated round ahead in that season. A round the club's
 * own pages announce for a later term (`announcedLaterRound`) decides instead of the pattern
 * (Round 10: the Pitches, "next audition cycle … Fall of 2027", aren't a spring club; HCDU's
 * announced Spring 2027 comp is). Rolling recruiters stay rolling. Postgres reads the pattern
 * only; the rounds need `now` and are static-site only, like Still time to join. PURE.
 */
export function matchesRecruitingSeason(
  c: Pick<IndexClub, "cycles" | "recruitingSeasons">,
  seasons: readonly string[],
  now: Date = new Date(0),
): boolean {
  const usual = c.recruitingSeasons ?? [];
  if (seasons.includes("rolling") && usual.includes("rolling")) return true;
  if (!knowsNow(now)) return seasons.some((s) => usual.some((u) => u === s));
  const later = announcedLaterRound(c.cycles, now);
  if (later) return seasons.includes(termSeason(later.termKey));
  return seasons.some((s) => usual.some((u) => u === s));
}

/** A dated round still ahead or open, in one of the seasons. */
function seasonRoundAhead(cy: IndexClub["cycles"][number], seasons: readonly string[]): boolean {
  return (
    (cy.opens !== null || cy.deadline !== null) &&
    (cy.status === "upcoming" || isRecruitingNow(cy.status)) &&
    seasons.includes(termSeason(cy.termKey))
  );
}

/** Lifts under a typed season ("what can I join in spring"): when it is known, first. */
const SEASON_LIFT = { dated: 10, announced: 8 } as const;

/**
 * How a season constraint orders a club: a dated round in that season ahead or open, then a
 * round the club's pages announce for it, then the usual-season pattern (0). PURE.
 */
function seasonLift(
  c: IndexClub,
  seasons: readonly string[],
  now: Date,
): { score: number; reason: MatchReason | null } {
  if (c.cycles.some((cy) => seasonRoundAhead(withLiveStatus(cy, now), seasons)))
    return { score: SEASON_LIFT.dated, reason: { kind: "joining", text: "Has a dated round that term" } };
  const later = announcedLaterRound(c.cycles, now);
  if (later && seasons.includes(termSeason(later.termKey)))
    return {
      score: SEASON_LIFT.announced,
      reason: { kind: "joining", text: "Announces its next round for that term" },
    };
  return { score: 0, reason: null };
}

/** `now` is needed only by `stillTime`; without it that filter matches nothing time-bound. */
export function passesFilters(c: IndexClub, f: ClubFilters, now: Date = new Date(0)): boolean {
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
  if (f.recruitingSeasons.length && !matchesRecruitingSeason(c, f.recruitingSeasons, now)) return false;
  if (f.recruitingNow && !c.cycles.some((cy) => isRecruitingNow(cy.status))) return false;
  if (f.openJoin && !matchesOpenJoin(c)) return false;
  if (f.noComp && !matchesNoComp(c)) return false;
  if (f.noDues && !matchesNoDues(c)) return false;
  if (f.noExperience && !matchesNoExperience(c)) return false;
  if (f.stillTime && !matchesStillTime(c, now)) return false;
  if (f.maxHours !== null && !matchesMaxHours(c, f.maxHours)) return false;
  if (f.intent) {
    const intent = INTENTS.find((i) => i.slug === f.intent);
    if (intent && !matchesIntent(c, intent)) return false;
  }
  return true;
}

const PARTIAL_LIMIT = 10;

/** Whether a normalized query is (a phrase of) some club's name or alias. */
const nameIndexes = new WeakMap<readonly IndexClub[], string>();
function nameIndex(clubs: readonly IndexClub[]): string {
  let all = nameIndexes.get(clubs);
  if (all === undefined) {
    all = ` ${clubs.flatMap((c) => prepare(c).names).join(" | ")} `;
    nameIndexes.set(clubs, all);
  }
  return all;
}
function isNamePhrase(clubs: readonly IndexClub[], norm: string): boolean {
  return nameIndex(clubs).includes(` ${norm} `);
}
/** Whether a normalized phrase begins a phrase of some club's name, its last word maybe cut short. */
function beginsNamePhrase(clubs: readonly IndexClub[], norm: string): boolean {
  return nameIndex(clubs).includes(` ${norm}`);
}

/**
 * Whether any club the directory shows by default has a round open at `now`: when none does,
 * "recruiting" in a query reads as Still time to join (`effectiveQuery`). Cached per index
 * and moment, since facets and relaxations ask the same question on every keystroke.
 */
const liveRounds = new WeakMap<readonly IndexClub[], { at: number; any: boolean }>();
const DEFAULT_VIEW = ClubFilters.parse({});
export function anyRecruitingNow(clubs: readonly IndexClub[], now: Date): boolean {
  const hit = liveRounds.get(clubs);
  if (hit && hit.at === now.getTime()) return hit.any;
  const any = clubs.some((raw) => {
    if (!passesFilters(raw, DEFAULT_VIEW, now)) return false;
    return raw.cycles.some((cy) => isRecruitingNow(withLiveStatus(cy, now).status));
  });
  liveRounds.set(clubs, { at: now.getTime(), any });
  return any;
}

/** Umbrella categories spanning many topics: sharing one says little about a specific topic. */
const BROAD_CATEGORIES = new Set(["technology", "academic-stem", "pre-professional"]);

/** Weights of soft-modifier signals: large enough to re-rank clubs matching the topic. */
const SOFT = {
  fact: 12,
  says: 10,
  saysTopic: 6,
  open: 10,
  noCuts: 5,
  hours: 12,
  category: 4,
  against: -6,
  /** "No auditions" at a club that auditions: below every club that doesn't. */
  noProcess: -20,
  /** "No auditions" said in those words ("non-audition group"). */
  saysProcess: 6,
} as const;

/** Where auditions are the norm: "dont audition" asks about these groups first. */
const PERFORMING = ["performing-arts", "music", "a-cappella", "dance", "theater"];

/**
 * How a soft modifier moves a club, and why: its text says it ("beginners welcome"), or a
 * derived joining fact answers it (no experience needed, open membership, no cuts, stated
 * hours). A stated audition or tryout counts against "beginner"; a comp against "low
 * commitment". `selected` is whether anything answered it (for a query of only soft words).
 */
function softHit(
  club: IndexClub,
  m: SoftModifier,
  now: Date,
  /** The club's live view (cycle statuses at `now`); `club` when omitted. */
  live: IndexClub = club,
  /** The words as typed ("no auditions"). */
  phrase = "",
): { score: number; reasons: MatchReason[]; selected: boolean } {
  const p = prepare(club);
  const j = club.joining;
  let score = 0;
  const reasons: MatchReason[] = [];
  const add = (n: number, r: MatchReason | null) => {
    score += n;
    if (r) reasons.push(r);
  };
  if (m.process) {
    const selected = processHit(live, m.process, now, add);
    return { score, reasons, selected };
  }
  const about = m.says.find((w) => phraseFound(p.aboutWords, [p.aboutLine], w));
  const topic = about ? null : m.says.find((w) => phraseFound(p.topicWords, [p.topicLine], w));
  if (about) add(SOFT.says, { kind: "description", word: about });
  else if (topic) add(SOFT.saysTopic, { kind: "topics", word: topic });
  const selective = j.general.some((g) => g === "audition" || g === "tryout");
  // "No audition(s)", "no tryouts", "unauditioned": a club that auditions or holds tryouts
  // for its members is the opposite, whatever else it says ("no experience needed").
  if (m.key === "beginner" && selective && j.access !== "open" && /audition|try ?outs?\b/.test(phrase))
    return { score: SOFT.noProcess, reasons: [], selected: false };
  switch (m.key) {
    case "beginner":
      // "Dont audition": a club saying so in those words ("non-audition group"), and performing
      // groups, before open clubs that never audition anyone anyway (Round 10).
      if (/audition|try ?outs?\b/.test(phrase)) {
        // Performers audition, teams hold tryouts.
        const asked = /audition/.test(phrase) ? /audition/ : /try ?out/;
        if (about && asked.test(about)) add(SOFT.saysProcess, null);
        const field = /audition/.test(phrase) ? PERFORMING : ["athletics-recreation"];
        if (field.some((s) => p.cats.has(s))) add(SOFT.category, null);
      }
      if (j.noExperience === true) add(SOFT.fact, { kind: "joining", text: "Says no experience needed" });
      if (j.access === "open") add(SOFT.open, { kind: "joining", text: "Open membership" });
      else if (j.noCuts) add(SOFT.noCuts, { kind: "joining", text: "Comp with no cuts" });
      if (selective && j.access !== "open" && j.noExperience !== true) add(SOFT.against, null);
      break;
    case "casual":
      if (j.access === "open") add(SOFT.open, { kind: "joining", text: "Open membership" });
      if (p.cats.has("hobbies-games")) add(SOFT.category, null);
      if (j.access === "process") add(SOFT.against, null);
      break;
    case "commitment": {
      const max = club.hoursPerWeek?.max ?? null;
      // Fewer stated hours first among them (a tie-break, not a tier).
      if (max !== null && max <= 5)
        add(SOFT.hours + (5 - max) * 0.2, {
          kind: "joining",
          text: `Says up to ${max} hour${max === 1 ? "" : "s"} a week`,
        });
      if (j.comp === true) add(SOFT.against, null);
      break;
    }
  }
  return { score, reasons, selected: reasons.length > 0 };
}

/**
 * The word to read as a name start when the query is a single process word ("comp",
 * "applications"), or null. PURE.
 */
export function processNameWord(text: string | null, eff: EffectiveQuery): string | null {
  const words = normalizeName(cleanQuery(text)).split(" ").filter(Boolean);
  if (words.length !== 1 || eff.constraints.length || !eff.soft.some((s) => s.modifier.process)) return null;
  return words[0]!;
}

/**
 * Whether a lone process word begins a longer first word of the club's name, "Harvard"
 * aside ("comp" → Harvard Computer Society; not Ballet *Comp*any). Postgres mirrors this
 * (`processNamePredicate`). PURE.
 */
export function processNameStarts(club: Pick<IndexClub, "searchNames">, w: string): boolean {
  return club.searchNames
    .split(" | ")
    .map(coreName)
    .some((c) => c.length > w.length && c.startsWith(w) && c[w.length] !== " ");
}

/**
 * The lift for such a name: just below a club that has the process ("comp": the Crimson and
 * the Advocate, which comp, before the Computer Society and the Composers).
 */
function processNameScore(club: IndexClub, w: string): number {
  return processNameStarts(club, w) ? PROCESS.mode - 1 : 0;
}

/** Weights of process words ("comp", "application", "deadline"): a lift, never a requirement. */
const PROCESS = {
  mode: 10,
  /** The club's process is the exact word asked for ("tryouts": tryout clubs before audition ones). */
  exactMode: 1,
  recruitingNow: 6,
  opensSoon: 4,
  deadlineAhead: 12,
  /** Extra for a deadline inside the asked window ("deadline this week"). */
  deadlineInWindow: 6,
  deadlineKnown: 4,
} as const;
const PROCESS_TEXT: Partial<Record<string, string>> = {
  comp: "Has a comp",
  application: "Has an application",
  audition: "Holds auditions",
  tryout: "Holds tryouts",
};

/**
 * How a process word ("comp", "audition", "deadline") lifts a club: a general-membership
 * process it names (ADR 0041; role-only processes don't count), a cycle recruiting now or
 * opening soon for such a club, and for "deadline" (no modes) a deadline ahead (more inside
 * the asked window) or known. Returns whether the club is selected when the query is only
 * process words: by `processSelects`, the rule Postgres mirrors.
 */
function processHit(
  live: IndexClub,
  process: NonNullable<SoftModifier["process"]>,
  now: Date,
  add: (n: number, r: MatchReason | null) => void,
): boolean {
  const { modes } = process;
  if (modes.length === 0) {
    const next = nextDeadline(live, now);
    if (next !== null) {
      const days = process.withinDays;
      const inWindow = days !== undefined && next - now.getTime() <= days * 86_400_000;
      add(PROCESS.deadlineAhead + (inWindow ? PROCESS.deadlineInWindow : 0), {
        kind: "joining",
        text: inWindow ? `Deadline in the next ${days} days` : "Has a deadline ahead",
      });
    } else if (live.cycles.some((c) => c.deadline))
      add(PROCESS.deadlineKnown, { kind: "joining", text: "Past deadlines known" });
    return processSelects(live, process);
  }
  const j = live.joining;
  const mode = modes.find((x) => live.joinModes.some((g) => g === x) || (x === "comp" && j.comp === true));
  if (mode)
    add(PROCESS.mode + (mode === modes[0] ? PROCESS.exactMode : 0), {
      kind: "joining",
      text: PROCESS_TEXT[mode] ?? "Selection process",
    });
  const cycle = live.currentCycle;
  if (cycle && (mode || cycle.processTypes.some((t) => modes.includes(t)))) {
    if (isRecruitingNow(cycle.status)) add(PROCESS.recruitingNow, { kind: "joining", text: "Recruiting now" });
    else if (cycle.status === "upcoming") add(PROCESS.opensSoon, { kind: "joining", text: "Recruiting opens soon" });
  }
  return processSelects(live, process);
}

/**
 * Which clubs a query of only process words shows: a general-membership process it names
 * (`joinModes`, or a stated comp for "comp"), or for "deadline" any known deadline.
 * Postgres mirrors this (`processPredicate` in search/provider.ts). PURE.
 */
export function processSelects(club: IndexClub, process: NonNullable<SoftModifier["process"]>): boolean {
  if (process.modes.length === 0) return club.cycles.some((c) => c.deadline);
  return process.modes.some((m) => club.joinModes.some((g) => g === m) || (m === "comp" && club.joining.comp === true));
}

/** Whether a query of only soft words ("low commitment", "comp") selects this club. PURE. */
export function softSelected(
  club: IndexClub,
  soft: EffectiveQuery["soft"],
  now: Date,
  live: IndexClub = club,
): boolean {
  return soft.some(({ modifier, phrase }) => softHit(club, modifier, now, live, phrase).selected);
}

/** A query as typed, without control characters (a pasted NUL or newline), trimmed and capped. */
export function cleanQuery(text: string | null | undefined): string {
  // eslint-disable-next-line no-control-regex -- removing control characters is the point
  const CONTROL = /[\u0000-\u001f\u007f-\u009f]+/g;
  return (text ?? "").replace(CONTROL, " ").trim().slice(0, MAX_QUERY_LENGTH);
}

export interface EffectiveQuery {
  /** Text left to search ("" when the query was only constraints). */
  text: string;
  filters: ClubFilters;
  /** The request's filters before constraint phrases were applied. */
  base: ClubFilters;
  constraints: QueryConstraint[];
  soft: { phrase: string; modifier: SoftModifier }[];
  /** Negated constraint phrases ("not recruiting"), dropped: no filter means their opposite. */
  negated: string[];
}

/**
 * The query as the directory runs it: constraint phrases become filters ("no comp finance"
 * → text "finance" + No comp) and soft words come out of the required text. Shared by
 * search, facet counts and relaxations so they agree. PURE.
 */
export function effectiveQuery(
  clubs: readonly IndexClub[],
  text: string | null,
  filters: ClubFilters,
  /** When given, "recruiting" with no round open anywhere reads as Still time to join. */
  now?: Date,
): EffectiveQuery {
  const raw = cleanQuery(text);
  if (!raw) return { text: "", filters, base: filters, constraints: [], soft: [], negated: [] };
  const q = interpretQuery(
    raw,
    (n) => isNamePhrase(clubs, n),
    (w) => FILLER.has(w),
    (n) => beginsNamePhrase(clubs, n),
  );
  // An hours limit already set as a filter (hours=N) wins over one typed in the box, so the
  // chip, the note and the results never disagree.
  let constraints = filters.maxHours !== null ? q.constraints.filter((c) => c.filter !== "maxHours") : q.constraints;
  // "recruiting", "open now" when no club in the directory has a round open (most of the
  // year): the filter would always be empty, so the phrase reads as Still time to join (a round
  // opening, open membership, rolling or a spring round ahead) and says so (`instead`).
  if (
    now &&
    !filters.recruitingNow &&
    constraints.some((c) => c.filter === "recruitingNow") &&
    !anyRecruitingNow(clubs, now)
  ) {
    const out: QueryConstraint[] = [];
    for (const c of constraints) {
      const next: QueryConstraint =
        c.filter === "recruitingNow" ? { ...c, filter: "stillTime", instead: "recruitingNow" } : c;
      if (!out.some((x) => x.filter === next.filter && x.season === next.season)) out.push(next);
    }
    constraints = out;
  }
  return {
    text: q.text,
    filters: { ...filters, ...constraintPatch(constraints) },
    base: filters,
    constraints,
    soft: q.soft,
    negated: q.negated,
  };
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
  const { now } = req;
  const eff = effectiveQuery(clubs, req.text, req.filters, req.now);
  const f = eff.filters;
  const text = eff.text;
  const query = text ? parseQueryIn(clubs, text) : null;

  const intentDef = f.intent ? INTENTS.find((i) => i.slug === f.intent) : undefined;
  const processName = query ? null : processNameWord(req.text, eff);
  const scored: { club: IndexClub; score: number; reasons: MatchReason[]; weak: boolean }[] = [];
  const partials: { club: IndexClub; score: number; m: ClubMatch }[] = [];
  const multi = (query?.units.length ?? 0) > 1;
  // A typed season ("what can I join in spring"): clubs that say when, in that season, first.
  const askedSeasons = eff.constraints.flatMap((c) => (c.filter === "recruitingSeason" && c.season ? [c.season] : []));
  let hiddenSparse = 0;
  for (const raw of clubs) {
    const c = liveClub(raw, now);
    // A club hidden by default (ended, graduate-school) still answers a search for its own
    // name, so old links and word of mouth find it (ADR 0038).
    if (!passesFilters(c, f, now) && !(text && namesClub(raw, text) && passesFilters(c, { ...f, ...SHOW_HIDDEN }, now)))
      continue;
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
    const reasons = m?.reasons ?? [];
    let score = m?.score ?? 0;
    if (intentDef?.rank) score += intentRank(c, intentDef);
    // Soft words only lift clubs that say them ("beginner-friendly"); they never exclude.
    // Soft words re-rank clubs matching the text; with no text, they select ("low commitment").
    // A club that matched only through its activity list ("music" among a cultural group's
    // events) is a passing mention: being open shouldn't lift it above clubs about the topic.
    // So is a club found only through a broad umbrella category ("Technology & Engineering"
    // for "coding"): "beginners" shouldn't lift Harvard Ventures above the Computer Society.
    // A specific category that is the topic itself (Dance for "dance") still counts.
    const passing =
      reasons.length > 0 &&
      reasons.every((r) => r.kind === "topics" || (r.kind === "category" && BROAD_CATEGORIES.has(r.slug)));
    let selected = false;
    for (const { modifier, phrase } of eff.soft) {
      const hit = softHit(raw, modifier, now, c, phrase);
      score += passing && hit.score > 0 ? hit.score * 0.3 : hit.score;
      selected ||= hit.selected;
      for (const r of hit.reasons) if (!reasons.some((x) => sameReason(x, r))) reasons.push(r);
    }
    // A process word typed alone may be a name on its way ("comp" → Computer Society): clubs
    // whose name has a word it begins follow the clubs it selects.
    const named = processName ? processNameScore(raw, processName) : 0;
    score += named;
    if (named) reasons.push({ kind: "name" });
    if (!query && eff.soft.length && !selected && !named) continue;
    if (askedSeasons.length) {
      const lift = seasonLift(c, askedSeasons, now);
      score += lift.score;
      if (lift.reason) reasons.push(lift.reason);
    }
    if (f.maxHours !== null && c.hoursPerWeek?.max != null) {
      const max = c.hoursPerWeek.max;
      // Fewer stated hours first among the clubs under the limit; said in the reason.
      score += (f.maxHours - max) * 0.1;
      reasons.push({ kind: "joining", text: `Says up to ${max} hour${max === 1 ? "" : "s"} a week` });
    }
    scored.push({ club: c, score, reasons, weak: m ? passingUnder(m, eff) : false });
  }

  // Under a constraint, a passing mention of the topic ("financial aid" for finance) is not
  // enough: when the topic has real matches, only those can answer "finance no comp".
  const constrained = eff.constraints.length > 0 && query !== null;
  let topic: TopicMatches | null = null;
  if (query && constrained && scored.some((x) => x.weak)) {
    topic = topicMatches(clubs, query, text, eff.base, req.categoryName, now);
    if (topic.strong >= STRONG_TOPIC_MIN) {
      for (let i = scored.length - 1; i >= 0; i--) if (scored[i]!.weak) scored.splice(i, 1);
    }
  }
  let relaxed: RelaxedConstraint[] = [];
  if (query && constrained && scored.length < FEW_RESULTS) {
    topic ??= topicMatches(clubs, query, text, eff.base, req.categoryName, now);
    relaxed = relaxConstraints(topic, eff, scored.length, now);
  }

  const byName = (a: IndexClub, b: IndexClub) =>
    a.name.toLowerCase().localeCompare(b.name.toLowerCase()) || a.id.localeCompare(b.id);
  const sort =
    req.sort === "relevance" &&
    !text &&
    !eff.soft.length &&
    !intentDef?.rank &&
    f.maxHours === null &&
    !askedSeasons.length
      ? "popularity"
      : req.sort;
  const day = featuredDay(now);
  const nullsLast = (a: number | null, b: number | null) => (a === b ? 0 : a === null ? 1 : b === null ? -1 : a - b);
  scored.sort((x, y) => {
    const a = x.club;
    const b = y.club;
    switch (sort) {
      case "relevance":
        return y.score - x.score || followersCompare(a, b) || byName(a, b);
      case "popularity":
        return popularityCompare(a, b, now, day) || byName(a, b);
      case "featured":
        return featuredCompare(a, b, now, day) || byName(a, b);
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
  const queryParts = query ? query.units.map(unitText) : [];
  const partial =
    scored.length === 0 && query && multi
      ? partials
          .sort((a, b) => b.m.matchedUnits - a.m.matchedUnits || b.score - a.score || byName(a.club, b.club))
          .map(({ club }) => ({
            club,
            matched: query.units.flatMap((u, i) => {
              const hit = unitHit(club, prepare(club), u, query, req.categoryName ?? ((s) => s));
              return hit ? [queryParts[i]!] : [];
            }),
          }))
          // A one- or two-letter fragment ("fi" of "sci-fi"), or a word we guessed from a typo
          // ("potter" read as "porter"), alone isn't a partial match.
          .filter((x) => x.matched.some((part) => part.length >= 3 && !query.fixes.has(part)))
          .slice(0, PARTIAL_LIMIT)
      : [];
  return {
    total: scored.length,
    hiddenSparse,
    clubs: page.map((s) => s.club),
    reasons: Object.fromEntries(page.map((s) => [s.club.id, s.reasons])),
    corrected: query?.corrected ?? null,
    concepts: query ? flatUnits(query.units).flatMap((u) => (u.kind === "concept" ? [u.concept] : [])) : [],
    partial,
    queryParts,
    constraints: eff.constraints,
    soft: eff.soft.filter((x) => !x.modifier.process).map((x) => x.phrase),
    process: eff.soft.filter((x) => x.modifier.process).map((x) => x.phrase),
    searchedText: text,
    negated: eff.negated,
    relaxed,
  };
}

/**
 * Whether a constrained query leaves out passing mentions of its topic: true when the
 * topic has enough real matches. Facet counts use it so they agree with the results. PURE.
 */
export function dropsPassingMentions(
  clubs: readonly IndexClub[],
  eff: EffectiveQuery,
  query: ParsedQuery | null,
  now: Date,
): boolean {
  if (!query || eff.constraints.length === 0) return false;
  return topicMatches(clubs, query, eff.text, eff.base, undefined, now).strong >= STRONG_TOPIC_MIN;
}

/** Matched only through its activity list ("HDC Consulting" among a debate team's programs). */
function listedOnly(m: ClubMatch): boolean {
  return m.reasons.length > 0 && m.reasons.every((r) => r.kind === "topics");
}

/**
 * A passing mention, as a constrained query reads it: a related word in a description
 * (`ClubMatch.weak`), or, under a constraint, only the activity list (Round 10: "consulting
 * still recruiting" isn't the Debate Council for its "HDC Consulting" program). PURE.
 */
export function passingUnder(m: ClubMatch, eff: EffectiveQuery): boolean {
  return m.weak || (eff.constraints.length > 0 && listedOnly(m));
}

interface TopicMatches {
  /** Full text matches, each flagged when it is only a passing mention. */
  matched: { club: IndexClub; weak: boolean }[];
  /** Strong matches under the request's own filters (constraint phrases not applied). */
  strong: number;
}

/**
 * Every club the text alone finds (live view), and how many are real matches under the
 * request's own filters: what "show all" would show. Computed only for a constrained query
 * that has a passing mention or came back short. PURE.
 */
function topicMatches(
  clubs: readonly IndexClub[],
  query: ParsedQuery,
  text: string,
  base: ClubFilters,
  categoryName: ((slug: string) => string) | undefined,
  now: Date,
): TopicMatches {
  const multi = query.units.length > 1;
  const matched: TopicMatches["matched"] = [];
  for (const raw of clubs) {
    const m = matchClub(raw, query, text, categoryName, multi);
    if (!m || m.matchedUnits < query.units.length) continue;
    matched.push({ club: liveClub(raw, now), weak: m.weak || listedOnly(m) });
  }
  const strong = matched.filter(
    (x) => !x.weak && passesFilters(x.club, base, now) && !(base.hideSparse && isSparseClub(x.club)),
  ).length;
  return { matched, strong };
}

/** One entry per constraint whose removal shows many more clubs than the constrained result. */
function relaxConstraints(topic: TopicMatches, eff: EffectiveQuery, total: number, now: Date): RelaxedConstraint[] {
  const out: RelaxedConstraint[] = [];
  for (const c of eff.constraints) {
    // A constraint the request itself already carried can't be relaxed away by the text.
    if (baseHasConstraint(eff.base, c)) continue;
    const filters = withoutConstraint(eff.filters, eff.base, c);
    const list = topic.matched.filter(
      // Everything "show all" would show: passing mentions included, as the plain text search does.
      (x) => passesFilters(x.club, filters, now) && !(filters.hideSparse && isSparseClub(x.club)),
    );
    if (list.length < STRONG_TOPIC_MIN || list.length <= total) continue;
    const noCuts =
      c.filter === "noComp"
        ? list
            .filter((x) => x.club.joining.noCuts && !x.weak)
            .slice(0, 3)
            .map((x) => ({ slug: x.club.slug, name: x.club.name }))
        : [];
    out.push({
      ...(noCuts.length ? { noCuts } : {}),
      constraint: c.filter,
      phrase: c.phrase,
      ...(c.value === undefined ? {} : { value: c.value }),
      ...(c.season ? { season: c.season } : {}),
      without: list.length,
      unknown: list.filter((x) => dontSay(x.club, c.filter, now)).length,
    });
  }
  return out;
}
