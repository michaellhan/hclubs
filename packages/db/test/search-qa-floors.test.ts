import { describe, expect, it } from "vitest";
import { normalizeName } from "@hci/core/browser";
import { ClubFilters, NO_JOINING_FACTS, searchLocal, type IndexClub } from "../src/local";

/**
 * Adversarial QA (2026-10-13), search inputs the round 13/14 work leaves broken on the real
 * index. `it.fails` documents each bug without turning the shared suite red while the search
 * files are being edited elsewhere: when one is fixed, vitest reports "expected to fail" and the
 * `.fails` is removed. Hand-made index; descriptions invented.
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
  // "more" is not a stop word, so "more than 10 hours" is spelling-corrected to "morse 10 hours"
  // and the bare number is required text: no club matches. A floor should be ignored, not fatal.
  it.fails("'more than 10 hours' is not corrected to a club-name word and does not empty the list", () => {
    const r = search("more than 10 hours");
    expect(r.corrected ?? "").not.toMatch(/morse/);
    expect(r.total).toBeGreaterThan(0);
  });
  it.fails("'10+ hours' still finds clubs", () => {
    expect(search("10+ hours").total).toBeGreaterThan(0);
  });
});
