import { normalizeName, SELECTIVE_JOIN_MODES, type JoinMode, type RecruitingSeason } from "@hci/core/browser";
import { CONCEPT_BY_TERM, SHORTHANDS } from "./concepts";
import type { ClubFilters } from "./filters";
import { joinTermText, type ConstraintFilter, type JoinTerm, type QueryConstraint } from "./basics";

/**
 * Constraint phrases in a search query (ADR 0034, amended): "no comp finance",
 * "still recruiting", "social no application". These say *which
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

/** The request's filters without one constraint's filter (for "show all" counts). PURE. */
export function withoutConstraint(filters: ClubFilters, base: ClubFilters, c: QueryConstraint): ClubFilters {
  switch (c.filter) {
    case "maxHours":
      return { ...filters, maxHours: null };
    case "recruitingSeason":
      return { ...filters, recruitingSeasons: base.recruitingSeasons };
    default:
      return { ...filters, [c.filter]: false };
  }
}

/** Whether the request itself already carried the constraint's filter (it can't be relaxed away). */
export function baseHasConstraint(base: ClubFilters, c: QueryConstraint): boolean {
  if (c.filter === "maxHours") return base.maxHours !== null;
  if (c.filter === "recruitingSeason") return c.season !== undefined && base.recruitingSeasons.includes(c.season);
  return base[c.filter];
}

/**
 * Question and helper words ("what is a comp", "when are auditions", "how do i join"): they
 * say a question is being asked, never which club. They are never spelling-corrected ("what"
 * had become "wha", "still" "skill", "when" "ween") and never required text; a query of only
 * these words (with a question word) is the plain browse list.
 */
export const QUESTION_WORDS: ReadonlySet<string> = new Set(
  "what whats when whens where wheres how hows who whos which why".split(" "),
);
/** Words that ask how to get in ("clubs to join"): with only filler beside them, the browse list. */
const JOIN_WORDS: ReadonlySet<string> = new Set(["join", "joining"]);
/**
 * English function words and contractions (apostrophes are gone after normalizing: "don't" is
 * "dont"). Round 10: they had been "corrected" into club words ("that" → "thai", "dont" →
 * "done", "much" → "mich", "this" → "thin") and then required. None is a word of a club's
 * name, except as part of a phrase the name check keeps whole.
 */
const FUNCTION_WORDS =
  "that thats this these those much many dont doesnt didnt cant cannot wont isnt arent wasnt ive youre theyre lets need needs want wants wanted take takes it its there they them their any some very really just so if than then has have had got lot lots kind sort into ones being been might may must ever least rate rates".split(
    " ",
  );
export const STOP_WORDS: ReadonlySet<string> = new Set([
  ...QUESTION_WORDS,
  ..."is are am was were be does did could should would will you your still i im me my can do".split(" "),
  ...FUNCTION_WORDS,
]);
/**
 * Words that, in a question ("how much *time* does the Crimson take", "how *long* is the
 * comp"), ask about a club's commitment rather than name a topic: filler then.
 */
const QUESTION_TOPIC_WORDS: ReadonlySet<string> = new Set(["time", "long", "hours", "hour", "commitment"]);

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
/** Words between a range's two amounts ("3 *to* 5 hours"); a dash is gone after normalizing. */
const RANGE_SEPARATORS = new Set(["to", "or", "and"]);
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
  // Capped at the hours filter's limit: "under 1000 hours" still means "any stated amount".
  if (/^\d{1,4}$/.test(t)) return Math.min(Number(t), 100);
  return NUMBER_WORDS[t] ?? null;
};

/** An hours range starting at token `s` ("3 5 hours", "3 to 5 hrs"): its top and where its unit is. */
function rangeAt(tokens: readonly string[], s: number): { top: number; unitAt: number; sep: boolean } | null {
  const low = asNumber(tokens[s]);
  if (low === null || low < 1) return null;
  const sep = RANGE_SEPARATORS.has(tokens[s + 1] ?? "") ? 1 : 0;
  const top = asNumber(tokens[s + 1 + sep]);
  const unitAt = s + 2 + sep;
  return top !== null && top >= low && HOURS_UNIT.has(tokens[unitAt] ?? "") ? { top, unitAt, sep: sep === 1 } : null;
}

