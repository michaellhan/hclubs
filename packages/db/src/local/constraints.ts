import { normalizeName } from "@hci/core/browser";

/**
 * Constraint phrases in a search query (ADR 0034, amended): "no comp finance",
 * "clubs for freshmen", "still recruiting", "social no application". These say *which
 * clubs may show*, not what a club's page says, so matching them as text found clubs whose
 * description happened to contain "no" and "comp" (and "easy" was corrected to "east").
 * Each phrase maps to one of the directory's existing yes/no/unknown filters, which reads
 * the derived joining facts (ADR 0041): unknown is never read as yes. The caller applies
 * the filter and says so ("Read “no comp” as the No comp filter").
 *
 * Soft modifiers ("casually", "beginner", "low commitment") are things clubs rarely state
 * and no filter covers: beside a topic they stop being required words and re-rank ("dance
 * beginner" finds every dance club, beginner-friendly and open ones first); alone they
 * select the clubs whose text or joining facts answer them.
 *
 * A phrase that is part of a club's name is the name ("First-Year Outdoor Program"), so the
 * caller skips this parse when the query is a phrase of a club name. PURE, browser-safe.
 */

/** The directory filters a phrase can turn on (keys of `ClubFilters`). */
export type ConstraintFilter =
  "freshmenEligible" | "openJoin" | "noComp" | "noDues" | "noExperience" | "recruitingNow" | "maxHours";

export interface QueryConstraint {
  filter: ConstraintFilter;
  /** The words as typed (normalized), for "Read “no comp” as …". */
  phrase: string;
  /** `maxHours` only: the most hours a week the club may state ("under 3 hours a week" → 3). */
  value?: number;
}

/** The `ClubFilters` fields a list of constraints turns on. PURE. */
export function constraintPatch(constraints: readonly QueryConstraint[]): {
  [K in ConstraintFilter]?: K extends "maxHours" ? number : true;
} {
  const patch: { [K in ConstraintFilter]?: K extends "maxHours" ? number : true } = {};
  for (const c of constraints) {
    if (c.filter === "maxHours") {
      if (c.value !== undefined) patch.maxHours = c.value;
    } else patch[c.filter] = true;
  }
  return patch;
}

/** "A few hours a week" is read as up to this many (the soft "low commitment" rule uses 5 too). */
export const FEW_HOURS = 5;

const NUMBER_WORDS: Record<string, number> = {
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  twelve: 12,
  fifteen: 15,
  twenty: 20,
};
const HOURS_UNIT = new Set(["hour", "hours", "hr", "hrs"]);
const WEEK_WORDS = new Set(["week", "weekly", "wk"]);
/** Words between the unit and "week" ("hours *a* week", "hours *per* week"). */
const HOURS_FILLER = new Set(["a", "per", "each", "every", "in", "of"]);
/** Leads that mean "at most": token sequences, longest first. */
const HOURS_LEADS: string[][] = [
  ["no", "more", "than"],
  ["at", "most"],
  ["less", "than"],
  ["fewer", "than"],
  ["up", "to"],
  ["under"],
  ["below"],
  ["within"],
  ["max"],
  ["maximum"],
  ["upto"],
];

const asNumber = (t: string | undefined): number | null => {
  if (!t) return null;
  if (/^\d{1,2}$/.test(t)) return Number(t);
  return NUMBER_WORDS[t] ?? null;
};

/** Index after an optional "(a|per) week" following the hours unit at `k`. */
function afterWeek(tokens: readonly string[], k: number): { end: number; week: boolean } {
  let j = k;
  while (HOURS_FILLER.has(tokens[j] ?? "")) j++;
  return WEEK_WORDS.has(tokens[j] ?? "") ? { end: j + 1, week: true } : { end: k, week: false };
}

/**
 * An hours-a-week limit at token `i`: "under 3 hours a week", "less than 5 hours", "at most
 * 4 hrs per week", "3 hours a week or less", "a few hours a week". Returns the tokens it
 * spans and the limit, or null. A bare "3 hours" is not a limit, and "few hours" without
 * "a week" stays the soft "low commitment" word. PURE.
 */
export function hoursLimitAt(tokens: readonly string[], i: number): { n: number; value: number } | null {
  const lead = HOURS_LEADS.find((l) => l.every((w, k) => tokens[i + k] === w));
  if (lead) {
    const at = i + lead.length;
    const v = asNumber(tokens[at]);
    if (v === null || v < 1 || !HOURS_UNIT.has(tokens[at + 1] ?? "")) return null;
    return { n: afterWeek(tokens, at + 2).end - i, value: v };
  }
  const v = asNumber(tokens[i]);
  if (v !== null && v >= 1 && HOURS_UNIT.has(tokens[i + 1] ?? "")) {
    const { end } = afterWeek(tokens, i + 2);
    if (tokens[end] === "or" && (tokens[end + 1] === "less" || tokens[end + 1] === "fewer"))
      return { n: end + 2 - i, value: v };
    return null;
  }
  const start = tokens[i] === "a" ? i + 1 : i;
  const amount = tokens[start] === "few" ? FEW_HOURS : tokens[start] === "couple" ? 3 : 0;
  if (amount && HOURS_UNIT.has(tokens[start + 1] ?? "")) {
    const { end, week } = afterWeek(tokens, start + 2);
    if (week) return { n: end - i, value: amount };
  }
  return null;
}

