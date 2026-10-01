import { describe, expect, it } from "vitest";
import { normalizeName } from "@hci/core";
import {
  CONCEPTS,
  ClubFilters,
  INTENTS,
  matchesIntent,
  matchesOpenJoin,
  parseQuery,
  passesFilters,
  searchLocal,
  similarClubs,
  type IndexClub,
} from "../src/local";

/**
 * Discovery (ADR 0034): search relevance, synonyms, typo handling, presets, intents and
 * similar clubs, on small hand-made index rows (no database).
 */
const NOW = new Date("2026-10-01T16:00:00Z");
let n = 0;

function club(name: string, over: Partial<IndexClub> & { aliases?: string[] } = {}): IndexClub {
  const { aliases = [], ...rest } = over;
  const id = `c${++n}`;
  return {
    id,
    slug: normalizeName(name).replace(/ /g, "-"),
    name,
    acronym: null,
    shortDescription: null,
    orgType: null,
    recognitionStatus: "recognized",
    activityStatus: "active",
    joinModes: [],
    freshmenEligible: null,
    categories: [],
    memberCount: null,
    hoursPerWeek: null,
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
    searchNames: [name, ...aliases].map(normalizeName).join(" | "),
    searchAcronyms: over.acronym ? [over.acronym.toLowerCase()] : [],
    searchTopics: "",
    categorySlugs: (over.categories ?? []).map((c) => c.slug),
    recruitingSeasons: [],
    ...rest,
  };
}
const cat = (slug: string, name = slug) => ({ slug, name, isPrimary: false });

const CLUBS = [
  club("Harvard Computer Society", {
    acronym: "HCS",
    shortDescription: "Student-run computer science community offering coding workshops.",
    categories: [cat("technology", "Technology & Engineering")],
  }),
  club("Harvard Undergraduate Quantum Computing Association", {
    acronym: "HUQCA",
    shortDescription: "Talks on quantum information science.",
  }),
  club("Harvard Undergraduate Quantitative Traders", {
    shortDescription: "Mentorship for careers in quantitative finance and trading.",
    categories: [cat("finance", "Finance & Investing")],
  }),
  club("Harvard Crimson", {
    shortDescription: "Student newspaper publishing every weekday morning.",
    categories: [cat("publications-media", "Publications & Media")],
  }),
  club("The Crimson: Business Board", { shortDescription: "Advertising and strategy for the newspaper." }),
  club("Harvard Undergraduate Tuesday Magazine", {
    shortDescription: "Creative writing and art by students.",
    categories: [cat("publications-media", "Publications & Media")],
  }),
  club("PBHA's Chinatown ESL Program", {
    shortDescription: "Volunteer English tutoring for Chinatown adults.",
    categories: [cat("public-service", "Public Service")],
  }),
  club("Work Force Tutoring", {
    categories: [cat("public-service", "Public Service")],
    shortDescription: "Homework help for teens.",
  }),
  club("Radcliffe Pitches", {
    shortDescription: "Treble a cappella group singing jazz.",
    categories: [cat("performing-arts"), cat("a-cappella", "A cappella")],
    categorySlugs: ["performing-arts", "a-cappella"],
    joinModes: ["audition"],
  }),
  club("Harvard-Radcliffe Chinese Students Association", {
    acronym: "CSA",
    shortDescription: "Cultural events for Chinese students.",
  }),
  club("Harvard Undergraduate Premedical Society", {
    shortDescription: "Workshops and panels for pre-med undergraduates.",
    categories: [cat("medicine-health", "Health & Medicine")],
    aliases: ["HUPS"],
  }),
  club("Harvard Model United Nations", { shortDescription: "A conference where high school students debate." }),
  club("Harvard Chess Club", { joinModes: ["open"], categories: [cat("hobbies-games", "Hobbies & Games")] }),
  club("Harvard Undergraduate Poker Club", { noComp: true, categories: [cat("hobbies-games", "Hobbies & Games")] }),
];

const search = (text: string, f: Partial<ClubFilters> = {}) =>
  searchLocal(CLUBS, { text, filters: ClubFilters.parse(f), sort: "relevance", offset: 0, limit: 20, now: NOW });
const names = (text: string) => search(text).clubs.map((c) => c.name);

