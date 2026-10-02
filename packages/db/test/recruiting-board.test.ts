import { describe, expect, it } from "vitest";
import {
  buildBoardSections,
  buildJoinAnytime,
  buildNextChances,
  buildRecruitingBoard,
  buildStartedNoDeadline,
  buildUsuallyRecruiting,
  hasCycleThisTerm,
  followingSeason,
  startedWindowDays,
  type IndexClub,
} from "../src/local";
import type { CycleSummary } from "../src/queries/types";
import { listedDate } from "../src/queries/clubs";

/**
 * The recruiting board's student-facing sections over hand-built index rows (pure, injected
 * time). "Now" is 2026-10-02 noon in Boston: most fall rounds closed in September.
 */
const NOW = new Date("2026-10-02T16:00:00Z");
const day = (at: string) => ({ at, precision: "date" as const });

let n = 0;
function cycle(c: Partial<CycleSummary>): CycleSummary {
  n += 1;
  return {
    id: `cy-${n}`,
    termKey: "2026-fall",
    track: "main",
    status: "unknown",
    statedStatus: null,
    opens: null,
    deadline: null,
    processTypes: [],
    applicationUrl: null,
    eligibleClasses: null,
    lastVerifiedAt: "2026-09-30T00:00:00Z",
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
    joinModes: [],
    freshmenEligible: null,
    joining: {
      access: null,
      general: [],
      roles: [],
      noCuts: false,
      comp: null,
      firstYears: null,
      dues: null,
      conflicts: [],
    },
    categories: [],
    memberCount: null,
    hoursPerWeek: null,
    currentCycle: null,
    isFixture: false,
    completeness: 0.5,
    lastObservedAt: null,
    eligibleClasses: null,
    affiliationScope: "harvard_college",
    quickLinks: { website: `https://${slug}.example.invalid`, instagram: null },
    logo: null,
    pressCount: 0,
    cycles: [],
    searchNames: slug,
    searchAcronyms: [],
    searchTopics: "",
    categorySlugs: [],
    recruitingSeasons: [],
    ...c,
  } as IndexClub;
}
const open = (slug: string, c: Partial<IndexClub> = {}) =>
  club(slug, { joinModes: ["open"], ...c, joining: { ...club(slug).joining, access: "open", ...c.joining } });

describe("join anytime", () => {
  it("lists only clubs a source says anyone can join, never ones we know nothing about", () => {
    const clubs = [
      open("chess"),
      club("unknown-process"),
      club("applies", { joinModes: ["application"], joining: { ...club("x").joining, access: "process" } }),
      open("sparse", { shortDescription: null, quickLinks: { website: null, instagram: null } }),
      open("ended", { activityStatus: "defunct" }),
      open("law-clinic", { affiliationScope: "graduate_school" }),
    ];
    expect(buildJoinAnytime(clubs, { now: NOW }).map((c) => c.slug)).toEqual(["chess"]);
  });

  it("ranks active and first-year-friendly clubs first, then by name", () => {
    const clubs = [
      open("b-unknown-activity", { activityStatus: "unknown" }),
      open("c-active"),
      open("a-active-first-years", { joining: { ...club("x").joining, access: "open", firstYears: true } }),
    ];
    expect(buildJoinAnytime(clubs, { now: NOW }).map((c) => c.slug)).toEqual([
      "a-active-first-years",
      "c-active",
      "b-unknown-activity",
    ]);
  });

  it("respects the board's filters", () => {
    const clubs = [
      open("fy", { joining: { ...club("x").joining, access: "open", firstYears: true }, categorySlugs: ["games"] }),
      open("upper", { eligibleClasses: ["junior", "senior"] }),
    ];
    expect(buildJoinAnytime(clubs, { now: NOW, classYear: "first_year" }).map((c) => c.slug)).toEqual(["fy"]);
    expect(buildJoinAnytime(clubs, { now: NOW, classYear: "sophomore" }).map((c) => c.slug)).toEqual(["fy"]);
    expect(buildJoinAnytime(clubs, { now: NOW, category: "games" }).map((c) => c.slug)).toEqual(["fy"]);
    expect(buildJoinAnytime(clubs, { now: NOW, joinMode: "comp" })).toEqual([]);
  });
});

