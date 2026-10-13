import { describe, expect, it } from "vitest";
import { normalizeName } from "@hci/core/browser";
import {
  ClubFilters,
  INTENTS,
  interpretQuery,
  isGraduateGroup,
  matchesIntent,
  NO_JOINING_FACTS,
  searchLocal,
  type IndexClub,
} from "../src/local";

/**
 * Round-14 ranking from persona round 7 (2026-10-13; CLAUDE.md §13 "Round 8"): an athlete's
 * "no weekly meetings", "flexible" and "service one day" read as commitment words, not text;
 * "soccer" reaches Futsal; "intramural" lists clubs where students play; an international
 * first-year's "bollywood" and "classical dance" reach the dance groups; a graduate chapter
 * saying so in its one-liner stays out of Still time to join; Women in Business isn't a
 * Cultural & identity community. Hand-made index; descriptions invented.
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

const CLUBS: IndexClub[] = [
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

const search = (
  text: string | null,
  filters: Partial<ClubFilters> = {},
  sort: "relevance" | "popularity" = "relevance",
) =>
  searchLocal(CLUBS, {
    text,
    filters: { ...ClubFilters.parse({}), ...filters },
    sort,
    offset: 0,
    limit: 100,
    now: NOW,
  });
const names = (
  text: string | null,
  filters: Partial<ClubFilters> = {},
  sort: "relevance" | "popularity" = "relevance",
) => search(text, filters, sort).clubs.map((c) => c.name);
const before = (list: string[], a: string, b: string) => {
  expect(list).toContain(a);
  expect(list).toContain(b);
  expect(list.indexOf(a)).toBeLessThan(list.indexOf(b));
};
const byName = (name: string) => CLUBS.find((c) => c.name === name)!;
const intent = (slug: string) => INTENTS.find((i) => i.slug === slug)!;

describe("commitment words are read, not searched (round 14)", () => {
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
    const r = names("chess no weekly meetings");
    before(r, "Knights Collective", "Harvard Strategy Society");
    // Plain "chess" ranks the bigger club first: only the negation moved it.
    before(names("chess"), "Harvard Strategy Society", "Knights Collective");
  });

  it("alone, they select clubs that say they take little time", () => {
    for (const q of ["no weekly meetings", "flexible"]) {
      const r = names(q);
      expect(r).toContain("PBHA's Experimentors");
      expect(r).not.toContain("Harvard Strategy Society");
    }
  });

  it("low commitment service: a service program stating few hours leads; a society filed elsewhere stays slight", () => {
    for (const q of ["low commitment service", "service one day", "volunteer low commitment"]) {
      const r = names(q);
      before(r, "PBHA's Experimentors", "PBHA Tutoring Program");
      before(r, "PBHA's Experimentors", "Global Health Society");
    }
  });
});

describe("sports words (round 14)", () => {
  it("soccer reaches Futsal, after the club named for it", () => {
    const r = names("soccer");
    expect(r[0]).toBe("Harvard Men's Soccer Club");
    // A service program listing soccer among its games is a passing mention, outside sports.
    expect(r).toContain("Harvard Futsal Club");
    expect(r).not.toContain("Afterschool Sports Program");
    expect(names("futbol")).toContain("Harvard Futsal Club");
  });

  it("intramurals list clubs where students play, club sports first; not sports business or analytics", () => {
    for (const q of ["intramural", "intramurals", "intramural sports", "rec sports"]) {
      const r = names(q);
      expect(r).toEqual(expect.arrayContaining(["Tennis (Club Sport)", "Harvard Futsal Club"]));
      before(r, "Tennis (Club Sport)", "Harvard Undergraduate Kaizen Club");
      for (const x of ["Harvard Undergraduate Sports Lab", "Harvard Sports Analysis Collective", "Athlete Ally"])
        expect(r).not.toContain(x);
    }
  });
});

describe("dance forms (round 14)", () => {
  it("bollywood: South Asian dance groups first, then the community's groups; no ballet", () => {
    const r = names("bollywood");
    for (const d of ["Harvard Undergraduate Bhangra", "Harvard Undergraduate Deepam"]) {
      before(r, d, "Harvard South Asian Association");
      before(r, d, "South Asian Business Association");
    }
    before(r, "Harvard Undergraduate Ghungroo", "South Asian Business Association");
    expect(r).not.toContain("The Harvard Ballet Company");
  });

  it("classical dance: ballet and Bharatanatyam, not folk ballet or a classical orchestra", () => {
    const r = names("classical dance");
    expect(r).toEqual(expect.arrayContaining(["The Harvard Ballet Company", "Harvard Undergraduate Deepam"]));
    expect(r).not.toContain("The Harvard Ballet Folklorico de Aztlan");
    expect(r).not.toContain("Harvard Pops Orchestra");
    expect(r).not.toContain("Harvard Undergraduate Bhangra");
  });
});

describe("graduate chapters and career networks (round 14)", () => {
  it("a one-liner opening with a graduate school's chapter is a graduate group; a mention isn't", () => {
    expect(isGraduateGroup(byName("Harvard Chinese Students and Scholars Association"))).toBe(true);
    expect(isGraduateGroup(byName("Harvard Pre-Law Society"))).toBe(false);
    expect(isGraduateGroup({ affiliationScope: "harvard_college", shortDescription: "Graduate student group." })).toBe(
      false,
    );
    expect(
      isGraduateGroup({ affiliationScope: "unknown", shortDescription: "Graduate-student group on policy." }),
    ).toBe(true);
  });

  it("stays out of Still time to join and the default list, and answers a search for its name", () => {
    expect(names(null, { stillTime: true }, "popularity")).not.toContain(
      "Harvard Chinese Students and Scholars Association",
    );
    expect(names(null, { stillTime: true }, "popularity")).toContain("Harvard Pre-Law Society");
    expect(names(null, { stillTime: true, includeGraduate: true }, "popularity")).toContain(
      "Harvard Chinese Students and Scholars Association",
    );
    expect(names("chinese students and scholars association")[0]).toBe(
      "Harvard Chinese Students and Scholars Association",
    );
  });

  it("Women in Business isn't a Cultural & identity or Meet people pick; a community's career group is", () => {
    const wib = byName("Harvard Undergraduate Women in Business");
    expect(matchesIntent(wib, intent("cultural-community"))).toBe(false);
    expect(matchesIntent(wib, intent("meet-people"))).toBe(false);
    expect(matchesIntent(byName("Harvard College Latinos in Health Careers"), intent("cultural-community"))).toBe(true);
    expect(matchesIntent(byName("Harvard Vietnamese Association"), intent("cultural-community"))).toBe(true);
    // Still found by searching for it.
    expect(names("women in business")[0]).toBe("Harvard Undergraduate Women in Business");
  });

  it("Sports topic under Best match: club sports first", () => {
    const r = names(null, { intent: "play-a-sport" }, "relevance");
    before(r, "Tennis (Club Sport)", "Harvard Undergraduate Kaizen Club");
  });
});
