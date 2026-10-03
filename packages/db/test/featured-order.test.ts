import { describe, expect, it } from "vitest";
import { featuredCompare, featuredDay } from "../src/local/search";
import type { IndexClub } from "../src/local/types";

const NOW = new Date("2026-10-03T15:00:00Z");
const club = (id: string, over: Partial<IndexClub> = {}) =>
  ({ id, slug: id, name: id, cycles: [], currentCycle: null, joining: null, ...over }) as unknown as IndexClub;
const open = (id: string, deadline: string) =>
  club(id, {
    currentCycle: { status: "open" } as IndexClub["currentCycle"],
    cycles: [{ deadline: { at: deadline, precision: "datetime" } }] as unknown as IndexClub["cycles"],
  });

describe("featured order", () => {
  const day = featuredDay(NOW);
  const order = (cs: IndexClub[], d = day) => [...cs].sort((a, b) => featuredCompare(a, b, NOW, d)).map((c) => c.id);

  it("puts clubs recruiting now first (soonest deadline), then join-anytime clubs, then the rest", () => {
    const anytime = club("anytime", { joining: { access: "open" } as IndexClub["joining"] });
    const got = order([
      club("zeta"),
      anytime,
      open("later", "2026-10-20T23:59:00-04:00"),
      open("soon", "2026-10-05T23:59:00-04:00"),
      club("alpha"),
    ]);
    expect(got.slice(0, 3)).toEqual(["soon", "later", "anytime"]);
    expect(new Set(got.slice(3))).toEqual(new Set(["zeta", "alpha"]));
  });

  it("shuffles the rest by day, the same for everyone that day", () => {
    const rest = Array.from({ length: 30 }, (_, i) => club(`club-${i}`));
    expect(order(rest)).toEqual(order(rest));
    expect(order(rest, "2026-10-4")).not.toEqual(order(rest));
    // Not alphabetical.
    expect(order(rest)).not.toEqual(rest.map((c) => c.id).sort());
  });
});