export interface InterpretedQuery {
  /** The query without its constraint phrases and soft modifiers ("finance"). */
  text: string;
  constraints: QueryConstraint[];
  /** Soft modifiers: beside a topic they re-rank; with no other text they select. */
  /** Negated constraints ("not recruiting"): no filter covers them, so they were dropped. */
  negated: string[];
  soft: { phrase: string; modifier: SoftModifier }[];
}

const FILTER_PHRASES: Record<Exclude<ConstraintFilter, "maxHours">, string[]> = {
  freshmenEligible: [
    "freshmen",
    "freshman",
    "frosh",
    "first years",
    "first year students",
    "first year student",
    "firstyears",
    "freshmen friendly",
    "freshman friendly",
    "first year friendly",
  ],
  noComp: [
    "no comp",
    "nocomp",
    "no comps",
    "no comping",
    "non comp",
    "noncomp",
    "comp free",
    "without comp",
    "without comping",
    "dont require comp",
    "doesnt require comp",
    "dont need comp",
    "no comp required",
    "no comp needed",
  ],
  openJoin: [
    "no application",
    "no applications",
    "no app",
    "no apps",
    "no applying",
    "without application",
    "without applying",
    "dont require application",
    "doesnt require application",
    "no application required",
    "no application needed",
    "open membership",
    "open to all",
    "open to everyone",
    "anyone can join",
    "join anytime",
    "easy to join",
    "easy to get into",
    "not selective",
    "non selective",
    "nonselective",
    "unselective",
    "no selection",
  ],
  noDues: [
    "no dues",
    "nodues",
    "without dues",
    "without fees",
    "without fee",
    "no dues required",
    "free to join",
    "no fees",
    "no fee",
    "no membership fee",
    "no membership fees",
    "no cost",
  ],
  // Explicit "no experience needed" wording only; bare "beginner"/"novice"/"no experience"
  // stay soft words (clubs rarely say it, so the filter would be nearly empty).
  noExperience: [
    "no experience needed",
    "no experience required",
    "no experience necessary",
    "no prior experience",
    "no prior experience needed",
    "no prior experience required",
    "no previous experience",
    "experience not required",
    "experience not needed",
    "without experience",
    "without prior experience",
  ],
  recruitingNow: [
    "recruiting",
    "recruiting now",
    "still recruiting",
    "currently recruiting",
    "now recruiting",
    "accepting applications",
    "taking applications",
    "applications open",
    "open applications",
    "apply now",
    "still accepting",
    "accepting members",
    "taking new members",
  ],
};

/**
 * Soft modifiers: things clubs rarely state and no filter covers. Each group lists the
 * query phrases and the words that answer it in a club's description or activities; the
 * search adds the joining facts that answer it too (ADR 0041: open membership, no cuts,
 * "no experience needed", stated hours). Beside a topic they re-rank; alone they select.
 */
export interface SoftModifier {
  key: "casual" | "beginner" | "commitment";
  phrases: string[];
  /** Normalized words/phrases in a club's text that answer it. */
  says: string[];
}
export const SOFT_MODIFIERS: readonly SoftModifier[] = [
  {
    key: "casual",
    phrases: [
      "casual",
      "casually",
      "easy going",
      "easygoing",
      "for fun",
      "just for fun",
      "fun",
      "low key",
      "lowkey",
      "chill",
      "relaxed",
      "laid back",
    ],
    says: ["casual", "casually", "for fun", "low key", "relaxed", "laid back", "no pressure", "drop in"],
  },
  {
    key: "beginner",
    phrases: [
      // Bare "easy" is a soft word, not Open membership: "easy finance" left 0 clubs, and
      // "easy" can mean low effort as much as no selection.
      "easy",
      "beginner",
      "beginners",
      "beginner friendly",
      "novice",
      "novices",
      "newbie",
      "newbies",
      "no experience",
      "non audition",
      "no audition",
      "no auditions",
      "without audition",
      "no tryout",
      "no tryouts",
    ],
    says: [
      "beginner",
      "beginners",
      "novice",
      "novices",
      "no experience",
      "no prior experience",
      "all levels",
      "all skill levels",
      "all experience levels",
      "non audition",
      "no audition",
      "without audition",
      "open to all",
    ],
  },
  {
    key: "commitment",
    phrases: [
      "low commitment",
      "low time commitment",
      "small commitment",
      "little commitment",
      "light commitment",
      "minimal commitment",
      "flexible commitment",
      "low time",
      "few hours",
      "not much time",
      "little time",
      "not time consuming",
    ],
    says: ["low commitment", "low time commitment", "flexible", "drop in", "no commitment", "minimal commitment"],
  },
];

