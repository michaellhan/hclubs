import { describe, expect, it } from "vitest";
import { isBareRound, isRecentPastTerm, lastPastRound, roundEvidenced, type RoundLike } from "../src/local/cycles";

const now = new Date("2026-10-13T12:00:00-04:00");
const round = (over: Partial<RoundLike>): RoundLike => ({
  termKey: "2026-fall",
  opens: null,
  deadline: null,
  statedStatus: null,
  processTypes: [],
  applicationUrl: null,
  eligibleClasses: null,
  stages: [],
  ...over,
});

describe("isBareRound", () => {
  it("a round whose only stage is the process ('Comp') is bare (VCG)", () => {
    expect(isBareRound(round({ stages: [{ kind: "comp_period", label: "Comp" }] }), now)).toBe(true);
    expect(isBareRound(round({ processTypes: ["comp"] }), now)).toBe(true);
    expect(isBareRound(round({ stages: [{ kind: "audition", label: null }] }), now)).toBe(true);
  });

  it("any date, status, form, real stage or named term makes it a round worth showing", () => {
    expect(isBareRound(round({ deadline: { at: "2026-09-20", precision: "date" } }), now)).toBe(false);
    expect(isBareRound(round({ statedStatus: "closed" }), now)).toBe(false);
    expect(isBareRound(round({ applicationUrl: "https://forms.gle/x" }), now)).toBe(false);
    expect(
      isBareRound(
        round({
          stages: [
            { kind: "written_application", label: "Application" },
            { kind: "interview", label: "Interview" },
          ],
        }),
        now,
      ),
    ).toBe(false);
    expect(
      isBareRound(round({ termKey: "2026-spring", stages: [{ kind: "comp_period", label: "Spring 2026 Comp" }] }), now),
    ).toBe(false);
    expect(
      isBareRound(
        round({ stages: [{ kind: "comp_period", label: "Comp", startsAt: { at: "2026-09-10", precision: "date" } }] }),
        now,
      ),
    ).toBe(false);
  });

  it("a round announced for a later term is never bare (it says when the club recruits next)", () => {
    expect(isBareRound(round({ termKey: "2027-fall", processTypes: ["audition"] }), now)).toBe(false);
  });
});

describe("lastPastRound", () => {
  it("names the last evidenced round from an earlier term (HIA: 'Spring 2026 Comp')", () => {
    const hia = round({ termKey: "2026-spring", stages: [{ kind: "comp_period", label: "Spring 2026 Comp" }] });
    expect(roundEvidenced(hia)).toBe(true);
    expect(lastPastRound([hia], now)).toEqual({ termKey: "2026-spring", processTypes: [] });
  });

  it("never treats a process-only round, a current-term round or an old one as the last round", () => {
    // A process read in spring is not evidence that the club recruited in spring.
    expect(lastPastRound([round({ termKey: "2026-spring", processTypes: ["comp"] })], now)).toBeNull();
    // This term's round isn't "last round".
    expect(lastPastRound([round({ statedStatus: "closed" })], now)).toBeNull();
    // More than a year back is too old to tell a student anything.
    expect(
      lastPastRound([round({ termKey: "2025-spring", deadline: { at: "2025-02-10", precision: "date" } })], now),
    ).toBeNull();
    expect(isRecentPastTerm("2025-fall", now)).toBe(true);
    expect(isRecentPastTerm("2025-summer", now)).toBe(false);
  });

  it("takes the newest round, including the index's undated named round", () => {
    const dated = round({ termKey: "2025-fall", deadline: { at: "2025-09-12", precision: "date" } });
    expect(lastPastRound([dated], now)?.termKey).toBe("2025-fall");
    expect(lastPastRound([dated], now, { termKey: "2026-spring", processTypes: ["comp"] })).toEqual({
      termKey: "2026-spring",
      processTypes: ["comp"],
    });
  });

  it("re-checks on the reader's day: a round becomes 'last' once its term is over", () => {
    const fall = round({ deadline: { at: "2026-09-12", precision: "date" } });
    expect(lastPastRound([fall], now)).toBeNull();
    expect(lastPastRound([fall], new Date("2027-02-01T12:00:00-05:00"))?.termKey).toBe("2026-fall");
  });
});
