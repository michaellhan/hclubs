import { describe, expect, it } from "vitest";
import { normalizeName } from "@hci/core";
import {
  clubAudiences,
  ClubFilters,
  INTENTS,
  matchesIntent,
  NO_JOINING_FACTS,
  searchLocal,
  similarClubs,
  type IndexClub,
} from "../src/local";

/**
 * Round-9 ranking from live student testing (2026-10-12): identity concepts ("black" in the
 * identity sense only; broad identity groups before pre-professional ones; similar clubs by
 * shared community), audience clubs after general ones on a topic that doesn't name their
 * audience, venue and event words that aren't the topic, "or"/"and" between topics as a
 * union, "no audition" against clubs that audition, comp clubs before "comp…" names, and a
 * few concept gaps. Hand-made index; descriptions invented for the test.
 */
const NOW = new Date("2026-10-12T16:00:00Z");
const J = NO_JOINING_FACTS;
let n = 0;
const cat = (slug: string, name = slug) => ({ slug, name, isPrimary: false });
const PARENT: Record<string, string> = {
  dance: "performing-arts",
  music: "performing-arts",
  "a-cappella": "performing-arts",
  theater: "performing-arts",
  finance: "pre-professional",
  consulting: "pre-professional",
};

function club(name: string, over: Partial<IndexClub> = {}): IndexClub {
  const cats = over.categories ?? [];
  return {
    id: `r9-${++n}`,
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
    // A website of its own: "similar clubs" treats a shared one as the same club.
    quickLinks: { website: `https://${normalizeName(name).replace(/ /g, "-")}.invalid`, instagram: null },
    logo: null,
    pressCount: 0,
    cycles: [],
    searchNames: normalizeName(name),
    searchAcronyms: [],
    searchTopics: "",
    categorySlugs: [...new Set(cats.flatMap((c) => [c.slug, ...(PARENT[c.slug] ? [PARENT[c.slug]!] : [])]))],
    recruitingSeasons: [],
    ...over,
  };
}

const cultural = [cat("cultural-identity", "Cultural & Identity")];
const social = [cat("social", "Social & Community")];
const tech = [cat("technology", "Technology & Engineering")];
const finance = [cat("finance", "Finance & Investing")];
const health = [cat("medicine-health", "Medicine & Health")];
const dance = [cat("dance", "Dance")];
const acap = [cat("a-cappella", "A cappella")];
const music = [cat("music", "Music")];
const performing = [cat("performing-arts", "Performing Arts")];
const startupsCat = [cat("entrepreneurship", "Entrepreneurship")];
const sports = [cat("athletics-recreation", "Athletics & Recreation")];
const audition = { ...J, access: "process" as const, general: ["audition" as const] };
const open = { ...J, access: "open" as const, general: ["open" as const] };
const comp = { ...J, access: "process" as const, general: ["comp" as const], comp: true };

