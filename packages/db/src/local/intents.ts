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
}

export const INTENTS: readonly Intent[] = [
  {
    slug: "build-software",
    label: "Build software",
    group: "build",
    categories: ["technology"],
    words: ["software", "coding", "programming", "developers", "hackathon", "app", "apps", "computer science"],
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
    words: ["research", "researchers", "lab", "labs"],
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
    words: ["investing", "investment", "investments", "portfolio", "trading", "fund"],
  },
  {
    slug: "consulting-projects",
    label: "Do consulting projects",
    group: "career",
    categories: ["consulting"],
    words: ["consulting", "consultancy"],
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
    words: ["visual art", "visual arts", "painting", "drawing", "photography", "design", "studio art", "artists"],
  },
  {
    slug: "perform-music",
    label: "Play music",
    group: "create",
    categories: ["music"],
    words: ["orchestra", "ensemble", "band", "jazz", "musicians", "symphony"],
  },
  {
    slug: "sing",
    label: "Sing",
    group: "create",
    categories: ["a-cappella"],
    words: ["choir", "chorus", "choral", "cappella", "singers", "singing", "glee"],
  },
  {
    slug: "dance",
    label: "Dance",
    group: "create",
    categories: ["dance"],
    words: ["dance", "dancers", "ballet", "troupe"],
  },
  {
    slug: "act-or-do-comedy",
    label: "Act or do comedy",
    group: "create",
    categories: ["theater"],
    words: ["theater", "theatre", "improv", "comedy", "musical", "drama"],
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
    label: "Meet people from a cultural community",
    group: "engage",
    categories: ["cultural-identity"],
    words: [],
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
  if (intent.categories.some((s) => c.categorySlugs.includes(s))) return true;
  return intent.words.some((x) => uses(c, x));
}

/** Why the rule picked it ("category", or the word it uses), for display. */
export function intentReason(c: IndexClub, intent: Intent): string | null {
  const cat = intent.categories.find((s) => c.categorySlugs.includes(s));
  if (cat) return cat;
  return intent.words.find((x) => uses(c, x)) ?? null;
}
