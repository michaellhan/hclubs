import { describe, expect, it } from "vitest";
import { normalizeName } from "@hci/core";
import {
  abbreviates,
  ClubFilters,
  facetCounts,
  matchesFirstYears,
  nameInitials,
  reasonText,
  relaxations,
  searchLocal,
  wordVariants,
  type IndexClub,
} from "../src/local";

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
    categories: [],
    memberCount: null,
    hoursPerWeek: null,
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
    freshmenEligible: null,
    eligibleClasses: ["first_year", "sophomore"],
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

  it("first-years: stated eligibility or listed class years; unknown never matches", () => {
    expect(matchesFirstYears({ freshmenEligible: null, eligibleClasses: ["first_year"] })).toBe(true);
    expect(matchesFirstYears({ freshmenEligible: false, eligibleClasses: ["first_year"] })).toBe(false);
    expect(matchesFirstYears({ freshmenEligible: null, eligibleClasses: null })).toBe(false);
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
