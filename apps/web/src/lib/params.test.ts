import { describe, expect, it } from "vitest";
import { activeFilterCount, parseDirectoryParams, toSearchParams } from "./params";

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

describe("retired sorts", () => {
  it("send old 'recently updated' and 'most complete' links to the default order", () => {
    expect(parseDirectoryParams({ sort: "completeness" }).sort).toBe("name");
    expect(parseDirectoryParams({ sort: "updated", q: "debate" }).sort).toBe("relevance");
    expect(parseDirectoryParams({ sort: "deadline" }).sort).toBe("deadline");
  });
});

describe("no-dues filter in the URL", () => {
  it("round-trips, counts as a filter and has a removable chip", async () => {
    const { filterChips } = await import("./params");
    const p = parseDirectoryParams({ nodues: "1", category: "public-service" });
    expect(p.filters.noDues).toBe(true);
    expect(toSearchParams(p).toString()).toBe("category=public-service&nodues=1");
    expect(activeFilterCount(p.filters)).toBe(2);
    const chip = filterChips(p.filters, []).find((c) => c.key === "nodues");
    expect(chip?.label).toBe("No dues required");
    expect(toSearchParams({ ...p, filters: { ...p.filters, ...chip!.patch } }).toString()).toBe(
      "category=public-service",
    );
  });
});
