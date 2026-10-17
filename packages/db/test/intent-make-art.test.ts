import { describe, expect, it } from "vitest";
import { normalizeName } from "@hci/core/browser";
import { INTENTS, matchesIntent, NO_JOINING_FACTS, type IndexClub } from "../src/local";

/** "Make art" (persona round 8): it found 2 clubs; art and craft clubs by name or one-liner. Invented clubs. */
function club(name: string, shortDescription: string, categorySlugs: string[]): IndexClub {
  return {
    id: name,
    slug: normalizeName(name).replace(/ /g, "-"),
    name,
    acronym: null,
    shortDescription,
    orgType: null,
    recognitionStatus: "recognized",
    activityStatus: "active",
    joinModes: [],
    freshmenEligible: null,
    joining: NO_JOINING_FACTS,
    categories: categorySlugs.map((slug) => ({ slug, name: slug, isPrimary: true })),
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
    categorySlugs,
    recruitingSeasons: [],
  };
}

const art = INTENTS.find((i) => i.slug === "make-art")!; // defined in intents.ts

describe("Make art", () => {
  it.each([
    club("Harvard Black Arts Collective", "Space for Black artists to make and share work.", ["cultural-identity"]),
    club("Harvard Arts & Crafts Club", "Weekly craft nights.", ["hobbies-games"]),
    club("Harvard Photography Club", "", ["hobbies-games"]),
    club("Harvard Tuesday Review", "Publication of creative writing and art by students.", ["publications-media"]),
  ])("picks $name", (c) => expect(matchesIntent(c, art)).toBe(true));
  it("leaves out talks about the arts and arts-business careers", () => {
    expect(
      matchesIntent(club("Coalition for the Arts", "Events with artists on policy.", ["political-advocacy"]), art),
    ).toBe(false);
    expect(
      matchesIntent(
        club("Harvard Music Business Association", "Careers with artists.", ["music", "pre-professional"]),
        art,
      ),
    ).toBe(false);
  });
});