/** Words skipped inside a phrase ("no *a* comp", "without *an* application"). */
const ARTICLES = new Set(["a", "an", "the", "any"]);
/** Words that only introduce a constraint ("clubs *that are* open to all", "*for* freshmen"). */
const CONNECTORS = new Set([
  "for",
  "that",
  "which",
  "who",
  "with",
  "are",
  "is",
  "open",
  "to",
  "take",
  "accept",
  "still",
]);

/** Words that negate the constraint right after them ("not recruiting", "no freshmen"). */
const NEGATORS = new Set(["not", "no", "non", "isnt", "arent", "dont", "doesnt", "never", "without", "except"]);
/** Words left over beside a constraint that say nothing about a club ("freshmen *only*"). */
const LEFTOVER = new Set(["only", "just", "ones", "please", "good", "best", "great", "cool", "any", "some"]);

interface Pattern {
  words: string[];
  filter: ConstraintFilter | null;
  soft?: SoftModifier;
}
const PATTERNS: Pattern[] = [
  ...Object.entries(FILTER_PHRASES).flatMap(([filter, phrases]) =>
    phrases.map((p) => ({ words: p.split(" "), filter: filter as ConstraintFilter })),
  ),
  ...SOFT_MODIFIERS.flatMap((m) => m.phrases.map((p) => ({ words: p.split(" "), filter: null, soft: m }))),
  // Longest first, so "no comp required" wins over "no comp".
].sort((a, b) => b.words.length - a.words.length);

/** Length in tokens of `p` matched at `i` (articles skipped), or 0. */
function matchAt(tokens: readonly string[], i: number, p: Pattern): number {
  let j = i;
  for (const w of p.words) {
    while (j < tokens.length && ARTICLES.has(tokens[j]!) && w !== tokens[j]) j++;
    if (tokens[j] !== w) return 0;
    j++;
  }
  return j - i;
}

/**
 * Split constraint phrases and soft modifiers out of a query. `isName` says whether a
 * normalized query is (part of) a club's name; then nothing is split out. PURE.
 */
export function interpretQuery(
  text: string,
  isName: (normalized: string) => boolean = () => false,
  isFiller: (word: string) => boolean = () => false,
): InterpretedQuery {
  const norm = normalizeName(text);
  const none: InterpretedQuery = { text, constraints: [], soft: [], negated: [] };
  if (!norm || isName(norm)) return none;
  const tokens = norm.split(" ");
  const keep: string[] = [];
  const constraints: QueryConstraint[] = [];
  const soft: InterpretedQuery["soft"] = [];
  const negated: string[] = [];
  for (let i = 0; i < tokens.length;) {
    let hit: { p: Pattern; n: number; value?: number } | null = null;
    const hours = hoursLimitAt(tokens, i);
    if (hours) hit = { p: { words: [], filter: "maxHours" }, n: hours.n, value: hours.value };
    else
      for (const p of PATTERNS) {
        const n = matchAt(tokens, i, p);
        if (n) {
          hit = { p, n };
          break;
        }
      }
    if (!hit) {
      keep.push(tokens[i]!);
      i++;
      continue;
    }
    const phrase = tokens.slice(i, i + hit.n).join(" ");
    // Drop the words that only introduced it ("clubs that are | open to all").
    while (keep.length && CONNECTORS.has(keep[keep.length - 1]!)) keep.pop();
    // A negated constraint ("not recruiting", "not for freshmen") has no filter: never read
    // it as the affirmative one. Both words leave the text; the caller can say so.
    if (keep.length && NEGATORS.has(keep[keep.length - 1]!)) {
      negated.push(`${keep.pop()!} ${phrase}`);
      i += hit.n;
      continue;
    }
    if (hit.p.filter) {
      if (!constraints.some((c) => c.filter === hit.p.filter))
        constraints.push(
          hit.value === undefined
            ? { filter: hit.p.filter, phrase }
            : { filter: hit.p.filter, phrase, value: hit.value },
        );
    } else if (hit.p.soft && !soft.some((x) => x.modifier === hit.p.soft)) soft.push({ phrase, modifier: hit.p.soft });
    i += hit.n;
  }
  const read = constraints.length > 0 || soft.length > 0 || negated.length > 0;
  const rest = keep.filter((w) => !(read && LEFTOVER.has(w))).join(" ");
  const meaningful = rest.split(" ").some((w) => w && !CONNECTORS.has(w) && !ARTICLES.has(w) && !isFiller(w));
  if (!meaningful && !read) return none;
  // Beside a topic, soft words re-rank; alone ("low commitment") they are what's searched.
  return { text: meaningful ? rest : "", constraints, soft, negated };
}