/** Normalizing dropped the dash: say "3-5 hours a week", not "3 5 hours a week". */
function rangePhrase(
  tokens: readonly string[],
  i: number,
  s: number,
  range: { unitAt: number; sep: boolean },
  end: number,
): { phrase?: string } {
  if (range.sep) return {};
  return {
    phrase: [...tokens.slice(i, s), `${tokens[s]}-${tokens[s + 1]}`, ...tokens.slice(range.unitAt, end)].join(" "),
  };
}

/** Index after an optional "(a|per) week" following the hours unit at `k`. */
function afterWeek(tokens: readonly string[], k: number): { end: number; week: boolean } {
  let j = k;
  while (HOURS_FILLER.has(tokens[j] ?? "")) j++;
  return WEEK_WORDS.has(tokens[j] ?? "") ? { end: j + 1, week: true } : { end: k, week: false };
}

/**
 * An hours-a-week limit at token `i`: "under 3 hours a week", "less than 5 hours", "at most
 * 4 hrs per week", "3 hours a week or less", "a few hours a week". Returns the tokens it
 * spans and the limit, or null. "3 hours a week" (or "3 hours" as the whole query) is read
 * as at most 3, a range ("3-5 hours a week", "3 to 5 hours") as at most its top; "3 hours"
 * beside other words is not a limit, and "few hours" without "a week"
 * stays the soft "low commitment" word. PURE.
 */
