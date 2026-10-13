import { describe, expect, it } from "vitest";
import { normalizeName } from "@hci/core";
import {
  ClubFilters,
  INTENTS,
  interpretQuery,
  matchesIntent,
  mostOfName,
  NO_JOINING_FACTS,
  searchLocal,
  similarClubs,
  type IndexClub,
} from "../src/local";

/**
 * Round-11 ranking from student testing (2026-10-13): selectivity asked in words ("hard to
 * get into", "acceptance rate", "prestigious") read as a selection step, never a ranking (§9);
 * politics/political as one stem; op-eds and newspapers; transfer students; joining mid-term;
 * hospital volunteering; graduate groups named in part; social impact consulting; tennis,
 * debate, cooking, outdoors and video games; low commitment and "no tryouts"; the Sports and
 * Games & hobbies topics; similar clubs for a climbing club. Hand-made index; descriptions
 * invented for the test.
 */
const NOW = new Date("2026-10-13T16:00:00Z");
const J = NO_JOINING_FACTS;
let n = 0;
const cat = (slug: string, name = slug) => ({ slug, name, isPrimary: false });

function club(name: string, over: Partial<IndexClub> = {}): IndexClub {
  const cats = over.categories ?? [];
  return {
    id: `r11-${++n}`,
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

const pol = [cat("political-advocacy", "Political & Advocacy")];
const pubs = [cat("publications-media", "Publications & Media")];
const health = [cat("medicine-health", "Health & Medicine")];
const healthService = [cat("health-service", "Health Services")];
const service = [cat("public-service", "Public Service")];
const sports = [cat("athletics-recreation", "Athletics & Recreation")];
const hobbies = [cat("hobbies-games", "Hobbies & Games")];
const consulting = [cat("consulting", "Consulting")];
const religious = [cat("religious-spiritual", "Religious & Spiritual")];
const prepro = [cat("pre-professional", "Business & Pre-professional")];
const audition = { ...J, access: "process" as const, general: ["audition" as const] };
const application = { ...J, access: "process" as const, general: ["application" as const] };
const comp = { ...J, access: "process" as const, general: ["comp" as const], comp: true };
const open = { ...J, access: "open" as const, general: ["open" as const] };

const CLUBS: IndexClub[] = [
  // Selection steps
  club("Harvard Zebra Singers", { joinModes: ["audition"], joining: audition, instagramFollowers: 9000 }),
  club("Harvard Aardvark Review", { joinModes: ["application"], joining: application, instagramFollowers: 10 }),
  club("Harvard Open Knitters", { joinModes: ["open"], joining: open, categories: hobbies }),
  // Politics
  club("Harvard College Democrats", {
    categories: pol,
    shortDescription: "Student political group that lobbies and campaigns.",
    instagramFollowers: 5000,
  }),
  club("Harvard Political Union", { categories: pol, shortDescription: "Student debate society." }),
  club("Harvard Arts Coalition", { shortDescription: "Arts advocacy where art meets politics in passing." }),
  // Writing
  club("Harvard Daily Paper", {
    categories: pubs,
    shortDescription: "Student newspaper publishing every weekday morning.",
    searchTopics: "opinion sports arts",
  }),
  club("Harvard Weekly Independent", {
    categories: pubs,
    shortDescription: "Student publication producing weekly print issues.",
  }),
  club("Harvard Poetry Magazine", { categories: pubs }),
  club("Harvard Public Opinion Project", {
    categories: pol,
    shortDescription: "Polling group surveying young Americans.",
  }),
  // Health
  club("Harvard Undergraduate Patient Support Corps", { categories: health }),
  club("PBHA Memory Care Buddies", {
    categories: [...service, ...healthService],
    shortDescription: "Volunteer group pairing students with memory care residents.",
  }),
  club("Harvard Figure Skating Club", {
    categories: sports,
    shortDescription: "Skating club offering beginner clinics.",
  }),
  club("Public Health Innovation Student Forum", {
    affiliationScope: "graduate_school",
    categories: health,
    shortDescription: "Graduate forum on public health technology.",
  }),
  club("Harvard Global Health Society", { categories: health }),
  // Consulting for nonprofits
  club("Harvard Undergraduate Social Impact Consulting Group", { categories: consulting }),
  club("Harvard Strategy Teams", {
    categories: pol,
    shortDescription: "Undergraduate teams developing strategies for non-profit and public sector clients.",
  }),
  club("Harvard Housing Help", {
    categories: service,
    shortDescription: "Volunteers helping nonprofit shelters house people.",
  }),
  // Sports and hobbies
  club("Tennis (Club Sport)", { orgType: "club_sport", categories: sports, searchNames: "tennis club sport | tennis" }),
  club("Harvard Table Tennis Club", {
    orgType: "club_sport",
    categories: sports,
    shortDescription: "Club sport offering table tennis practices.",
    searchNames: "harvard table tennis club | table tennis",
  }),
  club("Harvard Men's Tennis Club", { orgType: "club_sport", categories: sports }),
  club("Harvard Undergraduate Sports Lab", {
    categories: [...prepro, ...sports],
    shortDescription: "Student community for sports business careers.",
  }),
  club("Harvard Climbing Club", {
    orgType: "club_sport",
    categories: sports,
    shortDescription: "Harvard club sports team for climbing.",
  }),
  club("Harvard Archery Club", {
    orgType: "club_sport",
    categories: sports,
    shortDescription: "Harvard club sports team for archery.",
  }),
  club("Harvard Mountaineering Club", {
    categories: hobbies,
    shortDescription: "Climbing club that lends gear and runs training trips.",
  }),
  club("Harvard Outing Club", { categories: hobbies, shortDescription: "Outdoor trips: hiking and camping." }),
  club("Harvard Humanist Community", {
    categories: religious,
    shortDescription: "Secular community with weekly discussions and a camping trip.",
  }),
  club("Harvard Student Baking Club", { categories: hobbies }),
  club("Harvard Food Teaching Lab", {
    categories: health,
    shortDescription: "Undergraduate volunteers teaching classes on food science through cooking.",
  }),
  club("Harvard Poker Club", { categories: hobbies }),
  club("Harvard Undergraduate Game Developers", { categories: hobbies }),
  // Debate
  club("Harvard Undergraduate Mock Trial Association", { shortDescription: "Mock trial team." }),
  club("Harvard Model UN Conference", {
    categories: pol,
    shortDescription: "Annual conference where delegates debate global issues.",
  }),
  // Commitment and process words
  club("Harvard Two Hour Ventures", {
    joinModes: ["comp"],
    joining: comp,
    hoursPerWeek: { min: 1.5, max: 2 },
  }),
  club("Harvard Five Hour Orchestra", { hoursPerWeek: { min: 5, max: 5 } }),
  club("Harvard Peer Listening", { shortDescription: "Peer counseling offering nightly drop-in support." }),
  club("Harvard Finance Analysts", {
    joinModes: ["comp"],
    joining: { ...comp, noExperience: true },
    shortDescription: "Finance comps for students with no prior experience.",
  }),
  club("Harvard Beginner Boxing", {
    categories: sports,
    joinModes: ["open"],
    joining: { ...open, noExperience: true },
  }),
];

const filters = ClubFilters.parse({});
const search = (text: string, extra: Partial<ClubFilters> = {}) =>
  searchLocal(CLUBS, { text, filters: { ...filters, ...extra }, sort: "relevance", offset: 0, limit: 50, now: NOW });
const names = (text: string) => search(text).clubs.map((c) => c.name);
const before = (list: string[], a: string, b: string) => {
  expect(list).toContain(a);
  if (list.includes(b)) expect(list.indexOf(a)).toBeLessThan(list.indexOf(b));
};

describe("selectivity asked in words (§9)", () => {
  it("reads selective words as a selection step, with a note, never typo-corrected", () => {
    for (const q of [
      "hard to get into",
      "acceptance rate",
      "prestigious clubs",
      "selective clubs",
      "competitive clubs",
    ]) {
      const r = search(q);
      expect(r.corrected, q).toBeNull();
      expect(r.notes, q).toEqual(["Clubs with a selection step. We don't know how hard any is to get into."]);
      expect(r.process, q).toEqual([]);
      const got = r.clubs.map((c) => c.name);
      expect(got, q).toContain("Harvard Zebra Singers");
      expect(got, q).toContain("Harvard Aardvark Review");
      expect(got, q).not.toContain("Harvard Open Knitters");
    }
  });

  it("orders equally matched clubs by name, never by followers", () => {
    before(names("selective clubs"), "Harvard Aardvark Review", "Harvard Zebra Singers");
  });

  it("reads competitive as selectivity only as a modifier", () => {
    expect(search("is the zebra singers competitive").notes).toHaveLength(1);
    expect(search("competitive dance").notes).toEqual([]);
  });

  it("reads the low end as Open membership", () => {
    for (const q of ["least selective", "easy to get into", "not competitive"]) {
      const r = search(q);
      expect(
        r.constraints.map((c) => c.filter),
        q,
      ).toEqual(["openJoin"]);
      expect(r.clubs.map((c) => c.name).sort(), q).toEqual(["Harvard Beginner Boxing", "Harvard Open Knitters"]);
    }
  });

  it("selects the same clubs Postgres does (one process predicate over the modes)", () => {
    const q = interpretQuery("selective clubs");
    expect(q.soft[0]?.modifier.process?.modes).toEqual(["application", "comp", "audition", "tryout", "invite_only"]);
  });
});

describe("topics", () => {
  it("politics and political are one stem", () => {
    const p = names("politics clubs");
    before(p, "Harvard College Democrats", "Harvard Arts Coalition");
    expect(names("political")).toEqual(names("politics"));
  });

  it("op-eds and newspapers: a club saying it is a newspaper beats a magazine named so", () => {
    expect(names("op-ed")).toContain("Harvard Daily Paper");
    for (const q of ["journalism", "newspaper", "write for a newspaper"]) {
      const got = names(q);
      before(got, "Harvard Daily Paper", "Harvard Poetry Magazine");
      before(got, "Harvard Weekly Independent", "Harvard Poetry Magazine");
    }
    // Polling is not an opinion section.
    expect(names("opinion")).not.toContain("Harvard Public Opinion Project");
  });

  it("hospital volunteering finds patient and memory-care clubs, not skating clinics", () => {
    const h = names("hospital volunteering");
    expect(h).toContain("Harvard Undergraduate Patient Support Corps");
    expect(h).toContain("PBHA Memory Care Buddies");
    expect(names("clinics")).not.toContain("Harvard Figure Skating Club");
  });

  it("a graduate group named only in part follows the undergraduate matches", () => {
    const h = names("public health");
    before(h, "Harvard Global Health Society", "Public Health Innovation Student Forum");
    expect(h.at(-1)).toBe("Public Health Innovation Student Forum");
    expect(
      mostOfName(
        CLUBS.find((c) => c.name.startsWith("Public Health Innovation"))!,
        "public health",
      ),
    ).toBe(false);
    expect(names("public health innovation student forum")[0]).toBe("Public Health Innovation Student Forum");
  });

  it("social impact consulting needs a consulting half", () => {
    for (const q of ["social impact consulting", "nonprofit consulting"]) {
      const got = names(q);
      expect(got, q).toContain("Harvard Undergraduate Social Impact Consulting Group");
      expect(got, q).toContain("Harvard Strategy Teams");
      expect(got, q).not.toContain("Harvard Housing Help");
    }
  });

  it("tennis: the men's team before table tennis", () => {
    before(names("tennis"), "Harvard Men's Tennis Club", "Harvard Table Tennis Club");
  });

  it("debate: a mock trial team before a conference where delegates debate", () => {
    before(names("debate"), "Harvard Undergraduate Mock Trial Association", "Harvard Model UN Conference");
  });

  it("cooking: the baking club before volunteers teaching through cooking", () => {
    before(names("cooking"), "Harvard Student Baking Club", "Harvard Food Teaching Lab");
    before(names("baking"), "Harvard Student Baking Club", "Harvard Food Teaching Lab");
  });

  it("outdoors words in text count only at sports and hobby clubs", () => {
    for (const q of ["climbing", "hiking", "outdoors", "camping"])
      expect(names(q), q).not.toContain("Harvard Humanist Community");
    expect(names("hiking")).toContain("Harvard Outing Club");
  });

  it("video games are their own topic: no poker or chess", () => {
    for (const q of ["video games", "esports"]) {
      expect(names(q), q).toContain("Harvard Undergraduate Game Developers");
      expect(names(q), q).not.toContain("Harvard Poker Club");
    }
  });
});

describe("joining words", () => {
  it("transfer students re-rank beside a topic and ask for Still time alone", () => {
    const r = search("debate for transfers");
    expect(r.soft).toEqual(["transfers"]);
    expect(r.constraints).toEqual([]);
    expect(search("transfer").constraints.map((c) => c.filter)).toEqual(["stillTime"]);
    expect(search("transfer students").constraints.map((c) => c.filter)).toEqual(["stillTime"]);
  });

  it("joining mid-semester or late is Still time to join", () => {
    for (const q of ["join mid semester", "mid-semester", "can i join late"])
      expect(
        search(q).constraints.map((c) => c.filter),
        q,
      ).toEqual(["stillTime"]);
  });

  it("low commitment: stated hours first, drop-in support isn't commitment", () => {
    const got = names("low commitment");
    before(got, "Harvard Two Hour Ventures", "Harvard Five Hour Orchestra");
    expect(got).not.toContain("Harvard Peer Listening");
  });

  it("no tryouts: a comp with cuts is a tryout", () => {
    const got = names("no tryouts");
    expect(got).toContain("Harvard Beginner Boxing");
    expect(got).not.toContain("Harvard Finance Analysts");
  });
});

describe("topics menu and similar clubs", () => {
  it("Sports is clubs that play; Games & hobbies exists", () => {
    const sport = INTENTS.find((i) => i.slug === "play-a-sport")!;
    const picked = CLUBS.filter((c) => matchesIntent(c, sport)).map((c) => c.name);
    expect(picked).toContain("Harvard Men's Tennis Club");
    expect(picked).not.toContain("Harvard Undergraduate Sports Lab");
    const games = INTENTS.find((i) => i.slug === "games-hobbies");
    expect(games?.label).toBe("Games & hobbies");
    expect(CLUBS.filter((c) => matchesIntent(c, games!)).map((c) => c.name)).toContain("Harvard Poker Club");
    const outdoors = INTENTS.find((i) => i.slug === "get-outdoors")!;
    expect(
      matchesIntent(
        CLUBS.find((c) => c.name === "Harvard Humanist Community")!,
        outdoors,
      ),
    ).toBe(false);
  });

  it("a climbing club is like the mountaineering and outing clubs, not every club sport", () => {
    const climbing = CLUBS.find((c) => c.name === "Harvard Climbing Club")!;
    const got = similarClubs(climbing, CLUBS, { isLeaf: () => true }).map((s) => s.club.name);
    expect(got).toContain("Harvard Mountaineering Club");
    expect(got).toContain("Harvard Outing Club");
    expect(got).not.toContain("Harvard Archery Club");
    expect(got).not.toContain("Harvard Humanist Community");
  });
});
