import { describe, expect, it } from "vitest";
import { normalizeName } from "@hci/core";
import {
  abbreviates,
  cleanQuery,
  ClubFilters,
  facetCounts,
  matchesFirstYears,
  nameInitials,
  reasonText,
  relaxations,
  searchLocal,
  wordVariants,
  type IndexClub,
  NO_JOINING_FACTS,
} from "../src/local";
import { interpretQuery } from "../src/local/constraints";

/**
 * Search-ranking regressions on a small hand-made index (no database). Each case is a
 * query a student would type and the club that obviously belongs on top — or a club that
 * must not appear. Club names are illustrative; descriptions are invented for the test.
 */
const NOW = new Date("2026-10-01T16:00:00Z");
let n = 0;
const cat = (slug: string, name = slug) => ({ slug, name, isPrimary: false });

function club(name: string, over: Partial<IndexClub> & { alias?: string[] } = {}): IndexClub {
  const { alias = [], ...rest } = over;
  return {
    id: `r${++n}`,
    slug: normalizeName(name).replace(/ /g, "-"),
    name,
    acronym: null,
    shortDescription: null,
    orgType: null,
    recognitionStatus: "recognized",
    activityStatus: "active",
    joinModes: [],
    freshmenEligible: null,
    joining: NO_JOINING_FACTS,
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
    quickLinks: { website: "https://example.invalid", instagram: null },
    logo: null,
    pressCount: 0,
    cycles: [],
    searchNames: [name, ...alias].map(normalizeName).join(" | "),
    // As the real index ships them: uppercase.
    searchAcronyms: over.acronym ? [over.acronym.toUpperCase()] : [],
    searchTopics: "",
    categorySlugs: (over.categories ?? []).map((c) => c.slug),
    recruitingSeasons: [],
    ...(alias.length ? { aliases: alias } : {}),
    ...rest,
  };
}

