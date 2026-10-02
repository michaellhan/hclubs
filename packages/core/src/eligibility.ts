import type { ClassYear } from "./fields/value-utils";

/**
 * Who may join, read from one sentence (ADR 0041). Shared by the deterministic extractor
 * (which turns a sentence into `club.eligible_classes` / `club.freshmen_eligible` claims)
 * and the joining derivation (which reads the quotes behind join-mode claims), so both
 * apply the same rules. PURE, no Zod: the browser bundle may import it.
 *
 * Three readings, from strongest to weakest:
 *  - `explicit`: the sentence names first-years ("first-years are welcome", "open to
 *    first-years, sophomores, and juniors", "not open to first-years").
 *  - `list`: it lists the class years that may join and first-years aren't among them
 *    ("open to sophomores, juniors and seniors", "sophomores and up", "a punch for
 *    sophomore and junior men"). A list is a restriction only when worded as one; "members
 *    typically join during their sophomore year" describes, it doesn't restrict.
 *  - `population`: it opens membership to a population that includes every class year
 *    ("open to all Harvard undergraduates", "any student at Harvard College", "regardless
 *    of class year", "everyone is welcome").
 *
 * Mentions that aren't about who may join never count: "Freshman Welcome Event", "our
 * freshman representative", "when I was a freshman", "welcome two new freshmen, …".
 */
export interface ClassEligibility {
  /** true: first-years may join (or apply); false: they may not; null: the sentence doesn't say. */
  firstYears: boolean | null;
  kind: "explicit" | "list" | "population";
  /** Undergraduate class years the sentence opens membership to (all four for a population). */
  classes: ClassYear[];
}

const FY = String.raw`(?:incoming |new |current )?(?:harvard )?(?:first[- ]?years?(?: students?)?|freshm[ae]n|frosh)`;
const ALL_UNDERGRAD: ClassYear[] = ["first_year", "sophomore", "junior", "senior"];

/** A first-year word used as a modifier of something else: an event, a role, a place. */
const FY_AS_MODIFIER = new RegExp(
  String.raw`\b(?:first[- ]?year|freshm[ae]n|frosh)\s+(?:welcome\s+(?:event|week|weekend|party|concert|dinner|in)|jam|week|weekend|year|yard|dorms?|housing|seminars?|reps?|representatives?|fellows?|liaisons?|outreach|social|register|guide|events?|retreat|mixers?|orientation|students? (?:in|at) (?:high school|college)|council|class)\b`,
  "gi",
);

const NEGATION = new RegExp(
  String.raw`\b(?:not|isn't|aren't|never|no longer)\s+(?:open|available|eligible)\s+(?:to|for)\s+${FY}|\b${FY}\s+(?:are|is)\s+(?:not|ineligible|never)\b(?!\s+(?:only|just|required))|\b${FY}\s+(?:cannot|can't|can not|may not|are unable to)\s+(?:join|apply|comp|audition|try ?out|become|participate)\b(?![^.]*\buntil\b)|\b(?:except|excluding|other than)\s+(?:for\s+)?${FY}|\bno\s+${FY}(?=\s*(?:[.,;!]|$|allowed|permitted|may|can))`,
  "i",
);

const POSITIVE = [
  // "First-years are welcome", "freshmen are especially encouraged to apply"
  new RegExp(
    String.raw`\b${FY}\s+(?:are|is|'re)\s+(?:all\s+|especially\s+|always\s+|very\s+|more than\s+|also\s+|absolutely\s+)?(?:welcome|encouraged|eligible|invited|able to|allowed to|free to)\b`,
    "i",
  ),
  // "First-years welcome!" as a whole phrase (not "Freshman Welcome Event")
  new RegExp(String.raw`\b${FY}\s+welcome\s*(?:[!.]|$)`, "i"),
  // "First-years can join", "freshmen may comp", "first-years must apply"
  new RegExp(
    String.raw`\b${FY}\s+(?:can|may|should|must|are able to|are free to|are allowed to|get to)\s+(?:\w+\s+){0,2}?(?:join|apply|comp|audition|try ?out|sign up|register|participate|become|be (?:a )?members?)\b`,
    "i",
  ),
  // "open to (all) first-years", "we welcome first-years", "encourage first-years to apply"
  new RegExp(
    String.raw`\b(?:open to|available to|welcomes?|welcoming|invites?|encourages?|recruits?|accepts?|seeking)\s+(?:all\s+|both\s+)?${FY}\b(?!\s+(?:welcome|week|jam|event))`,
    "i",
  ),
  // "Whether you are a first-year or a senior", "including freshmen", "first-year or upperclass"
  new RegExp(String.raw`\bwhether you(?:'re| are)\s+(?:an?\s+)?${FY}\b`, "i"),
  new RegExp(String.raw`\b(?:including|especially|particularly)\s+${FY}\b`, "i"),
  new RegExp(String.raw`\b${FY}\s+or\s+(?:an?\s+)?upperclass`, "i"),
];

