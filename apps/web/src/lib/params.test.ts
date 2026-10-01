import { describe, expect, it } from "vitest";
import { parseDirectoryParams, toSearchParams } from "./params";

describe("directory URL params", () => {
  it("drops invalid values instead of failing, and round-trips valid ones", () => {
    const p = parseDirectoryParams({
      q: "chess",
      join: ["comp,bribery", "audition"],
      category: "finance,Not A Slug",
      season: "fall,never",
      sort: "bogus",
      do: "build-software",
      open: "1",
      page: "-3",
    });
    expect(p.filters).toMatchObject({
      joinModes: ["comp", "audition"],
      categories: ["finance"],
      recruitingSeasons: ["fall"],
      intent: "build-software",
      openJoin: true,
    });
    expect(p.sort).toBe("relevance");
    expect(p.page).toBe(1);
    expect(parseDirectoryParams(Object.fromEntries(toSearchParams(p))).filters).toMatchObject({
      categories: ["finance"],
      openJoin: true,
    });
  });
});
