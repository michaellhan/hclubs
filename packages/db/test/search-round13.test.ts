import { describe, expect, it } from "vitest";
import { normalizeName } from "@hci/core/browser";
import {
  ClubFilters,
  extendsWord,
  INTENTS,
  interpretQuery,
  intentRank,
  joinableThisTerm,
  joinTermText,
  liveClub,
  matchesIntent,
  matchResume,
  NO_JOINING_FACTS,
  organizesOnly,
  programOf,
  readResumeInterests,
  reasonText,
  searchLocal,
  similarClubs,
  type CycleSummary,
  type IndexClub,
} from "../src/local";

/**
 * Round-13 ranking from student testing round 6 (2026-10-13): "join now" and Still time to join
 * put this term's chances before spring rounds; a newspaper editor's resume finds the papers;
 * "what's a comp" / "what is punch" answer with /about's definition and punch means the social
 * clubs' invitations; outdoors reaches birding and cycling; a typed word only an audience club's
 * name says ranks it first; a program filed under the topic itself isn't set aside; the school's
 * colour is no shared topic; technical interviews; "rocket" reads "Rocketry"; clubs that only run
 * a tournament for high schoolers follow the teams; Build software orders makers first; umbrella
 * categories alone don't make clubs alike. Hand-made index; descriptions invented.
 */
const NOW = new Date("2026-10-13T16:00:00Z");
const J = NO_JOINING_FACTS;
let n = 0;
const cat = (slug: string, name = slug) => ({ slug, name, isPrimary: false });

function club(name: string, over: Partial<IndexClub> = {}): IndexClub {
  const cats = over.categories ?? [];
  const slug = normalizeName(name).replace(/ /g, "-");
  return {
    id: `r13-${++n}`,
    slug,
    name,
    acronym: null,
    shortDescription: null,
    orgType: null,
    recognitionStatus: "recognized",
    activityStatus: "active",
    joinModes: [],
    freshmenEligible: null,
    joining: J,
    categories: [],
    memberCount: null,
    hoursPerWeek: null,
    instagramFollowers: null,
    currentCycle: null,
    isFixture: false,
    completeness: 0.5,
    lastObservedAt: null,
    eligibleClasses: null,
    affiliationScope: "harvard_college",
    quickLinks: { website: `https://${slug}.invalid`, instagram: null },
    logo: null,
    pressCount: 0,
    cycles: [],
    searchNames: normalizeName(name),
    searchAcronyms: over.acronym ? [over.acronym] : [],
    searchTopics: "",
    categorySlugs: cats.map((c) => c.slug),
    recruitingSeasons: [],
    ...over,
  };
}

function cycle(over: Partial<CycleSummary>): CycleSummary {
  return {
    id: `cy-${++n}`,
    termKey: "2026-fall",
    track: "main",
    status: "unknown",
    statedStatus: null,
    opens: null,
    deadline: null,
    processTypes: [],
    applicationUrl: null,
    eligibleClasses: null,
    lastVerifiedAt: "2026-10-01T00:00:00Z",
    ...over,
  };
}

const pubs = [cat("publications-media", "Publications & Media")];
const theater = [cat("performing-arts", "Performing Arts"), cat("theater", "Theater")];
const sports = [cat("athletics-recreation", "Sports & Recreation")];
const hobbies = [cat("hobbies-games", "Hobbies & Games")];
const social = [cat("social", "Social & Community")];
const pol = [cat("political-advocacy", "Politics & Policy")];
const law = [cat("pre-professional", "Pre-professional"), cat("law", "Law")];
const lawService = [cat("public-service", "Public Service"), ...law, cat("adult-services", "Adult Services")];
const health = [cat("medicine-health", "Health & Medicine"), cat("mentoring-education", "Mentoring & Education")];
const academic = [cat("academic-stem", "Academic & Research")];
const tech = [cat("technology", "Technology & Engineering")];
const stemTech = [...academic, ...tech];
const finance = [cat("pre-professional", "Pre-professional"), cat("finance", "Finance & Investing")];
const consultingTech = [cat("pre-professional", "Pre-professional"), cat("consulting", "Consulting"), ...tech];
const competition = [cat("competition-teams", "Competition Teams")];
const cultural = [cat("cultural-identity", "Cultural & Identity")];
const entre = [cat("entrepreneurship", "Entrepreneurship")];
const comp = { ...J, access: "process" as const, general: ["comp" as const], comp: true as const };
const open = { ...J, access: "open" as const, general: ["open" as const] };
const invite = { ...J, access: "process" as const, general: ["invite_only" as const] };