export function hoursLimitAt(
  tokens: readonly string[],
  i: number,
  /** False when the query asks for a minimum ("at least", "10+"): a bare amount isn't a cap then. */
  bareIsLimit = true,
): { n: number; value: number; phrase?: string } | null {
  const lead = HOURS_LEADS.find((l) => l.every((w, k) => tokens[i + k] === w));
  if (lead) {
    const at = i + lead.length;
    // "under 3-5 hours", "up to 3 to 5 hours": the range's top.
    const range = rangeAt(tokens, at);
    if (range) {
      const end = afterWeek(tokens, range.unitAt + 1).end;
      return { n: end - i, value: range.top, ...rangePhrase(tokens, i, at, range, end) };
    }
    const v = asNumber(tokens[at]);
    if (v === null || v < 1 || !HOURS_UNIT.has(tokens[at + 1] ?? "")) return null;
    return { n: afterWeek(tokens, at + 2).end - i, value: v };
  }
  const v = asNumber(tokens[i]);
  // A range ("3-5 hours a week", "3 to 5 hours", "3 or 4 hrs"): a budget whose top is the
  // limit. The whole phrase is consumed, so "3" never stays behind as text. Ranges read as
  // a budget beside other words too ("chess 3-5 hours"), unlike a bare amount; a query that
  // asks for a minimum ("at least 3-5 hours") still sets no cap.
  const s = tokens[i] === "between" ? i + 1 : i;
  const range = rangeAt(tokens, s);
  if (range) {
    if (!bareIsLimit) return null;
    const end = afterWeek(tokens, range.unitAt + 1).end;
    return { n: end - i, value: range.top, ...rangePhrase(tokens, i, s, range, end) };
  }
  if (v !== null && v >= 1 && HOURS_UNIT.has(tokens[i + 1] ?? "")) {
    const { end, week } = afterWeek(tokens, i + 2);
    if (tokens[end] === "or" && (tokens[end + 1] === "less" || tokens[end + 1] === "fewer"))
      return { n: end + 2 - i, value: v };
    // "3 hours a week" is a student's budget; so is "3 hours" typed on its own. A bare
    // amount beside other words ("24 hours of code") is not.
    if (bareIsLimit && (week || (i === 0 && tokens.length === end))) return { n: end - i, value: v };
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
  /**
   * Definitions the query asks for ("what's a comp", "what does punch mean"): one sentence each,
   * worded as /about#joining (`JOIN_TERMS`). Empty unless the query asks.
   */
  notes: string[];
}

/** Words that ask what a word means. */
const DEFINE_WORDS: ReadonlySet<string> = new Set([
  "what",
  "whats",
  "mean",
  "means",
  "meaning",
  "define",
  "definition",
  "explain",
]);
/** Each joining word's forms, as typed and normalized. */
const JOIN_TERM_FORMS: readonly [JoinTerm, readonly string[]][] = [
  ["comp", ["comp", "comps", "comping", "comped"]],
  ["punch", ["punch", "punches", "punched", "punch process", "punching season"]],
  ["audition", ["audition", "auditions", "auditioning"]],
  ["tryout", ["tryout", "tryouts", "try out", "try outs"]],
];

/**
 * The joining words a question asks the meaning of ("whats a comp" → comp), in query order.
 * Only with a word that asks ("what", "mean", "define"): "comp finance" defines nothing. PURE.
 */
export function definitionsAsked(tokens: readonly string[]): JoinTerm[] {
  if (!tokens.some((t) => DEFINE_WORDS.has(t))) return [];
  const out: JoinTerm[] = [];
  for (let i = 0; i < tokens.length; i++) {
    // "comp lit", "comp sci": a subject, not the process.
    if (startsConceptPhrase(tokens, i) || SHORTHANDS.has(`${tokens[i]} ${tokens[i + 1]}`)) continue;
    for (const [key, forms] of JOIN_TERM_FORMS)
      if (!out.includes(key) && forms.some((f) => f.split(" ").every((w, k) => tokens[i + k] === w))) out.push(key);
  }
  return out;
}

/**
 * "dont need experience", "doesnt require applications", "i dont want to comp": a negated
 * verb before what the club asks of members. Apostrophes are gone ("don't" → "dont"), and
 * articles inside are skipped by the matcher ("don't require an application"). PURE.
 */
const NEGATED_VERBS = ["dont", "doesnt", "do not", "does not", "wont", "will not"];
function negatedAsks(verbs: readonly string[], objects: readonly string[]): string[] {
  return NEGATED_VERBS.flatMap((n) => verbs.flatMap((v) => objects.map((o) => `${n} ${v} ${o}`)));
}
const ASK_VERBS = ["need", "require", "requires", "have", "ask for", "want"];

const FILTER_PHRASES: Record<Exclude<ConstraintFilter, "maxHours" | "recruitingSeason">, string[]> = {
  noComp: [
    // "i dont want to comp", "dont have to comp", "dont require a comp"
    ...negatedAsks([...ASK_VERBS, "want to", "have to", "need to"], ["comp", "comps", "comping"]),
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
    // "dont require applications", "doesnt need an application", "dont have to apply"
    ...negatedAsks(
      [...ASK_VERBS, "have to", "need to", "want to"],
      ["application", "applications", "app", "apps", "apply", "applying"],
    ),
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
    "dont need application",
    "dont need applications",
    "dont need an application",
    "doesnt need an application",
    "dont need to apply",
    "no need to apply",
    "dont have to apply",
    "dont have applications",
    "dont have an application",
    "open membership",
    "open to all",
    "open to everyone",
    "anyone can join",
    "easy to join",
    "easy to get into",
    "not selective",
    "non selective",
    "nonselective",
    "unselective",
    "no selection",
    // Round 11: the low end of selectivity is the Open membership filter, never a ranking.
    "least selective",
    "less selective",
    "least competitive",
    "less competitive",
    "not competitive",
    "non competitive",
    "noncompetitive",
    "not exclusive",
    "not hard to get into",
    "easy to get in",
    "easiest to get into",
    "easiest to join",
  ],
  noDues: [
    "no dues",
    "nodues",
    "without dues",
    "without fees",
    "without fee",
    "no dues required",
    "free to join",
    "free clubs",
    "free club",
    "free organizations",
    "no fees",
    "no fee",
    "no membership fee",
    "no membership fees",
    "no cost",
  ],
  // Explicit "no experience needed" wording only; bare "beginner"/"novice"/"no experience"
  // stay soft words (clubs rarely say it, so the filter would be nearly empty).
  noExperience: [
    // "clubs that dont need experience", "doesnt require prior experience", "i dont have experience"
    ...negatedAsks(ASK_VERBS, ["experience", "prior experience", "previous experience"]),
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
    "open now",
    "open right now",
    "still accepting",
    "accepting members",
    "taking new members",
  ],
  // What a student who missed a round asks ("clubs i can still join", "join now"): a round
  // open or opening, open membership or rolling recruiting (`matchesStillTime`), not only a
  // round open today.
  stillTime: [
    // "join a publication this semester": the term is now, wherever the words sit.
    "this semester",
    "this term",
    "join now",
    "join right now",
    "still join",
    "still open",
    "still time",
    "still time to join",
    "join this semester",
    "join this term",
    "join this year",
    "join later",
    "join anytime",
    "join any time",
    "join at any time",
    "join whenever",
    "late join",
    "still get in",
    // Round 11: joining partway through a term ("join mid semester", "can i join late").
    "mid semester",
    "midsemester",
    "mid term",
    "mid year",
    "midyear",
    "join late",
    "joining late",
    "join in the middle",
    "late joiners",
  ],
};

/**
 * Soft modifiers: things clubs rarely state and no filter covers. Each group lists the
 * query phrases and the words that answer it in a club's description or activities; the
 * search adds the joining facts that answer it too (ADR 0041: open membership, no cuts,
 * "no experience needed", stated hours). Beside a topic they re-rank; alone they select.
 */
export interface SoftModifier {
  key: "casual" | "beginner" | "commitment" | "classYear" | ProcessKey;
  /**
   * Class years a "classYear" word asks about ("sophomores" → sophomore): a club stating
   * that it takes them lifts; one stating a list without them follows (unknown is neither).
   */
  classes?: readonly ("sophomore" | "junior" | "senior")[];
  /**
   * The filter this word reads as when nothing else was typed: a lone "transfer" asks what a
   * transfer student can still join (Still time to join); beside a topic it only re-ranks.
   */
  alone?: ConstraintFilter;
  /**
   * One quiet sentence the directory shows when the word was read ("selective": we only know
   * which clubs have a selection step, never how hard any is to get into; §9).
   */
  note?: string;
  phrases: string[];
  /** Normalized words/phrases in a club's text (or `IndexClub.pace`) that answer it. */
  says: string[];
  /** Phrases in a club's text or pace that say the opposite ("weekly" for "no weekly meetings"). */
  against?: string[];
  /**
   * Process words ("comp", "application", "deadline"): how a student asks about joining, not
   * what a club's page says. They are never required text ("newspaper comp" isn't "newspaper"
   * + a page saying "compiling"); they lift clubs whose joining facts or recruiting dates
   * answer them, and alone select those clubs. `modes` are the general-membership processes
   * that answer it (none for "deadline", which reads recruiting dates).
   */
  process?: {
    modes: JoinMode[];
    /** "deadline this week": deadlines inside this many days lift a little more. */
    withinDays?: number;
    /** Every mode counts the same (no extra for the first, as "tryouts" has for tryout clubs). */
    anyMode?: boolean;
  };
}

export type ProcessKey = "comp" | "application" | "audition" | "tryout" | "deadline" | "selective" | "punch";
/**
 * Asking how selective clubs are ("selective clubs", "hard to get into", "acceptance rate",
 * "prestigious"): we never know how hard a club is to get into (§9: no acceptance rates without
 * published numbers, no prestige ranking), only whether it has a selection step. So these read
 * like "apply": clubs with an application, comp, audition, tryout or invitation for general
 * members come first (alone, they are the list), and the note says what that means.
 * "Competitive" only as a modifier ("competitive clubs", "most competitive", a query ending
 * in it): "competitive dance" and "competitive programming" are competitions.
 */
const SELECTIVE_NOTE = "Clubs with a selection step. We don't know how hard any is to get into.";
const SELECTIVE_PHRASES = [
  "selective",
  "selectivity",
  "most selective",
  "highly selective",
  "exclusive",
  "prestigious",
  "prestige",
  "hard to get into",
  "hard to get in",
  "hardest to get into",
  "harder to get into",
  "difficult to get into",
  "tough to get into",
  "hard to join",
  "hardest to join",
  "acceptance rate",
  "acceptance rates",
  "admit rate",
  "admission rate",
  "admissions rate",
  "most competitive",
  "competitive to get into",
  "competitive to join",
  ...["club", "clubs", "org", "orgs", "organization", "organizations", "group", "groups", "societies"].map(
    (w) => `competitive ${w}`,
  ),
];
const SELECTIVE_MODIFIER: SoftModifier = {
  key: "selective",
  phrases: SELECTIVE_PHRASES,
  says: [],
  process: { modes: [...SELECTIVE_JOIN_MODES], anyMode: true },
  note: SELECTIVE_NOTE,
};

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
    // Not "drop in": peer counseling's drop-in hours and a bike shop's drop-in repairs are for the
    // people served, not how members take part (Round 11).
    says: ["casual", "casually", "for fun", "low key", "relaxed", "laid back", "no pressure"],
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
      "without auditions",
      "dont audition",
      "doesnt audition",
      "dont require auditions",
      "doesnt require auditions",
      "dont require an audition",
      "unauditioned",
      "non auditioned",
      "no tryout",
      "no tryouts",
      "dont try out",
      "without tryouts",
      // A first-year asking is asking what they can walk into: almost every club takes
      // first-years, but few say so, so this re-ranks rather than filtering to the few that do.
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
  // Transfer students ask what a newcomer can walk into, like first-years (Round 11): beside a
  // topic a re-rank ("premed for transfers"); alone, the clubs they can still join this year.
  {
    key: "beginner",
    phrases: [
      "transfer",
      "transfers",
      "transfer student",
      "transfer students",
      "transferring",
      "transferred",
      "sophomore transfer",
      "sophomore transfers",
      "junior transfer",
      "junior transfers",
    ],
    says: [
      "transfer",
      "transfers",
      "transfer students",
      "beginner",
      "beginners",
      "no experience",
      "all levels",
      "open to all",
    ],
    alone: "stillTime",
  },
  // Class years (Round 12): "finance clubs for sophomores" asks what a sophomore can join,
  // like "for freshmen". Never required text or spelling-corrected; beside a topic a re-rank
  // toward clubs stating they take that year; alone, what they can still join this year.
  ...(
    [
      [["sophomore"], ["sophomore", "sophomores", "second year", "second years", "second year students"]],
      [["junior"], ["junior", "juniors", "third year", "third years", "third year students"]],
      [["senior"], ["senior", "seniors", "fourth year", "fourth years", "fourth year students"]],
      [
        ["sophomore", "junior", "senior"],
        [
          "upperclassmen",
          "upperclassman",
          "upperclass",
          "upperclass students",
          "upper class",
          "upperclassmen friendly",
        ],
      ],
    ] as const
  ).map(([classes, phrases]): SoftModifier => ({
    key: "classYear",
    classes,
    phrases: [...phrases],
    // Only words that say the year in a club's text: "juniors"/"seniors" there are as often
    // junior high or senior centers.
    says: phrases.filter((x) => x === "sophomores" || x === "upperclassmen" || x === "upperclass students"),
    alone: "stillTime",
  })),
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
      // Round 14: a flexible schedule is a light commitment ("flexible" had found only one
      // club listing it among activities; Elderly 1-2-1's pairs "meet at their own convenience").
      "flexible",
      "flexible schedule",
      "flexible hours",
      "flexible time",
      "on my own schedule",
      "own schedule",
      "my own schedule",
      "own pace",
      "own time",
    ],
    says: [
      "low commitment",
      "low time commitment",
      "minimal commitment",
      "minimal time commitment",
      "flexible",
      "flexible schedule",
      "flexible commitment",
      "own convenience",
      "own schedule",
      "own pace",
      "no commitment",
    ],
  },
  // Round 14: not every week ("no weekly meetings", "not weekly", "no regular meetings", "service
  // one day"). Clubs whose own words meet monthly or once ("two activities per month", "monthly
  // service", "days of service") come first; a club saying it meets weekly never gains, and
  // follows (`against`, read from its one-liner, activities and `pace`). Otherwise it reads like
  // "low commitment". Negation is part of the phrase, never dropped: "no weekly meetings" had
  // matched clubs that do meet weekly.
  {
    key: "commitment",
    phrases: [
      "no weekly meetings",
      "no weekly meeting",
      "without weekly meetings",
      "without meetings",
      "not weekly",
      "not every week",
      "no weekly",
      "no weekly commitment",
      "no regular meetings",
      "no regular meeting",
      "no meetings",
      "dont meet weekly",
      "dont meet every week",
      "doesnt meet weekly",
      "doesnt meet every week",
      "monthly",
      "once a month",
      "one day",
      "single day",
      "one time",
      "one off",
      "occasional",
      "occasionally",
    ],
    says: [
      "once a month",
      "twice a month",
      "each month",
      "every month",
      "per month",
      "monthly",
      "once a semester",
      "one day",
      "single day",
      "one time",
      "one off",
      "service days",
      "day of service",
      "days of service",
      "flexible",
      "own convenience",
      "low commitment",
      "low time commitment",
    ],
    against: ["weekly", "every week", "each week", "once a week", "twice a week", "biweekly"],
  },
  // Process words. "No comp", "no application", "no auditions" and "applications open" are
  // longer phrases above, so they keep their filters and soft readings.
  { key: "comp", phrases: ["comp", "comps", "comping", "comped"], says: [], process: { modes: ["comp"] } },
  SELECTIVE_MODIFIER,
  {
    key: "application",
    phrases: ["application", "applications", "apply", "applying", "applicant", "applicants"],
    says: [],
    process: { modes: ["application"] },
  },
  // Performing groups say audition, sports teams tryout; a student uses either word.
  {
    key: "audition",
    phrases: ["audition", "auditions", "auditioning"],
    says: [],
    process: { modes: ["audition", "tryout"] },
  },
  { key: "tryout", phrases: ["tryout", "tryouts"], says: [], process: { modes: ["tryout", "audition"] } },
  // Round 13: a punch is how final clubs and social groups invite members, never the word in a
  // club's text (the Lampoon is "modeled on the British magazine Punch"). Clubs that say it
  // ("admits members through a punch process") lead the invitation-only clubs. Bare
  // "punching" stays boxing (Round 8: "what is punching" → the Boxing Club).
  {
    key: "punch",
    phrases: ["punch", "punches", "punched", "punch process", "punch season", "punching season"],
    says: ["punch", "punching", "punch process"],
    process: { modes: ["invite_only"] },
  },
  {
    key: "deadline",
    phrases: ["deadline", "deadlines", "due", "due date", "due dates"],
    says: [],
    process: { modes: [] },
  },
  // A time window beside the word is part of it ("deadline this week" never leaves "this week"
  // as required text).
  ...(
    [
      [7, ["this week", "soon", "today", "tomorrow"]],
      [14, ["next week", "next two weeks", "in two weeks"]],
    ] as const
  ).map(([days, windows]): SoftModifier => ({
    key: "deadline",
    phrases: ["deadline", "deadlines", "due", "closing"].flatMap((w) =>
      windows.map((x) => `${w} ${x}`).concat(w === "closing" ? [] : windows.map((x) => `${x} ${w}`)),
    ),
    says: [],
    process: { modes: [], withinDays: days },
  })),
];