describe("missed it? next chances", () => {
  const closedFall = () => cycle({ deadline: day("2026-09-12"), processTypes: ["application"] });

  it("rolling first, then clubs whose fall round closed and recruit in spring, then spring-only", () => {
    const clubs = [
      club("spring-only", { recruitingSeasons: ["spring"], joinModes: ["comp"] }),
      club("missed-fall", { recruitingSeasons: ["fall", "spring"], cycles: [closedFall()] }),
      club("rolling", { recruitingSeasons: ["rolling"], joinModes: ["application"] }),
      club("fall-only-closed", { recruitingSeasons: ["fall"], cycles: [closedFall()] }),
      club("fall-and-spring-no-cycle", { recruitingSeasons: ["fall", "spring"] }),
      open("open-rolling", { recruitingSeasons: ["rolling"] }),
    ];
    const got = buildNextChances(clubs, { now: NOW });
    expect(got.map((c) => [c.club.slug, c.next])).toEqual([
      ["rolling", "rolling"],
      ["missed-fall", "spring"],
      ["spring-only", "spring"],
    ]);
    expect(got[1]?.closed?.deadline?.at).toBe("2026-09-12");
  });

  it("skips clubs with an open or announced round (they're on the board)", () => {
    const clubs = [
      club("open-round", {
        recruitingSeasons: ["rolling"],
        cycles: [cycle({ deadline: day("2026-10-09"), processTypes: ["application"] })],
      }),
    ];
    expect(buildNextChances(clubs, { now: NOW })).toEqual([]);
  });

  it("looks to fall from spring", () => {
    expect(followingSeason("spring")).toBe("fall");
    expect(followingSeason("fall")).toBe("spring");
    const clubs = [club("fall-recruiter", { recruitingSeasons: ["fall"] })];
    expect(buildNextChances(clubs, { now: new Date("2027-03-01T17:00:00Z") }).map((c) => c.next)).toEqual(["fall"]);
  });
});

describe("usually recruits this term", () => {
  it("drops clubs whose round this term already closed", () => {
    const clubs = [
      club("closed-already", {
        recruitingSeasons: ["fall"],
        cycles: [cycle({ deadline: day("2026-09-12") })],
      }),
      club("no-dates-yet", { recruitingSeasons: ["fall"] }),
    ];
    expect(buildUsuallyRecruiting(clubs, { now: NOW }).map((c) => c.slug)).toEqual(["no-dates-yet"]);
    const closed = club("c", { cycles: [cycle({ status: "closed", deadline: day("2026-09-12") })] });
    expect(hasCycleThisTerm(closed, NOW)).toBe(true);
  });

  it("a closed round from last year doesn't count as this term's", () => {
    const c = club("old", { cycles: [cycle({ termKey: "2025-fall", status: "closed", deadline: day("2025-09-12") })] });
    expect(hasCycleThisTerm(c, NOW)).toBe(false);
  });
});

describe("started, no deadline listed", () => {
  it("auditions and tryouts drop off after 10 days; comps and applications after 30", () => {
    expect(startedWindowDays(["audition"], [])).toBe(10);
    expect(startedWindowDays([], ["tryout", "audition"])).toBe(10);
    expect(startedWindowDays(["comp"], [])).toBe(30);
    expect(startedWindowDays([], [])).toBe(30);
    const clubs = [
      club("audition-sep5", { joinModes: ["audition"], cycles: [cycle({ opens: day("2026-09-05") })] }),
      club("audition-sep25", { joinModes: ["audition"], cycles: [cycle({ opens: day("2026-09-25") })] }),
      club("comp-sep6", { joinModes: ["comp"], cycles: [cycle({ opens: day("2026-09-06") })] }),
      club("comp-aug20", { joinModes: ["comp"], cycles: [cycle({ opens: day("2026-08-20") })] }),
    ];
    expect(buildStartedNoDeadline(clubs, { now: NOW }).map((e) => e.club.slug)).toEqual([
      "audition-sep25",
      "comp-sep6",
    ]);
  });
});