const CLUBS: IndexClub[] = [
  // Publications
  club("Harvard Crimson", {
    categories: pubs,
    shortDescription: "Student newspaper publishing every weekday morning.",
    instagramFollowers: 40000,
    joining: comp,
    joinModes: ["comp"],
    recruitingSeasons: ["fall", "spring"],
  }),
  club("The Harvard Independent", {
    categories: pubs,
    shortDescription: "Student publication producing weekly print issues.",
    instagramFollowers: 3000,
    joining: comp,
    joinModes: ["comp"],
  }),
  club("The Harvard Advocate", {
    categories: pubs,
    shortDescription: "Literary magazine publishing art, fiction and poetry.",
    instagramFollowers: 8000,
    joining: comp,
    joinModes: ["comp"],
  }),
  club("Harvard Political Review", {
    categories: [...pubs, ...pol],
    shortDescription: "Undergraduate journal publishing articles on politics.",
    instagramFollowers: 2000,
    recruitingSeasons: ["rolling"],
  }),
  club("Harvard Undergraduate Writers Collective", {
    categories: pubs,
    shortDescription: "Open writing group with weekly workshops.",
    joining: open,
    joinModes: ["open"],
  }),
  club("Harvard Lampoon", {
    categories: pubs,
    shortDescription: "Student-run humor magazine, modeled on the British magazine Punch.",
    instagramFollowers: 20000,
    joining: comp,
    joinModes: ["comp"],
  }),
  // Spring rounds, a live round, an open club
  club("Hasty Pudding Theatricals", {
    categories: theater,
    shortDescription: "Student theater troupe staging an annual burlesque.",
    instagramFollowers: 30000,
    recruitingSeasons: ["spring"],
  }),
  club("Harvard Cheerleading Club", {
    categories: sports,
    shortDescription: "Cheerleading team performing at football games.",
    instagramFollowers: 25000,
    recruitingSeasons: ["spring"],
  }),
  club("Harvard Ballroom Dance Team", {
    categories: sports,
    shortDescription: "Ballroom dance team with lessons for beginners.",
    instagramFollowers: 500,
    cycles: [
      cycle({ opens: { at: "2026-10-01", precision: "date" }, deadline: { at: "2026-10-30", precision: "date" } }),
    ],
  }),
  club("Harvard Fencing Club", {
    categories: sports,
    shortDescription: "Fencing club for all levels.",
    joining: open,
    joinModes: ["open"],
  }),
  club("Harvard Chess Club", {
    categories: hobbies,
    shortDescription: "Chess community with weekly casual meetings and on-campus tournaments.",
    joining: open,
    joinModes: ["open"],
  }),
  club("Harvard Undergraduate Ghost Stories Club", {
    categories: hobbies,
    shortDescription: "Storytelling club opening a round later this term.",
    cycles: [
      cycle({ opens: { at: "2026-11-02", precision: "date" }, deadline: { at: "2026-11-20", precision: "date" } }),
    ],
  }),
  // Social clubs: a punch
  club("Hasty Pudding Club", {
    categories: social,
    orgType: "social_organization",
    shortDescription: "Co-ed social club that admits members through a punch process.",
    joining: invite,
    joinModes: ["invite_only"],
  }),
  club("Fly Club", {
    categories: social,
    orgType: "social_organization",
    shortDescription: "Final club inviting sophomores and juniors.",
    instagramFollowers: 900,
    joining: invite,
    joinModes: ["invite_only"],
  }),
  club("Harvard Boxing Club", {
    categories: sports,
    shortDescription: "Boxing club teaching punching technique to beginners.",
    joining: open,
    joinModes: ["open"],
  }),
  // Outdoors
  club("Harvard Outing Club", {
    categories: hobbies,
    shortDescription: "Student group leading outdoor trips like hiking and biking.",
  }),
  club("Harvard Undergraduate Birding Club", { categories: hobbies, searchTopics: "bird walk at fresh pond" }),
  club("Harvard Cycling Club", {
    categories: sports,
    shortDescription: "College cycling group racing road and mountain biking.",
  }),
  club("PBHA Summer Camp", {
    categories: [cat("public-service", "Public Service")],
    orgType: "public_service_program",
    shortDescription: "Summer camp for children with field trips and an overnight camping trip.",
  }),
  // Law
  club("Harvard Undergraduate Law Review", {
    categories: [...pubs, ...law],
    shortDescription: "Journal publishing undergraduate legal scholarship.",
    instagramFollowers: 1500,
  }),
  club("Harvard Undergraduate Moot Court", {
    categories: [...competition, ...law],
    shortDescription: "Moot court team arguing legal cases.",
  }),
  club("Harvard College Black Prelaw Association", {
    categories: law,
    shortDescription: "Community for Black students interested in law.",
  }),
  club("Harvard Undergraduate Women in Law Association", {
    categories: law,
    shortDescription: "Community for women interested in law.",
  }),
  club("Small Claims Advisory Service", {
    categories: lawService,
    orgType: "public_service_program",
    shortDescription: "Volunteers advising people on small claims court law.",
  }),
  club("Harvard Undergraduate VISION Global Health Society", {
    categories: health,
    shortDescription:
      "Student group teaching high school students about social and legal factors behind global health.",
    instagramFollowers: 4000,
  }),
  // Debate and competitions
  club("Harvard College Debating Union", {
    categories: [...competition, ...pol],
    shortDescription: "Competitive debate team that travels to tournaments.",
    instagramFollowers: 1000,
  }),
  club("Harvard Undergraduate Mock Trial Association", {
    categories: [...competition, ...law],
    shortDescription:
      "Mock trial team that competes in collegiate tournaments and hosts a seminar for high school students.",
  }),
  club("Harvard Model Congress Asia", {
    categories: pol,
    shortDescription: "Student-run government simulation conference where high school students debate global issues.",
    instagramFollowers: 9000,
  }),
  club("Harvard College Project for Asian and International Relations", {
    acronym: "HPAIR",
    categories: pol,
    shortDescription: "Student-run group hosting two conferences a year for students and young professionals.",
    searchTopics: "debate panels case competition",
    instagramFollowers: 12000,
  }),
  club("Harvard-MIT Mathematics Tournament", {
    acronym: "HMMT",
    categories: [...academic, ...competition],
    shortDescription: "Student-volunteer-run math tournament where students write problems and run contest day.",
    instagramFollowers: 3000,
  }),
  club("Harvard Computing Contest Club", {
    categories: stemTech,
    shortDescription:
      "Sends teams to compete in the International Collegiate Programming Contest, an algorithmic contest.",
  }),
  // Technology
  club("Harvard Undergraduate Aerospace Collective", {
    categories: stemTech,
    shortDescription: "Undergraduate aerospace group with Satellite, Rocketry, and UAV teams.",
  }),
  club("Harvard College Engineering Society", {
    categories: stemTech,
    shortDescription: "Promotes engineering through mentorship and community building.",
    instagramFollowers: 600,
  }),
  club("Harvard Undergraduate Robotics Club", {
    categories: stemTech,
    shortDescription: "Student group offering robotics projects to work on and engineers to build them with.",
    instagramFollowers: 300,
  }),
  club("Society of Women Engineers", {
    acronym: "SWE",
    categories: stemTech,
    shortDescription: "Chapter of a national society that empowers women to succeed as engineers.",
    searchTopics: "networking sessions skill building workshops",
    instagramFollowers: 900,
  }),
  club("Harvard Society of Black Scientists and Engineers", {
    categories: stemTech,
    shortDescription: "Community for Black students in STEM with career advising and professional development.",
    instagramFollowers: 1200,
  }),
  club("Harvard Undergraduate Ventures", {
    categories: [...entre, ...tech],
    shortDescription: "Undergraduate network for students interested in venture, making introductions to founders.",
    searchTopics: "computer science fireside chats",
    instagramFollowers: 2500,
  }),
  club("Harvard Computer Society Tech for Social Good", {
    categories: [...tech, cat("public-service", "Public Service")],
    shortDescription: "Student group that works with nonprofits to build technology solutions.",
    searchTopics: "ux research software engineering",
  }),
  club("Harvard Undergraduate Quantitative Traders", {
    acronym: "HUQT",
    categories: [...finance, ...academic],
    shortDescription: "Student community preparing undergraduates for careers in quantitative finance.",
    searchTopics: "mentorship projects software engineering trading simulations",
  }),
  club("Harvard Undergraduate Data Analytics Group", {
    acronym: "HDAG",
    categories: consultingTech,
    shortDescription: "Student group turning organizations' data into decisions.",
  }),
  club("Harvard Undergraduate Knitting Circle", { categories: hobbies, shortDescription: "Knitting circle." }),
  // AI
  club("AI Safety Team", {
    acronym: "AIST",
    categories: stemTech,
    shortDescription:
      "Supports students in research to reduce risks from advanced AI, with a reading group and a policy fellowship.",
  }),
  club("Harvard Undergraduate Society for AI", {
    categories: stemTech,
    shortDescription: "Student group exploring and implementing AI advances.",
  }),
  club("Harvard Undergraduate Women in Computer Science", {
    categories: [...stemTech, ...cultural],
    shortDescription: "Community for women pursuing computer science.",
  }),
  club("Harvard College Ventures", {
    categories: stemTech,
    shortDescription: "Student group connecting undergraduates with founders and startups.",
  }),
  // The school colour
  club("Harvard Crimson Dance Team", {
    categories: sports,
    shortDescription: "Dance team performing at games and competitions.",
    instagramFollowers: 7000,
  }),
  club("The Crimson: Business Board", {
    categories: [cat("pre-professional", "Pre-professional"), ...pubs],
    shortDescription: "Runs the business side of the Crimson.",
  }),
  club("PBHA's Chinatown Afterschool Program", {
    categories: [cat("public-service", "Public Service")],
    orgType: "public_service_program",
    shortDescription: "Afterschool program in Chinatown.",
  }),
  club("Harvard Undergraduate China Forum", {
    categories: pol,
    shortDescription: "Student group discussing issues affecting China.",
  }),
];