/** Words skipped inside a phrase ("no *a* comp", "without *an* application"). */
const ARTICLES = new Set(["a", "an", "the", "any"]);
/** Small words that join or place other words; a query of only these (and stop words) says nothing. */
const LINK_WORDS = new Set(["and", "or", "of", "in", "at", "on", ","]);
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
const LEFTOVER = new Set([
  "only",
  "just",
  "or",
  "and",
  "ones",
  "please",
  "good",
  "best",
  "great",
  "cool",
  "any",
  "some",
]);

interface Pattern {
  words: string[];
  filter: ConstraintFilter | null;
  soft?: SoftModifier;
  season?: RecruitingSeason;
  /** A season word on its own ("finance spring"): not when it begins a club's name ("spring break"). */
  bare?: boolean;
  /** Only as the query's last word, after other words ("is the crimson competitive"). */
  last?: boolean;
}

/**
 * Season phrases ("finance spring", "recruits in the fall", "spring recruiting", "rolling
 * basis"): the directory's recruiting-season filter (`season=`), which reads the club's usual
 * recruiting terms (`club.recruiting_seasons`; unknown ≠ match). "Spring recruiting" is the
 * season, not Recruiting now.
 */
const SEASON_WORDS: [string, RecruitingSeason][] = [
  ["fall", "fall"],
  ["autumn", "fall"],
  ["spring", "spring"],
];
const SEASON_AFTER = ["recruiting", "recruitment", "semester", "term", "applications", "application", "rush"];
const SEASON_LEADS = ["recruits", "recruit", "recruiting", "recruitment", "apply", "applications", "join", "joining"];
const SEASON_PREPS = ["in", "during", "this", "next", "for"];
const ROLLING_AFTER = ["recruiting", "recruitment", "basis", "admissions", "admission", "applications", "deadlines"];
const SEASON_PATTERNS: Pattern[] = [
  ...SEASON_WORDS.flatMap(([w, season]): Pattern[] => [
    { words: [w], filter: "recruitingSeason", season, bare: true },
    ...SEASON_AFTER.map((a) => ({ words: [w, a], filter: "recruitingSeason" as const, season })),
    ...SEASON_LEADS.flatMap((l) =>
      SEASON_PREPS.map((p) => ({ words: [l, p, w], filter: "recruitingSeason" as const, season })),
    ),
  ]),
  { words: ["rolling"], filter: "recruitingSeason", season: "rolling", bare: true },
  ...ROLLING_AFTER.map((a) => ({
    words: ["rolling", a],
    filter: "recruitingSeason" as const,
    season: "rolling" as const,
  })),
  ...SEASON_LEADS.map((l) => ({
    words: [l, "on", "rolling", "basis"],
    filter: "recruitingSeason" as const,
    season: "rolling" as const,
  })),
];

