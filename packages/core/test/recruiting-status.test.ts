import { describe, expect, it } from "vitest";
import { computeCycleStatus, isRecruitingNow, opensAfterDeadline } from "../src";

/**
 * Recruiting status at the boundaries a student hits in September and January (CLAUDE.md §8):
 * the opening day, the day before and of the deadline, the minute after, an old cycle, a
 * date-only vs a timed deadline, and contradictory sources. Campus time is America/New_York.
 */
const day = (at: string) => ({ at, precision: "date" as const });
const timed = (at: string) => ({ at, precision: "datetime" as const });
/** An instant given as campus wall time in EDT (UTC-4). */
const edt = (local: string) => new Date(`${local}-04:00`);
const status = (
  c: {
    opensAt?: ReturnType<typeof day> | ReturnType<typeof timed> | null;
    deadline?: ReturnType<typeof day> | ReturnType<typeof timed> | null;
    statedStatus?: "open" | "closed" | null;
    termKey?: string;
  },
  now: Date,
) =>
  computeCycleStatus(
    {
      opensAt: c.opensAt ?? null,
      deadline: c.deadline ?? null,
      statedStatus: c.statedStatus ?? null,
      ...(c.termKey ? { termKey: c.termKey } : {}),
    },
    now,
  );

const cycle = { opensAt: day("2026-09-08"), deadline: day("2026-09-20"), termKey: "2026-fall" };

describe("a dated cycle through the term", () => {
  it("is upcoming the evening before it opens", () => {
    expect(status(cycle, edt("2026-09-07T23:59:00"))).toBe("upcoming");
  });
  it("opens at the start of the opening day, campus time", () => {
    expect(status(cycle, edt("2026-09-08T00:00:00"))).toBe("open");
  });
  it("is open the day before the deadline and all of a date-only deadline day", () => {
    expect(status(cycle, edt("2026-09-19T12:00:00"))).toBe("open");
    expect(status(cycle, edt("2026-09-20T23:59:00"))).toBe("open");
    expect(isRecruitingNow(status(cycle, edt("2026-09-20T23:59:00")))).toBe(true);
  });
  it("closes right after the deadline day ends", () => {
    expect(status(cycle, edt("2026-09-21T00:00:01"))).toBe("closed");
  });
  it("a timed deadline closes at its minute, not at midnight", () => {
    const c = { deadline: timed("2026-09-20T17:00:00-04:00"), termKey: "2026-fall" };
    expect(status(c, edt("2026-09-20T16:59:00"))).toBe("deadline_ahead");
    expect(status(c, edt("2026-09-20T17:01:00"))).toBe("closed");
  });
  it("a reader in another time zone sees the campus deadline", () => {
    // 11 PM in Los Angeles on Sep 20 is already Sep 21 on campus.
    expect(status(cycle, new Date("2026-09-20T23:00:00-07:00"))).toBe("closed");
  });
});

describe("old and undated information is never current", () => {
  it("an earlier term's 'applications are open' is unknown now", () => {
    expect(status({ statedStatus: "open", termKey: "2026-spring" }, edt("2026-10-01T12:00:00"))).toBe("unknown");
  });
  it("an earlier term's closed cycle stays closed", () => {
    expect(status({ deadline: day("2025-09-20"), termKey: "2025-fall" }, edt("2026-10-01T12:00:00"))).toBe("closed");
  });
  it("an opening day with no deadline and no stated status is not 'open'", () => {
    expect(status({ opensAt: day("2026-09-08"), termKey: "2026-fall" }, edt("2026-10-01T12:00:00"))).toBe("unknown");
  });
  it("a source saying closed wins over an opening date", () => {
    expect(
      status({ opensAt: day("2026-09-08"), statedStatus: "closed", termKey: "2026-fall" }, edt("2026-09-10T12:00:00")),
    ).toBe("closed");
  });
});

describe("contradictory sources", () => {
  it("ignores an opening date after the deadline and goes by the deadline", () => {
    const c = {
      opensAt: timed("2026-11-16T17:00:00-05:00"),
      deadline: timed("2026-10-31T23:59:00-04:00"),
      termKey: "2026-fall",
    };
    expect(opensAfterDeadline(c)).toBe(true);
    expect(status(c, edt("2026-10-01T12:00:00"))).toBe("deadline_ahead");
    expect(status(c, edt("2026-11-01T12:00:00"))).toBe("closed");
  });
});

describe("next term's deadlines", () => {
  it("a deadline months away in a later term is upcoming, not recruiting now", () => {
    const spring = { deadline: day("2027-02-15"), termKey: "2027-spring" };
    expect(status(spring, edt("2026-10-01T12:00:00"))).toBe("upcoming");
    expect(status(spring, edt("2027-01-20T12:00:00"))).toBe("deadline_ahead");
  });
  it("August notice of an early-September deadline still counts as recruiting", () => {
    expect(status({ deadline: day("2026-09-05"), termKey: "2026-fall" }, edt("2026-08-20T12:00:00"))).toBe(
      "deadline_ahead",
    );
  });
});

describe("stated 'open' without dates goes stale (ADR 0041)", () => {
  const now = new Date("2026-10-02T16:00:00Z");
  const base = { opensAt: null, deadline: null, statedStatus: "open" as const, termKey: "2026-fall" };
  it("is open while recently seen, unknown once the sighting is old", () => {
    expect(computeCycleStatus({ ...base, lastVerifiedAt: "2026-09-25T00:00:00Z" }, now)).toBe("open");
    expect(computeCycleStatus({ ...base, lastVerifiedAt: "2026-08-20T00:00:00Z" }, now)).toBe("unknown");
  });
  it("a dated deadline still ahead keeps it open however old the sighting", () => {
    expect(
      computeCycleStatus(
        { ...base, deadline: { at: "2026-10-09", precision: "date" }, lastVerifiedAt: "2026-08-20T00:00:00Z" },
        now,
      ),
    ).toBe("open");
  });
  it("a September 2025 deadline is never this year's", () => {
    expect(
      computeCycleStatus(
        { opensAt: null, deadline: { at: "2025-09-12", precision: "date" }, statedStatus: null, termKey: "2025-fall" },
        now,
      ),
    ).toBe("closed");
  });
});
