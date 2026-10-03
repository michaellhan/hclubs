import { describe, expect, it } from "vitest";
import { ClubFilters } from "../src/local/filters";
import { featuredDay, popularityCompare, searchLocal } from "../src/local/search";
import type { IndexClub } from "../src/local/types";

const NOW = new Date("2026-10-03T15:00:00Z");
const club = (id: string, followers: number | null | undefined, over: Partial<IndexClub> = {}) =>
  ({
    id,
    slug: id,
    name: id,
    shortDescription: `The ${id} club.`,
    quickLinks: { website: "https://example.test", instagram: null },
    activityStatus: "active",
    affiliationScope: "harvard_college",
    categories: [],
    categorySlugs: [],
    joinModes: [],
    searchNames: id,
    searchAcronyms: [],
    searchTopics: "",
    recruitingSeasons: [],
    cycles: [],
    currentCycle: null,
    joining: null,
    instagramFollowers: followers,
    ...over,
  }) as unknown as IndexClub;

describe("popularity order (ADR 0046)", () => {
  const day = featuredDay(NOW);
  const order = (cs: IndexClub[]) => [...cs].sort((a, b) => popularityCompare(a, b, NOW, day)).map((c) => c.id);

  it("puts counted clubs first, most followers first", () => {
    expect(order([club("a", 10), club("b", 5000), club("c", 300)])).toEqual(["b", "c", "a"]);
  });

  it("puts uncounted clubs after counted ones, in the Suggested order", () => {
    const anytime = club("anytime", null, { joining: { access: "open" } as IndexClub["joining"] });
    const recruiting = club("recruiting", null, {
      currentCycle: { status: "open" } as IndexClub["currentCycle"],
      cycles: [
        { deadline: { at: "2026-10-20T23:59:00-04:00", precision: "datetime" } },
      ] as unknown as IndexClub["cycles"],
    });
    // A club with zero followers is counted; a club with no count is not.
    expect(order([club("plain", null), anytime, club("tiny", 0), recruiting, club("big", 9000)])).toEqual([
      "big",
      "tiny",
      "recruiting",
      "anytime",
      "plain",
    ]);
    // An index built before the field existed reads as uncounted.
    expect(order([club("old", undefined), club("big", 9000)])).toEqual(["big", "old"]);
  });

  it("is the order searchLocal gives with no search text; ties go by name", () => {
    const clubs = [club("bravo", 100), club("alpha", 100), club("none", null), club("top", 5000)];
    const run = (sort: "relevance" | "popularity" | "name") =>
      searchLocal(clubs, {
        text: null,
        filters: ClubFilters.parse({}),
        sort,
        offset: 0,
        limit: 10,
        now: NOW,
      }).clubs.map((c) => c.id);
    expect(run("popularity")).toEqual(["top", "alpha", "bravo", "none"]);
    // "relevance" with nothing to match falls back to the same default order.
    expect(run("relevance")).toEqual(run("popularity"));
    expect(run("name")).toEqual(["alpha", "bravo", "none", "top"]);
  });

  it("leaves relevance first when there is search text", () => {
    const clubs = [club("alpha", 1, { name: "Alpha Debate" }), club("beta", 9000, { name: "Beta Chess" })];
    const r = searchLocal(clubs, {
      text: "alpha",
      filters: ClubFilters.parse({}),
      sort: "relevance",
      offset: 0,
      limit: 10,
      now: NOW,
    });
    expect(r.clubs[0]?.id).toBe("alpha");
  });
});
