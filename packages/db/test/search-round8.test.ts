import { describe, expect, it } from "vitest";
import { normalizeName } from "@hci/core";
import {
  ClubFilters,
  facetCounts,
  matchesStillTime,
  NO_JOINING_FACTS,
  searchLocal,
  type IndexClub,
} from "../src/local";
import { constraintPatch } from "../src/local/basics";
import { interpretQuery } from "../src/local/constraints";

/**
 * Round-8 query reading from live student testing (2026-10-12): question and helper words
 * ("what is punching", "when are a cappella auditions", "clubs i can still join") were
 * spelling-corrected into other words ("wha", "ween", "skill") and emptied the results;
 * joining phrases ("join now", "still open") read as Still time to join; "recruiting" with
 * no round open anywhere falls back to Still time to join; season words ("finance spring")
 * read as the recruiting-season filter. Hand-made index; descriptions invented for the test.
 */
const NOW = new Date("2026-10-12T16:00:00Z");
const J = NO_JOINING_FACTS;
let n = 0;
const cat = (slug: string, name = slug) => ({ slug, name, isPrimary: false });

function club(name: string, over: Partial<IndexClub> = {}): IndexClub {
  return {
    id: `r8-${++n}`,
    slug: normalizeName(name).replace(/ /g, "-"),
    name,
    acronym: null,
    shortDescription: null,
    orgType: null,
    recognitionStatus: "recognized",
    activityStatus: "active",
    joinModes: [],
    freshmenEligible: null,
    joining: J,
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
    quickLinks: { website: "https://example.invalid", instagram: null },
    logo: null,
    pressCount: 0,
    cycles: [],
    searchNames: normalizeName(name),
    searchAcronyms: [],
    searchTopics: "",
    categorySlugs: (over.categories ?? []).map((c) => c.slug),
    recruitingSeasons: [],
    ...over,
  };
}

const comp = { ...J, access: "process" as const, general: ["comp" as const], comp: true };
const open = { ...J, access: "open" as const, general: ["open" as const] };
const round = (deadline: string) => ({
  id: `cy-${deadline}`,
  termKey: "2026-fall",
  track: "main",
  status: "deadline_ahead" as const,
  statedStatus: null,
  opens: null,
  deadline: { at: deadline, precision: "date" as const },
  processTypes: ["application" as const],
  applicationUrl: null,
  eligibleClasses: null,
  lastVerifiedAt: null,
});
const fin = [cat("finance", "Finance & Investing")];
const consulting = [cat("consulting", "Consulting")];
const tech = [cat("technology", "Technology & Engineering")];
const acap = [cat("a-cappella", "A cappella")];

const IX: IndexClub[] = [
  club("Harvard Crimson", {
    shortDescription: "The daily student newspaper.",
    joinModes: ["comp"],
    joining: comp,
    recruitingSeasons: ["fall", "spring"],
  }),
  club("Harvard Yearbook Publications", { joinModes: ["comp"], joining: comp }),
  club("Harvard Boxing Club", { shortDescription: "Footwork and punching drills for every level." }),
  club("Harvard Krokodiloes", { categories: acap, joinModes: ["audition"], shortDescription: "A cappella group." }),
  club("Harvard Opportunes", { categories: acap, joinModes: ["audition"], shortDescription: "A cappella group." }),
  club("Harvard Undergraduate Consulting Group", { categories: consulting, recruitingSeasons: ["fall"] }),
  club("Harvard Social Impact Consulting", { categories: consulting, joining: open }),
  club("Harvard Strategy Consulting Circle", { categories: consulting, recruitingSeasons: ["rolling"] }),
  club("Harvard Finance Society", { categories: fin, recruitingSeasons: ["spring"] }),
  club("Harvard Investment Association", { categories: fin, recruitingSeasons: ["fall"] }),
  club("Harvard Trading Group", { categories: fin }),
  club("Harvard Coding Collective", { categories: tech, joining: open, shortDescription: "Weekly coding nights." }),
  club("Harvard Computer Society", { categories: tech, shortDescription: "Coding projects and talks." }),
  // Words that "what" and "whatever" used to reach.
  club("Global Alliance for Medical Innovation", { searchTopics: "whatsapp group chats" }),
  club("Harvard Meditation Club", { shortDescription: "Come whatever your level." }),
  club("PBHA's Alternative Spring Breaks", { shortDescription: "Service trips over spring break." }),
  // A graduate group's open round is hidden from the default directory: it doesn't count.
  club("Harvard Law Consulting Society", {
    categories: consulting,
    affiliationScope: "graduate_school",
    cycles: [round("2026-10-20")],
  }),
];

const run = (text: string, f: Partial<ClubFilters> = {}, clubs: IndexClub[] = IX) =>
  searchLocal(clubs, { text, filters: ClubFilters.parse(f), sort: "relevance", offset: 0, limit: 50, now: NOW });
const names = (text: string, clubs: IndexClub[] = IX) => run(text, {}, clubs).clubs.map((c) => c.name);