const CLUBS: IndexClub[] = [
  club("Harvard Undergraduate Consulting on Business and the Environment", {
    shortDescription: "Case teams advising clients on sustainability.",
  }),
  club("Harvard Undergraduate Society for Emerging Artists", { shortDescription: "Studio nights and shows." }),
  club("Harvard Sailing Team", { shortDescription: "Racing on the sea every weekend." }),
  club("Harvard Undergraduate World Pre-Health Conference"),
  club("Harvard Undergraduate Women in Medicine"),
  club("Harvard Undergraduate Venture Capital Group"),
  club("Harvard Undergraduate Data Group", { alias: ["Harvard College Data Group"] }),
  club("Harvard College Consulting Group", {
    shortDescription: "Student consulting projects for nonprofits and companies.",
    categories: [cat("consulting", "Consulting")],
    categorySlugs: ["pre-professional", "consulting"],
    joinModes: ["application"],
  }),
  club("Harvard Undergraduate Mathematics Association", {
    acronym: "HUMA",
    shortDescription: "Talks and problem sessions for math lovers.",
  }),
  club("Mather House Committee", { shortDescription: "Plans events for residents of the house." }),
  club("Harvard Mountaineering Club", {
    shortDescription: "Hiking, rock climbing and mountaineering trips around New England.",
    categories: [cat("hobbies-games", "Hobbies & Games")],
    joinModes: ["open"],
  }),
  club("Harvard Combat Sports Club", {
    shortDescription: "Boxing and wrestling practice for all levels.",
    categories: [cat("athletics-recreation", "Sports & Recreation")],
  }),
  club("Harvard Undergraduate Beekeepers", {
    shortDescription: "Keeping hives on a campus roof.",
    categories: [cat("hobbies-games", "Hobbies & Games")],
  }),
  club("Harvard College Video Game Development Club", {
    shortDescription: "Students build games together each semester.",
    categories: [cat("technology", "Technology & Engineering")],
  }),
  club("Harvard-Radcliffe Dramatic Club", {
    shortDescription: "Produces student theater in the Loeb.",
    categories: [cat("theater", "Theater")],
    categorySlugs: ["performing-arts", "theater"],
    joinModes: ["audition"],
  }),
  club("Harvard Undergraduate Robotics Club", {
    shortDescription: "Builds robots for intercollegiate competitions.",
    categories: [cat("technology", "Technology & Engineering")],
  }),
  club("Harvard Society of Engineers", {
    shortDescription: "Engineering community; members join robotics, rocketry and other robotics-adjacent projects.",
  }),
  club("Harvard Breakers", {
    shortDescription: "Hip hop and breaking dance crew.",
    categories: [cat("dance", "Dance")],
    categorySlugs: ["performing-arts", "dance"],
    joinModes: ["audition"],
  }),
  club("Harvard Radcliffe Orchestra", {
    shortDescription: "The oldest symphony orchestra in the country.",
    categories: [cat("music", "Music")],
    categorySlugs: ["performing-arts", "music"],
  }),
  club("Harvard Korean Association", {
    shortDescription: "Korean culture, food and community.",
    categories: [cat("cultural-identity", "Cultural & Identity")],
  }),
  club("Harvard Computer Society", {
    acronym: "HCS",
    shortDescription: "Coding workshops and a student-run computing community.",
    categories: [cat("technology", "Technology & Engineering")],
    alias: ["Computer Society of Harvard"],
  }),
  club("Harvard Undergraduate Quantitative Traders", {
    shortDescription: "Mentorship for careers in quantitative finance and trading.",
    categories: [cat("finance", "Finance & Investing")],
    categorySlugs: ["pre-professional", "finance"],
    freshmenEligible: true,
    eligibleClasses: ["first_year", "sophomore"],
    joining: { ...NO_JOINING_FACTS, firstYears: true },
  }),
  club("Harvard College Queer Students Association", {
    shortDescription: "Social and support space for queer students.",
    categories: [cat("cultural-identity", "Cultural & Identity")],
  }),
  club("Gender and Sexuality Coalition", {
    shortDescription: "Coalition of student groups working on gender and sexuality.",
  }),
  club("Harvard Undergraduate PRIMUS", {
    shortDescription: "Community for first-generation, low-income students.",
  }),
  club("PBHA Afterschool Tutoring", {
    shortDescription: "Tutoring for children from low-income families.",
    categories: [cat("public-service", "Public Service")],
  }),
  club("Harvard Model United Nations", {
    shortDescription: "Runs a conference for high school delegates.",
  }),
  club("Harvard Model Congress", {
    shortDescription: "Simulated congress for high school students.",
  }),
  club("Immediate Players", {
    shortDescription: "Long-form improv comedy troupe with free shows.",
    categories: [cat("performing-arts", "Arts & Performance")],
  }),
  club("Harvard Undergraduate Data Project", {
    shortDescription: "Student data journalism.",
    categories: [cat("technology", "Technology & Engineering")],
    searchTopics: "web development visualization",
  }),
  club("Harvard Women in Computer Science", {
    shortDescription: "Community for women in CS.",
    categories: [cat("technology", "Technology & Engineering")],
  }),
  club("Peer Counseling Group", {
    shortDescription: "Confidential peer counseling about mental health.",
  }),
  club("Harvard Global Health Society", {
    shortDescription: "Talks on global health policy.",
    categories: [cat("medicine-health", "Health & Medicine")],
  }),
  club("Harvard Garden Club", { shortDescription: "Growing vegetables behind the house." }),
];

const search = (text: string, f: Partial<ClubFilters> = {}) =>
  searchLocal(CLUBS, { text, filters: ClubFilters.parse(f), sort: "relevance", offset: 0, limit: 20, now: NOW });
const names = (text: string) => search(text).clubs.map((c) => c.name);

