import { describe, expect, it } from "vitest";
import type { ListedClub } from "@hci/db/local";
import { parseSlugList } from "./local-list";
import { nextStep, offerableSlugs, parseClubsParam, savedSummary, sortSaved, migrateSlugs } from "./saved";
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

describe("offerableSlugs", () => {
  const listed = new Set(["a", "b", "new-c"]);
  const isListed = (s: string) => listed.has(s);
  it("offers listed clubs and redirected old slugs, never unknown ones", () => {
    expect(offerableSlugs(["a", "ghost", "old-c", "b", "a"], isListed, new Map([["old-c", "new-c"]]))).toEqual([
      "a",
      "new-c",
      "b",
    ]);
  });
  it("drops a redirect that leads to an unlisted club", () => {
    expect(offerableSlugs(["old"], isListed, new Map([["old", "gone"]]))).toEqual([]);
  });
});

describe("parseSlugList with corrupt storage", () => {
  it("ignores bad JSON, non-arrays and non-slug entries", () => {
    expect(parseSlugList("{not json", 4)).toEqual([]);
    expect(parseSlugList('{"a":1}', 4)).toEqual([]);
    expect(parseSlugList('["ok", 5, null, "Bad Slug", "<script>", "ok2"]', 4)).toEqual(["ok", "ok2"]);
  });
});

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
    expect(r?.state.group).toBe(4);
  });
  it("puts join-anytime clubs before closed and unknown ones", () => {
    const anytime = { ...club("Anytime", null), joining: { access: "open" } } as unknown as ListedClub;
    const sorted = sortSaved(
      [club("Unknown", null), club("Closed", cycle({ deadline: day("2026-09-10") })), anytime],
      NOW,
    ).map((r) => `${r.club.name}:${r.state.group}`);
    expect(sorted).toEqual(["Anytime:3", "Closed:4", "Unknown:5"]);
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

describe("savedSummary and nextStep", () => {
  const open = { access: "open" } as ListedClub["joining"];
  const mk = (name: string, c: Cycle | null, extra: Record<string, unknown> = {}) =>
    ({ ...club(name, c), ...extra }) as ListedClub;
  it("counts each club once and leaves out zero parts", () => {
    const rows = sortSaved(
      [
        mk("Soon", cycle({ deadline: day("2026-10-04") })),
        mk("Far", cycle({ deadline: day("2026-10-30") })),
        mk("Anytime", null, { joining: open }),
        mk("Missed", cycle({ deadline: day("2026-09-01") }), { recruitingSeasons: ["spring"] }),
      ],
      NOW,
    );
    expect(savedSummary(rows, NOW)).toBe("1 due this week · 1 join anytime · 1 closed, usually Spring");
    expect(savedSummary(sortSaved([mk("Z", null)], NOW), NOW)).toBeNull();
    // Only some closed clubs state a pattern: say how many, never imply all of them do.
    const mixed = sortSaved(
      [
        mk("M1", cycle({ deadline: day("2026-09-01") }), { recruitingSeasons: ["fall"] }),
        mk("M2", cycle({ deadline: day("2026-09-02") })),
        mk("M3", cycle({ deadline: day("2026-09-03") })),
      ],
      NOW,
    );
    expect(savedSummary(mixed, NOW)).toBe("3 closed, 1 of them usually Fall");
  });
  it("names the club when only one is saved", () => {
    const one = sortSaved(
      [mk("Crimson", cycle({ deadline: day("2026-09-01") }), { recruitingSeasons: ["fall", "spring"] })],
      NOW,
    );
    expect(savedSummary(one, NOW)).toBe("Crimson is closed, usually Fall and Spring");
    expect(savedSummary(sortSaved([mk("Plain", cycle({ deadline: day("2026-09-01") }))], NOW), NOW)).toBe(
      "Plain is closed",
    );
  });
  it("picks apply, then join anytime, then website", () => {
    const withApp = mk("A", cycle({ deadline: day("2026-10-04"), applicationUrl: "https://x.test/apply" }), {
      joining: open,
    });
    expect(nextStep(withApp, savedSummaryState(withApp))).toEqual({ kind: "apply", url: "https://x.test/apply" });
    const anytime = mk("B", null, { joining: open, quickLinks: { website: "https://b.test", instagram: null } });
    expect(nextStep(anytime, savedSummaryState(anytime))).toEqual({ kind: "join", href: "/clubs/b/#how-to-join" });
    const site = mk("C", null, { quickLinks: { website: "https://c.test", instagram: null } });
    expect(nextStep(site, savedSummaryState(site))).toEqual({ kind: "website", url: "https://c.test" });
    const ig = { ...mk("E", null), quickLinks: { website: null, instagram: "https://www.instagram.com/e/" } };
    expect(nextStep(ig, null)).toEqual({ kind: "instagram", url: "https://www.instagram.com/e/" });
    expect(nextStep(mk("D", null), null)).toBeNull();
  });
});
function savedSummaryState(c: ListedClub) {
  return sortSaved([c], NOW)[0]!.state;
}

describe("nextStep: interest form", () => {
  it("offers a club sport's shared form under the profile's words, before Instagram", () => {
    const c = {
      slug: "x",
      name: "X",
      activityStatus: "active",
      joining: null,
      quickLinks: {
        website: null,
        instagram: "https://www.instagram.com/x/",
        interestForm: "https://forms.office.com/r/tViFu2N5zz",
      },
    } as unknown as ListedClub;
    expect(nextStep(c, null)).toEqual({
      kind: "interest",
      url: "https://forms.office.com/r/tViFu2N5zz",
      label: "Club Sports interest form",
    });
  });
});
