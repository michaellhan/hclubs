import { describe, expect, it } from "vitest";
import { normalizeName } from "@hci/core";
import {
  ClubFilters,
  facetCounts,
  hoursLimitAt,
  NO_JOINING_FACTS,
  searchLocal,
  suggest,
  type IndexClub,
} from "../src/local";
import { interpretQuery } from "../src/local/constraints";

/**
 * Round-3 query reading: nicknames that begin a distinctive name word, a passing mention
 * never answering a constrained topic, the "show all" hint, hours limits and the Meet-people
 * rule for "social". Hand-made index; names illustrative.
 */
const NOW = new Date("2026-10-01T16:00:00Z");
const J = NO_JOINING_FACTS;
let n = 0;
const cat = (slug: string, name = slug) => ({ slug, name, isPrimary: false });

function club(name: string, over: Partial<IndexClub> = {}): IndexClub {
  return {
    id: `x${++n}`,
    slug: normalizeName(name).replace(/ /g, "-"),
    name,
    acronym: null,
    shortDescription: null,
    orgType: null,
    recognitionStatus: "recognized",
    activityStatus: "active",
    joinModes: [],
    freshmenEligible: null,
    joining: J,
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

const fin = [cat("finance", "Finance & Investing")];
const social = [cat("social", "Social & Community")];
const cultural = [cat("cultural-identity", "Cultural & Identity")];
const IX: IndexClub[] = [
  club("The Harvard Krokodiloes"),
  club("Harvard Social Impact Collective", { shortDescription: "Social entrepreneurship workshops." }),
  club("Harvard Investment Comp Society", { categories: fin, joining: { ...J, comp: true } }),
  club("Harvard Finance Association", { categories: fin, joining: { ...J, comp: null } }),
  club("Harvard Trading Group", { categories: fin, joining: { ...J, comp: true } }),
  club("Harvard Open Finance Circle", { categories: fin, joining: { ...J, comp: false } }),
  // Only a passing mention: "financial" in the description, no finance category.
  club("Harvard Rural League", { shortDescription: "Advocacy including financial literacy workshops." }),
  club("Harvard Quiet Readers", { hoursPerWeek: { min: 1, max: 2 }, shortDescription: "Reading circle." }),
  club("Harvard Weekly Chess", { hoursPerWeek: { min: 2, max: 4 }, shortDescription: "Chess." }),
  club("Harvard Heavy Journal", { hoursPerWeek: { min: 10, max: 20 }, shortDescription: "A journal." }),
  club("Harvard Min Only Club", { hoursPerWeek: { min: 3, max: null } }),
  club("Harvard Unknown Hours Club"),
  club("Harvard House Social Committee", { categories: social, joining: { ...J, access: "open" } }),
  club("Harvard Fox Club", {
    categories: social,
    orgType: "social_organization",
    joinModes: ["invite_only"],
    joining: { ...J, access: "process" },
  }),
  club("Harvard Dance Troupe", {
    searchTopics: "weekly socials performances",
    categories: [cat("dance", "Dance")],
    joining: { ...J, access: "process", general: ["audition"] },
  }),
  club("Harvard Taiwanese Association", { categories: cultural, joining: { ...J, access: "open" } }),
];
const run = (text: string, f: Partial<ClubFilters> = {}) =>
  searchLocal(IX, { text, filters: ClubFilters.parse(f), sort: "relevance", offset: 0, limit: 50, now: NOW });
const names = (text: string, f: Partial<ClubFilters> = {}) => run(text, f).clubs.map((c) => c.name);

describe("name nicknames (prefix of a distinctive name word)", () => {
  it("finds the Krokodiloes from 'kroks' and 'krok' in search and typeahead", () => {
    expect(names("kroks")).toContain("The Harvard Krokodiloes");
    expect(names("krok")).toContain("The Harvard Krokodiloes");
    expect(names("kroks")).not.toContain("Harvard Social Impact Collective");
    expect(suggest(IX, "kroks").map((s) => s.club.name)).toContain("The Harvard Krokodiloes");
    // Beside another word, not just as the last word.
    expect(names("kroks harvard")).toContain("The Harvard Krokodiloes");
  });

  it("does not turn generic prefixes or known words into name matches", () => {
    // "soci" is the start of "social"/"society" (many names); "harv" is filler; "math" is a word.
    expect(names("sociz")).toEqual([]);
    const mather = [club("Mather House Committee"), club("Harvard Math Club")];
    const r = searchLocal(mather, {
      text: "maths",
      filters: ClubFilters.parse({}),
      sort: "relevance",
      offset: 0,
      limit: 5,
      now: NOW,
    });
    expect(r.clubs.map((c) => c.name)).toEqual(["Harvard Math Club"]);
  });
});

describe("constrained topics", () => {
  it("a passing mention ('financial') never answers 'finance no comp'", () => {
    const r = run("finance no comp");
    expect(r.constraints.map((c) => c.filter)).toEqual(["noComp"]);
    expect(r.clubs.map((c) => c.name)).toEqual(["Harvard Open Finance Circle"]);
    expect(names("finance without comp")).not.toContain("Harvard Rural League");
    // Plain "finance" still lists it, below the category matches.
    const plain = names("finance");
    expect(plain).toContain("Harvard Rural League");
    expect(plain.indexOf("Harvard Rural League")).toBeGreaterThan(plain.indexOf("Harvard Trading Group"));
  });

  it("returns a relaxed hint when a constraint leaves fewer than 3 clubs", () => {
    const r = run("finance no comp");
    expect(r.relaxed).toEqual([{ constraint: "noComp", phrase: "no comp", without: 5, unknown: 2 }]);
    const open = run("finance no application");
    expect(open.total).toBe(0);
    expect(open.relaxed[0]).toMatchObject({ constraint: "openJoin", without: 5 });
    // Plenty of results: no hint. Few topic clubs: no hint.
    expect(run("finance").relaxed).toEqual([]);
    expect(run("chess no comp").relaxed).toEqual([]);
  });

  it("facet counts agree with the results", () => {
    const f = facetCounts(IX, { text: "finance no comp", filters: ClubFilters.parse({}), now: NOW });
    expect(f.noComp).toBe(1);
  });
});

describe("hours limits", () => {
  const read = (q: string) => interpretQuery(q).constraints;
  it("reads 'a few', 'under N', 'at most N', 'N or less' as a weekly maximum", () => {
    expect(read("a few hours a week")).toEqual([{ filter: "maxHours", phrase: "a few hours a week", value: 5 }]);
    expect(read("under 3 hours a week")[0]).toMatchObject({ filter: "maxHours", value: 3 });
    expect(read("less than 4 hours")[0]).toMatchObject({ value: 4 });
    expect(read("at most two hours per week")[0]).toMatchObject({ value: 2 });
    expect(read("3 hours a week or less")[0]).toMatchObject({ value: 3 });
    expect(read("music up to 6 hrs a week")[0]).toMatchObject({ value: 6 });
    // A weekly amount is the student's budget; so is an amount typed on its own.
    expect(read("3 hours a week")).toEqual([{ filter: "maxHours", phrase: "3 hours a week", value: 3 }]);
    expect(read("3 hours")[0]).toMatchObject({ value: 3 });
    // Big numbers cap at the filter's 100 rather than falling through to text search.
    expect(read("under 1000 hours")[0]).toMatchObject({ value: 100 });
    // Not limits.
    expect(read("24 hours of code")).toEqual([]);
    expect(hoursLimitAt(["few", "hours"], 0)).toBeNull();
    // "low commitment" stays a soft word: too few clubs state hours for a hard filter.
    expect(read("low commitment")).toEqual([]);
    expect(interpretQuery("low commitment").soft).toHaveLength(1);
  });

  it("matches only clubs whose stated maximum fits; unknown is never a match", () => {
    const r = run("under 3 hours a week");
    expect(r.clubs.map((c) => c.name)).toEqual(["Harvard Quiet Readers"]);
    expect(r.reasons[r.clubs[0]!.id]?.[0]).toMatchObject({ kind: "joining" });
    expect(names("a few hours a week")).toEqual(["Harvard Quiet Readers", "Harvard Weekly Chess"]);
    // The same filter set directly (URL hours=N), and beside a topic.
    expect(names("", { maxHours: 4 })).toContain("Harvard Weekly Chess");
    expect(names("", { maxHours: 4 })).not.toContain("Harvard Min Only Club");
    expect(names("chess under 3 hours a week")).toEqual([]);
    // An hours filter already set (hours=4) wins over a phrase in the box: one limit, no contradiction.
    expect(names("under 3 hours a week", { maxHours: 4 })).toContain("Harvard Weekly Chess");
    expect(run("under 3 hours a week", { maxHours: 4 }).constraints).toEqual([]);
    const f = facetCounts(IX, { text: "under 3 hours a week", filters: ClubFilters.parse({}), now: NOW });
    expect(f.hours.stated).toBe(3);
    expect(f.hours.unknown).toBe(IX.length - 3);
    expect(f.hours.within).toBe(1);
  });

  it("validates maxHours", () => {
    expect(() => ClubFilters.parse({ maxHours: -1 })).toThrow();
    expect(() => ClubFilters.parse({ maxHours: "3" })).toThrow();
    expect(ClubFilters.parse({ maxHours: 3 }).maxHours).toBe(3);
  });
});

describe("social uses the Meet-people rule", () => {
  it("leaves out selective social orgs and a dance team's 'socials'", () => {
    const r = names("social no application");
    expect(r).toContain("Harvard House Social Committee");
    expect(r).toContain("Harvard Taiwanese Association");
    expect(r).not.toContain("Harvard Fox Club");
    expect(r).not.toContain("Harvard Dance Troupe");
    expect(names("make friends")).not.toContain("Harvard Fox Club");
  });

  it("a club named for the word still matches, and the Fox Club answers 'final club'", () => {
    expect(names("social")).toContain("Harvard Social Impact Collective");
    expect(names("final club")).toContain("Harvard Fox Club");
  });
});