const CLUBS: IndexClub[] = [
  // Identity
  club("Harvard Black Students Association", {
    categories: [...cultural, ...social],
    shortDescription: "Community and affinity group for Black undergraduates, with social and service events.",
  }),
  club("Harvard Black Men's Forum", {
    categories: cultural,
    shortDescription: "Community for black men that builds brotherhood through meetings and seminars.",
  }),
  club("Association of Black Harvard Women", {
    categories: cultural,
    shortDescription: "Community for Black women at Harvard with discussion and social events.",
  }),
  club("Harvard College Generational African American Students Association", { categories: cultural }),
  club("Harvard African Students Association", {
    categories: cultural,
    shortDescription: "Community for African students organizing cultural and social events.",
  }),
  club("Haitians At Harvard", { categories: cultural, shortDescription: "A space for Haitians to discuss Haiti." }),
  club("Harvard Caribbean Club", { categories: cultural }),
  club("Harvard Society of Black Scientists and Engineers", {
    categories: tech,
    shortDescription: "Community for Black students in STEM fields with career advising.",
  }),
  club("Black Diamond Capital Investors", {
    categories: finance,
    shortDescription: "Student-run investment fund using long-short strategies.",
  }),
  club("Delphic Club", {
    categories: social,
    shortDescription: "All-male social final club founded in 1846.",
    searchTopics: "formal black tie dinners dances during recruitment",
  }),
  club("Harvard-Radcliffe Asian American Association", {
    categories: [...cultural, ...social],
    shortDescription: "Community among Asian American undergraduates through educational and social events.",
  }),
  club("Harvard-Radcliffe Chinese Students Association", {
    categories: [...cultural, ...social],
    shortDescription: "Community for Chinese and Chinese American students with cultural and social events.",
  }),
  club("Harvard Korean Association", { categories: cultural }),
  club("Harvard South Asian Association", { categories: cultural, searchTopics: "show called ghungroo" }),
  club("Harvard College Pakistani Students Association", { categories: cultural }),
  club("Harvard Undergraduate Nepali Student Association", { categories: cultural }),
  club("Harvard Undergraduate Bhangra", {
    categories: dance,
    shortDescription: "Bhangra team combining traditional Punjabi dance with hip hop.",
  }),
  club("Harvard Asian American Dance Troupe", {
    categories: [...dance, ...cultural],
    shortDescription: "Student dance troupe performing traditional and fusion Asian dance.",
  }),
  club("Fuerza Latina", {
    categories: cultural,
    shortDescription: "Student group supporting Latinx students academically and socially.",
  }),
  club("Concilio Latino de Harvard", {
    categories: cultural,
    shortDescription: "Umbrella organization coordinating Latinx student groups on campus.",
  }),
  club("Harvard Undergraduate Latines in Health Careers", {
    categories: [...cultural, ...health],
    shortDescription: "Pre-professional organization for Latinos interested in health professions.",
  }),
  club("Harvard Undergraduate Latinxs in Finance & Technology", {
    categories: [...finance, ...tech],
    shortDescription: "Professional resources for Latinx undergraduates in finance and technology.",
  }),
  club("Adams House Committee", { categories: social, orgType: "governance_body" }),
  club("First-Year Social Committee", { categories: social, quickLinks: { website: null, instagram: null } }),
  club("Harvard Undergraduate Kaizen Club", {
    categories: social,
    shortDescription: "Social club for making friends through weekly dinners.",
    joining: open,
  }),
  // Tech and startups
  club("Harvard Computer Society", {
    categories: tech,
    shortDescription: "Student computer science group running workshops and coding projects.",
    instagramFollowers: 3000,
  }),
  club("Harvard Undergraduate Women in Computer Science", {
    categories: tech,
    shortDescription: "Advocacy group and community for women pursuing computer science.",
    instagramFollowers: 5000,
  }),
  club("Startups at Harvard", {
    categories: startupsCat,
    shortDescription: "Community for student founders building startups.",
  }),
  club("Harvard College Ventures", {
    categories: [...tech, ...startupsCat],
    shortDescription: "Builds startups and software products with student founders.",
  }),
  club("Harvard Student Agencies", {
    categories: startupsCat,
    shortDescription: "Non-profit running student-managed businesses.",
  }),
  // Performing
  club("The Harvard Krokodiloes", {
    categories: acap,
    shortDescription: "Male a cappella group performing jazz arrangements.",
    instagramFollowers: 197000,
    joining: audition,
    joinModes: ["audition"],
  }),
  club("Harvard Opportunes", {
    categories: acap,
    shortDescription: "All-gender contemporary a cappella group.",
    instagramFollowers: 150000,
    joining: { ...audition, noExperience: true },
    joinModes: ["audition"],
  }),
  club("ApiChorus A Cappella", {
    categories: acap,
    shortDescription: "Coed Jewish a cappella group singing in Hebrew and English.",
    joining: audition,
    joinModes: ["audition"],
  }),
  club("Harvard Open Choir", {
    categories: music,
    shortDescription: "Choir singing gospel, open to all students with no auditions.",
    joining: open,
    joinModes: ["open"],
  }),
  club("Harvard University Choir", {
    categories: music,
    shortDescription: "Professional choir of paid singers for Sunday services.",
  }),
  club("Harvard Ballroom Dance Club", { categories: dance, shortDescription: "Ballroom and latin dance lessons." }),
  club("Harvard Undergraduate Folklorico Company", { categories: dance }),
  club("Harvard Undergraduate Ghungroo", { categories: performing }),
  club("Harvard Undergraduate Breakers Organization", { categories: performing, searchTopics: "learn breakdancing" }),
  club("Eleganza", {
    categories: dance,
    shortDescription: "Student-run fashion show staged each year by models and dancers.",
    searchTopics: "annual fashion show dance",
  }),
  club("Harvard Jazz Orchestra", {
    categories: music,
    shortDescription: "Eighteen-piece jazz ensemble playing concerts in Sanders Theatre.",
    searchTopics: "concerts dances on campus",
  }),
  club("Three Letter Acronym", {
    categories: performing,
    shortDescription: "Improv troupe performing regularly at Harvard.",
    searchTopics: "theater dance",
  }),
  club("The Harvard-Radcliffe Gilbert and Sullivan Players", {
    categories: music,
    shortDescription: "Student company performing comic opera, open to musicians and actors.",
    searchTopics: "technical theater staff",
  }),
  club("An Evening with Champions", {
    categories: [...performing, cat("public-service", "Public Service"), ...sports],
    shortDescription: "Charity committee that stages a figure skating exhibition to raise money for the Jimmy Fund.",
  }),
  // Comp
  club("Harvard Crimson", {
    categories: [cat("publications-media", "Publications")],
    joining: comp,
    joinModes: ["comp"],
  }),
  club("Harvard Composers Association", { categories: music, shortDescription: "Student composers." }),
  // Sports
  club("Harvard Running Club", { categories: sports, shortDescription: "Club sports team for running." }),
];

