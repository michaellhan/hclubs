import { describe, expect, it } from "vitest";
import { activeFilterCount, filterChips, parseDirectoryParams, toSearchParams } from "./params";

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
    expect(chip?.label).toBe("No dues");
    expect(toSearchParams({ ...p, filters: { ...p.filters, ...chip!.patch } }).toString()).toBe(
      "category=public-service",
    );
  });
});

describe("joining filters in the URL (ADR 0041)", () => {
  it("round-trips every yes/no filter, with search, sort and page, through a shared link", () => {
    const raw = {
      q: "debate",
      freshmen: "1",
      open: "1",
      nocomp: "1",
      nodues: "1",
      noexp: "1",
      recruiting: "1",
      join: "comp",
      category: "finance",
      sort: "name",
      page: "2",
    };
    const p = parseDirectoryParams(raw);
    expect(p.filters).toMatchObject({
      freshmenEligible: true,
      openJoin: true,
      noComp: true,
      noDues: true,
      noExperience: true,
      recruitingNow: true,
      joinModes: ["comp"],
      categories: ["finance"],
    });
    const again = parseDirectoryParams(Object.fromEntries(toSearchParams(p)));
    expect(again).toEqual(p);
    expect(activeFilterCount(p.filters)).toBe(8);
  });

  it("names chips the way the filter panel does, and each removes only itself", async () => {
    const { filterChips } = await import("./params");
    const p = parseDirectoryParams({ freshmen: "1", nocomp: "1" });
    const chips = filterChips(p.filters, []);
    expect(chips.map((c) => c.label)).toEqual(["First-years eligible", "No comp"]);
    const without = { ...p.filters, ...chips[1]!.patch };
    expect(toSearchParams({ ...p, filters: without }).toString()).toBe("freshmen=1");
  });

  it("ignores junk values instead of turning a filter on", () => {
    expect(parseDirectoryParams({ nocomp: "yes please", freshmen: "0" }).filters).toMatchObject({
      noComp: false,
      freshmenEligible: false,
    });
  });
  it("reads hours=N as an hours limit, ignoring bad values", () => {
    const p = parseDirectoryParams({ hours: "3" });
    expect(p.filters.maxHours).toBe(3);
    expect(activeFilterCount(p.filters)).toBe(1);
    expect(toSearchParams(p).get("hours")).toBe("3");
    expect(filterChips(p.filters, [])).toEqual([
      { key: "hours", label: "Up to 3 hrs/week", patch: { maxHours: null } },
    ]);
    for (const bad of ["0", "-2", "abc", "500", ""])
      expect(parseDirectoryParams({ hours: bad }).filters.maxHours).toBeNull();
  });
});