/** Words that make a sentence about joining at all (not an event, a bio, a history). */
const JOIN_CONTEXT =
  /\b(?:open|only|limited|restricted|punch\w*|welcome[sd]?|eligible|eligibility|join|joining|apply|application|member(?:ship|s)?|recruit\w*|comp(?:ing)?|audition\w*|try ?outs?|sign up|register|participate|encourage[sd]?|invite[sd]?|may|can)\b/i;

/** Words that make a sentence about joining itself (JOIN_CONTEXT also admits "only", "can"). */
const JOINING_WORD =
  /\b(?:open to|limited to|restricted to|available to|punch\w*|eligible|eligibility|join|joining|apply|applicants?|application|member(?:ship|s)?|recruit\w*|comp(?:s|ing|ed)?|audition\w*|try ?outs?|sign up|register|participate|invite[sd]?|welcome[sd]?)\b/i;

/** Hedged descriptions of who usually joins: not a restriction. */
const DESCRIPTIVE = /\b(?:typically|usually|traditionally|historically|often|generally|most(?:ly)?|tend to)\b/i;

/** A list worded as a restriction on who may join. */
const RESTRICTIVE =
  /\b(?:only|limited to|restricted to|open to|available to|eligible|must be|exclusively|for (?:rising )?(?:sophomores?|juniors?|seniors?|upperclass\w*)|first (?:apply|comp|join|punch)|punch(?:ing|es)?(?: process)? (?:for|of))\b/i;

/** "all Harvard undergraduates", "any enrolled student", "all graduate and undergraduate students". */
const ALL_STUDENTS = String.raw`\b(?:all|any|every)(?:\s+and\s+all)?\s+(?:enrolled\s+|current(?:ly enrolled)?\s+|interested\s+)?(?:harvard\s+)?(?:college\s+)?(?:graduate\s+(?:and|&)\s+)?(?:undergraduate\s+)?(?:students?|undergraduates?|undergrads?)\b`;
/** "Undergraduates can apply", "open to undergraduates": undergraduates as a whole. */
const UNDERGRADS_MAY = String.raw`\b(?:current(?:ly enrolled)?\s+)?(?:harvard\s+)?(?:college\s+)?(?:undergraduates|undergraduate students|undergrads|undergraduate (?:and|&|or) graduate students)(?:\s+(?:and|or)\s+graduate students)?\s+(?:can|may|are (?:welcome|eligible|encouraged|invited))\s+(?:to\s+)?(?:join|apply|participate|become|try ?out|audition|comp)\b|\bopen to (?:harvard\s+)?(?:college\s+)?(?:undergraduates|undergraduate students|undergrads)\b`;

const POPULATION = new RegExp(
  [
    ALL_STUDENTS,
    String.raw`\b(?:any|all)\s+(?:students?|members)\s+(?:at|of|in)\s+harvard(?:\s+college)?\b`,
    UNDERGRADS_MAY,
    String.raw`\bregardless of (?:their\s+)?(?:class\s+)?year\b`,
    String.raw`\ball (?:four\s+)?class years\b`,
    String.raw`\bstudents (?:of|from|in) all (?:class\s+)?years\b`,
    String.raw`\b(?:entire|whole) harvard community\b`,
    String.raw`\b(?:anyone|everyone|everybody)\b`,
    String.raw`\ball are welcome\b`,
    String.raw`\bmembers (?:from|of|in) all (?:four\s+)?(?:class\s+)?years\b`,
  ].join("|"),
  "i",
);