const IX = CLUBS;
const isLeaf = (s: string) => !["performing-arts", "pre-professional"].includes(s);
const run = (text: string, limit = 50) =>
  searchLocal(IX, { text, filters: ClubFilters.parse({}), sort: "relevance", offset: 0, limit, now: NOW });
const names = (text: string) => run(text).clubs.map((c) => c.name);
const byName = (name: string) => CLUBS.find((c) => c.name === name)!;
const before = (list: string[], a: string, b: string) => {
  expect(list).toContain(a);
  expect(list).toContain(b);
  expect(list.indexOf(a)).toBeLessThan(list.indexOf(b));
};

describe("identity concepts (round 9)", () => {
  it("'black' is the identity sense only: no fund names, no 'black tie'; African, Haitian and Caribbean groups count", () => {
    const r = names("black students");
    expect(r[0]).toBe("Harvard Black Students Association");
    expect(r).not.toContain("Black Diamond Capital Investors");
    expect(r).not.toContain("Delphic Club");
    for (const x of ["Harvard African Students Association", "Haitians At Harvard", "Harvard Caribbean Club"])
      expect(r).toContain(x);
    // Broad identity groups before pre-professional ones named the same way.
    before(r, "Harvard Black Men's Forum", "Harvard Society of Black Scientists and Engineers");
    // Typing the name still finds it: the query says the phrase.
    expect(names("black diamond capital")[0]).toBe("Black Diamond Capital Investors");
  });

  it("a bare identity word ranks the broad groups above pre-professional ones", () => {
    const r = names("latinx");
    before(r, "Fuerza Latina", "Harvard Undergraduate Latines in Health Careers");
    before(r, "Concilio Latino de Harvard", "Harvard Undergraduate Latinxs in Finance & Technology");
  });

  it("similar clubs share the community, not just Cultural & identity", () => {
    const sim = (name: string) => similarClubs(byName(name), CLUBS, { isLeaf, limit: 6 }).map((s) => s.club.name);
    const bsa = sim("Harvard Black Students Association");
    expect(bsa.slice(0, 3)).toEqual(
      expect.arrayContaining(["Harvard Black Men's Forum", "Association of Black Harvard Women"]),
    );
    expect(bsa).not.toContain("Harvard-Radcliffe Chinese Students Association");
    expect(bsa).not.toContain("Harvard Korean Association");
    for (const x of bsa.slice(0, 4)) expect(clubAudiences(byName(x)).has("id:black")).toBe(true);
    const saa = sim("Harvard South Asian Association");
    expect(saa).toEqual(
      expect.arrayContaining([
        "Harvard College Pakistani Students Association",
        "Harvard Undergraduate Nepali Student Association",
        "Harvard Undergraduate Bhangra",
      ]),
    );
    // K-pop's "asian" counts only at dance groups: it never makes "South Asian" like "Korean".
    expect(saa).not.toContain("Harvard Korean Association");
    expect(saa).not.toContain("Harvard Asian American Dance Troupe");
  });

  it("house committees are only like other governance bodies", () => {
    const fysc = similarClubs(byName("First-Year Social Committee"), CLUBS, { isLeaf }).map((s) => s.club.name);
    expect(fysc).not.toContain("Adams House Committee");
  });
});

