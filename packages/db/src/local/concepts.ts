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
  /**
   * Related words count only at clubs in the concept's categories: "asian" says something
   * about a dance troupe for "kpop", nothing about an international-relations conference.
   */
  relatedInCategory?: boolean;
  /**
   * Words that, in a club's name, count at any club, even under `relatedInCategory`: the
   * topic's own community ("korean" for K-pop: the Korean Association, after Asian American
   * Dance Troupe and before dance groups with no tie to it). They stand in for the category.
   */
  namesAnywhere?: string[];
  /**
   * Whole club names (normalized, any of its names) that are this concept itself, ranked like
   * the typed word in the name: "student government" is the Harvard Undergraduate Association,
   * not every "Undergraduate Association of …".
   */
  clubNames?: string[];
  /**
   * An identity community (Black, South Asian, Latinx, Jewish…). Clubs in Cultural & identity
   * and in no career category (the broad groups) rank first among its matches, "similar clubs"
   * weigh a shared identity above a shared category, and a club whose name or one-liner says
   * it is for this community follows general clubs on other topics (`clubAudiences`).
   */
  identity?: boolean;
  /**
   * Words naming an identity concept's people ("pakistani", "latina"), not its art forms
   * ("bhangra"): in a club's name, or beside people in its one-liner, they say who it is for.
   */
  people?: string[];
  /**
   * The identity concept "<one of `people`> American" also means ("korean american": the
   * Korean groups, then Asian American ones). Its key; the concept itself when the community
   * names its Americans the same way ("mexican american" → Latino & Latinx).
   */
  diaspora?: string;
  /**
   * Phrases in which a term means nothing about this concept here: a venue ("Sanders
   * Theatre"), a dress code ("black tie"), a name ("Black Diamond"), a combined directory label
   * ("theater dance"). Left out of a club's names and text before matching, unless the query
   * itself says the phrase.
   */
  notSense?: string[];
  /** Related words that count only in a club's text, never its name ("socials" is events; "Social" in a name is "Social Impact"). */
  textOnly?: string[];
  /** The word in an activity list says too little ("black tie dinners", "dances"): only names and descriptions count. */
  notInActivities?: boolean;
  /**
   * The concept's words count in a club's description and activities only at clubs in these
   * categories; elsewhere they are another sense ("running a business"). Names always count.
   */
  textCategories?: string[];
  /**
   * Words that count in a club's description and activities only at clubs in the concept's
   * categories: elsewhere they describe something else's style ("theatrical concerts" at an
   * orchestra, "plays" at a band, "a theater" as a venue). Names always count.
   */
  inCategoryText?: string[];
  /**
   * Phrases a club's one-line description uses to say it *is* this kind of thing ("student
   * newspaper", "weekly print issues"): such a club ranks with clubs whose description says the
   * typed word, above a club with only a related word in its name ("magazine"). Round 11.
   */
  kinds?: string[];
  /**
   * Typed terms the `kinds` lift doesn't answer: a broader sense ("writing" is creative writing
   * too, so a newspaper doesn't outrank the Creative Writing Collective; persona round 8).
   */
  kindsNotFor?: string[];
  /**
   * A second half the concept needs ("nonprofit consulting" is consulting *for* nonprofits):
   * a club not named for the concept matches only when its names or text also use one of these.
   */
  alsoNeeds?: string[];
  /**
   * One related word in a club's activity list counts on its own ("patients", "hospitals"
   * among a pre-med society's activities): the words are specific to the topic.
   */
  activitiesCount?: boolean;
  /**
   * The concept's categories are wider than the topic ("Music" for "orchestra"): a club found
   * only through one is a passing match, which soft words ("no audition") lift only slightly,
   * so an open choir doesn't lead "orchestra no audition" (Round 12).
   */
  widerCategory?: boolean;
  /**
   * Its own terms in a name stand in for the category too ("Chorus", "Choral" for "sing": choirs
   * are filed under Music, not A cappella). Only where every term is specific (Round 12).
   */
  termNamesStandIn?: boolean;
  /**
   * Something a student takes part in ("debate", "competition"): a club that only organizes
   * the event for others (a conference or tournament for high schoolers; `organizesOnly` in
   * search.ts) follows every club whose members do it themselves (Round 13).
   */
  participate?: boolean;
}

/** "start a company", "founding my own startup", "launch a business" (normalized). */
const START_A_COMPANY: string[] = ["start", "starting", "found", "founding", "build", "building", "launch", "launching"]
  .flatMap((v) => ["a", "my own", "your own", "our own", "own", ""].map((a) => (a ? `${v} ${a}` : v)))
  .flatMap((lead) => ["company", "business", "startup", "venture"].map((o) => `${lead} ${o}`));

