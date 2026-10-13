import { describe, expect, it } from "vitest";
import { normalizeName } from "@hci/core";
import {
  ClubFilters,
  NO_JOINING_FACTS,
  paceWords,
  readsAsBrowse,
  reasonText,
  searchLocal,
  type IndexClub,
} from "../src/local";

/**
 * Round-14 ranking from student testing (2026-10-13; an international first-year from India and
 * an athlete): "bollywood" and "classical dance" are dance first; graduate-school chapters stay
 * out of Still time to join and the topics; Cultural & identity puts broad groups before career
 * and sports ones; Volunteer leaves out career clubs with only a side service category; the browse
 * list hides name-only clubs as the directory does; "no weekly meetings", "flexible" and
 * "low commitment" read the club's own words about time (`pace`); "free clubs" puts clubs naming
 * another cost last. Hand-made index; descriptions invented.
 */
const NOW = new Date("2026-10-13T16:00:00Z");
const J = NO_JOINING_FACTS;
let n = 0;
const cat = (slug: string, name = slug) => ({ slug, name, isPrimary: false });

function club(name: string, over: Partial<IndexClub> = {}): IndexClub {
  const cats = over.categories ?? [];
  return {
    id: `r14-${++n}`,
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
    quickLinks: { website: `https://${normalizeName(name).replace(/ /g, "-")}.invalid`, instagram: null },
    logo: null,
    pressCount: 0,
    cycles: [],
    searchNames: normalizeName(name),
    searchAcronyms: [],
    searchTopics: "",
    categorySlugs: cats.map((c) => c.slug),
    recruitingSeasons: [],
    ...over,
  };
}

const dance = [cat("performing-arts", "Performing Arts"), cat("dance", "Dance")];
const cultural = [cat("cultural-identity", "Cultural & identity")];
const service = [cat("public-service", "Public Service")];
const open = { ...J, access: "open" as const, general: ["open" as const] };

const CLUBS: IndexClub[] = [
  club("Harvard Undergraduate Bhangra", {
    categories: dance,
    shortDescription: "Dance team performing traditional Punjabi bhangra.",
  }),
  club("Harvard Undergraduate Deepam", {
    categories: [...cultural, ...dance],
    shortDescription: "Harvard Deepam performs Bharatanatyam.",
  }),
  club("Harvard Undergraduate Ghungroo", {
    categories: [...cultural, ...dance],
    shortDescription: "Annual show of dance, music and drama celebrating South Asian culture.",
  }),
  club("Harvard College Pakistani Students Association", {
    categories: cultural,
    shortDescription: "Community for Pakistani students.",
    instagramFollowers: 9000,
  }),
  club("Harvard South Asian Association", {
    categories: cultural,
    shortDescription: "Community for South Asian students.",
    instagramFollowers: 9500,
  }),
  club("The Harvard Ballet Company", {
    categories: dance,
    shortDescription: "Student-run company performing classical ballet and modern dance.",
  }),
  club("Harvard Undergraduate Tap Company", { categories: dance, shortDescription: "Tap dance company." }),
  club("The Harvard Intertribal Indian Dance Troupe", {
    categories: dance,
    shortDescription: "Performs Native American powwow dances.",
  }),
  // Cultural & identity, Still time to join
  club("Harvard Undergraduate Philippine Forum", {
    categories: cultural,
    shortDescription: "Community for Filipino students.",
    joining: open,
  }),
  club("Harvard Chinese Students & Scholars Association", {
    categories: cultural,
    affiliationScope: "unknown",
    shortDescription: "Graduate School of Arts and Sciences chapter serving Chinese students and scholars.",
    joining: open,
    instagramFollowers: 50000,
  }),
  club("Harvard Undergraduate Women in Business", {
    categories: [cat("pre-professional", "Business & Pre-professional"), ...cultural],
    shortDescription: "Group empowering women at Harvard through business education.",
    joining: open,
    instagramFollowers: 20000,
  }),
  // Volunteer
  club("PBHA's Youth Recreation Program- HOOPs", {
    categories: service,
    orgType: "public_service_program",
    shortDescription: "Afterschool volunteer program teaching elementary schoolers basketball.",
    pace: ["low commitment"],
    joining: open,
  }),
  club("Harvard Undergraduate Economics Association", {
    categories: [cat("academic-stem", "Academic & STEM"), ...service],
    shortDescription: "Group connecting econ concentrators with faculty, mentors and peers.",
    joining: open,
    instagramFollowers: 30000,
  }),
  club("Small Claims Advisory Service", {
    categories: service,
    shortDescription: "Volunteer service giving residents information on small claims court.",
  }),
  club("PBHA's Elderly 1-2-1", {
    categories: service,
    shortDescription: "Program pairing volunteers with aging Cambridge residents.",
    pace: ["own convenience"],
  }),
  club("PBHA's Best Buddies", {
    categories: service,
    shortDescription: "Volunteer program pairing students with adults with disabilities.",
    pace: ["per month", "monthly"],
  }),
  club("Harvard Chess Club", {
    categories: [cat("hobbies-games", "Games & hobbies")],
    shortDescription: "Weekly meetings for chess players of every level.",
    pace: ["weekly"],
    hoursPerWeek: { min: null, max: 2 },
  }),
  // Free clubs
  club("Harvard Free Club", {
    categories: cultural,
    shortDescription: "Community with no dues.",
    joining: { ...J, dues: false },
  }),
  club("Harvard Uniform Club", {
    categories: cultural,
    shortDescription: "Community with no dues; members buy a uniform.",
    joining: { ...J, dues: false, costNote: "uniform at own cost" },
    instagramFollowers: 100000,
  }),
  // Name-only (sparse): no description, no links.
  club("Harvard Name Only Society", { quickLinks: { website: null, instagram: null } }),
];

