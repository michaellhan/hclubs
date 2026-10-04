/**
 * Search concepts: a small, explicit synonym layer (ADR 0034). A query word or phrase in
 * `terms` expands to the concept: clubs in its `categories`, and clubs whose text uses one
 * of its `related` words, match (scored below an exact word hit). Every entry is
 * hand-written and tested; keep each list short — a broad expansion makes results noisy.
 * PURE, browser-safe.
 */
export interface Concept {
  key: string;
  /** Display name, used in "related topics" suggestions. */
  label: string;
  /** Normalized query words/phrases that mean this concept. */
  terms: string[];
  /** Normalized words that, found in a club's names or text, count as a match. */
  related: string[];
  /** Category slugs whose clubs match. */
  categories: string[];
  /** Related words that count only in a club's name ("Outing Club", not "monthly outings"). */
  nameOnly?: string[];
  /**
   * A directory intent whose rule decides which clubs this concept matches (and orders
   * them), beyond a word in their text: "social" and "meet people" use the Meet-people rule
   * (category Social or Cultural, or a stated community purpose; selective social orgs out)
   * instead of any club whose activities say "socials". A club *named* for the word still
   * matches.
   */
  intent?: string;
  /**
   * Words that say the same thing as any term, whichever was typed: spellings of one
   * identity ("latino", "latina", "latinx", "latine") or its usual names ("south asian",
   * "desi"). Each counts as the typed word itself in a club's name or text, a little below
   * the exact word, so "latino" finds what "latinx" finds.
   */
  forms?: string[];
  /**
   * Phrases in a club's name or text that mean another sense of a term: "indian" in a Native
   * American dance troupe is not South Asian. Such a club still matches, as weakly as a
   * passing mention, so the concept's own clubs come first.
   */
  otherSense?: string[];
  /**
   * The typed terms that `otherSense` disambiguates ("indian"). A club is demoted only when
   * the student typed one of these: "desi" at a club whose text says "indigenous" is fine.
   */
  senseTerms?: string[];
}

