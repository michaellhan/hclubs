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
export type ConstraintFilter = "freshmenEligible" | "openJoin" | "noComp" | "noDues" | "recruitingNow";

export interface QueryConstraint {
  filter: ConstraintFilter;
  /** The words as typed (normalized), for "Read “no comp” as …". */
  phrase: string;
}

export interface InterpretedQuery {
  /** The query without its constraint phrases and soft modifiers ("finance"). */
  text: string;
  constraints: QueryConstraint[];
  /** Soft modifiers: beside a topic they re-rank; with no other text they select. */
  soft: { phrase: string; modifier: SoftModifier }[];
}

const FILTER_PHRASES: Record<ConstraintFilter, string[]> = {
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
    "easy",
    "not selective",
    "non selective",
    "nonselective",
    "unselective",
    "no selection",
  ],
  noDues: ["no dues", "free to join", "no fees", "no fee", "no membership fee", "no membership fees", "no cost"],
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
      "beginner",
      "beginners",
      "beginner friendly",
      "novice",
      "novices",
      "newbie",
      "newbies",
      "no experience",
      "no experience needed",
      "no experience required",
      "no prior experience",
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
  const none = { text, constraints: [], soft: [] };
  if (!norm || isName(norm)) return none;
  const tokens = norm.split(" ");
  const keep: string[] = [];
  const constraints: QueryConstraint[] = [];
  const soft: InterpretedQuery["soft"] = [];
  for (let i = 0; i < tokens.length;) {
    let hit: { p: Pattern; n: number } | null = null;
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
    if (hit.p.filter) {
      if (!constraints.some((c) => c.filter === hit.p.filter)) constraints.push({ filter: hit.p.filter, phrase });
    } else if (hit.p.soft && !soft.some((x) => x.modifier === hit.p.soft)) soft.push({ phrase, modifier: hit.p.soft });
    i += hit.n;
  }
  const rest = keep.join(" ");
  const meaningful = rest.split(" ").some((w) => w && !CONNECTORS.has(w) && !ARTICLES.has(w) && !isFiller(w));
  if (!meaningful && constraints.length === 0 && soft.length === 0) return none;
  // Beside a topic, soft words re-rank; alone ("low commitment") they are what's searched.
  return { text: meaningful ? rest : "", constraints, soft };
}
