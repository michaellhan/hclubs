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
    expect(joinTiming({ ...base, seasons: ["spring"] }, now, now)?.sub).toBe(
      "Next round likely in spring · no date yet",
    );
    expect(joinTiming(base, now, now)).toBeNull();
  });

  it("a fall pattern is this term's early on, and points to the next round from Oct 1 (reader's day)", () => {
    const sep = new Date("2026-09-20T12:00:00-04:00");
    const both = { ...base, seasons: ["fall", "spring"] } as const;
    expect(joinTiming(both, sep, sep)).toEqual({
      text: "Usually recruits in fall and in spring",
      sub: "No dates for this term on record yet",
      tone: "plain",
    });
    const sep30 = new Date("2026-09-30T23:59:00-04:00");
    expect(joinTiming(both, sep30, sep30)?.sub).toBe("No dates for this term on record yet");
    const oct = new Date("2026-10-01T00:00:00-04:00");
    expect(joinTiming(both, oct, oct)?.sub).toBe("Next round likely in spring · no date yet");
    expect(joinTiming({ ...base, seasons: ["fall"] }, oct, oct)?.sub).toBe("Usually again next fall · no date yet");
    // Spring term: from Mar 1 (EST) a spring pattern points to fall.
    const mar = new Date("2027-03-01T00:00:00-05:00");
    expect(joinTiming(both, mar, mar)?.sub).toBe("Next round likely in fall · no date yet");
    const feb28 = new Date("2027-02-28T23:59:00-05:00");
    expect(joinTiming(both, feb28, feb28)?.sub).toBe("No dates for this term on record yet");
  });

  it("before mount (prebuilt HTML) the pattern's sub-line never depends on the date (no hydration mismatch)", () => {
    const both = { ...base, seasons: ["fall", "spring"] } as const;
    const buildDay = new Date("2026-09-28T12:00:00-04:00");
    const readerDay = new Date("2026-10-04T12:00:00-04:00");
    expect(joinTiming(both, buildDay, null)).toEqual(joinTiming(both, readerDay, null));
    expect(joinTiming(both, readerDay, null)?.sub).toBe("No date on record yet");
  });

  it("a rolling recruiter gets no 'next likely' line late in the term", () => {
    const oct4 = new Date("2026-10-04T12:00:00-04:00");
    expect(joinTiming({ ...base, seasons: ["fall", "rolling"] }, oct4, oct4)).toEqual({
      text: "Usually recruits in fall and on a rolling basis",
      sub: "No dates for this term on record yet",
      tone: "plain",
    });
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