describe("board boundaries", () => {
  const deadlineClub = (at: string) =>
    club("d", { cycles: [cycle({ deadline: day(at), processTypes: ["application"] })] });

  it("a date-only deadline is open through the whole deadline day in Boston", () => {
    const c = deadlineClub("2026-10-02");
    expect(buildRecruitingBoard([c], { now: new Date("2026-10-03T03:59:00Z") }).open).toHaveLength(1); // 11:59 PM EDT
    expect(buildRecruitingBoard([c], { now: new Date("2026-10-03T04:01:00Z") }).recentlyClosed).toHaveLength(1);
  });

  it("across the November DST change, a date-only deadline still ends at Boston midnight (EST)", () => {
    const c = deadlineClub("2026-11-02");
    expect(buildRecruitingBoard([c], { now: new Date("2026-11-03T04:30:00Z") }).open).toHaveLength(1); // 11:30 PM EST
    expect(buildRecruitingBoard([c], { now: new Date("2026-11-03T05:01:00Z") }).open).toHaveLength(0);
  });

  it("sorts the open list by deadline instant: a 5 PM deadline precedes a date-only one the same day", () => {
    const timed = club("timed", {
      cycles: [cycle({ deadline: { at: "2026-10-05T17:00:00-04:00", precision: "datetime" } })],
    });
    const dateOnly = club("date-only", { cycles: [cycle({ deadline: day("2026-10-05") })] });
    const later = club("later", { cycles: [cycle({ deadline: day("2026-10-06") })] });
    const slugs = buildRecruitingBoard([later, dateOnly, timed], { now: NOW }).open.map((e) => e.club.slug);
    expect(slugs).toEqual(["timed", "date-only", "later"]);
  });

  it("a next-term deadline months away is opening soon, not open now", () => {
    const c = club("spring", {
      cycles: [cycle({ termKey: "2027-spring", deadline: day("2027-02-10"), processTypes: ["comp"] })],
    });
    const b = buildRecruitingBoard([c], { now: NOW });
    expect(b.open).toHaveLength(0);
    expect(b.upcoming).toHaveLength(1);
  });

  it("an undated 'applications are open' expires 21 days after we last saw it", () => {
    const c = (seen: string) =>
      club("stated", {
        cycles: [cycle({ statedStatus: "open", lastVerifiedAt: seen, processTypes: ["application"] })],
      });
    expect(buildRecruitingBoard([c("2026-09-20T12:00:00Z")], { now: NOW }).open).toHaveLength(1);
    expect(buildRecruitingBoard([c("2026-09-05T12:00:00Z")], { now: NOW }).open).toHaveLength(0);
  });
});

describe("usually recruits this term: open membership", () => {
  it("leaves out clubs anyone can join (they're under Join anytime)", () => {
    const clubs = [
      open("open-fall", { recruitingSeasons: ["fall"] }),
      club("audition-fall", { recruitingSeasons: ["fall"] }),
    ];
    expect(buildUsuallyRecruiting(clubs, { now: NOW }).map((c) => c.slug)).toEqual(["audition-fall"]);
  });
});

describe("usually recruits this term: no contradiction with this term's rounds", () => {
  it("leaves out clubs with any round this term (closed Sep 5-12, or started with no deadline)", () => {
    const clubs = [
      club("din-and-tonics", {
        recruitingSeasons: ["fall"],
        joinModes: ["audition"],
        cycles: [cycle({ opens: day("2026-09-05"), deadline: day("2026-09-06"), processTypes: ["audition"] })],
      }),
      club("hucbe", { recruitingSeasons: ["fall", "spring"], cycles: [cycle({ deadline: day("2026-09-05") })] }),
      club("started", {
        recruitingSeasons: ["fall"],
        joinModes: ["comp"],
        cycles: [cycle({ opens: day("2026-09-06") })],
      }),
      club("last-year-only", {
        recruitingSeasons: ["fall"],
        cycles: [cycle({ termKey: "2025-fall", deadline: day("2025-09-12") })],
      }),
    ];
    const usual = buildUsuallyRecruiting(clubs, { now: NOW }).map((c) => c.slug);
    expect(usual).toEqual(["last-year-only"]);
    const closed = buildRecruitingBoard(clubs, { now: NOW }).recentlyClosed.map((e) => e.club.slug);
    for (const slug of closed) expect(usual).not.toContain(slug);
  });
});

