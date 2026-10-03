import { describe, expect, it } from "vitest";
import type { CycleSummary } from "@hci/db/local";
import { joinTiming } from "./join-timing";

const now = new Date("2026-10-01T12:00:00-04:00");
const cycle = (over: Partial<CycleSummary>): CycleSummary => ({
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
const base = { cycle: null, joining: { access: null }, seasons: [], joinModes: [] } as const;

describe("joinTiming", () => {
  it("leads with the deadline and how far away it is while applications are open", () => {
    const t = joinTiming(
      { ...base, cycle: cycle({ status: "open", deadline: { at: "2026-10-06", precision: "date" } }) },
      now,
      now,
    );
    expect(t).toEqual({ text: "Apply by Oct 6 · in 5 days", sub: "Fall 2026 applications are open", tone: "open" });
  });

  it("leaves relative words out of the prebuilt HTML (no reader clock yet)", () => {
    const t = joinTiming(
      { ...base, cycle: cycle({ status: "open", deadline: { at: "2026-10-06", precision: "date" } }) },
      now,
      null,
    );
    expect(t?.text).toBe("Apply by Oct 6");
  });

  it("says when an announced round opens", () => {
    const t = joinTiming(
      { ...base, cycle: cycle({ status: "upcoming", opens: { at: "2026-10-20", precision: "date" } }) },
      now,
      now,
    );
    expect(t).toMatchObject({ text: "Applications open Oct 20", sub: "Fall 2026", tone: "soon" });
  });

  it("points past a closed round to the usual next season, never a made-up date", () => {
    const t = joinTiming(
      {
        ...base,
        seasons: ["fall", "spring"],
        cycle: cycle({ status: "closed", deadline: { at: "2026-09-10", precision: "date" } }),
      },
      now,
      now,
    );
    expect(t).toEqual({
      text: "Fall 2026 round closed Sep 10",
      sub: "Next: usually recruits again in Spring",
      tone: "closed",
    });
  });

  it("says anytime for open membership, and how when it is by attendance", () => {
    expect(joinTiming({ ...base, joining: { access: "open" } }, now, now)).toMatchObject({
      text: "Anytime",
      sub: "No deadline to join",
    });
    expect(
      joinTiming({ ...base, joining: { access: "open" }, joinModes: ["attendance_based"] }, now, now),
    ).toMatchObject({ text: "Anytime", sub: "Join by coming to meetings" });
  });

  it("keeps open membership as Anytime when a dated round has closed", () => {
    const t = joinTiming(
      {
        ...base,
        joining: { access: "open" },
        cycle: cycle({ status: "closed", deadline: { at: "2026-09-10", precision: "date" } }),
      },
      now,
      now,
    );
    expect(t?.text).toBe("Anytime");
  });

  it("falls back to the recruiting pattern, then to nothing", () => {
    expect(joinTiming({ ...base, seasons: ["spring", "rolling"] }, now, now)).toEqual({
      text: "Usually recruits in spring and on a rolling basis",
      sub: "No dates for this term on record yet",
      tone: "plain",
    });
    expect(joinTiming(base, now, now)).toBeNull();
  });

  it("splits a started round with no end date into a headline and a caveat", () => {
    const t = joinTiming(
      {
        ...base,
        joinModes: ["audition"],
        cycle: cycle({ opens: { at: "2026-09-29", precision: "date" }, processTypes: ["audition"] }),
      },
      now,
      now,
    );
    expect(t?.sub).toBe("no end date listed, check their site");
    expect(t?.text).toMatch(/Sep 29/);
    expect(t?.tone).toBe("soon");
  });
});
