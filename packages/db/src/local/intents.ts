import type { IndexClub } from "./types";
import { clubWords } from "./words";

/**
 * "What do you want to do?" (ADR 0034). Each intent is a fixed rule over data the index
 * already has — categories, plus words in a club's names and one-line description (not its
 * activity list: "workshops on survey software" doesn't make a club a software group).
 * Deterministic and explained on the page; not a recommendation. PURE.
 */
export interface Intent {
  slug: string;
  label: string;
  /** Clubs in any of these categories match. */
  categories: string[];
  /** Clubs whose names or text use any of these normalized words match. */
  words: string[];
}

export const INTENTS: readonly Intent[] = [
  {
    slug: "build-software",
    label: "Build software",
    categories: ["technology"],
    words: ["software", "coding", "programming", "developers", "hackathon", "app", "apps"],
  },
  {
    slug: "consulting-projects",
    label: "Do consulting projects",
    categories: ["consulting"],
    words: ["consulting", "consultancy"],
  },
  {
    slug: "invest",
    label: "Invest or manage a fund",
    categories: ["finance"],
    words: ["investing", "investment", "investments", "portfolio", "trading", "fund"],
  },
  {
    slug: "perform-music",
    label: "Perform music",
    categories: ["music", "a-cappella"],
    words: ["orchestra", "choir", "chorus", "choral", "ensemble", "cappella", "band", "jazz"],
  },
  { slug: "dance", label: "Dance", categories: ["dance"], words: ["dance", "dancers", "ballet", "troupe"] },
  {
    slug: "act-or-do-comedy",
    label: "Act or do comedy",
    categories: ["theater"],
    words: ["theater", "theatre", "improv", "comedy", "musical", "drama"],
  },
  {
    slug: "write-or-report",
    label: "Write or report",
    categories: ["publications-media"],
    words: ["journalism", "newspaper", "magazine", "writing", "writers", "journal", "publication"],
  },
  {
    slug: "volunteer",
    label: "Volunteer",
    categories: ["public-service"],
    words: ["volunteer", "volunteers", "volunteering", "tutoring"],
  },
  {
    slug: "mentor-or-teach",
    label: "Mentor or teach",
    categories: ["mentoring-education"],
    words: ["mentoring", "mentors", "tutoring", "teaching"],
  },
  {
    slug: "debate",
    label: "Debate or argue cases",
    categories: [],
    words: ["debate", "debating", "parliamentary", "moot", "mock", "nations"],
  },
  { slug: "do-research", label: "Do research", categories: [], words: ["research", "researchers", "lab", "labs"] },
  {
    slug: "compete",
    label: "Join a competitive team",
    categories: ["competition-teams"],
    words: ["competition", "competitions", "competitive", "tournament", "tournaments"],
  },
  {
    slug: "explore-startups",
    label: "Explore startups",
    categories: ["entrepreneurship"],
    words: ["startup", "startups", "entrepreneurship", "founders", "ventures"],
  },
  {
    slug: "learn-policy",
    label: "Learn about policy and politics",
    categories: ["political-advocacy"],
    words: ["policy", "politics", "political", "government"],
  },
  {
    slug: "cultural-community",
    label: "Meet people from a cultural community",
    categories: ["cultural-identity"],
    words: [],
  },
  { slug: "play-a-sport", label: "Play a sport", categories: ["athletics-recreation"], words: [] },
  { slug: "explore-faith", label: "Explore faith", categories: ["religious-spiritual"], words: [] },
  {
    slug: "prepare-for-medicine",
    label: "Prepare for medicine",
    categories: ["medicine-health"],
    words: ["premedical", "premed", "medicine", "medical"],
  },
];

const prepared = new WeakMap<IndexClub, Set<string>>();
function wordsOf(c: IndexClub): Set<string> {
  let w = prepared.get(c);
  if (!w) {
    const cw = clubWords(c);
    w = new Set(`${c.searchNames} ${cw.about}`.split(/\s+|\|/).filter(Boolean));
    prepared.set(c, w);
  }
  return w;
}

/** Whether the intent's rule picks this club. PURE. */
export function matchesIntent(c: IndexClub, intent: Intent): boolean {
  if (intent.categories.some((s) => c.categorySlugs.includes(s))) return true;
  const w = wordsOf(c);
  return intent.words.some((x) => w.has(x));
}

/** Why the rule picked it ("category", or the word it uses), for display. */
export function intentReason(c: IndexClub, intent: Intent): string | null {
  const cat = intent.categories.find((s) => c.categorySlugs.includes(s));
  if (cat) return cat;
  const w = wordsOf(c);
  return intent.words.find((x) => w.has(x)) ?? null;
}
