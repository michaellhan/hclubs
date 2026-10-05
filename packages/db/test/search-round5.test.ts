import { describe, expect, it } from "vitest";
import { normalizeName } from "@hci/core";
import { ClubFilters, NO_JOINING_FACTS, searchLocal, type IndexClub } from "../src/local";

/**
 * Round 5 (2026-10-05), from a sweep of ~230 student queries: topics that had clubs but no
 * way in ("psychology", "martial arts", "persian", "sci-fi"), names written as one word or
 * two ("standup", "board games"), words scattered across an activity list ("law school"),
 * the student government by its usual names, typos in a club's own name, and multi-word
 * topics while typing. Hand-made index; names illustrative, descriptions invented.
 */
const NOW = new Date("2026-10-01T16:00:00Z");
let n = 0;
const cat = (slug: string, name = slug) => ({ slug, name, isPrimary: false });

function club(name: string, over: Partial<IndexClub> & { aliases?: string[] } = {}): IndexClub {
  const names = [name, ...(over.aliases ?? [])].map(normalizeName);
  return {
    id: `r5-${++n}`,
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
    searchNames: names.join(" | "),
    searchAcronyms: [],
    searchTopics: "",
    categorySlugs: (over.categories ?? []).map((c) => c.slug),
    recruitingSeasons: [],
    ...over,
  };
}

const theater = [cat("theater", "Theater")];
const IX: IndexClub[] = [
  club("Harvard Mind Brain and Behavior Society"),
  club("Harvard Judo Club"),
  club("Harvard Karate Club"),
  club("Harvard College Iranian Association"),
  club("Harvard-Radcliffe Science Fiction Association"),
  club("Harvard Undergraduate Stand-Up Comics Society"),
  club("Harvard Student Theater Collective", { categories: theater, shortDescription: "Student theater and drama." }),
  club("Harvard Undergraduate Boardgame Society"),
  club("Harvard Chess Club", { searchTopics: "games chess" }),
  club("Harvard Moot Court", { searchTopics: "law competitions high school outreach" }),
  club("Harvard Christian Impact", { searchTopics: "worship bible studies" }),
  club("Harvard Undergraduate Association", { shortDescription: "Advocates for students with the administration." }),
  club("Harvard Undergraduate Association of Ghanaian Students"),
  club("Harvard Undergraduate Tibetan Cultural Association", { instagramFollowers: 900 }),
  club("Harvard Crimson", { instagramFollowers: 20000 }),
  club("The Crimson: Business Board", { instagramFollowers: 30000 }),
  club("Harvard Climbing Club"),
  club("Harvard Outing Club"),
  club("Harvard Undergraduate Women in Foreign Policy"),
  club("Harvard Undergraduate Women in Business", { instagramFollowers: 5000 }),
  club("Harvard Undergraduate Patient Support Corps"),
  club("Harvard Patent Law Society", { instagramFollowers: 100 }),
  club("Harvard College Student International Law"),
  club("Harvard Association Cultivating Inter-American Democracy", { instagramFollowers: 3000 }),
  club("Harvard International Review"),
  club("Harvard International Club"),
  club("Harvard Open Choir", {
    joining: { ...NO_JOINING_FACTS, access: "open" },
    shortDescription: "Anyone can sing with us.",
  }),
];

const run = (text: string) =>
  searchLocal(IX, { text, filters: ClubFilters.parse({}), sort: "relevance", offset: 0, limit: 50, now: NOW });
const names = (text: string) => run(text).clubs.map((c) => c.name);

describe("search round 5", () => {
  it("topics with clubs but no way in before", () => {
    expect(names("psychology")[0]).toBe("Harvard Mind Brain and Behavior Society");
    expect(names("martial arts")).toEqual(expect.arrayContaining(["Harvard Judo Club", "Harvard Karate Club"]));
    expect(names("karate")[0]).toBe("Harvard Karate Club");
    expect(names("persian")).toEqual(["Harvard College Iranian Association"]);
    expect(names("sci-fi")).toEqual(["Harvard-Radcliffe Science Fiction Association"]);
  });

  it("a name written as one word or two: 'standup', 'stand up', 'board games'", () => {
    // The phrase in the name beats a theater group's category and related words.
    expect(names("stand up comedy")[0]).toBe("Harvard Undergraduate Stand-Up Comics Society");
    expect(names("standup")[0]).toBe("Harvard Undergraduate Stand-Up Comics Society");
    expect(names("board games")[0]).toBe("Harvard Undergraduate Boardgame Society");
  });

  it("words scattered across an activity list don't match; side by side, in any form, they do", () => {
    expect(names("law school")).not.toContain("Harvard Moot Court");
    expect(names("bible study")).toContain("Harvard Christian Impact");
  });

  it("the student government by its usual names, never another 'Undergraduate Association of …'", () => {
    expect(names("student government")[0]).toBe("Harvard Undergraduate Association");
    expect(names("ug council")[0]).toBe("Harvard Undergraduate Association");
    expect(names("student gov")[0]).toBe("Harvard Undergraduate Association");
    expect(names("student government")).not.toContain("Harvard Undergraduate Association of Ghanaian Students");
    // Its own name, all of it filler words, is still its name.
    expect(names("undergraduate association")[0]).toBe("Harvard Undergraduate Association");
    expect(names("undergraduate ass")).toContain("Harvard Undergraduate Association");
  });

  it("a typo in a club's own name still gets the name's bonus ('crimsom' → the Crimson)", () => {
    const r = run("crimsom");
    expect(r.corrected).toBe("crimson");
    expect(r.clubs[0]?.name).toBe("Harvard Crimson");
  });

  it("the typed word of a multi-word topic ranks first ('rock climbing' → Climbing Club)", () => {
    expect(names("rock climbing").slice(0, 2)).toEqual(["Harvard Climbing Club", "Harvard Outing Club"]);
  });

  it("'dont need applications' is the Open membership filter", () => {
    const r = run("clubs that dont need applications");
    expect(r.constraints.map((c) => c.filter)).toEqual(["openJoin"]);
    expect(r.clubs.map((c) => c.name)).toEqual(["Harvard Open Choir"]);
  });

  it("a filler word typed last may start a name word ('women in for' → Foreign Policy), never required", () => {
    expect(names("women in for")[0]).toBe("Harvard Undergraduate Women in Foreign Policy");
    expect(names("women in for")).toContain("Harvard Undergraduate Women in Business");
  });

  it("a swapped-letter typo keeps its letters ('pateint' → patient, not patent)", () => {
    const r = run("pateint support corps");
    expect(r.corrected).toBe("patient support corps");
    expect(r.clubs[0]?.name).toBe("Harvard Undergraduate Patient Support Corps");
  });

  it("a rare name word that begins a common one is still half-typed ('student inter' → International)", () => {
    expect(names("student inter")[0]).toBe("Harvard College Student International Law");
  });

  it("'dont audition' and 'free clubs' read as what they ask", () => {
    expect(run("singing groups that dont audition").soft.length).toBe(1);
    expect(run("free clubs").constraints.map((c) => c.filter)).toEqual(["noDues"]);
  });
});