const search = (
  text: string | null,
  filters: Partial<ClubFilters> = {},
  sort: "relevance" | "popularity" = "relevance",
) =>
  searchLocal(CLUBS, {
    text,
    filters: { ...ClubFilters.parse({}), ...filters },
    sort,
    offset: 0,
    limit: 100,
    now: NOW,
  });
const names = (
  text: string | null,
  filters: Partial<ClubFilters> = {},
  sort: "relevance" | "popularity" = "relevance",
) => search(text, filters, sort).clubs.map((c) => c.name);
const before = (list: string[], a: string, b: string) => {
  expect(list).toContain(a);
  expect(list).toContain(b);
  expect(list.indexOf(a)).toBeLessThan(list.indexOf(b));
};
const byName = (name: string) => CLUBS.find((c) => c.name === name)!;
const isLeaf = (s: string) => !["public-service", "performing-arts", "pre-professional"].includes(s);

describe("Still time to join puts this term first (round 13)", () => {
  const THIS_TERM = ["Harvard Ballroom Dance Team", "Harvard Undergraduate Ghost Stories Club", "Harvard Fencing Club"];
  const SPRING = ["Harvard Crimson", "Hasty Pudding Theatricals", "Harvard Cheerleading Club"];

  it("says why a club can be joined this term, or null for a later chance", () => {
    const why = (name: string) => {
      const r = joinableThisTerm(liveClub(byName(name), NOW), NOW);
      return r ? reasonText(r) : null;
    };
    expect(why("Harvard Ballroom Dance Team")).toBe("Recruiting now");
    expect(why("Harvard Undergraduate Ghost Stories Club")).toBe("Round opens this term");
    expect(why("Harvard Fencing Club")).toBe("Open membership");
    expect(why("Harvard Political Review")).toBe("Recruits on a rolling basis");
    expect(why("Harvard Crimson")).toBeNull();
  });

  it("browsing the filter: live rounds, open and rolling clubs before spring rounds, whatever the followers", () => {
    for (const list of [
      names(null, { stillTime: true }, "popularity"),
      names("clubs I can join now", {}, "popularity"),
      names("join this semester"),
    ]) {
      // Spring-round clubs still match (August to December), after this term's chances.
      for (const a of THIS_TERM) for (const b of SPRING) before(list, a, b);
      before(list, "Harvard Political Review", "Harvard Crimson");
    }
  });

  it("with a topic too: Write & report puts the rolling journal before the papers' spring comps", () => {
    const list = names(null, { stillTime: true, intent: "write-or-report" }, "popularity");
    before(list, "Harvard Political Review", "Harvard Crimson");
  });

  it("with search text, this term's chances lead and say why", () => {
    const r = search("dance join now");
    expect(r.clubs[0]?.name).toBe("Harvard Ballroom Dance Team");
    expect(r.reasons[r.clubs[0]!.id]?.some((x) => x.kind === "joining" && x.text === "Recruiting now")).toBe(true);
  });
});

