import { describe, expect, it } from "vitest";
import { normalizeName } from "@hci/core/browser";
import { ClubFilters, facetCounts, NO_JOINING_FACTS, searchLocal, type IndexClub } from "../src/local";
import { editDistance } from "../src/local/search";

/**
 * Spelling correction (persona round 8, 2026-10-17): real words were corrected to wrong index
 * words and emptied the list ("creatve writing" → "create", "fine arts" → "find", "manga" →
 * "manage"). Hand-made index; descriptions invented.
 */
let n = 0;
function club(name: string, shortDescription: string): IndexClub {
  const slug = normalizeName(name).replace(/ /g, "-");
  return {
    id: `sp-${++n}`,
    slug,
    name,
    acronym: null,
    shortDescription,
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
  };
}

const CLUBS = [
  club("Harvard Creative Writing Collective", "Workshops for fiction and poetry writers."),
  club("Harvard Create Lab", "Build things together."),
  club("Harvard Arts Collective", "Student painters and sculptors."),
  club("Find Your Path Program", "Mentoring for first-years."),
  club("Harvard Management Society", "Learn to manage teams."),
];
const NOW = new Date("2026-10-17T16:00:00Z");
const search = (text: string) =>
  searchLocal(CLUBS, {
    text,
    filters: ClubFilters.parse({}),
    sort: "relevance",
    offset: 0,
    limit: 50,
    now: NOW,
  });

describe("spelling correction", () => {
  it("counts an adjacent swap as one edit, never less than the true distance", () => {
    expect(editDistance("chiense", "chinese", 2)).toBe(1);
    expect(editDistance("manga", "manage", 1)).toBe(2);
    expect(editDistance("manga", "manage", 2)).toBe(2);
  });
  it("between equally close fixes, keeps every typed letter (a dropped letter)", () => {
    const r = search("creatve writing");
    expect(r.corrected).toBe("creative writing");
    expect(r.clubs[0]?.name).toBe("Harvard Creative Writing Collective");
  });
  it("never turns a word two edits away into a club word", () => {
    expect(search("manga").clubs.map((c) => c.name)).not.toContain("Harvard Management Society");
  });
  it("a word no club uses never empties the list: the rest is searched, and the result says so", () => {
    const r = search("arts zqxvb");
    expect(r.clubs[0]?.name).toBe("Harvard Arts Collective");
    expect(r.corrected).toBe("arts");
    expect(r.retriedText).toBe("arts");
    expect(r.unknownWords).toContain("zqxvb");
    // The directory's counts follow the retried text, so its menus agree with the list.
    const inView = (text: string | null) => {
      const { hours } = facetCounts(CLUBS, { text, filters: ClubFilters.parse({}), now: NOW });
      return hours.stated + hours.unknown;
    };
    expect(inView(r.retriedText)).toBe(r.total);
    expect(inView("arts zqxvb")).toBe(0);
  });
  it("a typo and an unreadable word: the typo is corrected, the other dropped", () => {
    const r = search("creatve zqxvb");
    expect(r.clubs[0]?.name).toBe("Harvard Creative Writing Collective");
    expect(r.corrected).toBe("creative");
  });
  it("a corrected word that led nowhere: partial matches show, nothing is silently dropped", () => {
    const r = search("fine arts");
    expect(r.total).toBe(0);
    expect(r.partial.map((p) => p.club.name)).toContain("Harvard Arts Collective");
  });
  it("filler beside an unreadable word is not a search", () => {
    expect(search("clubs zqxvb").total).toBe(0);
  });
  it("a query of only unknown words stays empty", () => {
    expect(search("zqxvb qwzzy").total).toBe(0);
  });
});