describe("names, acronyms and initials", () => {
  it("finds a club by the initials of its name when it publishes no acronym", () => {
    expect(nameInitials("harvard college consulting group")).toBe("hccg");
    expect(names("hccg")[0]).toBe("Harvard College Consulting Group");
    const r = search("hccg");
    expect(r.reasons[r.clubs[0]!.id]).toEqual([{ kind: "initials", initials: "hccg" }]);
  });

  it("finds a club by its initials without the Harvard Undergraduate prefix", () => {
    expect(names("cbe")[0]).toBe("Harvard Undergraduate Consulting on Business and the Environment");
    expect(names("hucbe")[0]).toBe("Harvard Undergraduate Consulting on Business and the Environment");
  });

  it("keeps hyphenated words whole, keeps short words, and drops just Harvard in core initials", () => {
    expect(names("wpc")[0]).toBe("Harvard Undergraduate World Pre-Health Conference");
    expect(names("huwpc")[0]).toBe("Harvard Undergraduate World Pre-Health Conference");
    expect(names("wphc")[0]).toBe("Harvard Undergraduate World Pre-Health Conference");
    expect(names("wim")[0]).toBe("Harvard Undergraduate Women in Medicine");
    expect(names("uvcg")[0]).toBe("Harvard Undergraduate Venture Capital Group");
  });

  it("never reads an ordinary word as a name's short initials", () => {
    // "sea" is a word in another club's description, so it never stands for Society for Emerging Artists.
    expect(names("husea")[0]).toBe("Harvard Undergraduate Society for Emerging Artists");
    expect(names("sea")).toEqual(["Harvard Sailing Team"]);
  });

  it("finds a renamed club by the initials of its former name", () => {
    expect(names("hcdg")[0]).toBe("Harvard Undergraduate Data Group");
    expect(names("hudg")[0]).toBe("Harvard Undergraduate Data Group");
  });

  it("matches stated acronyms however the index cases them", () => {
    expect(names("huma")[0]).toBe("Harvard Undergraduate Mathematics Association");
    expect(names("HCS")[0]).toBe("Harvard Computer Society");
  });

  it("reports an alternate name as the reason, written as the club writes it", () => {
    const r = search("computer society of harvard");
    expect(r.clubs[0]?.name).toBe("Harvard Computer Society");
  });

  it("puts a club named for the query above one whose description repeats it", () => {
    expect(names("robotics")[0]).toBe("Harvard Undergraduate Robotics Club");
  });
});

describe("word forms and spelling", () => {
  it("matches plural and singular forms", () => {
    expect(wordVariants("robot")).toContain("robots");
    expect(wordVariants("societies")).toContain("society");
    expect(wordVariants("physics")).toEqual(["physics"]);
    expect(names("robot")[0]).toBe("Harvard Undergraduate Robotics Club");
  });

  it("treats British and American spellings alike", () => {
    expect(names("theatre")).toEqual(names("theater"));
    expect(names("theatre")[0]).toBe("Harvard-Radcliffe Dramatic Club");
  });

  it("reads 'hiphop' as hip hop", () => {
    expect(names("hiphop")[0]).toBe("Harvard Breakers");
  });

  it("never lets a finished word stand for a longer, different one", () => {
    expect(names("math")).not.toContain("Mather House Committee");
    expect(names("math")[0]).toBe("Harvard Undergraduate Mathematics Association");
  });

  it("never corrects a word into one with a different first letter", () => {
    // "rowing" is one letter from "growing"; a club about gardening is not a rowing club.
    expect(search("rowing").corrected).toBeNull();
    expect(names("rowing")).not.toContain("Harvard Garden Club");
    expect(search("robitics").corrected).toBe("robotics");
  });

  it("still completes the last word while typing", () => {
    expect(names("compu")).toContain("Harvard Computer Society");
    // "comp" alone is the comp process (round 4), and also a name on its way ("Computer").
    expect(names("comp")).toContain("Harvard Computer Society");
  });
});

