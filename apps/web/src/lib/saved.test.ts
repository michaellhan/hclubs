import { describe, expect, it } from "vitest";
import type { ListedClub } from "@hci/db/local";
import { parseSlugList } from "./local-list";
import { parseClubsParam, sortSaved, migrateSlugs } from "./saved";
import { addSaved, MAX_SAVED } from "./use-saved";

const NOW = new Date("2026-10-02T12:00:00-04:00");
type Cycle = NonNullable<ListedClub["currentCycle"]>;
const cycle = (over: Partial<Cycle>): Cycle => ({
  id: "c",
  termKey: "2026-fall",
  track: "main",
  status: "unknown",
  statedStatus: null,
  opens: null,
  deadline: null,
  processTypes: [],
  applicationUrl: null,
  eligibleClasses: null,
  lastVerifiedAt: null,
  ...over,
});
const club = (name: string, currentCycle: Cycle | null, activityStatus = "active"): ListedClub =>
  ({ name, slug: name.toLowerCase(), currentCycle, activityStatus }) as unknown as ListedClub;
const day = (d: string) => ({ at: d, precision: "date" as const });

describe("sortSaved", () => {
  it("orders due-soonest, open without date, upcoming, the rest, ended last", () => {
    const sorted = sortSaved(
      [
        club("Zeta", null),
        club("Ended", cycle({ deadline: day("2026-10-03") }), "defunct"),
        club("Later", cycle({ deadline: day("2026-10-20") })),
        club("Undated", cycle({ statedStatus: "open" })),
        club("Soon", cycle({ deadline: day("2026-10-04") })),
        club("Upcoming", cycle({ opens: day("2026-10-10"), deadline: day("2026-10-30") })),
        club("Alpha", cycle({ deadline: day("2026-09-01") })),
      ],
      NOW,
    ).map((r) => r.club.name);
    expect(sorted).toEqual(["Soon", "Later", "Undated", "Upcoming", "Alpha", "Zeta", "Ended"]);
  });
  it("treats a passed deadline as closed, not urgent", () => {
    const [r] = sortSaved([club("A", cycle({ deadline: day("2026-10-01") }))], NOW);
    expect(r?.state.group).toBe(3);
  });
});

describe("storage parsing", () => {
  it("survives empty, corrupt and wrong-shaped values", () => {
    expect(parseSlugList(null, 5)).toEqual([]);
    expect(parseSlugList("{oops", 5)).toEqual([]);
    expect(parseSlugList('{"a":1}', 5)).toEqual([]);
    expect(parseSlugList('["a",3,null,"b","a","Bad Slug"]', 5)).toEqual(["a", "b"]);
    expect(parseSlugList('["a","b","c"]', 2)).toEqual(["a", "b"]);
  });
  it("parses a shared link's slugs", () => {
    expect(parseClubsParam("a, b,a,../x,c")).toEqual(["a", "b", "c"]);
    expect(parseClubsParam(null)).toEqual([]);
  });
  it("adds newest first, de-duped and capped", () => {
    expect(addSaved(["a", "b"], "b")).toEqual(["b", "a"]);
    expect(
      addSaved(
        Array.from({ length: MAX_SAVED }, (_, i) => `s${i}`),
        "new",
      ),
    ).toHaveLength(MAX_SAVED);
  });
});

describe("migrateSlugs", () => {
  it("replaces renamed or merged slugs in place and drops the duplicates that creates", () => {
    const moved = new Map([
      ["old-a", "club-b"],
      ["old-c", "club-c"],
    ]);
    expect(migrateSlugs(["old-a", "club-x", "club-b", "old-c"], moved)).toEqual(["club-b", "club-x", "club-c"]);
  });
});
