import { describe, expect, it } from "vitest";
import { normalizeName } from "@hci/core/browser";
import { ClubFilters, NO_JOINING_FACTS, searchLocal, type IndexClub } from "../src/local";

/** QA sweep 2026-10-13: odd queries made only of small words, and a word typed twice. */
function club(name: string, desc: string | null = null): IndexClub {
  const slug = normalizeName(name).replace(/ /g, "-");
  return {
    id: slug,
    slug,
    name,
    acronym: null,
    shortDescription: desc,
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
    quickLinks: { website: `https://${slug}.invalid`, instagram: null },
    logo: null,
    pressCount: 0,
    cycles: [],
    searchNames: normalizeName(name),
    searchAcronyms: [],
    searchTopics: "",
    categorySlugs: [],
    recruitingSeasons: [],
  } as IndexClub;
}
const clubs = [
  club("Harvard Script Society", "Writing scripts"),
  club("The Chess Club"),
  club("Society of Women Engineers"),
  club("Theater of the Absurd"),
];
const run = (text: string) =>
  searchLocal(clubs, {
    text,
    filters: ClubFilters.parse({}),
    sort: "relevance",
    offset: 0,
    limit: 50,
    now: new Date("2026-10-13T16:00:00Z"),
  });

describe("queries of only small words", () => {
  it("read as no search: the browse list, no 'unknown word' complaints", () => {
    const r = run("the and of");
    expect(r.total).toBe(clubs.length);
    expect(r.unknownWords).toEqual([]);
    expect(r.searchedText.trim()).toBe("");
  });

  it("still finds a club whose name is such a phrase, and a half-typed first word", () => {
    expect(run("of the").total).toBeGreaterThan(0);
    expect(run("the").clubs.map((c) => c.name)).toContain("Theater of the Absurd");
  });
});

describe("a word typed twice", () => {
  it("is read like the word once", () => {
    const once = run("script");
    for (const twice of ["script script", "Script  SCRIPT", "script script script"]) {
      const r = run(twice);
      expect(r.clubs.map((c) => c.name)).toEqual(once.clubs.map((c) => c.name));
      expect(r.searchedText.toLowerCase()).toBe(once.searchedText);
      expect(r.unknownWords).toEqual(once.unknownWords);
    }
  });

  it("leaves different words, and words that merely start alike, alone", () => {
    expect(run("script scripts").searchedText).toBe("script scripts");
  });
});