/** Populations that don't include College first-years. */
const GRADUATE_ONLY =
  /\b(?:graduate students?|grad students?|ph\.?d\.?|mba|hbs|hls|hks|gsas|gsd|gse|hsph|law students?|medical students?|professional schools?)\b/i;
const UNDERGRAD_WORD = /\b(?:undergrad\w*|college students?|harvard college)\b/i;
const OUTSIDERS = /\b(?:high school(?: students)?|middle school|alumni|parents|faculty|staff only|pre-?frosh|prospective students)\b/i;

const CLASS_WORDS: [ClassYear, RegExp][] = [
  ["first_year", /\b(?:first[- ]?years?|freshm[ae]n|frosh)\b/i],
  ["sophomore", /\bsophomores?\b/i],
  ["junior", /\bjuniors?\b/i],
  ["senior", /\bseniors?\b/i],
];
const ORDER: ClassYear[] = ["first_year", "sophomore", "junior", "senior"];

/** "first-years through juniors", "sophomores and up", "upperclass students". */
function classesIn(s: string): ClassYear[] {
  const range = /\b(first[- ]?years?|freshm[ae]n|sophomores?|juniors?)\s+(?:through|to|thru|[-–])\s+(sophomores?|juniors?|seniors?)\b/i.exec(s);
  if (range) {
    const from = CLASS_WORDS.findIndex(([, re]) => re.test(range[1]!));
    const to = CLASS_WORDS.findIndex(([, re]) => re.test(range[2]!));
    if (from >= 0 && to >= from) return ORDER.slice(from, to + 1);
  }
  // "first apply in your sophomore year … as late as your senior year": a range too.
  const loose =
    /\b(first[- ]?years?|freshm[ae]n|sophomores?|juniors?)\b[^.!?]{0,80}?\b(?:as late as|through|until|up to)\b[^.!?]{0,40}?\b(sophomores?|juniors?|seniors?)\b/i.exec(
      s,
    );
  if (loose) {
    const from = CLASS_WORDS.findIndex(([, re]) => re.test(loose[1]!));
    const to = CLASS_WORDS.findIndex(([, re]) => re.test(loose[2]!));
    if (from >= 0 && to >= from) return ORDER.slice(from, to + 1);
  }
  const andUp = /\b(sophomores?|juniors?)(?:\s+year)?\s+(?:and|or)\s+(?:above|up|older|later|beyond)\b/i.exec(s);
  if (andUp) return ORDER.slice(/^soph/i.test(andUp[1]!) ? 1 : 2);
  const found = CLASS_WORDS.filter(([, re]) => re.test(s)).map(([c]) => c);
  if (/\bupperclass\w*/i.test(s)) for (const c of ["sophomore", "junior", "senior"] as const) found.push(c);
  return ORDER.filter((c) => found.includes(c));
}

/** Class years a sentence leaves out: "no academic seniors", "except juniors". */
function excludedClasses(s: string): ClassYear[] {
  const out: ClassYear[] = [];
  for (const m of s.matchAll(/\b(?:no|not|except|excluding|other than)\s+(?:for\s+)?(?:academic\s+|current\s+)?(first[- ]?years?|freshm[ae]n|sophomores?|juniors?|seniors?)\b/gi)) {
    const hit = CLASS_WORDS.find(([, re]) => re.test(m[1]!));
    if (hit) out.push(hit[0]);
  }
  return out;
}

/** The sentence with first-year words that only modify other things taken out. */
const stripModifiers = (s: string) => s.replace(FY_AS_MODIFIER, " ");

/**
 * Who may join, per one sentence; null when it doesn't say. `context` is "membership"
 * when the caller already knows the sentence is about joining (a join-mode quote), which
 * lets a bare population ("Everyone is welcome!") count.
 */
