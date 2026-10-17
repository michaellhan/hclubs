import { clubAudiences } from "./audience";
import { CAREER_CATEGORIES } from "./basics";
import type { IndexClub } from "./types";
import { clubWords } from "./words";

/**
 * "What do you want to do?" (ADR 0034). Each intent is a fixed rule over data the index
 * already has — categories, plus words in a club's names and one-line description (not its
 * activity list: "workshops on survey software" doesn't make a club a software group).
 * Deterministic and explained on the page; not a recommendation. PURE.
 */
export type IntentGroup = "build" | "career" | "create" | "engage" | "play";

/** Headings for the home page's grouped intents, in display order. */
export const INTENT_GROUPS: { key: IntentGroup; label: string }[] = [
  { key: "build", label: "Build & discover" },
  { key: "career", label: "Career & business" },
  { key: "create", label: "Create & perform" },
  { key: "engage", label: "Serve, argue & belong" },
  { key: "play", label: "Play & compete" },
];

export interface Intent {
  slug: string;
  label: string;
  group: IntentGroup;
  /** Clubs in any of these categories match. */
  categories: string[];
  /** Clubs whose names or text use any of these normalized words match. */
  words: string[];
  /**
   * Words that pick a club only from its name ("Business" in "Women in Business", "Federal
   * Reserve" in the Fed Challenge team): in a one-liner they are as often a passing word
   * ("speakers from government, academia, business").
   */
  nameWords?: string[];
  /** Clubs this rule never picks, even when a category or word does (e.g. invitation-only groups). */
  excludes?: (c: IndexClub) => boolean;
  /** Orders picked clubs best-first (higher first) under "Best match"; ties fall back to name. */
  rank?: (c: IndexClub) => number;
}

/**
 * Clubs a student can't just show up to: invitation-only, and social organizations (final
 * clubs, secret societies, Greek chapters) that don't say their membership is open. House
 * committees are governance for one house, not a way to meet people across campus. PURE.
 */
export function isSelectiveSocial(c: IndexClub): boolean {
  if (c.joinModes.includes("invite_only")) return true;
  if (c.orgType === "governance_body") return true;
  if (c.orgType === "social_organization") return c.joining.access !== "open";
  return false;
}

/**
 * A paid professional ensemble ("Professional choir of paid singers"): a job, not a group a
 * student joins to perform. PURE.
 */
export function paidEnsemble(c: IndexClub): boolean {
  return /\b(paid (singers|musicians|performers|positions)|professional (choir|ensemble|orchestra|singers))\b/i.test(
    c.shortDescription ?? "",
  );
}

const PERFORM_KINDS = ["music", "a-cappella", "dance", "theater"];
/** Fields outside the arts a club may also be filed under. */
const NOT_ARTS = [
  "public-service",
  "athletics-recreation",
  "academic-stem",
  "technology",
  "pre-professional",
  "social",
];
/**
 * Filed under the Performing Arts umbrella only (no music, a cappella, dance or theater) and
 * also under a field outside the arts, with no performing word in its name or one-liner: an
 * event committee or a creative-tech group ("An Evening with Champions" stages a skating show
 * for charity), not a group whose members perform. PURE.
 */
export function eventCommittee(c: IndexClub): boolean {
  if (!c.categorySlugs.includes("performing-arts") || PERFORM_KINDS.some((k) => c.categorySlugs.includes(k)))
    return false;
  if (!NOT_ARTS.some((k) => c.categorySlugs.includes(k))) return false;
  const perform = INTENTS.find((i) => i.slug === "perform");
  return !perform?.words.some((x) => uses(c, x));
}

/** Fields where an outdoors club lives (the Outing, Mountaineering, Climbing and Ski clubs). */
const OUTDOOR_HOMES = ["athletics-recreation", "hobbies-games"];

/**
 * Filed under Sports & Recreation but not a team or club that plays (Round 11): a sports-business
 * careers group, a sports-analytics society, a charity committee staging a skating show. Club
 * sports always play; otherwise a club also filed under a career field or the performing arts
 * is about sport, not playing it. PURE.
 */
export function notPlaying(c: IndexClub): boolean {
  if (c.orgType === "club_sport") return false;
  return c.categorySlugs.some((s) => CAREER_CATEGORIES.has(s) || s === "performing-arts");
}

