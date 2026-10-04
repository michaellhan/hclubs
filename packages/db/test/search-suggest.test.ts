import { describe, expect, it } from "vitest";
import { normalizeName } from "@hci/core";
import { NO_JOINING_FACTS, suggest, type IndexClub } from "../src/local";

let n = 0;
function club(name: string, over: Partial<IndexClub> & { alias?: string[] } = {}): IndexClub {
  const { alias = [], ...rest } = over;
  return {
    id: `s${++n}`,
    slug: normalizeName(name).replace(/ /g, "-"),
    name,
    acronym: null,
    shortDescription: null,
    orgType: null,
    recognitionStatus: "recognized",
    activityStatus: "active",
    joinModes: [],
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
    searchNames: [name, ...alias].map(normalizeName).join(" | "),
    searchAcronyms: over.acronym ? [over.acronym.toUpperCase()] : [],
    searchTopics: "",
    categorySlugs: [],
    recruitingSeasons: [],
    ...rest,
  };
}

const IX = [
  club("Harvard Computer Society", { acronym: "HCS" }),
  club("Harvard Composers Association"),
  club("The Harvard Krokodiloes", { alias: ["Kroks"] }),
  club("Harvard Undergraduate Robotics Club"),
  club("Harvard Undergraduate Combat Robotics Club"),
  club("Harvard College Consulting Group"),
  club("Harvard Graduate Robotics Society", { affiliationScope: "graduate_school" }),
  club("Harvard Old Debating Club", { activityStatus: "defunct" }),
  club("Harvard Chess Club"),
  club("Harvard Cricket Club"),
  club("Harvard College Climate Coalition", { acronym: "HCCC" }),
  club("Harvard World Model United Nations"),
];
const names = (q: string) => suggest(IX, q).map((s) => s.club.name);

describe("typeahead suggestions", () => {
  it("acronym, then name prefix with or without the Harvard prefix", () => {
    expect(suggest(IX, "hcs")[0]).toMatchObject({ club: { name: "Harvard Computer Society" }, match: "acronym" });
    expect(names("harvard comp").slice(0, 2)).toEqual(["Harvard Computer Society", "Harvard Composers Association"]);
    expect(names("harvard comp")).not.toContain("Harvard Undergraduate Combat Robotics Club");
    expect(names("robotics")[0]).toBe("Harvard Undergraduate Robotics Club");
    expect(suggest(IX, "kroks")[0]).toMatchObject({ club: { name: "The Harvard Krokodiloes" }, match: "alias" });
  });

  it("initials, a word inside the name, and a one-letter slip", () => {
    expect(suggest(IX, "hccg")[0]).toMatchObject({ match: "initials" });
    expect(suggest(IX, "combat")[0]?.club.name).toBe("Harvard Undergraduate Combat Robotics Club");
    expect(suggest(IX, "krokodils")[0]).toMatchObject({ club: { name: "The Harvard Krokodiloes" }, match: "spelling" });
  });

  it("ranks three-letter initials below acronym prefixes; knows concept abbreviations", () => {
    const hcc = suggest(IX, "hcc");
    expect(hcc[0]).toMatchObject({ club: { name: "Harvard College Climate Coalition" }, match: "acronymPrefix" });
    expect(hcc.slice(1).every((s) => s.match === "initials")).toBe(true);
    expect(suggest(IX, "mun")[0]).toMatchObject({
      club: { name: "Harvard World Model United Nations" },
      match: "abbreviation",
    });
  });

  it("ranks graduate groups below, drops defunct ones, and ignores junk", () => {
    expect(names("robotics").at(-1)).toBe("Harvard Graduate Robotics Society");
    expect(names("old debating")).toEqual([]);
    expect(suggest(IX, "h")).toEqual([]);
    expect(suggest(IX, "\u0000")).toEqual([]);
    expect(suggest(IX, "robotics", 1)).toHaveLength(1);
  });

  it("a finished word ranks names that only begin with it last ('math' vs Mather)", () => {
    const ix = [
      club("Mather House Committee"),
      club("Harvard Undergraduate Mathematics Association"),
      club("Harvard Applied Math Society"),
    ];
    expect(suggest(ix, "math").map((s) => s.club.name)).toEqual([
      "Harvard Undergraduate Mathematics Association",
      "Harvard Applied Math Society",
      "Mather House Committee",
    ]);
    expect(suggest(ix, "mathe")[0]?.club.name).toBe("Mather House Committee");
  });
});