export function classEligibility(sentence: string, context: "membership" | "any" = "any"): ClassEligibility | null {
  const s = stripModifiers(sentence.replace(/\s+/g, " ").trim());
  if (!s) return null;
  const aboutJoining = context === "membership" || JOIN_CONTEXT.test(s);
  if (!aboutJoining) return null;
  const mentionsFy = CLASS_WORDS[0]![1].test(s);

  if (mentionsFy && NEGATION.test(s)) return { firstYears: false, kind: "explicit", classes: [] };
  // "First-years may not comp until spring": eligible later, so neither yes nor no.
  if (mentionsFy && /\b(?:may not|cannot|can't|can not)\b/i.test(s)) return null;

  // "Comps are limited to undergraduates. No academic seniors.": the years named are the ones
  // left out, so first-years (not named) are in.
  const excluded = excludedClasses(s);
  if (excluded.length && !excluded.includes("first_year") && /\bundergrad\w*|\bharvard college\b/i.test(s))
    return { firstYears: true, kind: "explicit", classes: ALL_UNDERGRAD.filter((c) => !excluded.includes(c)) };

  const classes = classesIn(s);
  if (mentionsFy && POSITIVE.some((re) => re.test(s)))
    return {
      firstYears: true,
      kind: "explicit",
      classes: classes.length > 1 ? classes : ["first_year"],
    };
  // An explicit list naming first-years with other years: "Open to first-years, sophomores,
  // and juniors." "Lite is open to freshman, sophomore, junior, and senior members".
  if (mentionsFy && classes.length > 1 && RESTRICTIVE.test(s) && !DESCRIPTIVE.test(s))
    return { firstYears: true, kind: "explicit", classes };

  // A list without first-years, worded as a restriction. Years named only to leave them out
  // ("No academic Seniors.") are not the list.
  const upper = classes.filter((c) => c !== "first_year" && !excluded.includes(c));
  // Outside a membership context, "only"/"can" alone isn't about joining: "Only 18 of 50
  // concentrations restrict how seniors can use AI" is news, not a membership rule. A short
  // label ("Upperclass students only.") still is.
  if (
    !mentionsFy &&
    upper.length > 0 &&
    RESTRICTIVE.test(s) &&
    !DESCRIPTIVE.test(s) &&
    !POPULATION_ALL_YEARS.test(s) &&
    (context === "membership" || JOINING_WORD.test(s) || s.split(" ").length <= 6)
  )
    return { firstYears: false, kind: "list", classes: upper };

  if (POPULATION.test(s) && !OUTSIDERS_ONLY(s)) {
    if (GRADUATE_ONLY.test(s) && !UNDERGRAD_WORD.test(s)) return null;
    if (upper.length > 0 && !mentionsFy && !POPULATION_ALL_YEARS.test(s)) return null;
    // A bare "everyone"/"anyone" is about joining only when the caller says so.
    if (context === "any" && !STRONG_POPULATION.test(s)) return null;
    return { firstYears: true, kind: "population", classes: ALL_UNDERGRAD };
  }
  return null;
}

const POPULATION_ALL_YEARS = /\b(?:regardless of (?:their\s+)?(?:class\s+)?year|all (?:four\s+)?class years|students (?:of|from|in) all (?:class\s+)?years)\b/i;

/** Populations that name Harvard students or all class years (not a bare "everyone"). */
const STRONG_POPULATION = new RegExp(
  [
    ALL_STUDENTS,
    String.raw`\b(?:any|all)\s+(?:students?|members)\s+(?:at|of|in)\s+harvard`,
    UNDERGRADS_MAY,
    POPULATION_ALL_YEARS.source,
    String.raw`\b(?:entire|whole) harvard community\b`,
    // "has members from all four years": first-years are among the members.
    String.raw`\bmembers (?:from|of|in) all (?:four\s+)?(?:class\s+)?years\b`,
    // "anyone currently enrolled in high school or undergrad": undergraduates included.
    String.raw`\b(?:anyone|everyone)\b[^.!?]{0,40}\bundergrad`,
  ].join("|"),
  "i",
);

/** "We welcome anyone currently enrolled in high school": an outside population only. */
function OUTSIDERS_ONLY(s: string): boolean {
  return OUTSIDERS.test(s) && !UNDERGRAD_WORD.test(s) && !/\bharvard (?:students?|community)\b/i.test(s);
}
