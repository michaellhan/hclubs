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
    slug: "explore-startups",
    label: "Explore startups",
    group: "career",
    categories: ["entrepreneurship"],
    words: ["startup", "startups", "entrepreneurship", "founders", "ventures"],
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
    ],
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
    excludes: isSelectiveSocial,
    rank: meetPeopleRank,
  },
  { slug: "explore-faith", label: "Explore faith", group: "engage", categories: ["religious-spiritual"], words: [] },
  { slug: "play-a-sport", label: "Play a sport", group: "play", categories: ["athletics-recreation"], words: [] },
  {
    slug: "get-outdoors",
    label: "Get outdoors",
    group: "play",
    categories: [],
    words: ["outdoors", "outdoor", "hiking", "mountaineering", "climbing", "camping", "skiing", "sailing"],
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
