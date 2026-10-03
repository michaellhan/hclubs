import { describe, expect, it } from "vitest";
import { normalizeName } from "@hci/core";
import { ClubFilters, boardEligible, buildRecruitingBoard, namesClub, searchLocal, type IndexClub, NO_JOINING_FACTS } from "../src/local";

/**
 * Scope and lifecycle (ADR 0038) on hand-made, fictional index rows: graduate-school groups
 * and organizations that ended stay off the recruiting board and out of default browsing,
 * yet a search for their own name still finds them.
 */
const NOW = new Date("2026-10-01T16:00:00Z");
let n = 0;
const openCycle = {
  id: "cy",
  termKey: "2026-fall",
  track: "main",
  status: "deadline_ahead" as const,
  statedStatus: null,
  opens: null,
  deadline: { at: "2026-10-10T23:59:00-04:00", precision: "datetime" as const },
  processTypes: [],
  applicationUrl: null,
  eligibleClasses: null,
  lastVerifiedAt: null,
};

function club(name: string, over: Partial<IndexClub> = {}): IndexClub {
  const id = `c${++n}`;
  return {
    id,
    slug: normalizeName(name).replace(/ /g, "-"),
    name,
    acronym: null,
    shortDescription: "A fictional test group.",
    orgType: null,
    recognitionStatus: "unknown",
    activityStatus: "active",
    joinModes: ["application"],
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
    affiliationScope: "unknown",
    quickLinks: { website: null, instagram: null },
    logo: null,
    pressCount: 0,
    cycles: [{ ...openCycle, id: `${id}-cy` }],
    searchNames: normalizeName(name),
    searchAcronyms: over.acronym ? [over.acronym.toLowerCase()] : [],
    searchTopics: "",
    categorySlugs: [],
    recruitingSeasons: [],
    ...over,
  };
}

// The Harvard Law Entrepreneurship Project class of error: a graduate-school group with an
// open application must not read as "Recruiting now" to College students.
const lawClinic = club("Fictional Law Startup Clinic", { affiliationScope: "graduate_school" });
const ended = club("Fictional Undergraduate Assembly", { activityStatus: "defunct", acronym: "FUA" });
const unknownScope = club("Fictional Robotics Guild");
const college = club("Fictional Debate League", { affiliationScope: "harvard_college" });
const ALL = [lawClinic, ended, unknownScope, college];

describe("recruiting board scope (ADR 0038)", () => {
  it("leaves graduate-school groups and ended organizations off by default", () => {
    expect(boardEligible(lawClinic)).toBe(false);
    expect(boardEligible(ended)).toBe(false);
    expect(boardEligible(ended, true)).toBe(false);
    // Unknown scope is not "graduate": it stays on.
    expect(boardEligible(unknownScope)).toBe(true);
    const board = buildRecruitingBoard(ALL, { now: NOW });
    expect(board.open.map((e) => e.club.name).sort()).toEqual(["Fictional Debate League", "Fictional Robotics Guild"]);
  });

  it("shows graduate-school groups to a graduate student who asks", () => {
    const board = buildRecruitingBoard(ALL, { now: NOW, includeGraduate: true });
    expect(board.open.map((e) => e.club.name)).toContain("Fictional Law Startup Clinic");
    expect(board.open.map((e) => e.club.name)).not.toContain("Fictional Undergraduate Assembly");
  });
});

describe("hidden clubs answer a search for their own name", () => {
  const search = (text: string | null) =>
    searchLocal(ALL, {
      text,
      filters: ClubFilters.parse({}),
      sort: "relevance",
      offset: 0,
      limit: 20,
      now: NOW,
    }).clubs.map((c) => c.name);

  it("browsing without a query leaves them out", () => {
    expect(search(null)).not.toContain("Fictional Undergraduate Assembly");
    expect(search(null)).not.toContain("Fictional Law Startup Clinic");
  });
  it("a search naming the club finds it", () => {
    expect(search("undergraduate assembly")).toEqual(["Fictional Undergraduate Assembly"]);
    expect(search("FUA")).toEqual(["Fictional Undergraduate Assembly"]);
    expect(search("law startup clinic")).toEqual(["Fictional Law Startup Clinic"]);
  });
  it("a single generic word does not pull hidden clubs in", () => {
    expect(search("assembly")).not.toContain("Fictional Undergraduate Assembly");
    expect(search("law")).not.toContain("Fictional Law Startup Clinic");
  });
  it("namesClub needs a two-word phrase, the acronym or an alias", () => {
    expect(namesClub({ name: "Fictional Law Startup Clinic", acronym: null, aliases: [] }, "law")).toBe(false);
    expect(namesClub({ name: "Fictional Law Startup Clinic", acronym: null, aliases: [] }, "startup clinic")).toBe(
      true,
    );
    expect(namesClub({ name: "X Society", acronym: "XS", aliases: ["Old Name Club"] }, "old name club")).toBe(true);
  });
});