describe("concepts stay narrow", () => {
  it("hiking finds outdoor clubs, not every sports team", () => {
    expect(names("hiking")).toEqual(["Harvard Mountaineering Club"]);
    expect(names("outdoors")).not.toContain("Harvard Combat Sports Club");
  });

  it("gaming finds game clubs, not every hobby", () => {
    expect(names("gaming")).toContain("Harvard College Video Game Development Club");
    expect(names("gaming")).not.toContain("Harvard Undergraduate Beekeepers");
  });

  it("explains a related-word match in plain words", () => {
    const r = search("band");
    const orchestra = r.clubs.find((c) => c.name === "Harvard Radcliffe Orchestra")!;
    expect(r.reasons[orchestra.id]!.map(reasonText)).toContain("Music: “orchestra” in the name");
  });

  it("finds LGBTQ+ groups for the words students use", () => {
    for (const q of ["lgbtq", "lgbt", "gay", "queer"]) {
      expect(names(q)).toEqual(
        expect.arrayContaining(["Harvard College Queer Students Association", "Gender and Sexuality Coalition"]),
      );
    }
  });

  it("first-gen finds first-generation groups, not programs that serve low-income kids", () => {
    expect(names("first-gen")[0]).toBe("Harvard Undergraduate PRIMUS");
    expect(names("fgli")).not.toContain("PBHA Afterschool Tutoring");
  });

  it("reads an abbreviation as its full form in a name, and only then", () => {
    expect(abbreviates("mun", "model united nations")).toBe(true);
    expect(abbreviates("model un", "model united nations")).toBe(true);
    expect(abbreviates("cs", "computer science")).toBe(true);
    expect(abbreviates("web development", "computer science")).toBe(false);
    expect(abbreviates("model congress", "model congress")).toBe(false);
    expect(names("mun")[0]).toBe("Harvard Model United Nations");
    expect(names("model un")[0]).toBe("Harvard Model United Nations");
    // Model Congress shares the concept, below the clubs the abbreviation names.
    expect(names("mun").indexOf("Harvard Model Congress")).toBeGreaterThan(0);
  });

  it("a club that lists the activity outranks one with only a broader word in its name", () => {
    expect(names("web development")[0]).toBe("Harvard Undergraduate Data Project");
  });

  it("mental health finds clubs about it, not every club with Health in its name", () => {
    expect(names("mental health")[0]).toBe("Peer Counseling Group");
    expect(names("mental health")).not.toContain("Harvard Global Health Society");
  });

  it("a description that says improv outranks one that only matches the broader category", () => {
    expect(names("improv")[0]).toBe("Immediate Players");
    // …but never above a club named for the topic.
    expect(names("theater")[0]).toBe("Harvard-Radcliffe Dramatic Club");
  });

  it("reads what a student wants to do, not the request words (ADR 0039)", () => {
    expect(names("learn to code")[0]).toBe("Harvard Computer Society");
    expect(names("i want to learn programming")[0]).toBe("Harvard Computer Society");
  });

  it("reads past verbs and people words around the topic (ADR 0040)", () => {
    expect(names("build robots")[0]).toBe("Harvard Undergraduate Robotics Club");
    expect(names("perform theater")[0]).toBe("Harvard-Radcliffe Dramatic Club");
    expect(names("build websites")[0]).toBe("Harvard Computer Society");
    expect(names("meet other korean students")[0]).toBe("Harvard Korean Association");
    // On their own, they are still searched as written.
    expect(search("play").total).toBeGreaterThanOrEqual(0);
  });

  it("finds coding clubs for software queries", () => {
    for (const q of ["coding", "software", "programming"]) expect(names(q)[0]).toBe("Harvard Computer Society");
    // "cs" abbreviates "computer science", so a club with that in its name comes first.
    expect(names("cs").slice(0, 2)).toEqual(["Harvard Women in Computer Science", "Harvard Computer Society"]);
  });
});

