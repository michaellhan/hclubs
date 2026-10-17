import { describe, expect, it } from "vitest";
import { normalizeName } from "@hci/core/browser";
import { ClubFilters, NO_JOINING_FACTS, searchLocal, type IndexClub } from "../src/local";

/**
 * "writing" (persona round 8, 2026-10-17): the Creative Writing Collective, named for the word,
 * ranked behind newspapers lifted by their one-liner ("student newspaper", `Concept.kinds`).
 * Hand-made index; descriptions invented.
 */
let n = 0;
function club(name: string, shortDescription: string, categorySlugs: string[] = []): IndexClub {
  const slug = normalizeName(name).replace(/ /g, "-");
  return {
    id: `sp-${++n}`,
    slug,
    name,
    acronym: null,
    shortDescription,
    orgType: null,
    recognitionStatus: "recognized",
    activityStatus: "active",
    joinModes: [],
    freshmenEligible: null,
    joining: NO_JOINING_FACTS,
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
    categorySlugs,
    categories: categorySlugs.map((slug) => ({ slug, name: slug, isPrimary: true })),
    recruitingSeasons: [],
  };
}

const PUB = ["publications-media"];
const CLUBS = [
  club("Harvard Undergraduate Creative Writing Collective", "Workshops for fiction and poetry.", PUB),
  club("The Harvard Weekly", "Student newspaper with weekly print issues and writing for every section.", PUB),
  club("Harvard Daily Bulletin", "Student newspaper publishing every weekday morning.", PUB),
];
const NOW = new Date("2026-10-17T16:00:00Z");
const names = (text: string) =>
  searchLocal(CLUBS, {
    text,
    filters: ClubFilters.parse({}),
    sort: "relevance",
    offset: 0,
    limit: 50,
    now: NOW,
  }).clubs.map((c) => c.name);

describe("a club named for a broad topic word leads it", () => {
  it("'writing' and 'writers': the Creative Writing Collective first, the newspapers after", () => {
    for (const q of ["writing", "writers", "writing club"]) {
      const got = names(q);
      expect(got[0], q).toBe("Harvard Undergraduate Creative Writing Collective");
      expect(got, q).toContain("The Harvard Weekly");
    }
  });
  it("'newspaper' and 'journalism' still lead with the newspapers, whatever the word order", () => {
    for (const q of ["newspaper", "journalism"])
      expect(names(q).slice(0, 2), q).not.toContain("Harvard Undergraduate Creative Writing Collective");
    for (const q of ["writing for a newspaper", "writing journalism", "newspaper writing"])
      expect(names(q)[0], q).not.toBe("Harvard Undergraduate Creative Writing Collective");
  });
});

describe("music production and DJing (persona round 8)", () => {
  const clubs = [
    club("Harvard Undergraduate Electronic Music Collective", "", ["music"]),
    club("Harvard Campus Radio", "Student radio station broadcasting live shows.", ["publications-media"]),
    club("Harvard Chamber Orchestra", "Student orchestra playing classical repertoire.", ["music"]),
    club("Harvard Music Business Association", "Careers in the music industry.", ["pre-professional"]),
  ];
  const first = (text: string) =>
    searchLocal(clubs, { text, filters: ClubFilters.parse({}), sort: "relevance", offset: 0, limit: 10, now: NOW })
      .clubs[0]?.name;
  it.each(["dj", "djing", "edm", "beats", "making beats", "music production", "music producer", "produce music"])(
    "'%s' leads with the Electronic Music Collective",
    (q) => expect(first(q)).toBe("Harvard Undergraduate Electronic Music Collective"),
  );
});

