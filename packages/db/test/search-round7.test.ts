import { describe, expect, it } from "vitest";
import { normalizeName } from "@hci/core";
import { ClubFilters, NO_JOINING_FACTS, searchLocal, type IndexClub } from "../src/local";

/**
 * Round 7 (2026-10-05): category names typed whole ("technology & engineering" found 9 of
 * its 37 clubs), topics whose clubs no word reached (blockchain, polo, Hillel, Datamatch),
 * the typed word's own stem first among related words, and a category's own clubs before
 * outside clubs that only mention the word. Hand-made index; names illustrative.
 */
const NOW = new Date("2026-10-01T16:00:00Z");
let n = 0;
const cat = (slug: string, name = slug) => ({ slug, name, isPrimary: false });

function club(name: string, over: Partial<IndexClub> = {}): IndexClub {
  return {
    id: `r7-${++n}`,
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
    searchNames: normalizeName(name),
    searchAcronyms: [],
    searchTopics: "",
    categorySlugs: (over.categories ?? []).map((c) => c.slug),
    recruitingSeasons: [],
    ...over,
  };
}

const tech = [cat("technology", "Technology & Engineering")];
const theater = [cat("theater", "Theater")];
const music = [cat("music", "Music")];
const IX: IndexClub[] = [
  club("Harvard Robotics Club", { categories: tech }),
  club("Harvard Satellite Team", { categories: tech }),
  club("Harvard Technology Review"),
  club("Harvard Blockchain Club"),
  club("Harvard Polo Club"),
  club("Harvard Hillel"),
  club("Datamatch", { searchTopics: "sponsors free dates" }),
  club("Harvard Composers Association", { categories: music }),
  club("Harvard Radcliffe Orchestra", { categories: music, shortDescription: "Symphonic music." }),
  club("Three Letter Acronym", { categories: theater }),
  club("Harvard Opportunes", { shortDescription: "A cappella pop, jazz and theatre." }),
];

const run = (text: string) =>
  searchLocal(IX, { text, filters: ClubFilters.parse({}), sort: "relevance", offset: 0, limit: 50, now: NOW });
const names = (text: string) => run(text).clubs.map((c) => c.name);

describe("search round 7", () => {
  it("a multi-word category name finds all of its clubs, first", () => {
    const r = names("technology & engineering");
    expect(r.slice(0, 2).sort()).toEqual(["Harvard Robotics Club", "Harvard Satellite Team"]);
    expect(names("Technology and Engineering clubs")).toContain("Harvard Satellite Team");
  });

  it("topics whose clubs no word reached", () => {
    expect(names("crypto")).toEqual(["Harvard Blockchain Club"]);
    expect(names("equestrian")).toEqual(["Harvard Polo Club"]);
    expect(names("judaism")).toEqual(["Harvard Hillel"]);
    expect(names("dating")).toEqual(["Datamatch"]);
  });

  it("a related word with the typed word's stem comes first ('composing' → Composers)", () => {
    expect(names("composing")[0]).toBe("Harvard Composers Association");
  });

  it("a category's own club comes before an outside club that only mentions the word", () => {
    const r = names("theater");
    expect(r.indexOf("Three Letter Acronym")).toBeLessThan(r.indexOf("Harvard Opportunes"));
  });
});
