import { describe, expect, it } from "vitest";
import { normalizeName } from "@hci/core";
import {
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

  it("finds coding clubs for software queries", () => {
    for (const q of ["coding", "software", "cs", "programming"]) expect(names(q)[0]).toBe("Harvard Computer Society");
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
    expect(got.map((g) => [g.key, g.count])).toEqual([["comp", 3]]);
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