describe("'stem' is the fields, not stem cells (persona round 8)", () => {
  const clubs = [
    club("Harvard College Stem Cell Society", "Talks on regenerative biology.", ["academic-stem"]),
    club("Harvard Science Olympiad", "Science research competitions for students.", ["academic-stem"]),
  ];
  const got = (text: string) =>
    searchLocal(clubs, {
      text,
      filters: ClubFilters.parse({}),
      sort: "relevance",
      offset: 0,
      limit: 10,
      now: NOW,
    }).clubs.map((c) => c.name);
  it("'stem' leads with a science club, not the Stem Cell Society by name", () => {
    expect(got("stem")[0]).toBe("Harvard Science Olympiad");
  });
  it("'stem cell' still finds the Stem Cell Society first", () => {
    expect(got("stem cell")[0]).toBe("Harvard College Stem Cell Society");
  });
});

describe("visual arts (persona round 8)", () => {
  const clubs = [
    club("Harvard Undergraduate Creative Writing Collective", "Workshops for fiction and poetry.", [
      "publications-media",
    ]),
    club("Harvard Arts & Crafts Club", "Weekly painting and pottery nights.", ["arts"]),
    club("Harvard Faith Forum", "Reading scripture together.", ["religious"]),
  ];
  const got = (text: string) =>
    searchLocal(clubs, {
      text,
      filters: ClubFilters.parse({}),
      sort: "relevance",
      offset: 0,
      limit: 10,
      now: NOW,
    }).clubs.map((c) => c.name);
  it("'painting' doesn't reach a creative writing group", () => {
    expect(got("painting")).toEqual(["Harvard Arts & Crafts Club"]);
  });
  it("'sculpture' is an art word, never corrected to 'scripture'", () => {
    expect(got("sculpture")).not.toContain("Harvard Faith Forum");
    expect(got("sculpture")[0]).toBe("Harvard Arts & Crafts Club");
  });
});

describe("under a constraint, an activity-list word beside a category isn't a match (persona round 8)", () => {
  const noComp = { ...NO_JOINING_FACTS, comp: false };
  const clubs = [
    club("Harvard Undergraduate Creative Writing Collective", "Workshops for fiction and poetry.", [
      "publications-media",
    ]),
    {
      ...club("Harvard Tuesday Review", "Prints creative writing each week.", ["publications-media"]),
      joining: noComp,
    },
    {
      ...club("Harvard Ad Board", "Sells advertising for student papers.", ["publications-media"]),
      searchTopics: "creative campaigns sales",
      joining: noComp,
    },
  ];
  it("'creative writing no comp' keeps the review, not the ad board", () => {
    const r = searchLocal(clubs, {
      text: "creative writing no comp",
      filters: ClubFilters.parse({}),
      sort: "relevance",
      offset: 0,
      limit: 10,
      now: NOW,
    });
    expect(r.clubs.map((c) => c.name)).toEqual(["Harvard Tuesday Review"]);
  });
});

describe("how seriously: 'serious', 'intense', 'rigorous' never empty the list (persona round 8)", () => {
  const clubs = [club("Harvard Computer Society", "Student software projects and talks.", ["technology"])];
  it.each(["serious computer society", "intense computer society", "rigorous computer society"])("%s", (q) => {
    const r = searchLocal(clubs, {
      text: q,
      filters: ClubFilters.parse({}),
      sort: "relevance",
      offset: 0,
      limit: 5,
      now: NOW,
    });
    expect(r.clubs.map((c) => c.name)).toEqual(["Harvard Computer Society"]);
  });
});

describe("film (persona round 8)", () => {
  const clubs = [
    club("Harvard Undergraduate Film Club", "", ["hobbies-games"]),
    {
      ...club("Harvard Beekeepers", "Keeping campus hives.", ["hobbies-games"]),
      searchTopics: "honey tastings film screenings",
    },
    club("Harvard Video Game Development Club", "Students build games together.", ["technology"]),
  ];
  const got = (text: string) =>
    searchLocal(clubs, {
      text,
      filters: ClubFilters.parse({}),
      sort: "relevance",
      offset: 0,
      limit: 5,
      now: NOW,
    }).clubs.map((c) => c.name);
  it.each(["film", "movies", "filmmaking"])("'%s' is the film club alone, not screenings or video games", (q) => {
    expect(got(q)).toEqual(["Harvard Undergraduate Film Club"]);
  });
});