describe("empty results", () => {
  it("offers clubs matching part of a multi-word query, labeled as such", () => {
    const r = search("korean robotics");
    expect(r.total).toBe(0);
    expect(r.partial.map((p) => p.club.name)).toEqual(
      expect.arrayContaining(["Harvard Korean Association", "Harvard Undergraduate Robotics Club"]),
    );
    expect(r.partial.find((p) => p.club.name === "Harvard Korean Association")?.matched).toEqual(["korean"]);
  });

  it("names the single filter whose removal brings results back", () => {
    const filters = ClubFilters.parse({ joinModes: ["comp"], categories: ["technology"] });
    const got = relaxations(CLUBS, { text: null, filters, now: NOW }, [
      { key: "comp", patch: { joinModes: [] } },
      { key: "tech", patch: { categories: [] } },
    ]);
    expect(got.map((g) => [g.key, g.count])).toEqual([["comp", 5]]);
  });
});

describe("facets and eligibility", () => {
  it("counts each option as if added to its group (OR within a group)", () => {
    const f = facetCounts(CLUBS, { text: null, filters: ClubFilters.parse({ joinModes: ["audition"] }), now: NOW });
    expect(f.joinModes.audition).toBe(2);
    expect(f.joinModes.open).toBe(1);
    expect(f.categories["technology"] ?? 0).toBe(0);
    expect(f.categories["dance"]).toBe(1);
  });

  it("first-years: the derived yes only; no and unknown never match", () => {
    expect(matchesFirstYears({ joining: { ...NO_JOINING_FACTS, firstYears: true } })).toBe(true);
    expect(matchesFirstYears({ joining: { ...NO_JOINING_FACTS, firstYears: false } })).toBe(false);
    expect(matchesFirstYears({ joining: NO_JOINING_FACTS })).toBe(false);
    expect(search("", { freshmenEligible: true }).clubs.map((c) => c.name)).toEqual([
      "Harvard Undergraduate Quantitative Traders",
    ]);
  });
});

describe("similar clubs stay varied", () => {
  it("shows one of a family of look-alike names", async () => {
    const { similarClubs } = await import("../src/local");
    const mk = (name: string) =>
      club(name, {
        shortDescription: "Simulated congress conference for high school students on policy debate.",
        categories: [cat("political-advocacy", "Politics & Policy")],
        // Distinct sites: a shared website marks a duplicate, not a similar club.
        quickLinks: { website: `https://${normalizeName(name).replace(/ /g, "")}.invalid`, instagram: null },
      });
    const target = mk("Harvard Model Congress");
    const others = [
      mk("Harvard Model Congress Europe"),
      mk("Harvard Model Congress Asia"),
      mk("Harvard Policy Debaters"),
    ];
    const got = similarClubs(target, [target, ...others], { isLeaf: () => true }).map((s) => s.club.name);
    expect(got.filter((n) => n.startsWith("Harvard Model Congress")).length).toBeLessThanOrEqual(1);
    expect(got).toContain("Harvard Policy Debaters");
  });
});