const search = (text: string, filters: Partial<ClubFilters> = {}) =>
  searchLocal(CLUBS, {
    text,
    filters: ClubFilters.parse(filters),
    sort: "relevance",
    offset: 0,
    limit: 100,
    now: NOW,
  });
const names = (text: string, filters: Partial<ClubFilters> = {}) => search(text, filters).clubs.map((c) => c.name);
const before = (list: string[], a: string, b: string) => {
  expect(list).toContain(a);
  expect(list).toContain(b);
  expect(list.indexOf(a)).toBeLessThan(list.indexOf(b));
};

describe("dance forms (Round 14)", () => {
  it("'bollywood' is South Asian dance first, then the associations, then other dance", () => {
    const got = names("bollywood");
    before(got, "Harvard Undergraduate Bhangra", "Harvard South Asian Association");
    before(got, "Harvard Undergraduate Deepam", "Harvard South Asian Association");
    before(got, "Harvard Undergraduate Ghungroo", "Harvard College Pakistani Students Association");
    before(got, "Harvard College Pakistani Students Association", "Harvard Undergraduate Tap Company");
    // The powwow troupe is another sense of "Indian".
    before(got, "Harvard Undergraduate Tap Company", "The Harvard Intertribal Indian Dance Troupe");
  });

  it("'classical dance' reaches ballet and Bharatanatyam before other dance", () => {
    const got = names("classical dance");
    before(got, "The Harvard Ballet Company", "Harvard Undergraduate Tap Company");
    before(got, "Harvard Undergraduate Deepam", "Harvard Undergraduate Tap Company");
    // Kathak: no club says it; the South Asian dance groups are the nearest answer.
    expect(names("kathak").slice(0, 3)).toEqual(
      expect.arrayContaining(["Harvard Undergraduate Bhangra", "Harvard Undergraduate Deepam"]),
    );
    // A form a club says still finds that club alone.
    expect(names("bharatanatyam")).toEqual(["Harvard Undergraduate Deepam"]);
  });

  it("'south asian' still finds the associations by name first", () => {
    expect(names("south asian")[0]).toBe("Harvard South Asian Association");
  });
});