const PATTERNS: Pattern[] = [
  ...Object.entries(FILTER_PHRASES).flatMap(([filter, phrases]) =>
    phrases.map((p) => ({ words: p.split(" "), filter: filter as ConstraintFilter })),
  ),
  // "can i join late": not when it begins a club's name.
  { words: ["late"], filter: "stillTime" as const, bare: true },
  // "is the crimson competitive": as the query's last word, "competitive" asks how selective.
  { words: ["competitive"], filter: null, soft: SELECTIVE_MODIFIER, last: true },
  ...SEASON_PATTERNS,
  ...SOFT_MODIFIERS.flatMap((m) => m.phrases.map((p) => ({ words: p.split(" "), filter: null, soft: m }))),
  // Longest first, so "no comp required" wins over "no comp".
].sort((a, b) => b.words.length - a.words.length);

/** Whether a multi-word search concept phrase ("comp sci", "computer science") starts at `i`. */
function startsConceptPhrase(tokens: readonly string[], i: number): boolean {
  for (let n = Math.min(4, tokens.length - i); n >= 2; n--)
    if (CONCEPT_BY_TERM.has(tokens.slice(i, i + n).join(" "))) return true;
  return false;
}

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
 * normalized query is (part of) a club's name; then nothing is split out. `beginsName` says
 * whether a phrase begins a phrase of some club's name, its last word maybe cut short
 * ("spring break" of "Alternative Spring Breaks"): a bare season word there is the name. PURE.
 */
