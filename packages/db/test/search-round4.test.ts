import { describe, expect, it } from "vitest";
import { normalizeName } from "@hci/core";
import { ClubFilters, facetCounts, NO_JOINING_FACTS, searchLocal, type IndexClub } from "../src/local";
import { interpretQuery } from "../src/local/constraints";

/**
 * Round-4 query reading from student testing: community concepts with synonym spellings
 * ("latino" finds what "latinx" finds; "south asian dance"), another sense of a word
 * ("indian" at a Native American troupe), process words ("comp", "application",
 * "deadline") as lifts rather than required text, and hours ranges ("3-5 hours a week").
 * Hand-made index; names illustrative, descriptions invented for the test.
 */
const NOW = new Date("2026-10-01T16:00:00Z");
const J = NO_JOINING_FACTS;
let n = 0;
const cat = (slug: string, name = slug) => ({ slug, name, isPrimary: false });

function club(name: string, over: Partial<IndexClub> = {}): IndexClub {
  return {
    id: `r4-${++n}`,
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

const dance = [cat("dance", "Dance")];
const cultural = [cat("cultural-identity", "Cultural & Identity")];
const arts = [cat("performing-arts", "Performing Arts")];
const pubs = [cat("publications-media", "Publications & Media")];
const fin = [cat("finance", "Finance & Investing")];
const consulting = [cat("consulting", "Consulting")];
const comp = { ...J, access: "process" as const, general: ["comp" as const], comp: true };
const deadlineAhead = {
  id: "cy1",
  termKey: "2026-fall",
  track: "main",
  status: "deadline_ahead" as const,
  statedStatus: null,
  opens: null,
  deadline: { at: "2026-10-06", precision: "date" as const },
  processTypes: ["comp" as const],
  applicationUrl: null,
  eligibleClasses: null,
  lastVerifiedAt: null,
};

const IX: IndexClub[] = [
  // South Asian
  club("Harvard Undergraduate Bhangra", { categories: arts }),
  club("Harvard Undergraduate Ghungroo", { categories: arts }),
  club("Harvard South Asian Association", { categories: cultural, searchTopics: "show called ghungroo" }),
  club("Harvard College Indian International Students Association", { categories: cultural }),
  club("Harvard Pakistani Students Association", { categories: cultural }),
  club("Harvard Asian American Dance Troupe", { categories: dance }),
  club("Harvard Intertribal Indian Dance Troupe", {
    categories: dance,
    shortDescription: "Performs Native American powwow dances.",
  }),
  club("Harvard Design Collective", { shortDescription: "Students who design posters." }),
  // Latino / Latinx
  club("Concilio Latino de Harvard", {
    categories: cultural,
    shortDescription: "Umbrella group for Latinx student groups.",
  }),
  club("Fuerza Latina", { categories: cultural, shortDescription: "Supports Latinx students." }),
  club("Harvard Candela Latin Dance Troupe", { categories: dance, searchTopics: "performing latinx" }),
  club("The Harvard Ballet Folklórico de Aztlán", { categories: dance }),
  club("Undergraduate Mariachi Véritas de Harvard", { categories: arts }),
  club("Harvard Classics Latin Reading Group", { shortDescription: "Reads Latin and Greek texts aloud." }),
  club("Cambridge Homework Help", { shortDescription: "Tutoring at Cambridge Rindge and Latin School." }),
  // Process words
  club("Harvard Crimson", {
    categories: pubs,
    shortDescription: "Student newspaper publishing every weekday.",
    joinModes: ["comp"],
    joining: comp,
  }),
  club("Harvard Real Estate Review", { categories: pubs, shortDescription: "Compiling research on housing." }),
  club("Harvard Computer Society", { shortDescription: "Computer science projects and talks." }),
  club("Harvard Investment Association", {
    categories: fin,
    shortDescription: "Teaches investing through a semester-long comp.",
    joinModes: ["comp"],
    joining: comp,
    cycles: [deadlineAhead],
    currentCycle: deadlineAhead,
  }),
  club("Harvard Finance Forum", { categories: fin, shortDescription: "Finance talks." }),
  club("Harvard Undergraduate Consulting Group", {
    categories: consulting,
    shortDescription: "Student-run nonprofit consulting for clients.",
    joinModes: ["application"],
    joining: { ...J, access: "process", general: ["application"] },
  }),
  club("Harvard Strategy Circle", { categories: consulting, shortDescription: "Consulting case practice." }),
  club("Harvard Ballet Company", {
    categories: dance,
    joinModes: ["audition"],
    joining: { ...J, access: "process", general: ["audition"] },
  }),
  // Review fixes
  club("Harvard Desi Heritage Circle", {
    categories: cultural,
    shortDescription: "Celebrates South Asian and indigenous textile arts.",
    joining: { ...J, dues: false },
  }),
  club("Glee Club Lite", { shortDescription: "A light-hearted choir." }),
  club("Harvard Comparative Literature Society", { shortDescription: "Reading across languages." }),
  club("Harvard Computational Biology Society", { shortDescription: "Biology with code." }),
  club("Harvard Club Rugby", {
    joinModes: ["tryout"],
    joining: { ...J, access: "process", general: ["tryout"] },
  }),
  club("Harvard Organization for Latin America", { categories: cultural }),
  club("Harvard Model Congress", { searchTopics: "committees on latin america europe asia" }),
  club("Harvard Later Deadline Group", {
    cycles: [{ ...deadlineAhead, id: "cy2", deadline: { at: "2026-10-12", precision: "date" as const } }],
  }),
  // Hours
  club("Harvard Quiet Readers", { hoursPerWeek: { min: 1, max: 2 } }),
  club("Harvard Weekly Chess", { hoursPerWeek: { min: 3, max: 5 } }),
  club("Harvard Heavy Journal", { hoursPerWeek: { min: 6, max: 10 } }),
];

const run = (text: string, f: Partial<ClubFilters> = {}) =>
  searchLocal(IX, { text, filters: ClubFilters.parse(f), sort: "relevance", offset: 0, limit: 50, now: NOW });
const names = (text: string, f: Partial<ClubFilters> = {}) => run(text, f).clubs.map((c) => c.name);
const before = (list: string[], a: string, b: string) => {
  expect(list).toContain(a);
  expect(list).toContain(b);
  expect(list.indexOf(a)).toBeLessThan(list.indexOf(b));
};

describe("South Asian concept", () => {
  it("'south asian dance' finds dance groups named for South Asian forms, not every Asian or Indian dance club", () => {
    const r = names("south asian dance");
    expect(r).toEqual(expect.arrayContaining(["Harvard Undergraduate Bhangra", "Harvard Undergraduate Ghungroo"]));
    expect(r).not.toContain("Harvard Asian American Dance Troupe");
    expect(r).not.toContain("Harvard Intertribal Indian Dance Troupe");
  });

  it("'desi' and 'bollywood' find South Asian clubs, not 'design'", () => {
    for (const q of ["desi", "bollywood", "south asian"]) {
      expect(names(q)).toContain("Harvard South Asian Association");
      expect(names(q)).not.toContain("Harvard Design Collective");
    }
    expect(names("south asian")).toEqual(
      expect.arrayContaining(["Harvard Pakistani Students Association", "Harvard Undergraduate Bhangra"]),
    );
  });

  it("'indian' means South Asian first; a Native American troupe follows, never above", () => {
    const indian = names("indian");
    expect(indian[0]).toBe("Harvard College Indian International Students Association");
    expect(indian.at(-1)).toBe("Harvard Intertribal Indian Dance Troupe");
    // Even though every word of "indian dance" is in the troupe's name.
    before(names("indian dance"), "Harvard Undergraduate Bhangra", "Harvard Intertribal Indian Dance Troupe");
    // Its own name still finds it first.
    expect(names("Harvard Intertribal Indian Dance Troupe")[0]).toBe("Harvard Intertribal Indian Dance Troupe");
    expect(names("native american")[0]).toBe("Harvard Intertribal Indian Dance Troupe");
  });

  it("a named dance form is a dance club for 'dance'", () => {
    expect(names("dance")).toContain("Harvard Undergraduate Bhangra");
  });
});

describe("Latino / Latinx concept", () => {
  const community = [
    "Concilio Latino de Harvard",
    "Fuerza Latina",
    "Harvard Candela Latin Dance Troupe",
    "The Harvard Ballet Folklórico de Aztlán",
    "Undergraduate Mariachi Véritas de Harvard",
  ];

  it("'latino', 'latinx', 'latina' and 'hispanic' find the same community clubs", () => {
    for (const q of ["latino", "latinx", "latina", "hispanic", "latinos"]) {
      expect(names(q)).toEqual(expect.arrayContaining(community));
    }
  });

  it("the word as typed ranks first; a synonym spelling follows", () => {
    expect(names("latino")[0]).toBe("Concilio Latino de Harvard");
    expect(names("latina")[0]).toBe("Fuerza Latina");
  });

  it("never matches the Latin language or a school named Latin", () => {
    for (const q of ["latino", "latinx", "hispanic"]) {
      expect(names(q)).not.toContain("Harvard Classics Latin Reading Group");
      expect(names(q)).not.toContain("Cambridge Homework Help");
    }
  });

  it("finds folklórico with or without the accent", () => {
    expect(names("folklórico")[0]).toBe("The Harvard Ballet Folklórico de Aztlán");
    expect(names("folklorico")[0]).toBe("The Harvard Ballet Folklórico de Aztlán");
  });
});

describe("process words lift, never require", () => {
  it("'newspaper comp' finds the newspaper, not a page saying 'compiling'", () => {
    const r = run("newspaper comp");
    expect(r.clubs[0]?.name).toBe("Harvard Crimson");
    expect(r.process).toEqual(["comp"]);
    expect(r.searchedText).toBe("newspaper");
    const review = r.clubs.find((c) => c.name === "Harvard Real Estate Review");
    if (review) expect(JSON.stringify(r.reasons[review.id])).not.toContain("compiling");
  });

  it("'comp' never prefix-matches 'computer'; alone it selects clubs that comp", () => {
    const r = run("comp");
    expect(r.clubs.map((c) => c.name).sort()).toEqual(["Harvard Crimson", "Harvard Investment Association"]);
    expect(names("comps")).not.toContain("Harvard Computer Society");
    // A topic phrase that starts with the word is the topic.
    expect(names("comp sci")).toContain("Harvard Computer Society");
    // Facet counts agree with the results.
    expect(facetCounts(IX, { text: "comp", filters: ClubFilters.parse({}), now: NOW }).joinModes).toEqual({ comp: 2 });
  });

  it("'finance comp deadline' finds finance clubs, the one with a comp and a deadline ahead first", () => {
    const r = run("finance comp deadline");
    expect(r.clubs[0]?.name).toBe("Harvard Investment Association");
    expect(r.clubs.map((c) => c.name)).toContain("Harvard Finance Forum");
    expect(r.process).toEqual(["comp", "deadline"]);
  });

  it("'consulting club application' finds consulting clubs, the one with an application first", () => {
    const r = names("consulting club application");
    expect(r[0]).toBe("Harvard Undergraduate Consulting Group");
    expect(r).toContain("Harvard Strategy Circle");
  });

  it("'tryout' lifts clubs that audition, too", () => {
    expect(names("dance tryout")[0]).toBe("Harvard Ballet Company");
    expect(names("dance auditions")[0]).toBe("Harvard Ballet Company");
  });

  it("'no comp' stays the No comp filter, and a negated process word filters nothing", () => {
    const r = run("no comp finance");
    expect(r.constraints).toEqual([{ filter: "noComp", phrase: "no comp" }]);
    expect(r.process).toEqual([]);
    expect(interpretQuery("no auditions").soft.map((s) => s.modifier.key)).toEqual(["beginner"]);
  });
});

describe("hours ranges", () => {
  const read = (q: string) => interpretQuery(q).constraints;

  it("reads a range as at most its top, consuming the whole phrase", () => {
    expect(interpretQuery("3-5 hours a week")).toMatchObject({
      text: "",
      constraints: [{ filter: "maxHours", phrase: "3-5 hours a week", value: 5 }],
    });
    expect(read("3–5 hours per week")[0]).toMatchObject({ value: 5 });
    expect(read("3 to 5 hours")[0]).toMatchObject({ value: 5, phrase: "3 to 5 hours" });
    expect(read("between 2 and 4 hrs a week")[0]).toMatchObject({ value: 4 });
    expect(read("2 or 3 hours a week")[0]).toMatchObject({ value: 3 });
    expect(interpretQuery("chess 3-5 hours")).toMatchObject({ text: "chess", constraints: [{ value: 5 }] });
  });

  it("never turns a floor into a cap", () => {
    for (const q of ["at least 3-5 hours a week", "more than 3 to 5 hours", "10-20+ hours a week"])
      expect(read(q)).toEqual([]);
  });

  it("filters by the range's top", () => {
    expect(names("3-5 hours a week").sort()).toEqual(["Harvard Quiet Readers", "Harvard Weekly Chess"]);
  });
});

describe("review fixes (round 4)", () => {
  it("another sense demotes only for the ambiguous typed word, not 'desi'", () => {
    expect(names("desi")[0]).toBe("Harvard Desi Heritage Circle");
    // Under a constraint the club is a full match, not a passing mention that gets dropped.
    expect(names("desi no dues")).toContain("Harvard Desi Heritage Circle");
    expect(names("south asian")).toContain("Harvard Desi Heritage Circle");
  });

  it("'comp lit' / 'comp bio' are subjects, not the process word", () => {
    expect(names("comp lit")).toEqual(["Harvard Comparative Literature Society"]);
    expect(names("comp bio")).toEqual(["Harvard Computational Biology Society"]);
    expect(names("comp lit")).not.toContain("Glee Club Lite");
    expect(run("comp lit").process).toEqual([]);
  });

  it("an hours range after a lead ('under 3-5 hours') leaves no text behind", () => {
    for (const q of ["under 3-5 hours", "up to 3 to 5 hours a week"])
      expect(interpretQuery(q)).toMatchObject({ text: "", constraints: [{ filter: "maxHours", value: 5 }] });
  });

  it("'deadline this week' and 'applications due' are process phrases, not text", () => {
    const r = run("deadline this week");
    expect(r.searchedText).toBe("");
    before(
      r.clubs.map((c) => c.name),
      "Harvard Investment Association",
      "Harvard Later Deadline Group",
    );
    const due = run("applications due");
    expect(due.searchedText).toBe("");
    expect(due.process).toEqual(["applications", "due"]);
    expect(due.clubs.map((c) => c.name)).toContain("Harvard Undergraduate Consulting Group");
    expect(due.clubs.map((c) => c.name)).not.toContain("Harvard Real Estate Review");
  });

  it("the exact process asked for leads: tryout clubs for 'tryouts', audition clubs for 'auditions'", () => {
    expect(names("tryouts")[0]).toBe("Harvard Club Rugby");
    expect(names("auditions")[0]).toBe("Harvard Ballet Company");
  });

  it("'Latin America' among a club's activities isn't Latino; in its name it is", () => {
    expect(names("latino")).not.toContain("Harvard Model Congress");
    expect(names("latino")).toContain("Harvard Organization for Latin America");
  });
});