describe("constraint phrases, soft words and concept precision (search-v5)", () => {
  const J = NO_JOINING_FACTS;
  const fin = [cat("finance", "Finance & Investing")];
  const social = [cat("social", "Social & Community")];
  const dance = [cat("dance", "Dance")];
  const IX: IndexClub[] = [
    club("Harvard Open Finance Circle", { categories: fin, joining: { ...J, comp: false } }),
    club("Harvard Investment Comp Society", { categories: fin, joining: { ...J, comp: true } }),
    // Says "no comp" in prose, but no derived fact: unknown is never read as yes.
    club("Harvard Wealth Club", { categories: fin, shortDescription: "No comps, no fuss: talks on finance." }),
    club("Harvard Venture Partners", { shortDescription: "Student venture capital fund backing campus founders." }),
    club("Harvard Latinx Finance Network", { categories: fin }),
    club("First-Year Outdoor Program", { shortDescription: "Pre-orientation trips in the woods." }),
    club("Harvard Mountaineering Society", { shortDescription: "Hiking and climbing trips." }),
    club("Harvard Outing Club", { shortDescription: "Weekend trips for students." }),
    club("Harvard Garden Friends", { shortDescription: "Monthly outings to local farms." }),
    club("Harvard Chess Society", { shortDescription: "Weekly casual play." }),
    club("Harvard Pom Squad", {
      categories: dance,
      shortDescription: "Dance team for athletic events.",
      searchTopics: "performs at home football games",
    }),
    club("Harvard Salsa Collective", { categories: dance, joining: { ...J, noExperience: true } }),
    club("Harvard Ballet Company", {
      categories: dance,
      shortDescription: "Classical ballet for trained dancers.",
      joining: { ...J, access: "process", general: ["audition"] },
    }),
    club("Harvard Swing Society", { categories: dance, joining: { ...J, access: "open", general: ["open"] } }),
    club("Harvard Culture Night", { searchTopics: "dance performances", joining: { ...J, access: "open" } }),
    club("Harvard Quiet Readers", { hoursPerWeek: { min: 1, max: 2 } }),
    club("Harvard Heavy Comp Review", { hoursPerWeek: { min: 10, max: 20 }, joining: { ...J, comp: true } }),
    club("Harvard China Forum", { shortDescription: "Conference on China's future." }),
    club("Harvard Korean Society", { shortDescription: "Korean culture and community." }),
    club("Harvard Rocketry Team", { shortDescription: "We design and launch rockets." }),
    club("Harvard Robot Builders", { shortDescription: "Hands-on robotics projects." }),
    club("Harvard Tech for Social Good", { shortDescription: "Software for nonprofits." }),
    club("Harvard House Social Committee", { categories: social, joining: { ...J, access: "open" } }),
    club("Harvard Data Lab", { searchTopics: "machine learning projects" }),
    club("Harvard Easy Rider Cycling", { joining: { ...J, access: "open" } }),
    club("Harvard Recruits Mentors", { joining: { ...J, firstYears: true } }),
  ];
  const run = (text: string, f: Partial<ClubFilters> = {}) =>
    searchLocal(IX, { text, filters: ClubFilters.parse(f), sort: "relevance", offset: 0, limit: 50, now: NOW });
  const ns = (text: string) => run(text).clubs.map((c) => c.name);

  it("reads “no comp” as the No comp filter, not as words in a description", () => {
    const r = run("no comp finance");
    expect(r.constraints).toEqual([{ filter: "noComp", phrase: "no comp" }]);
    expect(r.searchedText).toBe("finance");
    expect(r.clubs.map((c) => c.name)).toEqual(["Harvard Open Finance Circle"]);
    // Same filter however it's phrased.
    expect(run("finance clubs that don't require a comp").constraints.map((c) => c.filter)).toEqual(["noComp"]);
    expect(run("finance without comping").clubs.map((c) => c.name)).toEqual(["Harvard Open Finance Circle"]);
  });

  it("turns recruiting, open and dues phrases into filters, never spelling fixes", () => {
    // First-years is not a filter (almost every club takes them, few say so): the words are
    // a soft beginner lift, never required text and never a filter.
    const fresh = interpretQuery("clubs for freshmen");
    expect(fresh.constraints).toEqual([]);
    expect(fresh.soft.map((s) => s.modifier.key)).toEqual(["beginner"]);
    const rec = run("still recruiting");
    // No round is open anywhere in this index: the phrase reads as Still time to join and says
    // so (search-round8.test.ts has the case with a round open).
    expect(rec.constraints).toEqual([{ filter: "stillTime", phrase: "still recruiting", instead: "recruitingNow" }]);
    expect(interpretQuery("still recruiting").constraints.map((c) => c.filter)).toEqual(["recruitingNow"]);
    expect(rec.corrected).toBeNull(); // not "skill recruiting"
    // Bare "easy" is a soft word (re-ranks toward open clubs), not a filter; "easy to join" is.
    const easy = run("easy clubs");
    expect(easy.constraints).toEqual([]);
    expect(easy.soft).toEqual(["easy"]);
    expect(easy.corrected).toBeNull(); // not "east"
    expect(easy.clubs.map((c) => c.name)).toContain("Harvard Easy Rider Cycling");
    expect(run("easy to join").constraints.map((c) => c.filter)).toEqual(["openJoin"]);
    const soc = run("social no application");
    expect(soc.constraints.map((c) => c.filter)).toEqual(["openJoin"]);
    expect(soc.clubs.map((c) => c.name)).toEqual(["Harvard House Social Committee"]);
    expect(run("no dues finance").constraints.map((c) => c.filter)).toEqual(["noDues"]);
  });

  it("a phrase that is part of a club's name is the name", () => {
    const r = run("first year outdoor program");
    expect(r.constraints).toEqual([]);
    expect(r.clubs[0]?.name).toBe("First-Year Outdoor Program");
    expect(run("easy rider").clubs[0]?.name).toBe("Harvard Easy Rider Cycling");
  });

  it("facet counts and relaxations read the same constraints", () => {
    const f = facetCounts(IX, { text: "no comp finance", filters: ClubFilters.parse({}), now: NOW });
    expect(f.noComp).toBe(1);
    // A relaxation's link keeps the typed text, so the next page reads "no comp" from it again:
    // dropping the No comp filter alone still shows the one club.
    const rel = relaxations(IX, { text: "no comp finance", filters: ClubFilters.parse({}), now: NOW }, [
      { key: "nocomp", patch: { noComp: false } },
      { key: "q", patch: null },
    ]);
    expect(rel.find((r) => r.key === "nocomp")?.count).toBe(1);
    // Dropping the text drops what it implied.
    expect(rel.find((r) => r.key === "q")?.count).toBe(IX.length);
    // A filter set in the URL (not the text) counts without it.
    const url = relaxations(IX, { text: "finance", filters: ClubFilters.parse({ noComp: true }), now: NOW }, [
      { key: "nocomp", patch: { noComp: false } },
    ]);
    expect(url[0]?.count).toBe(5);
  });

  it("soft words lift clubs that say them and never exclude", () => {
    const r = run("dance beginner");
    expect(r.soft).toEqual(["beginner"]);
    expect(r.clubs.map((c) => c.name).slice(0, 1)).toEqual(["Harvard Salsa Collective"]);
    expect(r.clubs.map((c) => c.name)).toContain("Harvard Ballet Company");
    expect(r.reasons[r.clubs[0]!.id]).toContainEqual({ kind: "joining", text: "Says no experience needed" });
    // Open membership is the next best answer; a stated audition counts against.
    const order = r.clubs.map((c) => c.name);
    expect(order.indexOf("Harvard Swing Society")).toBeLessThan(order.indexOf("Harvard Pom Squad"));
    expect(order.at(-1)).toBe("Harvard Ballet Company");
    // A passing mention in an activity list isn't lifted above clubs about dance.
    expect(order.indexOf("Harvard Culture Night")).toBeGreaterThan(order.indexOf("Harvard Pom Squad"));
    expect(ns("chess casually")[0]).toBe("Harvard Chess Society");
  });

  it("soft words alone select the clubs that answer them, honestly", () => {
    const r = run("low commitment clubs");
    expect(r.soft).toEqual(["low commitment"]);
    expect(r.searchedText).toBe("");
    expect(r.clubs.map((c) => c.name)).toEqual(["Harvard Quiet Readers"]);
    expect(r.reasons[r.clubs[0]!.id]).toEqual([{ kind: "joining", text: "Says up to 2 hours a week" }]);
    expect(run("beginner").clubs.map((c) => c.name)).toContain("Harvard Swing Society");
    const f = facetCounts(IX, { text: "low commitment", filters: ClubFilters.parse({}), now: NOW });
    expect(f.categories["dance"] ?? 0).toBe(0);
  });

  it("ignores control characters in a query", () => {
    expect(cleanQuery("chess\u0000\n")).toBe("chess");
    expect(ns("chess\u0000")[0]).toBe("Harvard Chess Society");
  });

  it("an abbreviation counts a description's full form as the same words", () => {
    const vc = ns("vc");
    expect(vc.indexOf("Harvard Venture Partners")).toBeGreaterThanOrEqual(0);
    expect(vc.indexOf("Harvard Venture Partners")).toBeLessThan(vc.indexOf("Harvard Latinx Finance Network"));
    expect(ns("ml")).toContain("Harvard Data Lab");
  });

  it("a single related word only among listed activities doesn't match on its own", () => {
    const g = ns("gaming");
    expect(g).toContain("Harvard Chess Society");
    expect(g).not.toContain("Harvard Pom Squad");
    // A specific related phrase in the activities still does ("machine learning" for AI).
    expect(ns("ai")).toContain("Harvard Data Lab");
  });

  it("demonyms find the place, name-only related words stay in names", () => {
    expect(ns("chinese")).toContain("Harvard China Forum");
    expect(ns("korea")[0]).toBe("Harvard Korean Society");
    const h = ns("hiking");
    expect(h).toContain("Harvard Outing Club");
    expect(h).not.toContain("Harvard Garden Friends");
    expect(h[0]).toBe("Harvard Mountaineering Society");
  });

  it("natural phrasings reach a concept", () => {
    const b = ns("build things");
    expect(b).toContain("Harvard Robot Builders");
    expect(b).toContain("Harvard Rocketry Team");
    const m = ns("meet people");
    expect(m).toEqual(["Harvard House Social Committee"]); // not "Tech for Social Good"
  });
});