describe("what's a comp, what is punch (round 13)", () => {
  it("a definition question carries /about's sentence as a note", () => {
    expect(search("what's a comp").notes[0]).toBe(joinTermText("comp"));
    expect(search("whats a comp").notes[0]).toMatch(/^A comp \(short for competition\)/);
    expect(search("what is punch").notes).toEqual([joinTermText("punch")]);
    expect(search("what does tryout mean").notes).toEqual([joinTermText("tryout")]);
    expect(search("what is an audition").notes).toEqual([joinTermText("audition")]);
    // Only when asked: a plain process word or a subject defines nothing.
    expect(search("comp").notes).toEqual([]);
    expect(search("newspaper comp").notes).toEqual([]);
    expect(interpretQuery("what is comp lit").notes).toEqual([]);
  });

  it("the asking words aren't searched once a definition answers them", () => {
    expect(search("what does tryout mean").searchedText).toBe("");
    expect(search("define comp").clubs.every((c) => c.joining.comp === true)).toBe(true);
  });

  it("punch is the social clubs' invitation, never the Lampoon's magazine Punch", () => {
    for (const q of ["punch", "what is punch", "punch season"]) {
      const list = names(q);
      expect(list).not.toContain("Harvard Lampoon");
      expect(list).toEqual(expect.arrayContaining(["Hasty Pudding Club", "Fly Club"]));
      // The club whose own words say "punch" first, though the other has more followers.
      before(list, "Hasty Pudding Club", "Fly Club");
    }
    // "punching" stays boxing (round 8).
    expect(names("what is punching")).toEqual(["Harvard Boxing Club"]);
  });
});

