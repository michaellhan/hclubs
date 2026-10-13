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
      sub: "Next round likely in spring",
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
      sub: null,
      tone: "plain",
    });
    // One season: "Usually recruits in spring" already says when; no redundant second line.
    expect(joinTiming({ ...base, seasons: ["spring"] }, now, now)?.sub).toBeNull();
    expect(joinTiming(base, now, now)).toBeNull();
  });

  it("a fall pattern is this term's early on, and points to the next round from Oct 1 (reader's day)", () => {
    const sep = new Date("2026-09-20T12:00:00-04:00");
    const both = { ...base, seasons: ["fall", "spring"] } as const;
    expect(joinTiming(both, sep, sep)).toEqual({
      text: "Usually recruits in fall and spring",
      sub: null,
      tone: "plain",
    });
    const sep30 = new Date("2026-09-30T23:59:00-04:00");
    expect(joinTiming(both, sep30, sep30)?.sub).toBeNull();
    const oct = new Date("2026-10-01T00:00:00-04:00");
    expect(joinTiming(both, oct, oct)?.sub).toBe("Next round likely in spring");
    expect(joinTiming({ ...base, seasons: ["fall"] }, oct, oct)?.sub).toBe("Next round likely next fall");
    // Spring term: from Mar 1 (EST) a spring pattern points to fall.
    const mar = new Date("2027-03-01T00:00:00-05:00");
    expect(joinTiming(both, mar, mar)?.sub).toBe("Next round likely in fall");
    const feb28 = new Date("2027-02-28T23:59:00-05:00");
    expect(joinTiming(both, feb28, feb28)?.sub).toBeNull();
  });

  it("before mount (prebuilt HTML) the pattern's sub-line never depends on the date (no hydration mismatch)", () => {
    const both = { ...base, seasons: ["fall", "spring"] } as const;
    const buildDay = new Date("2026-09-28T12:00:00-04:00");
    const readerDay = new Date("2026-10-04T12:00:00-04:00");
    expect(joinTiming(both, buildDay, null)).toEqual(joinTiming(both, readerDay, null));
    expect(joinTiming(both, readerDay, null)?.sub).toBeNull();
  });

  it("a rolling recruiter gets no 'next likely' line late in the term", () => {
    const oct4 = new Date("2026-10-04T12:00:00-04:00");
    expect(joinTiming({ ...base, seasons: ["fall", "rolling"] }, oct4, oct4)).toEqual({
      text: "Usually recruits in fall and on a rolling basis",
      sub: null,
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

describe("joinTiming with a round the club announced for a later term (ADR 0051 amendment)", () => {
  const oct12 = new Date("2026-10-12T12:00:00-04:00");
  const later = { termKey: "2027-fall", processTypes: [] as const };
  const pitches = {
    ...base,
    seasons: ["fall", "spring"] as const,
    joinModes: ["audition"] as const,
    later,
  };

  it("names the announced round instead of the usual seasons", () => {
    expect(joinTiming(pitches, oct12, oct12)).toEqual({ text: "Next auditions: Fall 2027", sub: null, tone: "plain" });
    // The same before mount: no reader clock needed for a term.
    expect(joinTiming(pitches, oct12, null)?.text).toBe("Next auditions: Fall 2027");
    // The featured cycle may be that round itself (undated, unknown status).
    expect(joinTiming({ ...pitches, cycle: cycle({ termKey: "2027-fall" }) }, oct12, oct12)?.text).toBe(
      "Next auditions: Fall 2027",
    );
  });

  it("points past a closed round to the announced one", () => {
    const t = joinTiming(
      { ...pitches, cycle: cycle({ status: "closed", deadline: { at: "2026-09-10", precision: "date" } }) },
      oct12,
      oct12,
    );
    expect(t).toEqual({ text: "Fall 2026 round closed Sep 10", sub: "Next auditions: Fall 2027", tone: "closed" });
  });

  it("a live round, an announced dated one and open membership still come first", () => {
    const open = cycle({ status: "open", deadline: { at: "2026-10-20", precision: "date" } });
    expect(joinTiming({ ...pitches, cycle: open }, oct12, oct12)?.tone).toBe("open");
    expect(joinTiming({ ...pitches, joining: { access: "open" } }, oct12, oct12)?.text).toBe("Anytime");
  });

  it("once that term starts it is no longer 'later': the usual pattern speaks again", () => {
    const sep = new Date("2027-09-02T12:00:00-04:00");
    expect(joinTiming(pitches, sep, sep)?.text).toBe("Usually recruits in fall and spring");
  });

  it("names the round's own process, else 'round'", () => {
    expect(
      joinTiming({ ...pitches, later: { termKey: "2027-spring", processTypes: ["comp"] } }, oct12, oct12)?.text,
    ).toBe("Next comp: Spring 2027");
    expect(joinTiming({ ...pitches, joinModes: ["audition", "application"] }, oct12, oct12)?.text).toBe(
      "Next round: Fall 2027",
    );
  });
});