/** Public Service and its subcategories (the taxonomy's service tree). */
const SERVICE_TREE = new Set([
  "public-service",
  "mentoring-education",
  "health-service",
  "adult-services",
  "advocacy-justice",
]);
/** Words in a club's name or one-liner that say its members serve others. */
const SERVICE_WORDS = [
  "volunteer",
  "volunteers",
  "volunteering",
  "service",
  "tutoring",
  "tutors",
  "mentoring",
  "mentors",
  "afterschool",
  "after school",
  "outreach",
  "pbha",
  "humanitarian",
  "social good",
];
/** Mentoring words also describe career mentoring a club gives its own members ("with faculty, mentors and peers"). */
const MENTORING_WORDS = new Set(["mentoring", "mentors"]);

/**
 * Filed first under a career or academic field, with no word in its name or one-liner saying its
 * members serve others (mentoring aside): a service category is a side activity (Round 14: the
 * Economics Association, which runs high-school competitions, under Volunteer). Not a volunteer
 * group. PURE.
 */
export function notVolunteering(c: IndexClub): boolean {
  const primary = c.categories[0]?.slug;
  if (!primary || !CAREER_CATEGORIES.has(primary)) return false;
  return !SERVICE_WORDS.some((w) => !MENTORING_WORDS.has(w) && uses(c, w));
}

/**
 * Service programs first (Round 12): a public-service program, or a club whose name or
 * one-liner says it serves (volunteer, tutoring, mentoring…), then a club filed first under
 * the service tree, then a club with only a secondary service category (a Model UN conference
 * that also runs a high-school program). Fixed, not personalised; ties by followers.
 */
function volunteerRank(c: IndexClub): number {
  let n = 0;
  if (c.orgType === "public_service_program" || SERVICE_WORDS.some((w) => uses(c, w))) n += 2;
  const primary = c.categories[0]?.slug;
  if (primary && SERVICE_TREE.has(primary)) n += 1;
  return n;
}

/** Words in a club's name, one-liner or activities that say its members make things. */
const BUILD_WORDS = [
  "build",
  "builds",
  "building",
  "built",
  "develop",
  "develops",
  "developing",
  "developers",
  "development",
  "programmers",
  "programming contest",
  "hackathon",
  "hackathons",
  "robot",
  "robots",
  "robotics",
  "rocketry",
  "satellite",
  "prototype",
  "prototypes",
  "implementing",
  "project",
  "projects",
  "app",
  "apps",
  "web app",
  "software engineering",
  "technical skills",
  "hands on",
];
/** Phrases with those words that are about people, not things ("community building"). */
const NOT_BUILDING = [
  "community building",
  "skill building",
  "team building",
  "relationship building",
  "coalition building",
  "professional development",
  "career development",
  "leadership development",
  "developing communities",
  "developing countries",
];
const buildLines = new WeakMap<IndexClub, { own: string; listed: string }>();
/**
 * Build software (Round 13): clubs whose name or one-liner says members build, develop or
 * work on projects (2), then clubs whose activity list says so (1), before identity and
 * professional societies, a venture network or a reading group filed under Technology. Fixed,
 * not personalised; ties by followers.
 */
function buildRank(c: IndexClub): number {
  let t = buildLines.get(c);
  if (!t) {
    const strip = (line: string) => NOT_BUILDING.reduce((s, x) => s.split(` ${x} `).join(" "), line);
    t = {
      own: strip(textOf(c).line),
      listed: strip(` ${(c.searchTopics ?? "").split(/\s+/).filter(Boolean).join(" ")} `),
    };
    buildLines.set(c, t);
  }
  const says = (line: string) => BUILD_WORDS.some((w) => line.includes(` ${w} `));
  return says(t.own) ? 2 : says(t.listed) ? 1 : 0;
}

/**
 * A professional network for women or men in a career field (Women in Business, Women in
 * Computer Science, Women in AI): filed under Cultural & identity for who it is for, but its
 * members meet around the career, so the Cultural & identity and Meet people topics leave it
 * to its career topic (Round 14). A club naming an identity community or a faith (Latinos in
 * Health Careers, the Society of Black Scientists and Engineers) is that community's group and
 * stays. PURE.
 */
export function careerNetwork(c: IndexClub): boolean {
  if (!c.categorySlugs.includes("cultural-identity")) return false;
  if (!c.categorySlugs.some((s) => CAREER_CATEGORIES.has(s))) return false;
  const a = clubAudiences(c);
  return (a.has("women") || a.has("men")) && ![...a].some((x) => x.startsWith("id:") || x.startsWith("faith:"));
}