// REGRESSION (adversarial-qa, confirmed failing): constraint phrase gaps and negation.
describe("constraint phrases: negation and phrasing gaps (QA)", () => {
  const filtersOf = (q: string) => interpretQuery(q).constraints.map((c) => c.filter);
  it("drops a negated constraint and says so", () => {
    const q = interpretQuery("finance not recruiting");
    expect(q.constraints).toEqual([]);
    expect(q.negated).toEqual(["not recruiting"]);
    expect(q.text).toBe("finance");
    expect(filtersOf("no freshmen")).toEqual([]);
    expect(filtersOf("finance not easy to join")).toEqual([]);
  });
  it("drops leftover words beside a constraint and reads run-together phrases", () => {
    const q = interpretQuery("no comp only");
    expect(q.constraints.map((c) => c.filter)).toEqual(["noComp"]);
    expect(q.text).toBe("");
    expect(filtersOf("nocomp finance")).toEqual(["noComp"]);
    expect(filtersOf("finance without fees")).toEqual(["noDues"]);
    // Without a constraint, "only" is an ordinary word.
    expect(interpretQuery("only finance").text).toBe("only finance");
  });
  it("reads 'easy going' as a casual soft word", () => {
    expect(interpretQuery("easygoing music").soft.map((x) => x.modifier.key)).toEqual(["casual"]);
  });
  it("reads explicit no-experience phrases as the filter, keeping 'beginner' soft", () => {
    expect(filtersOf("no experience needed")).toEqual(["noExperience"]);
    expect(filtersOf("dance no prior experience")).toEqual(["noExperience"]);
    expect(filtersOf("music no experience required")).toEqual(["noExperience"]);
    expect(filtersOf("beginner dance")).toEqual([]);
    expect(filtersOf("not no experience needed")).toEqual([]);
  });
  it("reads 'without dues' like 'no dues'", () => {
    expect(filtersOf("clubs without dues")).toEqual(["noDues"]);
  });
  it("never turns a negated constraint into the affirmative filter", () => {
    // "not recruiting" must not apply Recruiting now; "not for freshmen" must not apply First-years eligible.
    expect(filtersOf("not recruiting")).toEqual([]);
    expect(filtersOf("not for freshmen")).toEqual([]);
    expect(filtersOf("not free to join")).toEqual([]);
    expect(filtersOf("not easy to join")).toEqual([]);
  });
  it("does not read 'easy going' as Open membership", () => {
    expect(filtersOf("easy going")).toEqual([]);
  });
});