export const CONCEPTS: readonly Concept[] = [
  {
    key: "consulting",
    label: "Consulting",
    terms: ["consulting", "consultant", "consultants", "consult", "strategy"],
    related: ["consulting", "consultancy", "clients", "strategy"],
    categories: ["consulting"],
  },
  {
    key: "finance",
    label: "Finance & investing",
    terms: [
      "finance",
      "financial",
      "investing",
      "investment",
      "investments",
      "invest",
      "investor",
      "banking",
      "stocks",
      "hedge fund",
      "asset management",
      "private equity",
      "vc",
      "venture capital",
    ],
    related: [
      "finance",
      "financial",
      "investing",
      "investment",
      "investments",
      "investors",
      "fund",
      "capital",
      "banking",
    ],
    categories: ["finance"],
  },
  {
    key: "quant",
    label: "Quantitative finance",
    terms: ["quant", "quantitative", "trading", "trader", "traders", "trade", "trades", "stock market"],
    related: ["quantitative", "trading", "traders", "quant"],
    categories: [],
  },
  {
    key: "entrepreneurship",
    label: "Startups & entrepreneurship",
    terms: [
      "startup",
      "startups",
      "entrepreneurship",
      "entrepreneur",
      "entrepreneurs",
      "entrepreneurial",
      "founder",
      "founders",
      "venture",
      "ventures",
    ],
    related: [
      "startup",
      "startups",
      "entrepreneurship",
      "entrepreneurs",
      "entrepreneurial",
      "founders",
      "ventures",
      "venture",
    ],
    categories: ["entrepreneurship"],
  },
  {
    key: "software",
    label: "Software & computer science",
    terms: [
      "coding",
      "code",
      "programming",
      "programmer",
      "software",
      "software engineering",
      "developer",
      "developers",
      "computer science",
      "cs",
      "computing",
      "web development",
      "websites",
      "website",
      "web apps",
      "app",
      "apps",
      "hackathon",
      "hackathons",
      "comp sci",
      "compsci",
    ],
    related: [
      "computer science",
      "computer",
      "software",
      "programming",
      "coding",
      "developers",
      "hackathon",
      "code",
      "apps",
      "computing",
    ],
    categories: ["technology"],
  },
  {
    key: "tech",
    label: "Technology",
    terms: ["tech", "technology", "technologies"],
    related: ["technology", "tech", "software", "engineering"],
    categories: ["technology"],
  },
  {
    key: "ai",
    label: "Artificial intelligence",
    terms: ["ai", "artificial intelligence", "machine learning", "ml", "deep learning", "llm", "llms"],
    related: ["ai", "artificial intelligence", "machine learning", "machine intelligence"],
    categories: [],
  },
  {
    key: "data",
    label: "Data science",
    terms: ["data", "data science", "analytics", "statistics", "stats"],
    related: ["data", "analytics", "statistics", "statistical"],
    categories: [],
  },
  {
    key: "robotics",
    label: "Robotics",
    terms: ["robotics", "robot", "robots", "robotic"],
    related: ["robotics", "robot", "robots", "robotic"],
    categories: [],
  },
  {
    key: "engineering",
    label: "Engineering",
    terms: ["engineering", "engineer", "engineers", "hardware", "aerospace", "rocketry", "rockets"],
    related: ["engineering", "engineers", "aerospace", "rocketry", "satellite", "hardware"],
    categories: [],
  },
  {
    // "build things" / "make things": hands-on making, hardware or software.
    key: "making",
    label: "Building & making",
    terms: [
      "build things",
      "building things",
      "make things",
      "making things",
      "maker",
      "makers",
      "makerspace",
      "hands on",
      "tinkering",
      "prototyping",
    ],
    related: [
      "engineering",
      "robotics",
      "hardware",
      "makers",
      "maker",
      "makerspace",
      "prototype",
      "prototypes",
      "rocketry",
      "aerospace",
      "hackathon",
      "vehicle",
    ],
    categories: ["technology"],
  },
  {
    key: "premed",
    label: "Pre-med & medicine",
    terms: [
      "premed",
      "pre med",
      "premedical",
      "medicine",
      "medical",
      "medical school",
      "doctor",
      "doctors",
      "physician",
      "dental",
      "predental",
    ],
    related: ["premedical", "premed", "medicine", "medical", "physicians", "clinical"],
    categories: ["medicine-health"],
  },
  {
    key: "health",
    label: "Health",
    terms: ["health", "healthcare", "public health", "global health"],
    related: ["health", "healthcare", "wellness"],
    categories: ["medicine-health", "health-service"],
  },
  {
    // Its own concept: under "health", any club with "Health" in its name outranked the
    // ones that actually talk about mental health.
    key: "mental-health",
    label: "Mental health & wellness",
    terms: ["mental health", "wellness", "wellbeing", "well being", "peer counseling", "peer support"],
    related: ["mental health", "wellness", "wellbeing", "peer counseling", "peer support", "counseling"],
    categories: [],
  },
  {
    key: "law",
    label: "Law",
    terms: ["law", "legal", "prelaw", "pre law", "lawyer", "lawyers", "attorney"],
    related: ["law", "legal", "prelaw", "lawyers"],
    categories: ["law"],
  },
  {
    key: "service",
    label: "Public service",
    terms: [
      "volunteer",
      "volunteers",
      "volunteering",
      "service",
      "community service",
      "public service",
      "charity",
      "nonprofit",
      "non profit",
      "tutoring",
      "tutor",
    ],
    related: ["volunteer", "volunteers", "volunteering", "tutoring", "tutors"],
    categories: ["public-service"],
  },
  {
    key: "mentoring",
    label: "Mentoring & education",
    terms: ["mentoring", "mentor", "mentors", "teaching", "teach", "education", "kids", "children", "youth"],
    related: ["mentoring", "mentors", "mentor", "teaching", "tutoring"],
    categories: ["mentoring-education"],
  },
  {
    key: "journalism",
    label: "Writing & journalism",
    terms: [
      "journalism",
      "journalist",
      "newspaper",
      "news",
      "reporting",
      "reporter",
      "writing",
      "write",
      "writes",
      "writer",
      "writers",
      "magazine",
      "press",
      "editorial",
      "publication",
      "publications",
    ],
    related: [
      "journalism",
      "newspaper",
      "magazine",
      "writing",
      "writers",
      "publication",
      "publishes",
      "editorial",
      "articles",
    ],
    categories: ["publications-media"],
  },
  {
    key: "policy",
    label: "Politics & policy",
    terms: [
      "policy",
      "politics",
      "political",
      "government",
      "public policy",
      "elections",
      "campaigns",
      "advocacy",
      "activism",
    ],
    related: ["policy", "politics", "political", "government", "advocacy", "civic"],
    categories: ["political-advocacy"],
  },
  {
    key: "debate",
    label: "Debate & mock trial",
    terms: ["debate", "debating", "debater", "speech", "mock trial", "moot court"],
    related: ["debate", "debating", "parliamentary", "mock trial", "moot court"],
    categories: [],
  },
  {
    key: "model-un",
    label: "Model UN & Model Congress",
    terms: ["model un", "model united nations", "mun", "model congress"],
    related: ["model united nations", "model congress"],
    categories: [],
  },
  {
    key: "music",
    label: "Music",
    terms: [
      "music",
      "musician",
      "musicians",
      "band",
      "orchestra",
      "orchestras",
      "symphony",
      "jazz",
      "instrument",
      "instruments",
    ],
    related: ["music", "musicians", "orchestra", "band", "ensemble", "jazz", "symphony", "musicum"],
    categories: ["music"],
  },
  {
    key: "singing",
    label: "Singing",
    terms: ["singing", "sing", "singer", "singers", "choir", "choirs", "chorus", "choral", "vocal", "vocals"],
    related: ["singing", "singers", "choir", "chorus", "choral", "cappella", "vocal", "glee"],
    categories: ["a-cappella"],
  },
  {
    key: "a-cappella",
    label: "A cappella",
    terms: ["a cappella", "a capella", "acapella", "acappella", "cappella"],
    related: ["cappella", "capella"],
    categories: ["a-cappella"],
  },
  {
    key: "dance",
    label: "Dance",
    terms: ["dance", "dancing", "dancer", "dancers", "ballet", "hip hop", "hiphop", "breakdancing", "kpop", "k pop"],
    // Named dance forms after the general words: a club named for one (Bhangra, Folklórico)
    // is a dance group even when no category or text says "dance".
    related: [
      "dance",
      "dancers",
      "dancing",
      "ballet",
      "troupe",
      "choreography",
      "bhangra",
      "bharatanatyam",
      "kathak",
      "garba",
      "raas",
      "ghungroo",
      "folklorico",
      "salsa",
      "ballroom",
    ],
    categories: ["dance"],
  },
  {
    key: "theater",
    label: "Theater & comedy",
    terms: [
      "theater",
      "theatre",
      "drama",
      "acting",
      "actor",
      "actors",
      "musical",
      "musicals",
      "improv",
      "comedy",
      "stand up",
    ],
    related: ["theater", "theatre", "theatrical", "drama", "acting", "musical", "improv", "comedy", "plays"],
    categories: ["theater"],
  },
  {
    key: "arts",
    label: "Visual arts",
    terms: ["art", "arts", "visual art", "visual arts", "painting", "drawing", "creative", "studio art"],
    related: ["art", "arts", "artists", "painting", "drawing", "creative"],
    categories: [],
  },
  {
    key: "film",
    label: "Film & video",
    terms: ["film", "films", "filmmaking", "movie", "movies", "cinema", "video", "videography"],
    related: ["film", "films", "filmmaking", "cinema", "video", "documentary", "television"],
    categories: [],
  },
  {
    key: "research",
    label: "Research",
    terms: ["research", "researcher", "researchers", "lab", "labs", "science", "sciences", "stem"],
    related: ["research", "researchers", "science", "scientific", "lab"],
    categories: ["academic-stem"],
  },
  {
    key: "math",
    label: "Math",
    terms: ["math", "maths", "mathematics", "mathematical"],
    related: ["math", "mathematics", "mathematical"],
    categories: [],
  },
  {
    key: "economics",
    label: "Economics",
    terms: ["economics", "econ", "economy", "economic"],
    related: ["economics", "economic", "econ", "economy"],
    categories: [],
  },
  {
    key: "competition",
    label: "Competitive teams",
    terms: ["competition", "competitions", "compete", "competitive", "tournament", "tournaments"],
    related: ["competition", "competitions", "competitive", "compete", "tournament", "tournaments"],
    categories: ["competition-teams"],
  },
  {
    key: "sports",
    label: "Sports & recreation",
    terms: ["sport", "sports", "athletics", "athletic", "fitness", "club sport", "club sports", "intramurals"],
    related: ["sport", "sports", "athletes", "athletic", "fitness"],
    categories: ["athletics-recreation"],
  },
  {
    key: "outdoors",
    label: "Outdoors",
    terms: [
      "outdoors",
      "outdoor",
      "hiking",
      "hike",
      "camping",
      "climbing",
      "rock climbing",
      "backpacking",
      "mountaineering",
      "skiing",
      "sailing",
    ],
    related: ["outdoors", "outdoor", "hiking", "mountaineering", "climbing", "camping", "backpacking", "skiing"],
    categories: [],
    nameOnly: ["outing"],
  },
  {
    key: "faith",
    label: "Religious & spiritual",
    terms: ["religion", "religious", "faith", "spiritual", "spirituality", "worship", "church", "bible", "ministry"],
    related: ["faith", "religious", "spiritual", "worship", "fellowship", "ministry"],
    categories: ["religious-spiritual"],
  },
  {
    key: "culture",
    label: "Cultural & identity",
    terms: ["culture", "cultural", "identity", "heritage", "diaspora", "international students"],
    related: ["culture", "cultural", "heritage", "community"],
    categories: ["cultural-identity"],
  },
  {
    // South Asian clubs: the region's names, its diaspora's word ("desi") and its national
    // and performing groups. Bare "indian" is a term, but a club where it means Native
    // American ("Intertribal Indian Dance Troupe") is another sense. Not religious groups:
    // faith is not ethnicity.
    key: "south-asian",
    label: "South Asian",
    terms: ["south asian", "south asians", "south asia", "desi", "desis", "bollywood", "indian"],
    forms: ["south asian", "desi"],
    related: [
      "south asian",
      "desi",
      "bhangra",
      "bollywood",
      "ghungroo",
      "bharatanatyam",
      "kathak",
      "garba",
      "raas",
      "punjabi",
      "indian international",
      "pakistani",
      "bangladeshi",
      "bengali",
      "nepali",
      "sri lankan",
      "tamil",
    ],
    categories: [],
    otherSense: ["native american", "native americans", "american indian", "intertribal", "indigenous"],
    senseTerms: ["indian", "indians"],
  },
  {
    // Latino/Latinx clubs under any of the community's spellings, plus Mexican, Caribbean
    // and Latin American groups and folklórico/mariachi ensembles. Not bare "latin" (the
    // language, "Cambridge Rindge & Latin"), nor Brazilian ("Brazilian jiu-jitsu").
    key: "latinx",
    label: "Latino & Latinx",
    terms: [
      "latino",
      "latinos",
      "latina",
      "latinas",
      "latine",
      "latines",
      "latinx",
      "latinxs",
      "latin american",
      "latin americans",
      "hispanic",
      "hispanics",
      "chicano",
      "chicana",
      "chicanx",
    ],
    forms: ["latino", "latina", "latine", "latinx", "hispanic", "chicano", "chicana", "chicanx"],
    related: [
      "latinx",
      "latino",
      "latina",
      "latine",
      "hispanic",
      "chicano",
      "mexican",
      "folklorico",
      "mariachi",
      "dominican",
      "puerto rican",
      "cuban",
    ],
    categories: [],
    // Only in a name: "Latin America" among a club's activities is often one committee or
    // conference among many (Model Congress), not a Latino community.
    nameOnly: ["latin america", "latin american"],
  },
  {
    key: "lgbtq",
    label: "LGBTQ+",
    terms: [
      "lgbtq",
      "lgbt",
      "lgbtqia",
      "queer",
      "gay",
      "lesbian",
      "bisexual",
      "transgender",
      "nonbinary",
      "gender and sexuality",
      "sexuality",
    ],
    related: ["queer", "lgbtq", "lgbt", "lgbtqia", "sexuality", "gay", "lesbian", "transgender", "bisexual"],
    categories: [],
  },
  {
    key: "first-gen",
    label: "First-generation & low-income",
    terms: ["first gen", "firstgen", "first generation", "fgli", "low income", "first generation low income"],
    // Not "low income": programs that *serve* low-income families say it too.
    related: ["first generation", "fgli", "first gen"],
    categories: [],
  },
  {
    key: "social",
    label: "Meet people",
    terms: [
      "social",
      "friends",
      "meet people",
      "meet new people",
      "meeting people",
      "make friends",
      "making friends",
      "new friends",
      "hang out",
    ],
    // No related words: "social" in a name is usually "Social Good" / "Social Impact".
    related: [],
    categories: ["social"],
    intent: "meet-people",
  },
  {
    key: "social-clubs",
    label: "Social clubs",
    terms: ["parties", "final club", "final clubs", "fraternity", "sorority"],
    related: [],
    categories: ["social"],
  },
  {
    key: "games",
    label: "Games",
    terms: [
      "games",
      "gaming",
      "game",
      "gamer",
      "gamers",
      "video games",
      "esports",
      "e sports",
      "board games",
      "tabletop",
    ],
    // Not "games" alone: "home football games", "games and icebreakers".
    related: [
      "gaming",
      "esports",
      "video games",
      "video game",
      "board games",
      "boardgame",
      "tabletop",
      "chess",
      "poker",
      "puzzles",
      "game developers",
      "game development",
    ],
    categories: [],
  },
  {
    key: "hobbies",
    label: "Hobbies",
    terms: ["hobby", "hobbies", "casual", "for fun"],
    related: ["hobby", "hobbies"],
    categories: ["hobbies-games"],
  },
  {
    key: "environment",
    label: "Climate & environment",
    terms: ["climate", "environment", "environmental", "sustainability", "sustainable", "energy", "conservation"],
    related: ["climate", "environmental", "environment", "sustainability", "sustainable", "energy"],
    categories: [],
  },
];

/**
 * Two-word academic shorthands a student types, read as the full phrase: "comp lit" is
 * comparative literature, not the process word "comp" beside "lit" (which found "Glee Club
 * Lite"). "comp sci" is a concept term instead. Keys are normalized.
 */
export const SHORTHANDS: ReadonlyMap<string, string> = new Map([
  ["comp lit", "comparative literature"],
  ["comp gov", "comparative government"],
  ["comp bio", "computational biology"],
  ["comp neuro", "computational neuroscience"],
  ["comp chem", "computational chemistry"],
  ["comp ling", "computational linguistics"],
  ["comp phys", "computational physics"],
]);

/** Concepts by trigger term (single words and phrases), for query parsing. */
export const CONCEPT_BY_TERM: ReadonlyMap<string, Concept> = new Map(
  CONCEPTS.flatMap((c) => c.terms.map((t) => [t, c] as const)),
);