/**
 * Cultural & identity (Round 14): a community's broad groups first, then the ones that stay
 * though also filed under a career field or Sports, or run as a service program (Latinos in
 * Health Careers, Women of Harvard Athletics). As search's `identityHome`. Fixed, not
 * personalised; ties by followers.
 */
function communityRank(c: IndexClub): number {
  if (c.orgType === "public_service_program") return 0;
  return c.categorySlugs.some((s) => CAREER_CATEGORIES.has(s) || s === "athletics-recreation") ? 0 : 1;
}

/** Club sports first (Round 14): teams anyone can play on, before other recreation groups. */
function playRank(c: IndexClub): number {
  return c.orgType === "club_sport" ? 1 : 0;
}

/** Open membership first, then no-cut processes, then everything else. Fixed, not personalised. */
function meetPeopleRank(c: IndexClub): number {
  if (c.joining.access === "open") return 3;
  if (c.joining.noCuts || c.joining.comp === false) return 2;
  if (c.joining.access === "mixed") return 1;
  return 0;
}

export const INTENTS: readonly Intent[] = [
  {
    slug: "build-software",
    label: "Build software",
    group: "build",
    categories: ["technology"],
    // Not "programming": "social and intellectual programming" is events.
    words: ["software", "coding", "developers", "hackathon", "app", "apps", "computer science"],
    rank: buildRank,
  },
  {
    slug: "work-on-ai",
    label: "Work on AI",
    group: "build",
    categories: [],
    words: ["ai", "artificial intelligence", "machine learning", "machine intelligence"],
  },
  {
    slug: "engineering",
    label: "Build hardware or robots",
    group: "build",
    categories: [],
    words: ["robotics", "robots", "engineering", "engineers", "aerospace", "rocketry", "hardware", "vehicle"],
  },
  {
    slug: "do-research",
    label: "Do research",
    group: "build",
    categories: [],
    // Not "lab": Product Lab, Sports Lab and Governance Lab are a PM group, a careers group and an incubator.
    words: ["research", "researchers"],
  },
  {
    slug: "quant-finance",
    label: "Do quantitative finance",
    group: "career",
    categories: [],
    words: ["quant", "quantitative", "trading", "traders"],
  },
  {
    slug: "invest",
    label: "Invest or manage a fund",
    group: "career",
    categories: ["finance"],
    // Not bare "fund": "raise money for the Jimmy Fund", "advocate for, fund, and support".
    words: ["investing", "investment", "investments", "portfolio", "trading", "hedge fund", "investment fund"],
  },
  {
    slug: "consulting-projects",
    label: "Do consulting projects",
    group: "career",
    categories: ["consulting"],
    words: ["consulting", "consultancy"],
  },
  {
    // The directory's topic chip: invest, quant and consulting together (each alone is a few clubs).
    slug: "finance-consulting",
    label: "Finance & consulting",
    group: "career",
    categories: ["finance", "consulting"],
    // Round 10: the business, economics and Fed Challenge groups students look for here
    // (Crimson Business Board, Women in Business, the South Asian Business Association, the
    // Economics Association, the Federal Reserve Challenge). Not arts or sports business groups.
    nameWords: ["business", "economics", "federal reserve"],
    excludes: (c) => ["performing-arts", "music", "athletics-recreation"].some((s) => c.categorySlugs.includes(s)),
    words: [
      "quant",
      "quantitative",
      "trading",
      "traders",
      "investing",
      "investment",
      "investments",
      "portfolio",
      "hedge fund",
      "investment fund",
      "consulting",
      "consultancy",
    ],
  },
  {
    // Also the directory's "Startups & VC" topic (Round 12): founders, startups and venture
    // capital groups (Harvard College Ventures, Startups at Harvard, the Venture Capital Group).
    slug: "explore-startups",
    label: "Explore startups",
    group: "career",
    categories: ["entrepreneurship"],
    words: [
      "startup",
      "startups",
      "entrepreneurship",
      "entrepreneurs",
      "entrepreneurial",
      "founders",
      "ventures",
      "venture capital",
    ],
    // "Venture" alone only in a name: a one-liner's "new venture" is as often a project.
    nameWords: ["venture", "ventures", "vc"],
    excludes: (c) => ["performing-arts", "music", "athletics-recreation"].some((s) => c.categorySlugs.includes(s)),
  },
  {
    slug: "prepare-for-medicine",
    label: "Prepare for medicine",
    group: "career",
    categories: ["medicine-health"],
    words: ["premedical", "premed", "medicine", "medical"],
  },
  {
    slug: "write-or-report",
    label: "Write or report",
    group: "create",
    categories: ["publications-media"],
    words: ["journalism", "newspaper", "magazine", "writing", "writers", "journal", "publication"],
  },
  {
    slug: "make-films",
    label: "Make films or videos",
    group: "create",
    categories: [],
    words: ["film", "films", "filmmaking", "cinema", "television", "documentary", "documentaries"],
  },
  {
    slug: "make-art",
    label: "Make visual art",
    group: "create",
    categories: [],
    // Not "design", "drawing" or "artists": "design lessons", "drawing from backgrounds", "meet artists".
    words: [
      "visual art",
      "visual arts",
      "painting",
      "photography",
      "graphic design",
      "design skills",
      "studio art",
      "illustration",
      "ceramics",
      "printmaking",
      // Persona round 8: only 2 clubs. What members make or publish, in a one-liner.
      // Stop words ("and") are gone from the text these are read in.
      "arts crafts",
      "crafts",
      "knitting",
      "crochet",
      "sewing",
      "pottery",
      "sculpture",
      "experimental arts",
      "art activities",
      "publishing art",
      "writing art",
      "black artists",
    ],
    // A club named for art or a craft ("Black Arts Collective", "Photography Club").
    nameWords: ["art", "arts", "crafts", "photography", "knitting", "design"],
    // Talks with artists about the arts and policy are not making art (Coalition for the Arts);
    // nor are career groups for the arts business.
    excludes: (c) =>
      c.categorySlugs.length > 0 &&
      c.categorySlugs.every((s) => s === "political-advocacy" || s === "pre-professional" || s === "music"),
  },
  {
    slug: "perform-music",
    label: "Play music",
    group: "create",
    categories: ["music"],
    excludes: (c) => paidEnsemble(c),
    // Not "jazz": a jazz dance team, jazz a cappella (Sing).
    words: ["orchestra", "ensemble", "band", "musicians", "symphony"],
  },
  {
    slug: "sing",
    label: "Sing",
    group: "create",
    categories: ["a-cappella"],
    excludes: (c) => paidEnsemble(c),
    words: ["choir", "chorus", "choral", "cappella", "singers", "singing", "glee"],
  },
  {
    slug: "dance",
    label: "Dance",
    group: "create",
    categories: ["dance"],
    // Not "troupe": improv troupes say it as often.
    words: ["dance", "dancers", "ballet"],
  },
  {
    slug: "act-or-do-comedy",
    label: "Act or do comedy",
    group: "create",
    categories: ["theater"],
    words: ["theater", "theatre", "improv", "comedy", "musical", "drama"],
  },
  {
    // The directory's topic chip: play music, sing, dance and act together.
    slug: "perform",
    label: "Perform",
    group: "create",
    categories: ["performing-arts", "music", "a-cappella", "dance", "theater"],
    excludes: (c) => paidEnsemble(c) || eventCommittee(c),
    words: [
      "orchestra",
      "ensemble",
      "band",
      "musicians",
      "symphony",
      "choir",
      "chorus",
      "choral",
      "cappella",
      "singers",
      "singing",
      "glee",
      "dance",
      "dancers",
      "ballet",
      "troupe",
      "theater",
      "theatre",
      "improv",
      "comedy",
      "musical",
      "drama",
    ],
  },
  {
    slug: "debate",
    label: "Debate or argue cases",
    group: "engage",
    categories: [],
    words: ["debate", "debating", "parliamentary", "moot", "mock trial", "model united nations", "model congress"],
  },
  {
    slug: "learn-policy",
    label: "Discuss policy and politics",
    group: "engage",
    categories: ["political-advocacy"],
    words: ["policy", "politics", "political", "government"],
  },
  {
    slug: "volunteer",
    label: "Volunteer",
    group: "engage",
    categories: ["public-service"],
    words: ["volunteer", "volunteers", "volunteering", "tutoring"],
    excludes: notVolunteering,
    rank: volunteerRank,
  },
  {
    slug: "mentor-or-teach",
    label: "Mentor or teach",
    group: "engage",
    categories: ["mentoring-education"],
    words: ["mentoring", "mentors", "tutoring", "teaching"],
  },
  {
    slug: "climate",
    label: "Work on climate and the environment",
    group: "engage",
    categories: [],
    words: ["climate", "environmental", "environment", "sustainability", "sustainable", "clean energy"],
  },
  {
    slug: "cultural-community",
    label: "Find a cultural or identity community",
    group: "engage",
    categories: ["cultural-identity"],
    words: [],
    excludes: careerNetwork,
    rank: communityRank,
  },
  {
    slug: "meet-people",
    label: "Meet people",
    group: "engage",
    categories: ["social", "cultural-identity"],
    // Phrases, not "social" or "community" alone: "social impact", "community service".
    words: [
      "make friends",
      "meet people",
      "meet new people",
      "friendship",
      "friendships",
      "social events",
      "social gatherings",
      "build community",
      "building community",
      "community building",
    ],
    excludes: (c) => isSelectiveSocial(c) || careerNetwork(c),
    rank: meetPeopleRank,
  },
  { slug: "explore-faith", label: "Explore faith", group: "engage", categories: ["religious-spiritual"], words: [] },
  {
    slug: "play-a-sport",
    label: "Play a sport",
    group: "play",
    categories: ["athletics-recreation"],
    words: [],
    excludes: notPlaying,
    rank: playRank,
  },
  {
    slug: "get-outdoors",
    label: "Get outdoors",
    group: "play",
    categories: [],
    words: [
      "outdoors",
      "outdoor",
      "hiking",
      "mountaineering",
      "climbing",
      "camping",
      "skiing",
      "sailing",
      // Round 13: birding and trail riding.
      "birding",
      "cycling",
      "biking",
    ],
    // One camping trip in a secular community's year, or a summer camp's, isn't an outdoors club.
    excludes: (c) => !OUTDOOR_HOMES.some((s) => c.categorySlugs.includes(s)),
  },
  {
    // Round 11: the Topic menu's "Games & hobbies": the Hobbies & Games category, plus clubs
    // named or described by a game.
    slug: "games-hobbies",
    label: "Games & hobbies",
    group: "play",
    categories: ["hobbies-games"],
    words: [
      "chess",
      "poker",
      "esports",
      "tabletop",
      "board games",
      "video game",
      "video games",
      "puzzles",
      "quiz bowl",
      "trivia",
      "crossword",
      "crosswords",
    ],
    excludes: isSelectiveSocial,
  },
  {
    slug: "play-games",
    label: "Play games",
    group: "play",
    categories: [],
    words: [
      "chess",
      "poker",
      "esports",
      "tabletop",
      "board games",
      "video game",
      "video games",
      "game developers",
      "game development",
      "puzzles",
      "quiz bowl",
      "trivia",
    ],
  },
  {
    slug: "compete",
    label: "Join a competitive team",
    group: "play",
    categories: ["competition-teams"],
    words: ["competition", "competitions", "competitive", "tournament", "tournaments"],
  },
];