describe("outdoors reaches birding and cycling (round 13)", () => {
  it("finds the birding and cycling clubs, not a summer camp's camping trip", () => {
    for (const q of ["outdoors", "hiking", "birding"]) {
      const list = names(q);
      expect(list).toContain("Harvard Undergraduate Birding Club");
      expect(list).not.toContain("PBHA Summer Camp");
    }
    expect(names("outdoors")).toContain("Harvard Cycling Club");
    const outdoors = INTENTS.find((i) => i.slug === "get-outdoors")!;
    expect(matchesIntent(byName("Harvard Cycling Club"), outdoors)).toBe(true);
    expect(matchesIntent(byName("Harvard Undergraduate Birding Club"), outdoors)).toBe(true);
  });
});

describe("prelaw and legal (round 13)", () => {
  it("a typed word only an audience club's name says ranks that club first", () => {
    for (const q of ["prelaw", "pre law", "pre-law"])
      expect(names(q)[0]).toBe("Harvard College Black Prelaw Association");
    // "law" is every law club's word: the audience clubs follow (round 9 rule kept).
    before(names("law"), "Harvard Undergraduate Law Review", "Harvard College Black Prelaw Association");
    before(names("law"), "Harvard Undergraduate Law Review", "Harvard Undergraduate Women in Law Association");
  });

  it("a service program filed under Law is a law club; a passing 'legal' follows it", () => {
    for (const q of ["legal", "law", "pre law"])
      before(names(q), "Small Claims Advisory Service", "Harvard Undergraduate VISION Global Health Society");
  });
});

describe("clubs that run a tournament for others follow the teams (round 13)", () => {
  it("names who organizes only", () => {
    expect(organizesOnly(byName("Harvard Model Congress Asia"))).toBe(true);
    expect(organizesOnly(byName("Harvard-MIT Mathematics Tournament"))).toBe(true);
    expect(organizesOnly(byName("Harvard College Project for Asian and International Relations"))).toBe(true);
    // Competes and hosts: a team.
    expect(organizesOnly(byName("Harvard Undergraduate Mock Trial Association"))).toBe(false);
    expect(organizesOnly(byName("Harvard College Debating Union"))).toBe(false);
    expect(organizesOnly(byName("Harvard Chess Club"))).toBe(false);
  });

  it("debate and competitions: teams before conferences for high schoolers", () => {
    for (const org of [
      "Harvard Model Congress Asia",
      "Harvard College Project for Asian and International Relations",
    ]) {
      before(names("debate"), "Harvard Undergraduate Mock Trial Association", org);
      before(names("debate"), "Harvard College Debating Union", org);
    }
    before(names("math competition"), "Harvard Computing Contest Club", "Harvard-MIT Mathematics Tournament");
    before(names("competition"), "Harvard Undergraduate Moot Court", "Harvard-MIT Mathematics Tournament");
    // A topic students staff, not compete in, keeps them (Model UN conferences are what members run).
    expect(names("hmmt")[0]).toBe("Harvard-MIT Mathematics Tournament");
  });
});

