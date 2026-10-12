import { describe, expect, it } from "vitest";
import {
  NO_JOINING_FACTS,
  academicYearEndTerm,
  announcedLaterRound,
  beyondAcademicYear,
  buildNextChances,
  buildUsuallyRecruiting,
  matchesStillTime,
  type IndexClub,
} from "../src/local";
import type { CycleSummary } from "../src/queries/types";

/**
 * A round the club's own pages announce for a later term, before any date ("The Pitches' next
 * audition cycle will begin in the Fall of 2027"; student testing 2026-10-12, ADR 0051
 * amendment). It outranks the club's usual-season pattern, and it is "still time to join" only
 * within the current academic year. Pure, with injected time (America/New_York).
 */
const OCT = new Date("2026-10-12T16:00:00Z");

let n = 0;
function cycle(c: Partial<CycleSummary>): CycleSummary {
  n += 1;
  return {
    id: `cy-${n}`,
    termKey: "2027-fall",
    track: "main",
    status: "unknown",
    statedStatus: null,
    opens: null,
    deadline: null,
    processTypes: [],
    applicationUrl: null,
    eligibleClasses: null,
    lastVerifiedAt: "2026-10-01T00:00:00Z",
    ...c,
  };
}
function club(slug: string, c: Partial<IndexClub> = {}): IndexClub {
  return {
    id: `id-${slug}`,
    slug,
    name: slug,
    acronym: null,
    shortDescription: `About ${slug}`,
    orgType: null,
    recognitionStatus: "unknown",
    activityStatus: "active",
    joinModes: ["audition"],
    freshmenEligible: null,
    joining: NO_JOINING_FACTS,
    categories: [],
    memberCount: null,
    hoursPerWeek: null,
    instagramFollowers: null,
    currentCycle: null,
    isFixture: false,
    completeness: 0.5,
    lastObservedAt: null,
    eligibleClasses: null,
    affiliationScope: "harvard_college",
    quickLinks: { website: null, instagram: null },
    logo: null,
    pressCount: 0,
    cycles: [],
    searchNames: slug,
    searchAcronyms: [],
    searchTopics: "",
    categorySlugs: [],
    recruitingSeasons: [],
    ...c,
  };
}

describe("academic year window", () => {
  it("runs from fall through the next summer, and from June on is the year ahead", () => {
    expect(academicYearEndTerm(OCT)).toBe("2027-summer");
    expect(academicYearEndTerm(new Date("2027-03-01T17:00:00Z"))).toBe("2027-summer");
    // May 31 late evening in Boston is still May; June 1 starts the year ahead.
    expect(academicYearEndTerm(new Date("2027-06-01T03:30:00Z"))).toBe("2027-summer");
    expect(academicYearEndTerm(new Date("2027-06-01T04:30:00Z"))).toBe("2028-summer");
    expect(beyondAcademicYear("2027-fall", OCT)).toBe(true);
    expect(beyondAcademicYear("2027-spring", OCT)).toBe(false);
    expect(beyondAcademicYear("2027-fall", new Date("2027-07-15T16:00:00Z"))).toBe(false);
  });
});

describe("announcedLaterRound", () => {
  it("is an undated round in a later term that a club or official page states", () => {
    const later = cycle({});
    expect(announcedLaterRound([later], OCT)).toBe(later);
    // The earliest of several.
    const spring = cycle({ termKey: "2027-spring" });
    expect(announcedLaterRound([later, spring], OCT)).toBe(spring);
  });

  it("is never this term's round, a dated round, a stated status or an unsourced row", () => {
    expect(announcedLaterRound([cycle({ termKey: "2026-fall" })], OCT)).toBe(null);
    expect(announcedLaterRound([cycle({ opens: { at: "2027-09-05", precision: "date" } })], OCT)).toBe(null);
    expect(announcedLaterRound([cycle({ deadline: { at: "2027-09-12", precision: "date" } })], OCT)).toBe(null);
    expect(announcedLaterRound([cycle({ statedStatus: "closed" })], OCT)).toBe(null);
    // A row whose facts were all rejected, or only a tier 6-9 page states.
    expect(announcedLaterRound([cycle({ lastVerifiedAt: null })], OCT)).toBe(null);
  });

  it("becomes this term's round once that term starts", () => {
    expect(announcedLaterRound([cycle({})], new Date("2027-09-02T16:00:00Z"))).toBe(null);
  });
});

describe("Still time to join with an announced round", () => {
  const pitches = club("pitches", { recruitingSeasons: ["fall", "spring"], cycles: [cycle({})] });

  it("a round next academic year outranks a spring pattern: not still time", () => {
    expect(matchesStillTime(pitches, OCT)).toBe(false);
    // Without the announcement the spring pattern still counts in October.
    expect(matchesStillTime({ ...pitches, cycles: [] }, OCT)).toBe(true);
  });

  it("a round announced for later this academic year is still time, even with no pattern", () => {
    expect(matchesStillTime(club("x", { cycles: [cycle({ termKey: "2027-spring" })] }), OCT)).toBe(true);
  });

  it("is still time once the year ahead begins (the fall round announced in July)", () => {
    expect(matchesStillTime(pitches, new Date("2027-07-15T16:00:00Z"))).toBe(true);
  });

  it("an upcoming dated round after this academic year isn't still time either", () => {
    const far = club("far", {
      cycles: [cycle({ status: "upcoming", opens: { at: "2027-09-05", precision: "date" } })],
    });
    expect(matchesStillTime(far, OCT)).toBe(false);
    const near = club("near", {
      cycles: [cycle({ termKey: "2027-spring", status: "upcoming", opens: { at: "2027-01-28", precision: "date" } })],
    });
    expect(matchesStillTime(near, OCT)).toBe(true);
  });

  it("open membership still wins", () => {
    expect(matchesStillTime({ ...pitches, joining: { ...NO_JOINING_FACTS, access: "open" } }, OCT)).toBe(true);
  });
});

describe("board sections follow the announced round", () => {
  const pitches = club("pitches", { recruitingSeasons: ["fall", "spring"], cycles: [cycle({})] });

  it("the next chance is the announced term, a year away, not the usual spring", () => {
    const got = buildNextChances([pitches], { now: OCT });
    expect(got.map((c) => [c.next, c.nextYear, c.announced])).toEqual([["fall", true, "2027-fall"]]);
  });

  it("is never 'usually recruits this term'", () => {
    expect(buildUsuallyRecruiting([pitches], { now: new Date("2026-09-10T16:00:00Z") })).toEqual([]);
    expect(buildUsuallyRecruiting([{ ...pitches, cycles: [] }], { now: new Date("2026-09-10T16:00:00Z") }).length).toBe(
      1,
    );
  });
});

describe("a cycle whose facts were all rejected", () => {
  it("states nothing, whatever pages its rejected claims came from", async () => {
    const { toCycleSummary } = await import("../src/queries/clubs");
    const row = {
      id: "r1",
      clubId: "c1",
      termKey: "2027-spring",
      track: "main",
      opensValue: null,
      deadlineValue: null,
      statedStatus: null,
      processTypes: [],
      applicationUrl: null,
      eligibleClasses: null,
      lastVerifiedAt: new Date("2026-09-30T22:00:00Z"),
      fields: {},
    } as unknown as Parameters<typeof toCycleSummary>[0];
    expect(toCycleSummary(row, OCT).lastVerifiedAt).toBe(null);
    const stated = { ...row, fields: { "cycle.stages": {} } } as typeof row;
    expect(toCycleSummary(stated, OCT).lastVerifiedAt).toBe("2026-09-30T22:00:00.000Z");
  });
});