const prepared = new WeakMap<IndexClub, { words: Set<string>; line: string }>();
function textOf(c: IndexClub): { words: Set<string>; line: string } {
  let t = prepared.get(c);
  if (!t) {
    const cw = clubWords(c);
    const all = `${c.searchNames} ${cw.about}`.split(/\s+|\|/).filter(Boolean);
    t = { words: new Set(all), line: ` ${all.join(" ")} ` };
    prepared.set(c, t);
  }
  return t;
}
/** A word, or a phrase ("mock trial") as consecutive words, in the club's names or description. */
const uses = (c: IndexClub, x: string) =>
  x.includes(" ") ? textOf(c).line.includes(` ${x} `) : textOf(c).words.has(x);

/** Whether the intent's rule picks this club. PURE. */
export function matchesIntent(c: IndexClub, intent: Intent): boolean {
  if (intent.excludes?.(c)) return false;
  if (intent.categories.some((s) => c.categorySlugs.includes(s))) return true;
  return intent.words.some((x) => uses(c, x)) || (intent.nameWords ?? []).some((x) => named(c, x));
}

/** A word or phrase in one of the club's names. */
const named = (c: IndexClub, x: string) => ` ${c.searchNames.replace(/ \| /g, "  ")} `.includes(` ${x} `);

/** The intent's order for a club (0 when it has no ranking). PURE. */
export const intentRank = (c: IndexClub, intent: Intent): number => intent.rank?.(c) ?? 0;

/** Why the rule picked it ("category", or the word it uses), for display. */
export function intentReason(c: IndexClub, intent: Intent): string | null {
  const cat = intent.categories.find((s) => c.categorySlugs.includes(s));
  if (cat) return cat;
  return intent.words.find((x) => uses(c, x)) ?? intent.nameWords?.find((x) => named(c, x)) ?? null;
}
