import { describe, expect, it } from "vitest";
import { normalizeName } from "@hci/core/browser";
import { ClubFilters, NO_JOINING_FACTS, searchLocal, type IndexClub } from "../src/local";

/**
 * Adversarial QA (2026-10-13): hours floors emptied the list (fixed 2026-10-17, `hoursFloorAt`).
 * A floor is dropped, never a filter and never searched text; caps beside it still apply.
 * Hand-made index; descriptions invented.
 */
const NOW = new Date("2026-10-13T16:00:00Z");
let n = 0;

function club(name: string, over: Partial<IndexClub> = {}): IndexClub {
  const slug = normalizeName(name).replace(/ /g, "-");
  return {
    id: `qa-${++n}`,
    slug,
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
    quickLinks: { website: `https://${slug}.invalid`, instagram: null },
    logo: null,
    pressCount: 0,
    cycles: [],
    searchNames: normalizeName(name),
    searchAcronyms: [],
    searchTopics: "",
    categorySlugs: [],
    recruitingSeasons: [],
    ...over,
  };
}

const CLUBS = [
  club("Harvard Morse Code Society", { shortDescription: "Learn telegraph signalling." }),
  club("Harvard Tutoring Corps", { hoursPerWeek: { min: 10, max: 12 }, shortDescription: "Weekly tutoring." }),
  club("Harvard Chess Club", { hoursPerWeek: { min: 1, max: 2 }, shortDescription: "Casual chess." }),
];
const search = (text: string) =>
  searchLocal(CLUBS, { text, filters: ClubFilters.parse({}), sort: "relevance", offset: 0, limit: 50, now: NOW });

describe("hours floors (CLAUDE.md §13: floors never become caps)", () => {
  // "more" is not a stop word: "more than 10 hours" was spelling-corrected to "morse 10 hours"
  // and the bare number was required text, so no club matched.
  it("'more than 10 hours' is not corrected to a club-name word and does not empty the list", () => {
    const r = search("more than 10 hours");
    expect(r.corrected ?? "").not.toMatch(/morse/);
    expect(r.total).toBeGreaterThan(0);
  });
  it("'10+ hours' still finds clubs", () => {
    expect(search("10+ hours").total).toBeGreaterThan(0);
  });
  it.each(["at least 5 hours a week", "10 hours or more", "at least 3-5 hours", "more than 10", "10+"])(
    "'%s' alone is the browse list",
    (q) => {
      const r = search(q);
      expect(r.searchedText ?? "").toBe("");
      expect(r.total).toBe(CLUBS.length);
    },
  );
  it("a floor beside a topic searches the topic, with no hours cap", () => {
    const r = search("chess more than 10 hours");
    expect(r.clubs.map((c) => c.name)).toEqual(["Harvard Chess Club"]);
    expect(r.constraints).toEqual([]);
  });
  it("a cap beside a floor still applies, and an amount with no floor word stays text", () => {
    expect(search("at least 2 hours, 5 hours or less").constraints.map((c) => [c.filter, c.value])).toEqual([
      ["maxHours", 5],
    ]);
    expect(search("not more than 5 hours").constraints.map((c) => [c.filter, c.value])).toEqual([["maxHours", 5]]);
    expect(search("24 hours of code plus").searchedText).toContain("24 hours");
  });
});
