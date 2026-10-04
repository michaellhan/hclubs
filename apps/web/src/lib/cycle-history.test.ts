import { describe, expect, it } from "vitest";
import { splitCycles } from "./cycle-history";

const now = new Date("2026-10-04T12:00:00-04:00");
const cy = (id: string, termKey: string) => ({ id, termKey });

describe("splitCycles (profile How to join)", () => {
  it("never features a round from an earlier term: it's the last round, as history", () => {
    // Harvard Investment Association: only a "Spring 2026 Comp" stage on record.
    const spring = cy("s", "2026-spring");
    expect(splitCycles([spring], null, now)).toEqual({ current: null, others: [], past: [spring] });
    // Even if a build picked it as current (built during that term), it stays history.
    expect(splitCycles([spring], spring, now)).toEqual({ current: null, others: [], past: [spring] });
  });

  it("keeps this term's and later rounds out of the past list, newest past first", () => {
    const fall = cy("f", "2026-fall");
    const next = cy("n", "2027-spring");
    const old = cy("o", "2025-fall");
    const spring = cy("s", "2026-spring");
    const got = splitCycles([old, spring, fall, next], fall, now);
    expect(got.current).toBe(fall);
    expect(got.others).toEqual([next]);
    expect(got.past).toEqual([spring, old]);
  });

  it("drops rounds with nothing to show", () => {
    const empty = cy("e", "2026-spring");
    expect(splitCycles([empty], null, now, () => false).past).toEqual([]);
  });

  it("spring rounds become the past when the spring term ends (Jun 1, campus time)", () => {
    const spring = cy("s", "2026-spring");
    expect(splitCycles([spring], spring, new Date("2026-05-31T23:59:00-04:00")).current).toBe(spring);
    expect(splitCycles([spring], spring, new Date("2026-06-01T00:00:00-04:00")).past).toEqual([spring]);
  });
});