describe("search relevance", () => {
  it("finds a club by acronym, alias and full name, first", () => {
    expect(names("hcs")[0]).toBe("Harvard Computer Society");
    expect(names("csa")[0]).toBe("Harvard-Radcliffe Chinese Students Association");
    expect(names("hups")[0]).toBe("Harvard Undergraduate Premedical Society");
    expect(names("harvard crimson")[0]).toBe("Harvard Crimson");
  });

  it("ranks the club whose name is the query above clubs that merely contain it", () => {
    // "crimson" is Harvard Crimson's whole name once "Harvard" is set aside.
    expect(names("crimson").slice(0, 2)).toEqual(["Harvard Crimson", "The Crimson: Business Board"]);
  });

  it("never lets a short word stand for a longer, different one", () => {
    expect(names("quant")).toEqual(["Harvard Undergraduate Quantitative Traders"]);
    expect(names("chess")).toEqual(["Harvard Chess Club"]);
  });

  it("matches the words of a description and says so", () => {
    const r = search("weekday");
    expect(r.clubs.map((c) => c.name)).toEqual(["Harvard Crimson"]);
    expect(r.reasons[r.clubs[0]!.id]).toContainEqual({ kind: "description", word: "weekday" });
  });
});

describe("synonyms", () => {
  it("expands a concept to its categories and related words", () => {
    // Neither club says "volunteering"; one says "volunteer", both are Public Service.
    expect(names("volunteering")).toEqual(
      expect.arrayContaining(["PBHA's Chinatown ESL Program", "Work Force Tutoring"]),
    );
    expect(names("theatre")).toEqual(names("theater"));
    expect(names("newspaper")[0]).toBe("Harvard Crimson");
    expect(names("coding")[0]).toBe("Harvard Computer Society");
    expect(names("premed")[0]).toBe("Harvard Undergraduate Premedical Society");
    expect(names("model un")).toEqual(["Harvard Model United Nations"]);
    expect(names("a cappella")).toEqual(["Radcliffe Pitches"]);
  });

  it("keeps every trigger term in exactly one concept", () => {
    const seen = new Map<string, string>();
    for (const c of CONCEPTS)
      for (const t of c.terms) {
        expect(seen.get(t), `"${t}" is in ${seen.get(t)} and ${c.key}`).toBeUndefined();
        seen.set(t, c.key);
        expect(t).toBe(normalizeName(t));
      }
  });

  it("parses phrases before words and drops filler", () => {
    const q = parseQuery("harvard model united nations club");
    expect(q.units).toEqual([expect.objectContaining({ kind: "concept", phrase: "model united nations" })]);
  });
});

describe("typos", () => {
  it("corrects an unknown word to the nearest known one and reports it", () => {
    const r = search("chiense");
    expect(r.corrected).toBe("chinese");
    expect(r.clubs[0]?.name).toBe("Harvard-Radcliffe Chinese Students Association");
    expect(search("acapela").corrected).toBe("acapella");
  });

  it("leaves known words, short words and far-off words alone", () => {
    expect(search("chess").corrected).toBeNull();
    expect(search("csa").corrected).toBeNull();
    expect(search("underwater basket weaving").total).toBe(0);
  });
});

describe("filters, presets and intents", () => {
  it("open membership means a stated open mode or the College's no-comp flag, and nothing selective", () => {
    expect(matchesOpenJoin({ joinModes: ["open"] })).toBe(true);
    expect(matchesOpenJoin({ joinModes: [], noComp: true })).toBe(true);
    expect(matchesOpenJoin({ joinModes: ["audition"], noComp: true })).toBe(false);
    expect(matchesOpenJoin({ joinModes: [] })).toBe(false);
    expect(
      search("", { openJoin: true })
        .clubs.map((c) => c.name)
        .sort(),
    ).toEqual(["Harvard Chess Club", "Harvard Undergraduate Poker Club"]);
  });

  it("category filters include subcategories through categorySlugs", () => {
    const f = ClubFilters.parse({ categories: ["performing-arts"] });
    expect(CLUBS.filter((c) => passesFilters(c, f)).map((c) => c.name)).toEqual(["Radcliffe Pitches"]);
  });

  it("intents are fixed rules over categories and names/descriptions", () => {
    const software = INTENTS.find((i) => i.slug === "build-software")!;
    expect(CLUBS.filter((c) => matchesIntent(c, software)).map((c) => c.name)).toEqual(["Harvard Computer Society"]);
    // Activities don't count: "workshops on survey software" isn't a software group.
    const bisg = club("Behavioral Insights Student Group", { searchTopics: "workshops survey software" });
    expect(matchesIntent(bisg, software)).toBe(false);
    expect(new Set(INTENTS.map((i) => i.slug)).size).toBe(INTENTS.length);
  });
});