describe("graduate chapters and topics (Round 14)", () => {
  it("a club whose one-liner places it in a graduate school is out of Still time to join and topics", () => {
    const hcssa = "Harvard Chinese Students & Scholars Association";
    expect(names("", { stillTime: true })).not.toContain(hcssa);
    expect(names("", { intent: "cultural-community" })).not.toContain(hcssa);
    expect(names("", { intent: "meet-people" })).not.toContain(hcssa);
    // The plain directory and a search for its name still find it.
    expect(names("")).toContain(hcssa);
    expect(names("chinese students scholars")).toContain(hcssa);
  });

  it("Cultural & identity puts broad groups before career ones, keeping both", () => {
    const got = names("", { intent: "cultural-community", stillTime: true });
    before(got, "Harvard Undergraduate Philippine Forum", "Harvard Undergraduate Women in Business");
  });

  it("Volunteer leaves out a career club with only a side service category", () => {
    const got = names("", { intent: "volunteer" });
    expect(got).toContain("PBHA's Youth Recreation Program- HOOPs");
    expect(got).not.toContain("Harvard Undergraduate Economics Association");
  });
});

describe("browse list (Round 14)", () => {
  it("a question with nothing to search reads as browsing, so name-only clubs hide as with no text", () => {
    expect(readsAsBrowse(CLUBS, "how do i join")).toBe(true);
    expect(readsAsBrowse(CLUBS, "no comp")).toBe(true);
    expect(readsAsBrowse(CLUBS, "")).toBe(true);
    expect(readsAsBrowse(CLUBS, "dance")).toBe(false);
    expect(readsAsBrowse(CLUBS, "low commitment")).toBe(false);
    const browse = search("", { hideSparse: true }).total;
    expect(search("how do i join", { hideSparse: true }).total).toBe(browse);
  });
});

describe("time in the club's own words (Round 14)", () => {
  it("reads pace phrases from text, longest first", () => {
    expect(paceWords(["Looking for a fun, low-commitment way to help?"])).toEqual(["low commitment"]);
    expect(paceWords(["Pairs meet at their own convenience."])).toEqual(["own convenience"]);
    expect(paceWords(["A low time commitment, two activities per month."])).toEqual([
      "low time commitment",
      "per month",
    ]);
    expect(paceWords(["We meet weekly."])).toEqual(["weekly"]);
  });

  it("'no weekly meetings' never lifts a weekly club; monthly ones lead", () => {
    const r = search("no weekly meetings");
    expect(r.soft).toEqual(["no weekly meetings"]);
    expect(r.clubs.map((c) => c.name)).not.toContain("Harvard Chess Club");
    expect(r.clubs[0]!.name).toBe("PBHA's Best Buddies");
    for (const q of ["not weekly", "no regular meetings"]) expect(names(q)).not.toContain("Harvard Chess Club");
  });

  it("'flexible' and 'low commitment' find clubs saying so in their own words", () => {
    expect(names("flexible")).toContain("PBHA's Elderly 1-2-1");
    const r = search("low commitment service");
    // The two clubs saying it in their own words lead ("low-commitment", "at their own convenience").
    const top = r.clubs.slice(0, 2);
    expect(top.map((c) => c.name).sort()).toEqual(["PBHA's Elderly 1-2-1", "PBHA's Youth Recreation Program- HOOPs"]);
    const hoops = top.find((c) => c.name.includes("HOOPs"))!;
    expect(r.reasons[hoops.id]!.map(reasonText)).toContain("Description mentions “low commitment”");
    before(names("low commitment service"), "PBHA's Youth Recreation Program- HOOPs", "Small Claims Advisory Service");
  });
});

describe("free clubs (Round 14)", () => {
  it("clubs naming another cost follow clubs that cost nothing", () => {
    const r = search("free clubs");
    expect(r.constraints.map((c) => c.filter)).toEqual(["noDues"]);
    before(
      r.clubs.map((c) => c.name),
      "Harvard Free Club",
      "Harvard Uniform Club",
    );
  });
});