export function interpretQuery(
  text: string,
  isName: (normalized: string) => boolean = () => false,
  isFiller: (word: string) => boolean = () => false,
  beginsName: (phrase: string) => boolean = () => false,
): InterpretedQuery {
  const norm = normalizeName(text);
  if (!norm || isName(norm)) return { text, constraints: [], soft: [], negated: [], notes: [] };
  // A comma stays a token: between topics it joins them like "and" ("coding, startups").
  const tokens = text
    .split(",")
    .map((part) => normalizeName(part))
    .filter(Boolean)
    .join(" , ")
    .split(" ");
  const notes = definitionsAsked(tokens).map(joinTermText);
  const none: InterpretedQuery = { text, constraints: [], soft: [], negated: [], notes };
  // "more than 5 hours a week", "at least 10", "10+ hours": a floor, which no filter covers.
  const asksMinimum = /\d\s*\+|\b(more than|at least|over|above|minimum|min|plus|or more)\b/i.test(text);
  const keep: string[] = [];
  const constraints: QueryConstraint[] = [];
  const soft: InterpretedQuery["soft"] = [];
  const negated: string[] = [];
  for (let i = 0; i < tokens.length;) {
    let hit: { p: Pattern; n: number; value?: number; phrase?: string } | null = null;
    const hours = hoursLimitAt(tokens, i, !asksMinimum);
    if (hours)
      hit = {
        p: { words: [], filter: "maxHours" },
        n: hours.n,
        value: hours.value,
        ...(hours.phrase ? { phrase: hours.phrase } : {}),
      };
    else
      for (const p of PATTERNS) {
        // A process word that begins a topic phrase ("comp sci") is the topic.
        if (p.soft?.process && (startsConceptPhrase(tokens, i) || SHORTHANDS.has(`${tokens[i]} ${tokens[i + 1]}`)))
          continue;
        if (
          p.bare &&
          (startsConceptPhrase(tokens, i) || (i + 1 < tokens.length && beginsName(`${tokens[i]} ${tokens[i + 1]}`)))
        )
          continue;
        const n = matchAt(tokens, i, p);
        if (n && p.last && (i === 0 || i + n !== tokens.length)) continue;
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
    const phrase = hit.phrase ?? tokens.slice(i, i + hit.n).join(" ");
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
      const { filter, season } = hit.p;
      if (!constraints.some((c) => c.filter === filter && c.season === season))
        constraints.push({
          filter,
          phrase,
          ...(hit.value === undefined ? {} : { value: hit.value }),
          ...(season ? { season } : {}),
        });
    } else if (hit.p.soft && !soft.some((x) => x.modifier === hit.p.soft)) soft.push({ phrase, modifier: hit.p.soft });
    i += hit.n;
  }
  const read = constraints.length > 0 || soft.length > 0 || negated.length > 0;
  // Question and helper words never reach the text searched ("what is punching" → punching).
  // "or", "and" or a comma between two kept words joins them ("no comp coding or startups").
  const joins = (w: string, i: number) =>
    (w === "or" || w === "and" || w === ",") &&
    i > 0 &&
    i < keep.length - 1 &&
    ![keep[i - 1]!, keep[i + 1]!].some((x) => x === "," || LEFTOVER.has(x) || CONNECTORS.has(x));
  const asks = tokens.some((w) => QUESTION_WORDS.has(w));
  const rest = keep
    .filter(
      (w, i) =>
        joins(w, i) ||
        (w !== "," &&
          !(read && LEFTOVER.has(w)) &&
          !STOP_WORDS.has(w) &&
          !(asks && QUESTION_TOPIC_WORDS.has(w)) &&
          // "what does tryout mean": the asking word isn't searched once a definition answers it.
          !(notes.length > 0 && DEFINE_WORDS.has(w))),
    )
    .join(" ");
  const meaningful = rest
    .split(" ")
    .some((w) => w && w !== "," && !CONNECTORS.has(w) && !ARTICLES.has(w) && !isFiller(w));
  // A question or request with nothing else in it ("how do i join", "how to join", "clubs to
  // join") is the browse list. Only a finished one (two words or more): a single word may
  // still be on its way to a name.
  const question = tokens.length > 1 && tokens.some((w) => QUESTION_WORDS.has(w) || JOIN_WORDS.has(w));
  // Likewise a query of only small function words ("the and of"): nothing to look for.
  const onlyFunctionWords =
    tokens.length > 1 &&
    tokens.every((w) => STOP_WORDS.has(w) || ARTICLES.has(w) || CONNECTORS.has(w) || LINK_WORDS.has(w));
  if (!meaningful && !read) return question || onlyFunctionWords ? { ...none, text: "" } : none;
  // A word with nothing beside it that reads as a filter alone ("transfer" → Still time to join).
  if (!meaningful)
    for (const s of [...soft])
      if (s.modifier.alone) {
        const filter = s.modifier.alone;
        soft.splice(soft.indexOf(s), 1);
        if (!constraints.some((c) => c.filter === filter)) constraints.push({ filter, phrase: s.phrase });
      }
  // Beside a topic, soft words re-rank; alone ("low commitment") they are what's searched.
  return { text: meaningful ? rest : "", constraints, soft, negated, notes };
}
