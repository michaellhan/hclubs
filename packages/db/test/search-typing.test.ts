import { describe, expect, it } from "vitest";
import { normalizeName } from "@hci/core";
import { ClubFilters, NO_JOINING_FACTS, searchLocal, type IndexClub } from "../src/local";

/**
 * The directory searches on every keystroke, so a half-typed query must already find the
 * club: "c" finds the Crimson, "consulting g" the Consulting Group, "hc" HCS. Equally good
 * matches go to the better-known club (stated Instagram followers), then by name.
 * Hand-made index; names illustrative, descriptions invented for the test.
 */
const NOW = new Date("2026-10-01T16:00:00Z");
let n = 0;
const cat = (slug: string, name = slug) => ({ slug, name, isPrimary: false });

function club(name: string, over: Partial<IndexClub> & { aliases?: string[] } = {}): IndexClub {
  const names = [name, ...(over.aliases ?? []), ...(over.searchAcronyms ?? [])].map(normalizeName);
  return {
    id: `ty-${++n}`,
    slug: normalizeName(name).replace(/ /g, "-"),
    name,
    acronym: over.searchAcronyms?.[0] ?? null,
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

const dance = [cat("dance", "Dance")];
const IX: IndexClub[] = [
  club("The Harvard Crimson", { instagramFollowers: 20000, shortDescription: "The daily student newspaper." }),
  club("Crimson Key Society", { instagramFollowers: 3000 }),
  club("Harvard College Chess Club", { shortDescription: "Casual and competitive chess co-hosted with MIT." }),
  club("Harvard Computer Society", { searchAcronyms: ["HCS"], instagramFollowers: 5000 }),
  club("Harvard College Consulting Group", { instagramFollowers: 4000 }),
  club("Harvard Undergraduate Social Impact Consulting Group"),
  club("Harvard College Engineering Society", { searchAcronyms: ["HCES"] }),
  club("Institute of Politics", { instagramFollowers: 9000 }),
  club("Datamatch", { shortDescription: "Students match students on Valentine's Day." }),
  club("Harvard Undergraduate Data Analytics Group"),
  club("Harvard Ballet Company", { categories: dance }),
  club("Harvard Ballroom Dance Club", { categories: dance }),
  club("Harmony Afterschool", { shortDescription: "Mentoring for kids." }),
  club("Robotics Team", { shortDescription: "Builds hardware projects." }),
  club("Mather House Committee", { shortDescription: "Plans events for residents of the house." }),
  club("Harvard Math Club", { shortDescription: "Math talks and problem solving." }),
];

const run = (text: string) =>
  searchLocal(IX, { text, filters: ClubFilters.parse({}), sort: "relevance", offset: 0, limit: 50, now: NOW });
const names = (text: string) => run(text).clubs.map((c) => c.name);

describe("searching while typing", () => {
  it("one letter finds names with a word starting with it, never just 'College' or 'Club'", () => {
    const c = names("c");
    expect(c[0]).toBe("The Harvard Crimson");
    expect(c).toContain("Harvard College Chess Club");
    expect(c).toContain("Harvard College Consulting Group");
    // Only "College"/"Club" start with c here.
    expect(c).not.toContain("Harvard Ballroom Dance Club");
  });

  it("a name's core counts as its start: 'harvard c' and 'the c' read like 'c'", () => {
    expect(names("harvard c")[0]).toBe("The Harvard Crimson");
    expect(names("the c")[0]).toBe("The Harvard Crimson");
    expect(names("cri")).toEqual(["The Harvard Crimson", "Crimson Key Society"]);
  });

  it("two letters are a word's start, not a description fragment ('co' isn't 'co-hosted')", () => {
    const co = names("co");
    expect(co.slice(0, 2)).toEqual(["Harvard Computer Society", "Harvard College Consulting Group"]);
    expect(co).not.toContain("Harvard College Chess Club");
  });

  it("finishes a filler word after other words ('consulting g' → Group)", () => {
    expect(names("consulting g")).toEqual([
      "Harvard College Consulting Group",
      "Harvard Undergraduate Social Impact Consulting Group",
    ]);
  });

  it("acronym and initials on their way: 'hc' → HCS/HCES, 'io' and 'iop' → Institute of Politics", () => {
    expect(names("hc").slice(0, 2)).toEqual(["Harvard Computer Society", "Harvard College Engineering Society"]);
    expect(run("hc").reasons[IX[3]!.id]).toEqual([{ kind: "acronym", acronym: "hcs" }]);
    expect(names("io")).toEqual(["Institute of Politics"]);
    expect(names("iop")[0]).toBe("Institute of Politics");
  });

  it("a half-typed topic finds the topic ('dan' → dance clubs), but 'har' is Harvard, not hardware", () => {
    expect(names("dan")).toEqual(expect.arrayContaining(["Harvard Ballet Company", "Harvard Ballroom Dance Club"]));
    const har = names("har");
    expect(har.slice(0, 2)).toEqual(["Harmony Afterschool", "The Harvard Crimson"]);
    // "hardware" only in its description: "har" isn't read as the hardware topic.
    expect(har).not.toContain("Robotics Team");
  });

  it("a topic word reaches compound names ('data' → Datamatch) but never a longer different word", () => {
    expect(names("data")).toContain("Datamatch");
    expect(names("math")).not.toContain("Mather House Committee");
  });

  it("ties go to the better-known club, then by name", () => {
    // Both are "Consulting" + "Group"; only one states a follower count.
    expect(names("consulting group")[0]).toBe("Harvard College Consulting Group");
  });
});