describe("a newspaper editor's resume (round 13)", () => {
  const resume = "Alex Kim\nEditor-in-chief, school newspaper\nVarsity debate team";
  it("reads the editor role as journalism and puts the papers first", () => {
    const interests = readResumeInterests(resume, CLUBS);
    const journalism = interests.find((i) => i.key === "c:journalism");
    expect(journalism?.count).toBeGreaterThanOrEqual(2);
    const got = matchResume(CLUBS, interests).map((m) => m.club.name);
    expect(got.slice(0, 3)).toEqual(expect.arrayContaining(["Harvard Crimson", "The Harvard Independent"]));
    before(got, "Harvard Crimson", "Harvard College Debating Union");
    // A conference for high schoolers is not a debate pick.
    expect(got).not.toContain("Harvard Model Congress Asia");
    expect(got).not.toContain("Harvard College Project for Asian and International Relations");
  });
});

describe("technical interviews and word endings (round 13)", () => {
  it("technical interviews find quant, data and software clubs", () => {
    for (const q of ["technical interview", "technical interviews", "coding interviews", "leetcode"]) {
      const list = names(q);
      expect(list).toEqual(
        expect.arrayContaining([
          "Harvard Undergraduate Quantitative Traders",
          "Harvard Undergraduate Data Analytics Group",
          "Harvard Computer Society Tech for Social Good",
        ]),
      );
      expect(list).not.toContain("Harvard Undergraduate Knitting Circle");
    }
  });

  it("a finished word reads a longer form of itself, never a different word", () => {
    expect(extendsWord("rocket", "rocketry")).toBe(true);
    expect(extendsWord("climb", "climbing")).toBe(true);
    expect(extendsWord("china", "chinatown")).toBe(false);
    expect(extendsWord("math", "mather")).toBe(false);
    expect(extendsWord("environment", "environmental")).toBe(false);
    for (const q of ["rocket", "rockets"]) expect(names(q)[0]).toBe("Harvard Undergraduate Aerospace Collective");
    // Finished (not the last word, which may be half-typed): "china" never reads "Chinatown".
    expect(names("china forum")).not.toContain("PBHA's Chinatown Afterschool Program");
    expect(names("china forum")[0]).toBe("Harvard Undergraduate China Forum");
  });
});

describe("Build software orders makers first (round 13)", () => {
  it("clubs that build come before identity, professional and venture groups", () => {
    const software = INTENTS.find((i) => i.slug === "build-software")!;
    const rank = (name: string) => intentRank(byName(name), software);
    expect(rank("Harvard Undergraduate Robotics Club")).toBe(2);
    expect(rank("Harvard Computer Society Tech for Social Good")).toBe(2);
    expect(rank("Society of Women Engineers")).toBe(0); // "skill building" isn't building things
    expect(rank("Harvard College Engineering Society")).toBe(0); // nor "community building"
    const list = names(null, { intent: "build-software" });
    for (const maker of ["Harvard Undergraduate Robotics Club", "Harvard Computer Society Tech for Social Good"])
      for (const other of [
        "Society of Women Engineers",
        "Harvard Society of Black Scientists and Engineers",
        "Harvard Undergraduate Ventures",
      ])
        before(list, maker, other);
  });
});

describe("similar clubs (round 13)", () => {
  it("the school's colour is no shared topic; the paper's own board still is", () => {
    const crimson = similarClubs(byName("Harvard Crimson"), CLUBS, { isLeaf }).map((s) => s.club.name);
    expect(crimson).not.toContain("Harvard Crimson Dance Team");
    expect(crimson[0]).toBe("The Crimson: Business Board");
    expect(programOf(byName("Harvard Crimson Dance Team"), byName("Harvard Crimson"))).toBe(false);
    expect(programOf(byName("The Crimson: Business Board"), byName("Harvard Crimson"))).toBe(true);
  });

  it("clubs like the AI Safety Team are about AI, not just filed under the same umbrellas", () => {
    const got = similarClubs(byName("AI Safety Team"), CLUBS, { isLeaf }).map((s) => s.club.name);
    expect(got[0]).toBe("Harvard Undergraduate Society for AI");
    expect(got).not.toContain("Harvard College Ventures");
    expect(got).not.toContain("Harvard Undergraduate Women in Computer Science");
  });
});