export const CONCEPTS: readonly Concept[] = [
  {
    key: "consulting",
    label: "Consulting",
    // Round 12: case interviews are how consulting clubs and firms select ("case interview"
    // had found only one club that wrote both words).
    terms: [
      "consulting",
      "consultant",
      "consultants",
      "consult",
      "strategy",
      "case interview",
      "case interviews",
      "case prep",
      "case competition",
      "case competitions",
    ],
    related: [
      "consulting",
      "consultancy",
      "clients",
      "strategy",
      "pro bono",
      "case interviews",
      "case competitions",
      "case teams",
    ],
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
      "fintech",
      "stocks",
      "hedge fund",
      "asset management",
      "private equity",
      "vc",
      "venture capital",
    ],
    // Not bare "fund": "raise money for the Jimmy Fund", "advocate for, fund, and support".
    related: [
      "finance",
      "financial",
      "investing",
      "investment",
      "investments",
      "investors",
      "hedge fund",
      "investment fund",
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
      // "start-up" normalizes to two words; "start" alone is a filler verb ("start a club").
      "start up",
      "start ups",
      // "start a company", "found my own business": the phrase is the topic, so "Company" in
      // a dance company's name never answers it (Round 10).
      ...START_A_COMPANY,
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
      "web dev",
      "app dev",
      "app development",
      "websites",
      "website",
      "web apps",
      "app",
      "apps",
      "hackathon",
      "hackathons",
      "hacking",
      "hacker",
      "hackers",
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
      "cybersecurity",
    ],
    categories: ["technology"],
  },
  {
    key: "tech",
    label: "Technology",
    terms: ["tech", "technology", "technologies"],
    // The fields "tech" covers, so a computer science club's own text answers it, not only an
    // umbrella word in some club's name ("… Life Science & Technology").
    related: [
      "technology",
      "tech",
      "software",
      "engineering",
      "computer science",
      "computer",
      "computing",
      "programming",
      "coding",
      "robotics",
      "hardware",
      "machine learning",
      "artificial intelligence",
    ],
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
    related: ["statistics", "data", "analytics", "statistical"],
    categories: [],
  },
  {
    // Round 13: how software, quant and data roles select, as case interviews are consulting's
    // ("technical interviews" had found nothing: no club's page says the phrase). The clubs
    // whose own text is about those fields, the most specific words first.
    key: "tech-interviews",
    label: "Technical interviews",
    terms: [
      "technical interview",
      "technical interviews",
      "tech interview",
      "tech interviews",
      "coding interview",
      "coding interviews",
      "leetcode",
    ],
    related: [
      "technical interviews",
      "coding interviews",
      "software engineering",
      "quantitative",
      "trading",
      "data science",
      "computer science",
      "software",
      // Not "programming": "social and intellectual programming" is events.
      "coding",
      "data",
    ],
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
    terms: ["engineering", "engineer", "engineers", "hardware", "aerospace", "rocketry", "rockets", "drones", "drone"],
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
    // Round 11: volunteering where patients are (hospitals, clinics, hospices, memory care).
    // Not the pre-med career groups: the clubs that put students beside patients.
    key: "clinical",
    label: "Hospital & clinical volunteering",
    terms: [
      "hospital",
      "hospitals",
      "hospital volunteering",
      "hospital volunteer",
      "clinical",
      "clinical volunteering",
      "clinical experience",
      "clinic",
      "clinics",
      "patient",
      "patients",
      "patient care",
      "hospice",
      "memory care",
      "nursing home",
      "nursing homes",
      "dementia",
      "alzheimers",
    ],
    related: [
      "hospital",
      "hospitals",
      "patient",
      "patients",
      "clinic",
      "clinics",
      "clinical",
      "hospice",
      "memory care",
      "nursing homes",
      "dementia",
      "alzheimers",
    ],
    categories: ["health-service"],
    // "Skating clinics" are lessons: the words count in text only at health and service clubs.
    textCategories: ["health-service", "medicine-health", "public-service", "adult-services"],
    activitiesCount: true,
  },
  {
    // Round 11: "EMT" names CrimsonEMS, whose one name word runs "Crimson" and "EMS" together.
    key: "ems",
    label: "Emergency medicine",
    terms: [
      "emt",
      "emts",
      "ems",
      "emergency medical",
      "emergency medical services",
      "emergency medicine",
      "paramedic",
      "first aid",
      "first responder",
      "first responders",
      "cpr",
    ],
    related: ["emergency medical", "emts", "emt", "first aid", "emergency medicine", "cpr"],
    categories: [],
    clubNames: ["crimsonems"],
  },
  {
    // Round 11: consulting for nonprofits and the public good. Two halves: an impact word and a
    // consulting word (`alsoNeeds`), so a service program that mentions "clients" doesn't match.
    key: "social-impact-consulting",
    label: "Social impact consulting",
    terms: [
      "social impact consulting",
      "nonprofit consulting",
      "non profit consulting",
      "pro bono consulting",
      "impact consulting",
      "consulting for nonprofits",
      "consulting for non profits",
    ],
    related: [
      "social impact",
      "nonprofit",
      "nonprofits",
      "non profit",
      "non profits",
      "pro bono",
      "social good",
      "public sector",
      "humanitarian",
    ],
    categories: [],
    alsoNeeds: ["consulting", "consultancy", "consultants", "clients", "client", "pro bono", "case teams", "case team"],
  },
  {
    // Nonprofits and social impact on their own ("nonprofit", "social good").
    key: "social-impact",
    label: "Nonprofits & social impact",
    terms: ["nonprofit", "nonprofits", "non profit", "non profits", "social impact", "social good", "pro bono"],
    related: ["nonprofit", "nonprofits", "non profit", "non profits", "social impact", "social good", "pro bono"],
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
      "tutoring",
      "tutored",
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
      // Round 11: what students write for a paper.
      "op ed",
      "op eds",
      "oped",
      "opeds",
      "opinion",
      "opinions",
      "opinion writing",
      "column",
      "columns",
      "columnist",
      "editorials",
      "student newspaper",
      "student paper",
      "zine",
      "zines",
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
      "op eds",
      "opinion",
      "columns",
    ],
    categories: ["publications-media"],
    // Polling ("Public Opinion Project") is not an opinion section.
    notSense: ["public opinion"],
    kinds: ["newspaper", "news magazine", "print issues", "print issue", "daily paper", "weekly paper"],
    kindsNotFor: ["writing", "writer", "writers"],
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
      "voting",
      "vote",
      "voters",
      "civic engagement",
      "democracy",
    ],
    related: ["policy", "politics", "political", "government", "advocacy", "civic", "votes", "voting"],
    categories: ["political-advocacy"],
  },
  {
    key: "debate",
    label: "Debate & mock trial",
    terms: ["debate", "debating", "debater", "speech", "mock trial", "moot court"],
    related: ["debate", "debating", "parliamentary", "mock trial", "moot court"],
    categories: [],
    participate: true,
  },
  {
    key: "model-un",
    label: "Model UN & Model Congress",
    terms: ["model un", "model united nations", "mun", "model congress"],
    related: ["model united nations", "model congress"],
    categories: [],
  },
  // Persona round 8: DJing and making beats or electronic music. No club's text says these
  // words, so the Electronic Music Collective is reached by its name and a radio station by
  // what it is; the rest of Music follows through the category.
  {
    key: "music-production",
    label: "Music production & DJ",
    terms: [
      "dj",
      "djs",
      "djing",
      "edm",
      "beats",
      "beat making",
      "beatmaking",
      "making beats",
      "music production",
      "music producer",
      "music producers",
      "producing music",
      "produce music",
      "electronic music",
      "synth",
      "synths",
      "ableton",
    ],
    related: ["electronic music", "electronic", "radio"],
    categories: ["music"],
    widerCategory: true,
    clubNames: ["harvard undergraduate electronic music collective"],
  },
  {
    key: "music",
    label: "Music",
    terms: [
      "music",
      "musician",
      "musicians",
      "band",
      "jazz",
      "instrument",
      "instruments",
      "piano",
      "pianist",
      "guitar",
      "drums",
      "drumming",
      "percussion",
      "songwriting",
      "songwriter",
      "composing",
      "composer",
      "composition",
      "rap",
    ],
    related: [
      "music",
      "musicians",
      "orchestra",
      "band",
      "ensemble",
      "jazz",
      "symphony",
      "musicum",
      "piano",
      "cellos",
      "drummers",
      "steelpan",
      "composers",
      "cappella",
    ],
    // A cappella is music too ("jewish music" → a Jewish a cappella group).
    categories: ["music", "a-cappella"],
  },
  // Round 12: orchestral and string playing, apart from Music, so "violin" and "orchestra" find
  // the orchestras and string groups before the music umbrella ("Music" in a business club's
  // name). Names count anywhere (Crimson Cellos); text only at Music clubs.
  {
    key: "orchestra",
    label: "Orchestra & strings",
    terms: [
      "orchestra",
      "orchestras",
      "orchestral",
      "symphony",
      "symphonic",
      "philharmonic",
      "violin",
      "violins",
      "violinist",
      "viola",
      "violist",
      "cello",
      "cellos",
      "cellist",
      "double bass",
      "strings",
      "string instruments",
      "string quartet",
      "chamber music",
      "concertmaster",
    ],
    related: ["orchestra", "symphony", "strings", "cellos", "chamber", "philharmonic", "string"],
    categories: ["music"],
    textCategories: ["music"],
    widerCategory: true,
  },
  {
    key: "singing",
    label: "Singing",
    terms: ["singing", "sing", "singer", "singers", "choir", "choirs", "chorus", "choral", "vocal", "vocals"],
    related: ["singing", "singers", "choir", "chorus", "choral", "cappella", "vocal", "glee"],
    categories: ["a-cappella"],
    termNamesStandIn: true,
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
    terms: [
      "dance",
      "dancing",
      "dancer",
      "dancers",
      "ballet",
      "hip hop",
      "hiphop",
      "breakdancing",
      "breakdance",
      "breaking",
      "bboy",
    ],
    // Named dance forms after the general words: a club named for one (Bhangra, Folklórico)
    // is a dance group even when no category or text says "dance". Not "troupe": improv and
    // comedy troupes say it as often.
    related: [
      "dance",
      "dancers",
      "dancing",
      "ballet",
      "choreography",
      "hip hop",
      "breakdancing",
      "breaking",
      "popping",
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
    nameOnly: ["breakers"],
    // An activity list's "dances" are events (a final club's formals, an orchestra playing
    // dances), and "theater dance" is the directory's combined label: dance groups are in Dance.
    notInActivities: true,
    notSense: ["theater dance", "theatre dance"],
    // "Breaking news", "popping up": dance styles only at dance groups.
    inCategoryText: ["breaking", "popping"],
  },
  {
    // Students from abroad, not every cultural group ("international relations" isn't it).
    key: "international-students",
    identity: true,
    people: ["international students", "international student"],
    label: "International students",
    terms: ["international students", "international student", "intl students", "foreign students"],
    related: [],
    categories: [],
    nameOnly: ["international students", "international student"],
  },
  {
    // The student government (the Undergraduate Association since 2022) and house and class
    // committees.
    key: "student-government",
    label: "Student government",
    terms: [
      "student government",
      "student council",
      "undergraduate council",
      "ug council",
      "ugc",
      "student senate",
      "class committee",
    ],
    related: ["student government", "house committee", "class committee"],
    categories: [],
    nameOnly: ["undergraduate council", "social committee"],
    clubNames: ["harvard undergraduate association", "undergraduate council"],
  },
  {
    key: "crypto",
    label: "Crypto & blockchain",
    terms: ["crypto", "cryptocurrency", "blockchain", "web3", "bitcoin", "ethereum", "defi"],
    related: ["blockchain", "crypto", "cryptocurrency", "web3"],
    categories: [],
  },
  {
    // Harvard's riding sport is polo.
    key: "equestrian",
    label: "Riding",
    terms: ["equestrian", "horse", "horses", "horseback", "horseback riding", "horse riding"],
    related: ["polo", "equestrian", "horse", "horses"],
    categories: [],
  },
  {
    key: "lifting",
    label: "Lifting & strength",
    terms: ["weightlifting", "lifting", "powerlifting", "bodybuilding", "strength training", "gym", "weights"],
    related: ["powerlifting", "weightlifting", "lifting", "barbell"],
    categories: [],
  },
  {
    key: "meditation",
    label: "Meditation & mindfulness",
    terms: ["meditation", "meditate", "mindfulness", "mindful", "zen"],
    related: ["meditation", "mindfulness"],
    categories: [],
  },
  {
    key: "jewish",
    identity: true,
    people: ["jewish", "jews", "hillel"],
    label: "Jewish life",
    terms: ["jewish", "judaism", "jews", "hillel", "kosher", "shabbat"],
    related: ["jewish", "hillel", "judaism", "jews"],
    categories: [],
  },
  {
    // Datamatch's own listing: "sponsors free dates at Harvard Square businesses".
    key: "dating",
    label: "Dating",
    terms: ["dating", "matchmaking", "valentines", "valentine"],
    related: ["matchmaking", "dating"],
    categories: [],
    clubNames: ["datamatch"],
  },
  {
    key: "justice",
    label: "Rights & justice",
    terms: [
      "justice",
      "social justice",
      "human rights",
      "civil rights",
      "racial justice",
      "criminal justice",
      "prison reform",
      "incarceration",
    ],
    related: ["justice", "rights", "prison", "incarceration", "reform"],
    categories: ["advocacy-justice"],
  },
  {
    key: "photography",
    label: "Photography",
    terms: ["photography", "photo", "photos", "photographer", "photographers", "film photography", "camera", "cameras"],
    related: ["photography", "photographers", "photo"],
    categories: [],
  },
  {
    key: "astronomy",
    label: "Astronomy",
    terms: ["astronomy", "astrophysics", "astronomers", "stargazing", "telescope", "telescopes", "cosmology"],
    related: ["astronomy", "astronomers", "astrophysics"],
    categories: [],
  },
  {
    key: "biology",
    label: "Biology",
    terms: [
      "biology",
      "bio",
      "genetics",
      "genomics",
      "molecular biology",
      "microbiology",
      "synthetic biology",
      "marine biology",
      "biochemistry",
      "biochem",
      "bioinformatics",
      "computational biology",
    ],
    related: ["biology", "microbiology", "genetically", "synthetic bio", "biotechnology", "biomedical", "bio"],
    categories: [],
  },
  {
    key: "food",
    label: "Food & cooking",
    terms: ["food", "foods", "cooking", "cook", "culinary", "chef", "baking", "bake", "nutrition"],
    related: ["food", "cooking", "baking", "culinary", "nutrition"],
    categories: [],
    // Round 11: a food drive or food security group is hunger relief, not cooking.
    notSense: ["food security", "food insecurity", "food drive", "food drives", "food bank", "food pantry"],
  },
  {
    key: "hunger",
    label: "Hunger & food security",
    terms: ["food insecurity", "food security", "hunger", "food bank", "food banks", "food pantry", "food drive"],
    related: ["food insecurity", "food security", "hunger", "food drive", "food bank", "food pantry", "meals"],
    categories: [],
  },
  {
    key: "design",
    label: "Design",
    terms: [
      "design",
      "graphic design",
      "interior design",
      "product design",
      "ux",
      "ui design",
      "architecture",
      "urban planning",
      "urban design",
    ],
    related: ["design", "designers", "architecture", "urban planning"],
    categories: [],
  },
  {
    key: "international-relations",
    label: "International relations",
    terms: [
      "international relations",
      "international affairs",
      "foreign policy",
      "foreign affairs",
      "global affairs",
      "diplomacy",
      "geopolitics",
    ],
    related: [
      "international relations",
      "foreign policy",
      "international affairs",
      "diplomacy",
      "global affairs",
      "model united nations",
    ],
    categories: [],
  },
  {
    key: "neuroscience",
    label: "Neuroscience",
    terms: ["neuro", "neuroscience", "neurobiology", "brain science"],
    related: ["neuroscience", "neurobiology", "mind brain", "brain"],
    categories: [],
  },
  {
    key: "pre-vet",
    label: "Pre-vet",
    terms: ["pre vet", "prevet", "veterinary", "vet school", "veterinarian"],
    related: ["veterinary", "veterinarian", "animals"],
    categories: [],
  },
  {
    key: "psychology",
    label: "Psychology",
    terms: ["psychology", "psych", "psychological", "cognitive science", "mind brain behavior", "mbb"],
    related: ["psychology", "mind brain", "behavior", "cognitive", "neuroscience"],
    categories: [],
  },
  {
    key: "martial-arts",
    label: "Martial arts",
    terms: [
      "martial arts",
      "martial art",
      "self defense",
      "combat sports",
      "karate",
      "judo",
      "taekwondo",
      "tae kwon do",
      "kendo",
      "jiu jitsu",
      "bjj",
      "kung fu",
      "wushu",
      "mma",
    ],
    related: ["martial", "judo", "karate", "kendo", "taekwondo", "combat", "jiu jitsu", "wushu", "boxing"],
    categories: [],
  },
  {
    key: "iranian",
    identity: true,
    people: ["iranian", "iranians", "persian", "persians"],
    label: "Iranian & Persian",
    terms: ["persian", "persians", "iranian", "iranians", "iran", "persia", "farsi"],
    related: ["iranian", "persian", "iran"],
    categories: [],
  },
  {
    key: "scifi",
    label: "Science fiction & fantasy",
    terms: ["sci fi", "scifi", "science fiction", "fantasy"],
    related: ["science fiction", "fantasy"],
    categories: [],
  },
  {
    // The Classical Club is the classics (Greek and Latin) club; "classical" elsewhere is music.
    key: "classics",
    label: "Classics",
    terms: ["classics", "ancient greek", "greek and latin", "latin and greek"],
    related: ["classics"],
    categories: [],
    nameOnly: ["classical club"],
  },
  {
    // No club we know says it dances K-pop (2026-10-04): dance groups named or described as
    // Asian or Korean, or doing hip-hop, come first, then the rest of Dance. A club whose own
    // text says K-pop matches by the word itself. Never a claim that a club does K-pop.
    key: "kpop",
    label: "K-pop",
    terms: ["kpop", "k pop", "korean pop"],
    related: ["korean", "korea", "asian", "hip hop", "hiphop", "open style"],
    categories: ["dance"],
    relatedInCategory: true,
    namesAnywhere: ["korean", "korea"],
  },
  {
    // Round 14: "bollywood" had been a South Asian term and listed every South Asian club
    // (business, music, the Sri Lankan Club) before any dance group. It is a dance style: groups
    // named for a South Asian dance form or whose one-liner says one (Bhangra, Ghungroo, Deepam's
    // Bharatanatyam) come first, then the community's groups by name (`namesAnywhere`). Other
    // dance groups (ballet, tap) don't match (`alsoNeeds`). Never a claim that a club dances
    // Bollywood: only a club's own text says that. "south asian dance" stays two words (South
    // Asian + dance, Round 4).
    key: "south-asian-dance",
    label: "Bollywood & South Asian dance",
    terms: [
      "bollywood",
      "bollywood dance",
      "bollywood dancing",
      "indian classical dance",
      "classical indian dance",
      // Forms no club names or describes yet: the South Asian dance groups are the nearest
      // answer. Not "bharatanatyam": Deepam says it, so the word finds Deepam alone.
      "kathak",
      "odissi",
      "kuchipudi",
    ],
    related: [
      "bollywood",
      "bhangra",
      "ghungroo",
      "bharatanatyam",
      "kathak",
      "odissi",
      "kuchipudi",
      "garba",
      "raas",
      "south asian",
      "desi",
      "punjabi",
    ],
    categories: ["dance"],
    relatedInCategory: true,
    namesAnywhere: [
      "south asian",
      "desi",
      "indian",
      "pakistani",
      "bangladeshi",
      "bengali",
      "nepali",
      "sri lankan",
      "tamil",
    ],
    // The Intertribal Indian Dance Troupe dances Native American powwow dances.
    notSense: ["intertribal indian", "american indian", "native american", "native americans"],
    // A one-liner naming the form it performs ("Harvard Deepam performs Bharatanatyam") says the
    // club is a South Asian dance group: before the associations, which only share the community.
    kinds: ["bollywood", "bhangra", "bharatanatyam", "kathak", "odissi", "kuchipudi", "garba", "raas"],
    alsoNeeds: [
      "bollywood",
      "bhangra",
      "ghungroo",
      "bharatanatyam",
      "kathak",
      "odissi",
      "kuchipudi",
      "garba",
      "raas",
      "south asian",
      "desi",
      "punjabi",
      "indian",
      "pakistani",
      "bangladeshi",
      "bengali",
      "nepali",
      "sri lankan",
      "tamil",
    ],
  },
  {
    // Round 14: classical dance forms, Western and Indian (ballet, Bharatanatyam, Kathak,
    // Odissi), not "classical" music ("classical repertoire" at an orchestra) and not every
    // dance group ("classical dance" had found only the Ballet Company, never Deepam).
    key: "classical-dance",
    label: "Classical dance",
    terms: ["classical dance", "classical dancing", "classical dances"],
    related: ["ballet", "classical", "bharatanatyam", "kathak", "odissi", "kuchipudi"],
    categories: ["dance"],
    relatedInCategory: true,
    // Ballet Folklórico is Mexican folk dance.
    notSense: ["ballet folklorico"],
    kinds: ["classical ballet", "bharatanatyam", "kathak", "odissi", "kuchipudi"],
    alsoNeeds: ["ballet", "classical", "bharatanatyam", "kathak", "odissi", "kuchipudi"],
  },
  {
    // Round 14: futsal is indoor soccer, so a student typing "soccer" wants the Futsal Club too
    // (after the two soccer clubs, named for the word). "Football" stays out: at Harvard it is
    // as often American football.
    key: "soccer",
    label: "Soccer",
    terms: ["soccer", "futbol"],
    related: ["soccer", "futsal"],
    categories: [],
    textCategories: ["athletics-recreation"],
  },
  {
    // Round 14: intramurals are run by the Houses, not by clubs; the closest clubs are the
    // ones where students play (club sports first). Before, "intramural" was a Sports term and
    // listed a sports-business group, a sports-analytics society and Athlete Ally first.
    key: "intramural",
    label: "Intramural & recreational sports",
    terms: [
      "intramural",
      "intramurals",
      "intramural sports",
      "intramural sport",
      "im sports",
      "rec sports",
      "recreational sports",
      "recreational sport",
      "pickup sports",
      "house sports",
    ],
    related: ["intramural", "intramurals", "recreational"],
    categories: ["athletics-recreation"],
    intent: "play-a-sport",
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
      "comedian",
      "comedians",
      // Persona round 8: "plays" found Model UN and a band. "play" stays a verb (filler).
      "plays",
      "stage plays",
      "playwriting",
      "playwright",
      "playwrights",
    ],
    related: [
      "theater",
      "theatre",
      "theatrical",
      "theatricals",
      "drama",
      "dramatic",
      "dramatics",
      "acting",
      "musical",
      "improv",
      "comedy",
      "comics",
      "plays",
      "actors",
      "comic opera",
      "productions",
    ],
    categories: ["theater"],
    // Round 10: "theatrical concerts" (an orchestra), "plays" (a band), "drama" (a dance show)
    // and a listed "theatre" outside Theater are another group's style or venue.
    inCategoryText: [
      "theater",
      "theaters",
      "theatre",
      "theatres",
      "theatrical",
      "theatricals",
      "play",
      "plays",
      "drama",
      "dramatic",
      "dramatics",
      "production",
      "productions",
    ],
    // Venues, not what a group does: orchestras and a cappella groups perform in Sanders Theatre.
    notSense: [
      "sanders theatre",
      "sanders theater",
      "agassiz theatre",
      "agassiz theater",
      "loeb drama center",
      "farkas hall",
      "american repertory theater",
      "american repertory theatre",
      "theater dance",
      "theatre dance",
    ],
  },
  {
    key: "arts",
    label: "Visual arts",
    // Persona round 8: "creative" is creative writing as often as art, so it no longer reads as
    // Visual arts (the Creative Writing Collective led "painting"); crafts that were unknown
    // words ("sculpture" had been corrected to "scripture") are terms.
    terms: [
      "art",
      "arts",
      "visual art",
      "visual arts",
      "painting",
      "painter",
      "drawing",
      "studio art",
      "sculpture",
      "sculpting",
      "ceramics",
      "pottery",
      "printmaking",
      "watercolor",
      "sketching",
    ],
    related: ["art", "arts", "artists", "painting", "drawing"],
    categories: [],
  },
  {
    key: "film",
    label: "Film & video",
    terms: [
      "film",
      "films",
      "filmmaking",
      "movie",
      "movies",
      "cinema",
      "video",
      "videography",
      "screenwriting",
      "screenplay",
      "screenplays",
    ],
    related: ["film", "films", "filmmaking", "cinema", "video", "documentary", "television"],
    categories: [],
    // Persona round 8: "film screenings" among a club's activities is a social night, not
    // filmmaking (the Psychedelics Club and the Beekeepers were in the top 5), and a video game
    // club isn't film.
    notInActivities: true,
    notSense: ["video game", "video games"],
  },
  // Persona round 8: "lit mag" found nothing, "literary magazine" two clubs; literature is
  // creative writing and literary magazines, apart from Writing & journalism's newspapers.
  {
    key: "literature",
    label: "Literature & creative writing",
    terms: [
      "lit mag",
      "lit mags",
      "literary magazine",
      "literary magazines",
      "literary",
      "literature",
      "fiction",
      "short stories",
      "creative writing",
    ],
    // "fiction" and "creative writing" only as typed: in a name they'd outrank the club that
    // says it is a literary magazine (the Advocate) for "lit mag".
    related: ["literary", "literature", "poetry", "short stories"],
    categories: [],
  },
  // Persona round 8: "chemistry" and "chemical" each found a different club.
  {
    key: "chemistry",
    label: "Chemistry",
    terms: ["chemistry", "chemical", "chemicals", "chem", "chemist", "chemists"],
    related: ["chemistry", "chemical", "chemists"],
    categories: [],
  },
  {
    key: "research",
    label: "Research",
    terms: ["research", "researcher", "researchers", "lab", "labs", "science", "sciences", "stem"],
    related: ["research", "researchers", "science", "scientific", "lab"],
    categories: ["academic-stem"],
    // "stem" is the fields, not stem cells: the Stem Cell Society isn't named for STEM
    // (persona round 8). "stem cell" typed still finds it.
    notSense: ["stem cell", "stem cells"],
  },
  {
    key: "math",
    label: "Math",
    terms: ["math", "maths", "mathematics", "mathematical"],
    // Round 13: algorithms are mathematics ("math competition" had found only a tournament the
    // club runs for high schoolers, not the team that competes in the ICPC).
    related: ["math", "mathematics", "mathematical", "algorithmic", "algorithms", "putnam"],
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
    related: [
      "competition",
      "competitions",
      "competitive",
      "compete",
      "competes",
      "competing",
      "tournament",
      "tournaments",
      "contest",
      "contests",
    ],
    categories: ["competition-teams"],
    participate: true,
  },
  {
    key: "sports",
    label: "Sports & recreation",
    terms: ["sport", "sports", "athletics", "athletic", "fitness", "club sport", "club sports"],
    related: ["sport", "sports", "athletes", "athletic", "fitness"],
    categories: ["athletics-recreation"],
  },
  {
    // The sport. Elsewhere "running" is a verb ("running student businesses"), so the words
    // count in text only at sports clubs; a name always counts (Running Club).
    key: "running",
    label: "Running",
    terms: ["running", "runner", "runners", "jogging", "cross country", "marathon", "marathons", "track and field"],
    related: ["running", "runners", "cross country", "marathon"],
    categories: [],
    textCategories: ["athletics-recreation"],
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
      "birding",
      "birdwatching",
      "bird watching",
    ],
    // Round 13: birding and riding trails are outdoors too ("outdoors" had found only 4 clubs).
    related: [
      "outdoors",
      "outdoor",
      "hiking",
      "mountaineering",
      "climbing",
      "camping",
      "backpacking",
      "skiing",
      "birding",
      "bird walk",
      "bird walks",
      "mountain biking",
      "biking",
      "cycling",
    ],
    categories: [],
    nameOnly: ["outing"],
    // Round 11: one camping trip in a secular community's year, or a summer camp's, isn't an
    // outdoors club. The words count in text only at sports and hobby clubs; names always count.
    textCategories: ["athletics-recreation", "hobbies-games"],
  },
  {
    key: "faith",
    label: "Religious & spiritual",
    terms: [
      "religion",
      "religious",
      "faith",
      "spiritual",
      "spirituality",
      "worship",
      "church",
      "bible",
      "ministry",
      "buddhist",
      "buddhism",
    ],
    related: ["faith", "religious", "spiritual", "worship", "fellowship", "ministry"],
    categories: ["religious-spiritual"],
  },
  {
    key: "culture",
    label: "Cultural & identity",
    terms: ["culture", "cultural", "identity", "heritage", "diaspora"],
    related: ["culture", "cultural", "heritage", "community"],
    categories: ["cultural-identity"],
  },
  {
    // South Asian clubs: the region's names, its diaspora's word ("desi") and its national
    // and performing groups. Bare "indian" is a term, but a club where it means Native
    // American ("Intertribal Indian Dance Troupe") is another sense. Not religious groups:
    // faith is not ethnicity.
    key: "south-asian",
    identity: true,
    people: [
      "south asian",
      "south asians",
      "desi",
      "desis",
      "indian",
      "pakistani",
      "bangladeshi",
      "bengali",
      "nepali",
      "sri lankan",
      "tamil",
      "punjabi",
    ],
    label: "South Asian",
    // Not "bollywood": a dance style first (`south-asian-dance`, Round 14).
    terms: ["south asian", "south asians", "south asia", "desi", "desis", "indian"],
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
    diaspora: "asian-american",
    categories: [],
    otherSense: ["native american", "native americans", "american indian", "intertribal", "indigenous"],
    senseTerms: ["indian", "indians"],
  },
  {
    // Black and African-diaspora clubs: African, Caribbean and Haitian groups are related.
    // "Black" only in the identity sense: never a dress code, a fund's name or a theater
    // style, and never from an activity list alone ("formal black tie dinners").
    key: "black",
    identity: true,
    people: ["black", "african american", "african", "afro", "caribbean", "haitian", "haitians", "pan african"],
    label: "Black & African diaspora",
    terms: ["black", "african american", "african americans", "afro caribbean"],
    related: ["black", "african american", "african", "afro", "caribbean", "haitian", "haitians", "pan african"],
    categories: [],
    notInActivities: true,
    notSense: [
      "black tie",
      "black diamond",
      "black box",
      "black and white",
      "black white",
      "black hole",
      "black holes",
      "black belt",
      "black friday",
    ],
  },
  {
    // Chinese, Korean, Japanese and Taiwanese groups ("east asian" itself names none of them).
    key: "east-asian",
    identity: true,
    people: ["east asian", "chinese", "korean", "japanese", "taiwanese", "hong kong"],
    label: "East Asian",
    terms: ["east asian", "east asians", "east asia"],
    related: [
      "east asian",
      "chinese",
      "china",
      "korean",
      "korea",
      "japanese",
      "japan",
      "taiwanese",
      "taiwan",
      "hong kong",
    ],
    diaspora: "asian-american",
    categories: [],
  },
  {
    // Arab, Iranian/Persian, Turkish, Kurdish, Armenian, Gulf, Levantine and Israeli groups:
    // "middle eastern" itself names none of them. Their people's words in a club's name stand
    // in for a category (`WEIGHTS.identityNameStandIn`). Not bare "israel" or "palestine"
    // (a trip, a summit, a cause); their people are.
    key: "middle-eastern",
    identity: true,
    people: [
      "middle eastern",
      "arab",
      "arabs",
      "arabian",
      "iranian",
      "iranians",
      "persian",
      "persians",
      "turkish",
      "kurdish",
      "kurds",
      "armenian",
      "armenians",
      "israeli",
      "israelis",
      "palestinian",
      "palestinians",
      "lebanese",
      "syrian",
      "egyptian",
      "levantine",
    ],
    label: "Middle Eastern & North African",
    terms: ["middle eastern", "middle east", "mena", "swana", "arab", "arabs", "arab american", "arab americans"],
    related: [
      "middle eastern",
      "arab",
      "arabian",
      "iranian",
      "persian",
      "turkish",
      "kurdish",
      "armenian",
      "israeli",
      "israelis",
      "palestinian",
      "palestine",
      "lebanese",
      "syrian",
      "egyptian",
      "levantine",
    ],
    categories: [],
    notInActivities: true,
    diaspora: "middle-eastern",
  },
  {
    // African students' groups, country by country: "african" names few of them (Nigerian,
    // Ghanaian, Somali, Eritrean & Ethiopian). "African American" is the Black concept's term.
    key: "african",
    identity: true,
    people: [
      "african",
      "africans",
      "pan african",
      "nigerian",
      "nigerians",
      "naija",
      "ghanaian",
      "ghanaians",
      "somali",
      "somalis",
      "eritrean",
      "eritreans",
      "ethiopian",
      "ethiopians",
      "kenyan",
      "kenyans",
      "south african",
      "ugandan",
      "rwandan",
      "cameroonian",
      "senegalese",
    ],
    label: "African",
    terms: ["african", "africans", "africa", "pan african"],
    related: [
      "african",
      "pan african",
      "nigerian",
      "naija",
      "ghanaian",
      "somali",
      "eritrean",
      "ethiopian",
      "kenyan",
      "south african",
      "ugandan",
      "rwandan",
      "cameroonian",
      "senegalese",
    ],
    categories: [],
    // "African drumming" in a percussion group's activity list, "Africa" among a ministry's trips.
    notInActivities: true,
    diaspora: "black",
  },
  {
    key: "asian-american",
    identity: true,
    people: ["asian american", "asian americans", "aapi", "asian pacific"],
    label: "Asian American",
    terms: ["asian american", "asian americans", "aapi", "asian pacific american"],
    related: ["asian american", "aapi", "asian pacific"],
    categories: [],
  },
  {
    key: "muslim",
    identity: true,
    people: ["muslim", "muslims", "islamic"],
    label: "Muslim life",
    terms: ["muslim", "muslims", "islam", "islamic"],
    related: ["muslim", "muslims", "islamic", "islam"],
    categories: [],
  },
  {
    // Latino/Latinx clubs under any of the community's spellings, plus Mexican, Caribbean
    // and Latin American groups and folklórico/mariachi ensembles. Not bare "latin" (the
    // language, "Cambridge Rindge & Latin"), nor Brazilian ("Brazilian jiu-jitsu").
    key: "latinx",
    identity: true,
    people: [
      "latino",
      "latinos",
      "latina",
      "latinas",
      "latine",
      "latines",
      "latinx",
      "latinxs",
      "hispanic",
      "chicano",
      "chicana",
      "chicanx",
      "latin american",
      "mexican",
      "dominican",
      "puerto rican",
      "cuban",
    ],
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
    diaspora: "latinx",
    categories: [],
    // Only in a name: "Latin America" among a club's activities is often one committee or
    // conference among many (Model Congress), not a Latino community.
    nameOnly: ["latin america", "latin american"],
  },
  {
    key: "lgbtq",
    identity: true,
    people: ["queer", "lgbtq", "lgbt", "lgbtqia", "gay", "lesbian", "transgender", "trans", "bisexual", "nonbinary"],
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
      "trans",
      "nonbinary",
      "gender and sexuality",
      "sexuality",
    ],
    related: ["queer", "lgbtq", "lgbt", "lgbtqia", "sexuality", "gay", "lesbian", "transgender", "bisexual"],
    categories: [],
  },
  {
    key: "first-gen",
    identity: true,
    people: ["first generation", "first gen", "fgli"],
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
    // Not "social" itself: in a name it is usually "Social Good" / "Social Impact". The
    // related words only count at clubs the Meet-people rule picks, so "community" here is a
    // club about its community, never "community service" elsewhere.
    related: ["friends", "friendship", "community", "social events", "socials"],
    // "socials" in a name would be its singular, "Social" ("First-Year Social Committee"), and
    // "Community" in a name names who a group gathers ("Community of Humanists"), not that it
    // is for meeting people: it no longer stands in for the category (Round 10).
    textOnly: ["socials", "community"],
    categories: ["social"],
    intent: "meet-people",
  },
  {
    key: "social-clubs",
    label: "Social clubs",
    terms: [
      "parties",
      "final club",
      "final clubs",
      "fraternity",
      "fraternities",
      "frat",
      "frats",
      "sorority",
      "sororities",
      "greek life",
      "greek letter",
    ],
    related: ["fraternity", "sorority", "fraternities", "sororities", "final club", "final clubs"],
    categories: ["social"],
    nameOnly: ["sigma chi", "kappa alpha theta", "kappa kappa gamma", "delta gamma", "pi beta phi", "alpha phi"],
  },
  {
    // Round 11: video games and esports are their own topic, so chess and poker don't answer them.
    key: "video-games",
    label: "Video games",
    terms: [
      "video games",
      "video game",
      "videogames",
      "esports",
      "e sports",
      "gaming",
      "gamer",
      "gamers",
      "game development",
      "game dev",
      "game design",
      "game developers",
    ],
    related: [
      "video games",
      "video game",
      "esports",
      "gaming",
      "game developers",
      "game development",
      "game design",
      "interactive media",
    ],
    categories: [],
  },
  {
    key: "games",
    label: "Games",
    terms: ["games", "game", "board games", "tabletop", "cards", "card games"],
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
    terms: [
      "climate",
      "environment",
      "environmental",
      "sustainability",
      "sustainable",
      "energy",
      "conservation",
      "ecology",
      "nature",
      "wildlife",
      "ocean",
      "oceans",
      "recycling",
      "composting",
    ],
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
  // "pick up basketball": a casual game, not a word a club's page uses.
  ["pick up", "pickup"],
]);

/** Concepts by trigger term (single words and phrases), for query parsing. */
export const CONCEPT_BY_TERM: ReadonlyMap<string, Concept> = new Map(
  CONCEPTS.flatMap((c) => c.terms.map((t) => [t, c] as const)),
);