describe("question and helper words (round 8)", () => {
  it("never spelling-corrects them, so the rest of the query still searches", () => {
    const punch = run("what is punching");
    expect(punch.corrected).toBeNull(); // not "wha is punching"
    expect(punch.searchedText).toBe("punching");
    expect(names("what is punching")).toEqual(["Harvard Boxing Club"]);
    const acapella = run("when are a cappella auditions");
    expect(acapella.corrected).toBeNull(); // not "ween are a cappella"
    expect(
      acapella.clubs
        .slice(0, 2)
        .map((c) => c.name)
        .sort(),
    ).toEqual(["Harvard Krokodiloes", "Harvard Opportunes"]);
    const crimson = run("what is the crimson comp");
    expect(crimson.corrected).toBeNull();
    expect(crimson.clubs[0]?.name).toBe("Harvard Crimson");
  });

  it("“what's a comp” selects comp clubs as “comp” does, never words that begin “what”", () => {
    for (const q of ["what's a comp", "what is a comp", "whats a comp"]) {
      const r = run(q);
      expect(r.searchedText).toBe("");
      expect(r.process).toEqual(["a comp"]);
      expect(r.clubs.map((c) => c.name).sort()).toEqual(["Harvard Crimson", "Harvard Yearbook Publications"]);
    }
  });

  it("a question with nothing else in it is the browse list, never 0 results", () => {
    const all = run("").total;
    for (const q of ["how do i join", "how to join", "clubs to join", "what is"]) {
      const r = run(q);
      expect(r.searchedText).toBe("");
      expect(r.total).toBe(all);
    }
    // One word may still be a name on its way: searched as typed.
    expect(run("how").searchedText).toBe("how");
  });

  it("keeps search-while-typing working around them", () => {
    expect(() => run("wh")).not.toThrow();
    expect(names("what is the cri")[0]).toBe("Harvard Crimson");
    // "wha" may still be "what": no topic completion guessed from it.
    expect(run("wha").corrected).toBeNull();
  });
});

describe("joining phrases read as Still time to join (round 8)", () => {
  it("maps every phrasing to the stillTime constraint, removed from the text", () => {
    for (const q of [
      "join now",
      "can join now",
      "clubs i can join now",
      "can still join",
      "still join",
      "still open",
      "join this semester",
      "join anytime",
      "consulting clubs I can still join",
      "what can i still join",
    ]) {
      const r = interpretQuery(q);
      expect(
        r.constraints.map((c) => c.filter),
        q,
      ).toEqual(["stillTime"]);
      expect(constraintPatch(r.constraints)).toEqual({ stillTime: true });
    }
    expect(interpretQuery("consulting clubs I can still join").text).toBe("consulting clubs");
  });

  it("finds clubs a student can still get into instead of matching “now”", () => {
    const r = run("clubs i can join now");
    expect(r.searchedText).toBe("");
    expect(r.total).toBeGreaterThan(1);
    expect(r.clubs.every((c) => matchesStillTime(c, NOW))).toBe(true);
    expect(names("coding clubs i can join now")).toEqual(["Harvard Coding Collective"]);
    const c = names("consulting clubs I can still join");
    expect(c).toContain("Harvard Social Impact Consulting");
    expect(c).toContain("Harvard Strategy Consulting Circle"); // rolling
    expect(c).not.toContain("Harvard Undergraduate Consulting Group");
  });

  it("“recruiting” with no round open anywhere reads as Still time to join, and says so", () => {
    const r = run("recruiting");
    expect(r.constraints).toEqual([{ filter: "stillTime", phrase: "recruiting", instead: "recruitingNow" }]);
    expect(r.total).toBeGreaterThan(0);
    expect(run("open now").constraints[0]).toMatchObject({ filter: "stillTime", instead: "recruitingNow" });
    // A round open at an undergraduate club: Recruiting now as typed.
    const live = [...IX, club("Harvard Mock Trial", { cycles: [round("2026-10-20")] })];
    const lr = run("recruiting", {}, live);
    expect(lr.constraints).toEqual([{ filter: "recruitingNow", phrase: "recruiting" }]);
    expect(lr.clubs.map((c) => c.name)).toEqual(["Harvard Mock Trial"]);
    // Facet counts read the query the same way.
    expect(facetCounts(IX, { text: "recruiting", filters: ClubFilters.parse({}), now: NOW }).stillTime).toBe(r.total);
  });
});

describe("season words read as the recruiting-season filter (round 8)", () => {
  it("“finance spring”, “spring recruiting”, “recruits in the fall”", () => {
    const r = run("finance spring");
    expect(r.constraints).toEqual([{ filter: "recruitingSeason", phrase: "spring", season: "spring" }]);
    expect(r.clubs.map((c) => c.name)).toEqual(["Harvard Finance Society"]);
    // "spring recruiting" is the season, never Recruiting now.
    expect(run("finance spring recruiting").constraints.map((c) => c.filter)).toEqual(["recruitingSeason"]);
    expect(names("consulting spring")).toEqual([]);
    expect(names("recruits in the fall").sort()).toEqual([
      "Harvard Crimson",
      "Harvard Investment Association",
      "Harvard Undergraduate Consulting Group",
    ]);
    expect(names("consulting rolling")).toEqual(["Harvard Strategy Consulting Circle"]);
    expect(constraintPatch(interpretQuery("fall or spring").constraints)).toEqual({
      recruitingSeasons: ["fall", "spring"],
    });
  });

  it("says how many clubs don't say when a season leaves few", () => {
    const r = run("finance spring");
    expect(r.relaxed).toEqual([
      { constraint: "recruitingSeason", phrase: "spring", season: "spring", without: 3, unknown: 1 },
    ]);
  });

  it("a season word that begins a club's name phrase is the name", () => {
    const r = run("spring break");
    expect(r.constraints).toEqual([]);
    expect(r.clubs[0]?.name).toBe("PBHA's Alternative Spring Breaks");
  });
});
