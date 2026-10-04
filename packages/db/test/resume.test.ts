import { describe, expect, it } from "vitest";
import { normalizeName } from "@hci/core";
import { matchResume, NO_JOINING_FACTS, readResumeInterests, type IndexClub } from "../src/local";

/** Resume → club recommendations. Hand-made index; names illustrative, text invented for the test. */
let n = 0;
const cat = (slug: string, name = slug) => ({ slug, name, isPrimary: false });

function club(name: string, over: Partial<IndexClub> = {}): IndexClub {
  return {
    id: `rs-${++n}`,
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
    quickLinks: { website: null, instagram: null },
    logo: null,
    pressCount: 0,
    cycles: [],
    searchNames: normalizeName(name),
    searchAcronyms: [],
    searchTopics: "",
    categorySlugs: (over.categories ?? []).map((c) => c.slug),
    recruitingSeasons: [],
    ...over,
  };
}

const CLUBS = [
  club("Harvard Investment Club", {
    categories: [cat("finance", "Finance")],
    shortDescription: "Student investing fund.",
  }),
  club("Harvard Computer Society", { categories: [cat("tech", "Tech")], shortDescription: "Software projects." }),
  club("Harvard Undergraduate Bhangra", { categories: [cat("dance", "Dance")] }),
  club("Radcliffe Pitches", { categories: [cat("a-cappella", "A cappella")] }),
  club("Phillips Brooks House Association", { categories: [cat("public-service", "Public service")] }),
  club("Harvard Rowing Club"),
  club("Harvard Law School Investing Group", {
    categories: [cat("finance", "Finance")],
    affiliationScope: "graduate_school",
  }),
  club("Old Investing Society", { categories: [cat("finance", "Finance")], activityStatus: "defunct" }),
];

const keys = (text: string) => readResumeInterests(text, CLUBS).map((i) => i.key);

describe("readResumeInterests", () => {
  it("reads topics and counts repeats", () => {
    const ints = readResumeInterests(
      "Jane Doe\nSummer intern: equity research, investment banking, stock pitches\nBuilt software in Python",
      CLUBS,
    );
    const finance = ints.find((i) => i.key === "c:finance");
    expect(finance?.count).toBeGreaterThanOrEqual(2);
    expect(ints.map((i) => i.key)).toContain("c:software");
  });

  it("skips contact lines and the name at the top", () => {
    // "Bhangra" as someone's surname on the first line, and an email naming Rowing, are not interests.
    expect(keys("Alex Bhangra\nalex.rowing@example.com | (617) 555-1234\nChess")).toEqual([]);
  });

  it("takes a rare club-name word only as a capitalized name, not an ordinary word", () => {
    expect(keys("Analyst\nstock pitches to the fund")).not.toContain("w:pitches");
    expect(keys("Analyst\nBhangra dancer for 10 years")).toContain("w:bhangra");
  });

  it("drops a club-name word inside a longer proper name (a school)", () => {
    expect(keys("Alex Kim\nPhillips Academy, Class of 2030")).not.toContain("w:phillips");
  });

  it("never reads generic resume phrases as topics", () => {
    expect(keys("Alex\nRan social media for a cafe; customer service")).toEqual([]);
  });
});

describe("matchResume", () => {
  it("ranks clubs for the resume's interests and says why", () => {
    const ints = readResumeInterests("Alex\nInvestment club treasurer; equity research; Bhangra dancer", CLUBS);
    const picks = matchResume(CLUBS, ints);
    const names = picks.map((p) => p.club.name);
    expect(names).toContain("Harvard Investment Club");
    expect(names).toContain("Harvard Undergraduate Bhangra");
    expect(picks.find((p) => p.club.name === "Harvard Investment Club")?.interests).toContain("Finance & investing");
  });

  it("leaves out graduate-school groups and clubs that ended", () => {
    const ints = readResumeInterests("Alex\nInvestment club; investing; finance", CLUBS);
    const names = matchResume(CLUBS, ints).map((p) => p.club.name);
    expect(names).not.toContain("Harvard Law School Investing Group");
    expect(names).not.toContain("Old Investing Society");
  });

  it("returns nothing without interests", () => {
    expect(matchResume(CLUBS, [])).toEqual([]);
  });
});

describe("resume review regressions", () => {
  const more = [
    ...CLUBS,
    club("Strong Women Strong Girls", { categories: [cat("public-service", "Public service")] }),
    club("Harvard Chess Club"),
  ];

  it("reads a one-line list of interests (not taken for a name)", () => {
    expect(readResumeInterests("coding, debate, a cappella", more).map((i) => i.key)).toEqual(
      expect.arrayContaining(["c:software", "c:debate", "c:a-cappella"]),
    );
    expect(readResumeInterests("Rowing, Chess", more).map((i) => i.key)).toContain("w:chess");
  });

  it("never reads an outside organization's name as the student's identity", () => {
    const ints = readResumeInterests("Alex\nVolunteer tutor at Boys & Girls Club", more).map((i) => i.key);
    expect(ints).not.toContain("w:girls");
    expect(ints).not.toContain("w:boys");
  });

  it("reads skills and job titles as topics", () => {
    const ints = readResumeInterests("Alex\nPython, SQL\nequity research and valuation", more).map((i) => i.key);
    expect(ints).toEqual(expect.arrayContaining(["c:software", "c:finance"]));
  });

  it("spreads picks across interests when the second is at least half as strong", () => {
    const fin = Array.from({ length: 8 }, (_, k) =>
      club(`Investing Fund ${String.fromCharCode(65 + k)}`, { categories: [cat("finance", "Finance")] }),
    );
    const clubs = [...fin, club("Harvard Undergraduate Bhangra", { categories: [cat("dance", "Dance")] })];
    const ints = readResumeInterests("Alex\ninvesting investing investing finance\nBhangra", clubs);
    const names = matchResume(clubs, ints).map((p) => p.club.name);
    expect(names.indexOf("Harvard Undergraduate Bhangra")).toBeLessThan(6);
  });
});