describe("similar clubs", () => {
  // performing-arts and public-service have subcategories; the rest are specific.
  const isLeaf = (s: string) => !["performing-arts", "public-service"].includes(s);
  it("prefers shared subcategories and excludes the club, look-alikes and inactive clubs", () => {
    const pitches = CLUBS.find((c) => c.name === "Radcliffe Pitches")!;
    const others = [
      club("Harvard Opportunes", {
        shortDescription: "Contemporary a cappella group singing pop.",
        categories: [cat("performing-arts"), cat("a-cappella")],
        categorySlugs: ["performing-arts", "a-cappella"],
        joinModes: ["audition"],
      }),
      club("Harvard Ballet Company", { categories: [cat("performing-arts")], categorySlugs: ["performing-arts"] }),
      club("Pitches", { categories: [cat("a-cappella")], categorySlugs: ["performing-arts", "a-cappella"] }),
      club("Old A Cappella Group", { categorySlugs: ["performing-arts", "a-cappella"], activityStatus: "defunct" }),
    ];
    const got = similarClubs(pitches, [pitches, ...others], { isLeaf });
    expect(got.map((s) => s.club.name)).toEqual(["Harvard Opportunes"]);
    expect(got[0]?.reasons).toContain("cat:a-cappella");
  });

  it("never pairs clubs with nothing in common", () => {
    const chess = CLUBS.find((c) => c.name === "Harvard Chess Club")!;
    expect(similarClubs(chess, CLUBS, { isLeaf }).map((s) => s.club.name)).toEqual([
      "Harvard Undergraduate Poker Club",
    ]);
    const quantum = CLUBS.find((c) => c.name === "Harvard Undergraduate Quantum Computing Association")!;
    expect(similarClubs(quantum, CLUBS, { isLeaf })).toEqual([]);
    // A broad category alone (Public Service) isn't enough; a specific one is.
    const crimson = CLUBS.find((c) => c.name === "Harvard Crimson")!;
    expect(similarClubs(crimson, CLUBS, { isLeaf }).map((s) => s.club.name)).toEqual([
      "Harvard Undergraduate Tuesday Magazine",
    ]);
  });
});

describe("ClubFilters.parse (plain validation, no Zod)", () => {
  it("fills defaults and keeps valid values", () => {
    expect(ClubFilters.parse({})).toEqual({
      categories: [],
      joinModes: [],
      recognition: [],
      orgTypes: [],
      recruitingNow: false,
      freshmenEligible: false,
      includeInactive: false,
      includeGraduate: false,
      classYear: null,
      recruitingSeasons: [],
      hideSparse: false,
      openJoin: false,
      noDues: false,
      intent: null,
    });
    expect(ClubFilters.parse({ joinModes: ["comp"], classYear: "junior", intent: "build-software" })).toMatchObject({
      joinModes: ["comp"],
      classYear: "junior",
      intent: "build-software",
    });
  });

  it("throws on invalid values, as the schema did", () => {
    expect(() => ClubFilters.parse({ joinModes: ["bribery"] })).toThrow(/joinModes/);
    expect(() => ClubFilters.parse({ categories: ["Not A Slug"] })).toThrow(/categories/);
    expect(() => ClubFilters.parse({ recruitingNow: "yes" })).toThrow(/recruitingNow/);
    expect(() => ClubFilters.parse({ classYear: "graduate" })).toThrow(/classYear/);
    expect(() => ClubFilters.parse({ intent: "<script>" })).toThrow(/intent/);
  });
});

describe("news mention ranking", () => {
  it("puts headlines that name the club first, then newest", async () => {
    const { rankPressMentions, headlineNamesClub } = await import("../src/local/press");
    const m = (title: string, publishedOn: string) => ({ mention: { title, publishedOn, url: title } });
    const chorus = { name: "Harvard-Radcliffe Chorus", acronym: null };
    const ranked = rankPressMentions(
      [
        m("1992 Candidates for Harvard & Radcliffe Class Marshals", "1991-10-03"),
        m("Students Sing at Commencement", "2025-05-01"),
        m("Harvard-Radcliffe Chorus Performs Brahms", "2019-04-02"),
      ],
      chorus,
    );
    expect(ranked.map((r) => r.mention.publishedOn)).toEqual(["2019-04-02", "2025-05-01", "1991-10-03"]);
    expect(headlineNamesClub("HCS Hosts Hackathon", { name: "Harvard Computer Society", acronym: "HCS" })).toBe(true);
    expect(headlineNamesClub("Harvard Hosts Hackathon", { name: "Harvard Computer Society", acronym: "HCS" })).toBe(
      false,
    );
  });
});
