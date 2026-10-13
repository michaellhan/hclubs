import { describe, expect, it } from "vitest";
import { normalizeName } from "@hci/core/browser";
import {
  ClubFilters,
  INTENTS,
  interpretQuery,
  isGraduateGroup,
  matchesIntent,
  NO_JOINING_FACTS,
  paceWords,
  readsAsBrowse,
  reasonText,
  searchLocal,
  type IndexClub,
} from "../src/local";

/**
 * Round-14 ranking from student testing round 7 (2026-10-13; persona round 7: an international
 * first-year from India and an athlete; CLAUDE.md §13 "Round 14"). Two hand-made indexes
 * (descriptions invented): `STUDENT` (dance forms, graduate chapters, topics, browse list, time
 * in a club's own words, free clubs) and `PERSONA` (commitment words, soccer and intramurals,
 * dance forms, graduate one-liners, career networks).
 */
const NOW = new Date("2026-10-13T16:00:00Z");
const J = NO_JOINING_FACTS;
let n = 0;
const cat = (slug: string, name = slug) => ({ slug, name, isPrimary: false });

function club(name: string, over: Partial<IndexClub> = {}): IndexClub {
  const cats = over.categories ?? [];
  const slug = normalizeName(name).replace(/ /g, "-");
  return {
    id: `r14-${++n}`,
    slug,
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
    quickLinks: { website: `https://${slug}.invalid`, instagram: null },
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

const sports = [cat("athletics-recreation", "Sports & Recreation")];
const dance = [cat("performing-arts", "Performing Arts"), cat("dance", "Dance")];
const music = [cat("performing-arts", "Performing Arts"), cat("music", "Music")];
const cultural = [cat("cultural-identity", "Cultural & Identity")];
const service = [cat("public-service", "Public Service")];
const open = { ...J, access: "open" as const, general: ["open" as const] };

type Sort = "relevance" | "popularity";
function searcher(clubs: IndexClub[]) {
  const search = (text: string | null, filters: Partial<ClubFilters> = {}, sort: Sort = "relevance") =>
    searchLocal(clubs, {
      text,
      filters: { ...ClubFilters.parse({}), ...filters },
      sort,
      offset: 0,
      limit: 100,
      now: NOW,
    });
  const names = (text: string | null, filters: Partial<ClubFilters> = {}, sort: Sort = "relevance") =>
    search(text, filters, sort).clubs.map((c) => c.name);
  const byName = (name: string) => clubs.find((c) => c.name === name)!;
  return { search, names, byName };
}
const before = (list: string[], a: string, b: string) => {
  expect(list).toContain(a);
  expect(list).toContain(b);
  expect(list.indexOf(a)).toBeLessThan(list.indexOf(b));
};
const intent = (slug: string) => INTENTS.find((i) => i.slug === slug)!;

// ---------------------------------------------------------------------------------------------
// Student testing round 7 (the international first-year).

const STUDENT: IndexClub[] = [
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
  club("Harvard College Latines in Health Careers", {
    categories: [...cultural, cat("medicine-health", "Health & Medicine")],
    shortDescription: "Community for Latine students pursuing careers in health.",
    joining: open,
    instagramFollowers: 25000,
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
const A = searcher(STUDENT);

describe("dance forms, student round 7 (Round 14)", () => {
  it("'bollywood' is South Asian dance first, then the associations; never other dance", () => {
    const got = A.names("bollywood");
    before(got, "Harvard Undergraduate Bhangra", "Harvard South Asian Association");
    before(got, "Harvard Undergraduate Deepam", "Harvard South Asian Association");
    before(got, "Harvard Undergraduate Ghungroo", "Harvard College Pakistani Students Association");
    // Tap is another dance form; the powwow troupe is another sense of "Indian".
    expect(got).not.toContain("Harvard Undergraduate Tap Company");
    expect(got).not.toContain("The Harvard Intertribal Indian Dance Troupe");
  });

  it("'classical dance' reaches ballet and Bharatanatyam, not other dance", () => {
    const got = A.names("classical dance");
    expect(got).toEqual(expect.arrayContaining(["The Harvard Ballet Company", "Harvard Undergraduate Deepam"]));
    expect(got).not.toContain("Harvard Undergraduate Tap Company");
    // Kathak: no club says it; the South Asian dance groups are the nearest answer.
    expect(A.names("kathak").slice(0, 3)).toEqual(
      expect.arrayContaining(["Harvard Undergraduate Bhangra", "Harvard Undergraduate Deepam"]),
    );
    // A form a club says still finds that club alone.
    expect(A.names("bharatanatyam")).toEqual(["Harvard Undergraduate Deepam"]);
  });

  it("'south asian' still finds the associations by name first", () => {
    expect(A.names("south asian")[0]).toBe("Harvard South Asian Association");
  });
});

describe("graduate chapters and topics, student round 7 (Round 14)", () => {
  it("a club whose one-liner opens as a graduate school's chapter is hidden like graduate-scope clubs", () => {
    const hcssa = "Harvard Chinese Students & Scholars Association";
    expect(A.names("", { stillTime: true })).not.toContain(hcssa);
    expect(A.names("", { intent: "cultural-community" })).not.toContain(hcssa);
    expect(A.names("", { intent: "meet-people" })).not.toContain(hcssa);
    expect(A.names("")).not.toContain(hcssa);
    // Shown with graduate groups, and a search for its name still finds it.
    expect(A.names("", { includeGraduate: true })).toContain(hcssa);
    // (Hidden clubs answer a phrase of their name, as graduate-scope clubs always have.)
    expect(A.names("chinese students and scholars")).toContain(hcssa);
  });

  it("Cultural & identity puts broad groups before career-filed ones; a women's career network leaves", () => {
    const got = A.names("", { intent: "cultural-community", stillTime: true });
    before(got, "Harvard Undergraduate Philippine Forum", "Harvard College Latines in Health Careers");
    expect(got).not.toContain("Harvard Undergraduate Women in Business");
  });

  it("Volunteer leaves out a career club with only a side service category", () => {
    const got = A.names("", { intent: "volunteer" });
    expect(got).toContain("PBHA's Youth Recreation Program- HOOPs");
    expect(got).not.toContain("Harvard Undergraduate Economics Association");
  });
});

describe("browse list (Round 14)", () => {
  it("a question with nothing to search reads as browsing, so name-only clubs hide as with no text", () => {
    expect(readsAsBrowse(STUDENT, "how do i join")).toBe(true);
    expect(readsAsBrowse(STUDENT, "no comp")).toBe(true);
    expect(readsAsBrowse(STUDENT, "")).toBe(true);
    expect(readsAsBrowse(STUDENT, "dance")).toBe(false);
    expect(readsAsBrowse(STUDENT, "low commitment")).toBe(false);
    const browse = A.search("", { hideSparse: true }).total;
    expect(A.search("how do i join", { hideSparse: true }).total).toBe(browse);
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
    expect(paceWords(["Join us for days of service around Boston."])).toEqual(["days of service"]);
  });

  it("'no weekly meetings' never lifts a weekly club; monthly ones lead", () => {
    const r = A.search("no weekly meetings");
    expect(r.soft).toEqual(["no weekly meetings"]);
    expect(r.clubs.map((c) => c.name)).not.toContain("Harvard Chess Club");
    expect(r.clubs[0]!.name).toBe("PBHA's Best Buddies");
    for (const q of ["not weekly", "no regular meetings"]) expect(A.names(q)).not.toContain("Harvard Chess Club");
  });

  it("'flexible' and 'low commitment' find clubs saying so in their own words", () => {
    expect(A.names("flexible")).toContain("PBHA's Elderly 1-2-1");
    const r = A.search("low commitment service");
    // The two clubs saying it in their own words lead ("low-commitment", "at their own convenience").
    const top = r.clubs.slice(0, 2);
    expect(top.map((c) => c.name).sort()).toEqual(["PBHA's Elderly 1-2-1", "PBHA's Youth Recreation Program- HOOPs"]);
    const hoops = top.find((c) => c.name.includes("HOOPs"))!;
    expect(r.reasons[hoops.id]!.map(reasonText)).toContain("Description mentions “low commitment”");
    before(
      A.names("low commitment service"),
      "PBHA's Youth Recreation Program- HOOPs",
      "Small Claims Advisory Service",
    );
  });
});

describe("free clubs (Round 14)", () => {
  it("clubs naming another cost follow clubs that cost nothing", () => {
    const r = A.search("free clubs");
    expect(r.constraints.map((c) => c.filter)).toEqual(["noDues"]);
    before(
      r.clubs.map((c) => c.name),
      "Harvard Free Club",
      "Harvard Uniform Club",
    );
  });
});

// ---------------------------------------------------------------------------------------------
// Persona round 7 (the athlete and the international first-year).

const PERSONA: IndexClub[] = [
  // Soccer and intramurals
  club("Harvard Men's Soccer Club", { categories: sports, orgType: "club_sport", instagramFollowers: 900 }),
  club("Harvard Futsal Club", {
    categories: sports,
    orgType: "club_sport",
    shortDescription: "Harvard club sports team for futsal.",
  }),
  club("Afterschool Sports Program", {
    categories: service,
    orgType: "public_service_program",
    shortDescription: "Volunteers run games for elementary schoolers.",
    searchTopics: "soccer basketball",
    instagramFollowers: 5000,
  }),
  club("Tennis (Club Sport)", { categories: sports, orgType: "club_sport" }),
  club("Harvard Undergraduate Sports Lab", {
    categories: [cat("pre-professional", "Pre-professional"), ...sports],
    shortDescription: "Student community for undergraduates pursuing sports business careers.",
    instagramFollowers: 3000,
  }),
  club("Harvard Sports Analysis Collective", {
    categories: [cat("academic-stem", "Academic & Research"), ...sports],
    shortDescription: "Student-run group analyzing sports strategy quantitatively.",
    instagramFollowers: 3000,
  }),
  club("Athlete Ally", {
    categories: [cat("political-advocacy", "Politics & Policy")],
    shortDescription: "Advocacy for LGBTQ+ inclusion in athletics.",
  }),
  club("Harvard Undergraduate Kaizen Club", {
    categories: [...sports, cat("social", "Social & Community")],
    shortDescription: "Community for Saturday runs along the river.",
    instagramFollowers: 4000,
  }),
  // Dance
  club("Harvard Undergraduate Bhangra", {
    categories: dance,
    shortDescription: "Dance team performing traditional Punjabi bhangra blended with hip hop.",
  }),
  club("Harvard Undergraduate Deepam", {
    categories: [...cultural, ...dance],
    shortDescription: "Performs Bharatanatyam.",
  }),
  club("Harvard Undergraduate Ghungroo", {
    categories: dance,
    shortDescription: "Annual spring show of dance, music, and drama celebrating South Asian culture.",
  }),
  club("Harvard South Asian Association", { categories: cultural, instagramFollowers: 2000 }),
  club("South Asian Business Association", {
    categories: [cat("pre-professional", "Pre-professional")],
    instagramFollowers: 3000,
  }),
  club("The Harvard Ballet Company", {
    categories: dance,
    shortDescription: "Student-run company performing classical ballet, contemporary and modern dance.",
  }),
  club("The Harvard Ballet Folklorico de Aztlan", {
    categories: dance,
    shortDescription: "Undergraduate dance group celebrating Mexican heritage through traditional dances.",
  }),
  club("Harvard Pops Orchestra", {
    categories: music,
    shortDescription: "Student orchestra combining classical and pops repertoire.",
  }),
  // Commitment
  club("Harvard Strategy Society", {
    categories: [cat("hobbies-games", "Hobbies & Games")],
    shortDescription: "Chess club with weekly meetings and tournaments.",
    instagramFollowers: 800,
  }),
  club("Knights Collective", {
    categories: [cat("hobbies-games", "Hobbies & Games")],
    shortDescription: "Casual chess games for players of all strengths.",
  }),
  club("PBHA's Experimentors", {
    categories: [cat("mentoring-education", "Mentoring & Education")],
    categorySlugs: ["public-service", "mentoring-education"],
    orgType: "public_service_program",
    shortDescription: "Program where students run science experiments with kids.",
    hoursPerWeek: { min: 2, max: 3 },
  }),
  club("PBHA Tutoring Program", {
    categories: [cat("mentoring-education", "Mentoring & Education")],
    categorySlugs: ["public-service", "mentoring-education"],
    orgType: "public_service_program",
    shortDescription: "Program pairing students with kids after school.",
    instagramFollowers: 6000,
  }),
  club("Global Health Society", {
    categories: [cat("pre-professional"), cat("medicine-health"), cat("mentoring-education")],
    categorySlugs: ["pre-professional", "medicine-health", "public-service", "mentoring-education"],
    shortDescription: "Society for students interested in global health careers.",
    hoursPerWeek: { min: 1, max: 1 },
  }),
  // Cultural & identity
  club("Harvard Undergraduate Women in Business", {
    categories: [cat("pre-professional", "Pre-professional"), ...cultural],
    shortDescription: "Undergraduate group that aims to empower young women through business education.",
  }),
  club("Harvard College Latinos in Health Careers", {
    categories: [...cultural, cat("medicine-health", "Health & Medicine")],
    shortDescription: "Community for Latino students pursuing careers in health.",
  }),
  club("Harvard Vietnamese Association", {
    categories: cultural,
    shortDescription: "Cultural community for Vietnamese and Vietnamese American students.",
    joining: open,
  }),
  // A graduate chapter whose scope no source states
  club("Harvard Chinese Students and Scholars Association", {
    categories: cultural,
    affiliationScope: "unknown",
    shortDescription: "Graduate School of Arts and Sciences chapter serving Chinese students and scholars.",
    joining: open,
  }),
  club("Harvard Pre-Law Society", {
    categories: [cat("pre-professional", "Pre-professional")],
    affiliationScope: "unknown",
    shortDescription: "Undergraduate group preparing students for law school and graduate school applications.",
    joining: open,
  }),
];
const B = searcher(PERSONA);

describe("commitment words are read, not searched (Round 14)", () => {
  it("'no weekly meetings', 'flexible', 'one day' are commitment words, never required text", () => {
    for (const [q, phrase] of [
      ["no weekly meetings", "no weekly meetings"],
      ["flexible", "flexible"],
      ["service one day", "one day"],
      ["chess no weekly meetings", "no weekly meetings"],
      ["clubs that dont meet weekly", "dont meet weekly"],
    ] as const) {
      const r = interpretQuery(q);
      expect(r.soft.map((s) => [s.phrase, s.modifier.key])).toEqual([[phrase, "commitment"]]);
      expect(r.negated).toEqual([]);
      expect(r.text).not.toMatch(/weekly|flexible|one day/);
    }
  });

  it("beside a topic, a club saying it meets weekly follows one that doesn't", () => {
    const r = B.names("chess no weekly meetings");
    before(r, "Knights Collective", "Harvard Strategy Society");
    // Plain "chess" ranks the bigger club first: only the negation moved it.
    before(B.names("chess"), "Harvard Strategy Society", "Knights Collective");
  });

  it("alone, they select clubs that say they take little time", () => {
    for (const q of ["no weekly meetings", "flexible"]) {
      const r = B.names(q);
      expect(r).toContain("PBHA's Experimentors");
      expect(r).not.toContain("Harvard Strategy Society");
    }
  });

  it("low commitment service: a service program stating few hours leads; a society filed elsewhere stays slight", () => {
    for (const q of ["low commitment service", "service one day", "volunteer low commitment"]) {
      const r = B.names(q);
      before(r, "PBHA's Experimentors", "PBHA Tutoring Program");
      before(r, "PBHA's Experimentors", "Global Health Society");
    }
  });
});

describe("sports words (Round 14)", () => {
  it("soccer reaches Futsal, after the club named for it", () => {
    const r = B.names("soccer");
    expect(r[0]).toBe("Harvard Men's Soccer Club");
    // A service program listing soccer among its games is a passing mention, outside sports.
    expect(r).toContain("Harvard Futsal Club");
    expect(r).not.toContain("Afterschool Sports Program");
    expect(B.names("futbol")).toContain("Harvard Futsal Club");
  });

  it("intramurals list clubs where students play, club sports first; not sports business or analytics", () => {
    for (const q of ["intramural", "intramurals", "intramural sports", "rec sports"]) {
      const r = B.names(q);
      expect(r).toEqual(expect.arrayContaining(["Tennis (Club Sport)", "Harvard Futsal Club"]));
      before(r, "Tennis (Club Sport)", "Harvard Undergraduate Kaizen Club");
      for (const x of ["Harvard Undergraduate Sports Lab", "Harvard Sports Analysis Collective", "Athlete Ally"])
        expect(r).not.toContain(x);
    }
  });
});

describe("dance forms, persona round 7 (Round 14)", () => {
  it("bollywood: South Asian dance groups first, then the community's groups; no ballet", () => {
    const r = B.names("bollywood");
    for (const d of ["Harvard Undergraduate Bhangra", "Harvard Undergraduate Deepam"]) {
      before(r, d, "Harvard South Asian Association");
      before(r, d, "South Asian Business Association");
    }
    before(r, "Harvard Undergraduate Ghungroo", "South Asian Business Association");
    expect(r).not.toContain("The Harvard Ballet Company");
  });

  it("classical dance: ballet and Bharatanatyam, not folk ballet or a classical orchestra", () => {
    const r = B.names("classical dance");
    expect(r).toEqual(expect.arrayContaining(["The Harvard Ballet Company", "Harvard Undergraduate Deepam"]));
    expect(r).not.toContain("The Harvard Ballet Folklorico de Aztlan");
    expect(r).not.toContain("Harvard Pops Orchestra");
    expect(r).not.toContain("Harvard Undergraduate Bhangra");
  });
});

describe("graduate chapters and career networks, persona round 7 (Round 14)", () => {
  it("a one-liner opening with a graduate school's chapter is a graduate group; a mention isn't", () => {
    expect(isGraduateGroup(B.byName("Harvard Chinese Students and Scholars Association"))).toBe(true);
    expect(isGraduateGroup(B.byName("Harvard Pre-Law Society"))).toBe(false);
    expect(isGraduateGroup({ affiliationScope: "harvard_college", shortDescription: "Graduate student group." })).toBe(
      false,
    );
    expect(
      isGraduateGroup({ affiliationScope: "unknown", shortDescription: "Graduate-student group on policy." }),
    ).toBe(true);
  });

  it("stays out of Still time to join and the default list, and answers a search for its name", () => {
    expect(B.names(null, { stillTime: true }, "popularity")).not.toContain(
      "Harvard Chinese Students and Scholars Association",
    );
    expect(B.names(null, { stillTime: true }, "popularity")).toContain("Harvard Pre-Law Society");
    expect(B.names(null, { stillTime: true, includeGraduate: true }, "popularity")).toContain(
      "Harvard Chinese Students and Scholars Association",
    );
    expect(B.names("chinese students and scholars association")[0]).toBe(
      "Harvard Chinese Students and Scholars Association",
    );
  });

  it("Women in Business isn't a Cultural & identity or Meet people pick; a community's career group is", () => {
    const wib = B.byName("Harvard Undergraduate Women in Business");
    expect(matchesIntent(wib, intent("cultural-community"))).toBe(false);
    expect(matchesIntent(wib, intent("meet-people"))).toBe(false);
    expect(matchesIntent(B.byName("Harvard College Latinos in Health Careers"), intent("cultural-community"))).toBe(
      true,
    );
    expect(matchesIntent(B.byName("Harvard Vietnamese Association"), intent("cultural-community"))).toBe(true);
    // Still found by searching for it.
    expect(B.names("women in business")[0]).toBe("Harvard Undergraduate Women in Business");
  });

  it("Sports topic under Best match: club sports first", () => {
    const r = B.names(null, { intent: "play-a-sport" }, "relevance");
    before(r, "Tennis (Club Sport)", "Harvard Undergraduate Kaizen Club");
  });
});