describe("listed cycle dates (public static index)", () => {
  it("keep the instant, precision and label; drop the source text and parse confidence", () => {
    expect(
      listedDate({
        at: "2026-09-10",
        precision: "date",
        sourceText: "Thursday, September 10th",
        parseConfidence: "medium",
      }),
    ).toEqual({ at: "2026-09-10", precision: "date" });
    expect(listedDate({ at: "2026-09-10", precision: "date", label: "First round" })).toEqual({
      at: "2026-09-10",
      precision: "date",
      label: "First round",
    });
    expect(listedDate(null)).toBeNull();
  });
});

describe("board sections list each club once (buildBoardSections)", () => {
  it("a rolling club that also recruits this season is a next chance, not 'usually recruits this term'", () => {
    const clubs = [club("rolling-fall", { recruitingSeasons: ["rolling", "fall"], joinModes: ["application"] })];
    expect(buildUsuallyRecruiting(clubs, { now: NOW })).toEqual([]);
    const s = buildBoardSections(clubs, { now: NOW });
    expect(s.usually).toEqual([]);
    expect(s.chances.map((c) => c.club.slug)).toEqual(["rolling-fall"]);
  });

  it("a rolling club with a started round shows only the round", () => {
    const clubs = [
      club("rolling-started", {
        recruitingSeasons: ["rolling"],
        joinModes: ["comp"],
        cycles: [cycle({ opens: day("2026-09-28"), processTypes: ["comp"] })],
      }),
    ];
    const s = buildBoardSections(clubs, { now: NOW });
    expect(s.started.map((e) => e.club.slug)).toEqual(["rolling-started"]);
    expect(s.chances).toEqual([]);
  });

  it("an open club with a recent role audition shows the audition, not Join anytime", () => {
    const clubs = [
      open("open-audition", { cycles: [cycle({ opens: day("2026-09-28"), processTypes: ["audition"] })] }),
    ];
    const s = buildBoardSections(clubs, { now: NOW });
    expect(s.started).toHaveLength(1);
    expect(s.anytime).toEqual([]);
  });

  it("every club appears in at most one of started/open/upcoming, anytime, usually, chances", () => {
    const clubs = [
      open("o1", { recruitingSeasons: ["fall", "rolling"] }),
      club("u1", { recruitingSeasons: ["fall", "spring"], joinModes: ["audition"] }),
      club("c1", { recruitingSeasons: ["spring"], joinModes: ["comp"] }),
      club("d1", {
        recruitingSeasons: ["rolling"],
        cycles: [cycle({ deadline: day("2026-10-09"), processTypes: ["application"] })],
      }),
    ];
    const s = buildBoardSections(clubs, { now: NOW });
    const ids = [
      ...s.board.open.map((e) => e.club.id),
      ...s.board.upcoming.map((e) => e.club.id),
      ...s.started.map((e) => e.club.id),
      ...s.anytime.map((c) => c.id),
      ...s.usually.map((c) => c.id),
      ...s.chances.map((c) => c.club.id),
    ];
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.sort()).toEqual(["id-c1", "id-d1", "id-o1", "id-u1"]);
  });
});

describe("join anytime with a process filter", () => {
  it("attendance-based keeps only clubs whose members join by showing up", () => {
    const clubs = [open("drop-in", { joinModes: ["attendance_based"] }), open("listserv", { joinModes: ["open"] })];
    expect(buildJoinAnytime(clubs, { now: NOW, joinMode: "attendance_based" }).map((c) => c.slug)).toEqual(["drop-in"]);
    expect(buildJoinAnytime(clubs, { now: NOW, joinMode: "open" })).toHaveLength(2);
  });
});