describe("audience clubs on general topics (round 9)", () => {
  it("a club for women follows general clubs on a topic that doesn't name women, and is never dropped", () => {
    for (const q of ["coding", "cs", "computer science", "app development"])
      before(names(q), "Harvard Computer Society", "Harvard Undergraduate Women in Computer Science");
    expect(names("women in computer science")[0]).toBe("Harvard Undergraduate Women in Computer Science");
    expect(names("wics women")[0]).toBe("Harvard Undergraduate Women in Computer Science");
  });

  it("a faith's a cappella group follows general groups unless the faith is typed", () => {
    for (const q of ["a cappella", "acapella", "a capella"])
      before(names(q), "Harvard Opportunes", "ApiChorus A Cappella");
    expect(names("jewish a cappella")[0]).toBe("ApiChorus A Cappella");
  });

  it("a community's dance troupe follows general dance clubs, but K-pop names Asian dance groups", () => {
    before(names("dance"), "Harvard Ballroom Dance Club", "Harvard Asian American Dance Troupe");
    expect(names("kpop")[0]).toBe("Harvard Asian American Dance Troupe");
  });
});

describe("topic precision (round 9)", () => {
  it("dance: named dance forms before activity-list mentions; event 'dances', improv troupes and directory labels aren't dance", () => {
    const r = names("dance");
    before(r, "Harvard Undergraduate Folklorico Company", "Eleganza");
    before(r, "Harvard Undergraduate Ghungroo", "Eleganza");
    expect(r).toContain("Harvard Undergraduate Breakers Organization");
    expect(r).not.toContain("Delphic Club");
    expect(r).not.toContain("Harvard Jazz Orchestra");
    expect(r).not.toContain("Three Letter Acronym");
  });

  it("theater: a venue ('Sanders Theatre') isn't theater; comic opera with actors is", () => {
    const r = names("theater");
    expect(r).not.toContain("Harvard Jazz Orchestra");
    expect(r).toContain("The Harvard-Radcliffe Gilbert and Sullivan Players");
    expect(names("sanders theatre")).toContain("Harvard Jazz Orchestra");
  });

  it("'or', 'and' or a comma between topics is a union, clubs matching both first", () => {
    for (const q of ["coding or startups", "coding and startups", "coding, startups"]) {
      const r = names(q);
      expect(r[0]).toBe("Harvard College Ventures");
      expect(r).toContain("Harvard Computer Society");
      expect(r).toContain("Startups at Harvard");
    }
    expect(names("poker or chess")).toEqual([]);
    // A constraint phrase beside them keeps the join.
    expect(run("no comp coding or startups").searchedText).toBe("coding or startups");
    expect(run("no comp coding, startups").searchedText).toBe("coding , startups");
  });

  it("'no audition' puts clubs that audition last, whatever else they say", () => {
    const r = names("no audition singing");
    expect(r[0]).toBe("Harvard Open Choir");
    before(r, "Harvard Open Choir", "Harvard Opportunes");
  });

  it("'comp' alone: clubs with a comp before clubs whose name begins 'comp'", () => {
    const r = names("comp");
    before(r, "Harvard Crimson", "Harvard Composers Association");
    before(r, "Harvard Crimson", "Harvard Computer Society");
  });

  it("concept gaps: 'a capela', 'start-up', 'cross country', verb-sense 'running'", () => {
    const capela = run("a capela");
    expect(capela.corrected).not.toBeNull();
    expect(capela.clubs.map((c) => c.name)).toContain("Harvard Opportunes");
    for (const q of ["start up", "start-up"]) expect(names(q)[0]).toBe("Startups at Harvard");
    expect(names("cross country")).toEqual(["Harvard Running Club"]);
    expect(names("running")).toEqual(["Harvard Running Club"]);
  });

  it("'make friends': a sparse club named 'Social' isn't lifted by 'socials'", () => {
    before(names("make friends"), "Harvard Undergraduate Kaizen Club", "First-Year Social Committee");
  });
});

describe("intent rules (round 9)", () => {
  const picks = (slug: string) => {
    const intent = INTENTS.find((i) => i.slug === slug)!;
    return CLUBS.filter((c) => matchesIntent(c, intent)).map((c) => c.name);
  };
  it("Finance & consulting and Invest read fund phrases, not a charity's 'Jimmy Fund'", () => {
    expect(picks("finance-consulting")).toContain("Black Diamond Capital Investors");
    expect(picks("finance-consulting")).not.toContain("An Evening with Champions");
    expect(picks("invest")).not.toContain("An Evening with Champions");
  });
  it("Perform leaves out paid professional ensembles and event committees", () => {
    const p = picks("perform");
    expect(p).toContain("Harvard Open Choir");
    expect(p).toContain("Harvard Undergraduate Ghungroo");
    expect(p).not.toContain("Harvard University Choir");
    expect(p).not.toContain("An Evening with Champions");
  });
});
