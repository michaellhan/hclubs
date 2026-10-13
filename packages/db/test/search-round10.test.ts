import { describe, expect, it } from "vitest";
import { normalizeName } from "@hci/core";
import {
  ClubFilters,
  graduateNamed,
  INTENTS,
  matchesIntent,
  matchResume,
  NO_JOINING_FACTS,
  parseQuery,
  readResumeInterests,
  searchLocal,
  similarClubs,
  type CycleSummary,
  type IndexClub,
} from "../src/local";

/**
 * Round-10 ranking from student testing round 3 (2026-10-12): function words and
 * contractions are never "corrected" ("that" → "thai"); negated asks ("don't need
 * experience") read as filters; Middle Eastern, African and "<demonym> American" identity
 * searches; theater words outside Theater; "start a company"; a dance named in a club's name;
 * K-pop's Korean groups; instruments and clinical work on a resume; "don't audition"; no-cut
 * comps in the relax hint; typed seasons and announced rounds; the Finance & consulting
 * topic; activity-list mentions under a constraint; "Community" in a name; graduate groups in
 * similar clubs. Hand-made index; descriptions invented for the test.
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
    id: `r10-${++n}`,
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
    categorySlugs: [...new Set(cats.flatMap((c) => [c.slug, ...(PARENT[c.slug] ? [PARENT[c.slug]!] : [])]))],
    recruitingSeasons: [],
    ...over,
  };
}

function cycle(over: Partial<CycleSummary>): CycleSummary {
  return {
    id: `cy-${++n}`,
    termKey: "2027-spring",
    track: "main",
    status: "unknown",
    statedStatus: null,
    opens: null,
    deadline: null,
    processTypes: [],
    applicationUrl: null,
    eligibleClasses: null,
    lastVerifiedAt: "2026-10-01T00:00:00Z",
    ...over,
  };
}

const cultural = [cat("cultural-identity", "Cultural & Identity")];
const social = [cat("social", "Social & Community")];
const dance = [cat("dance", "Dance")];
const theater = [cat("theater", "Theater")];
const music = [cat("music", "Music")];
const acap = [cat("a-cappella", "A cappella")];
const finance = [cat("finance", "Finance & Investing")];
const consulting = [cat("consulting", "Consulting")];
const prepro = [cat("pre-professional", "Business & Pre-professional")];
const startupsCat = [cat("entrepreneurship", "Entrepreneurship")];
const service = [cat("public-service", "Public Service")];
const sports = [cat("athletics-recreation", "Athletics & Recreation")];
const religious = [cat("religious-spiritual", "Religious & Spiritual")];
const open = { ...J, access: "open" as const, general: ["open" as const] };
const audition = { ...J, access: "process" as const, general: ["audition" as const] };
const noCutComp = { ...J, access: "process" as const, general: ["comp" as const], comp: true, noCuts: true };
const comp = { ...J, access: "process" as const, general: ["comp" as const], comp: true };

const CLUBS: IndexClub[] = [
  // Identity
  club("Harvard Society of Arab Students", { categories: cultural }),
  club("Harvard College Turkish Student Association", { categories: cultural }),
  club("Harvard Undergraduate Kurdish Cultural Association", { categories: cultural }),
  club("Israelis of Harvard", { categories: religious, shortDescription: "Community for Israeli students." }),
  club("Harvard Model Congress Middle East", {
    categories: [cat("political-advocacy", "Political")],
    shortDescription:
      "Government simulation conference teaching Middle Eastern high schoolers about American politics.",
  }),
  club("Harvard African Students Association", {
    categories: cultural,
    shortDescription: "Community for African students organizing cultural events.",
  }),
  club("Harvard College Nigerian Students Association", { categories: cultural }),
  club("Harvard Undergraduate Association of Ghanaian Students", { categories: cultural }),
  club("Harvard Undergraduate Somali Student Association", { categories: cultural }),
  club("The Harvard Undergraduate Drummers", {
    categories: music,
    shortDescription: "Percussion group playing buckets and cups.",
    searchTopics: "african drumming",
  }),
  club("Harvard Korean Association", {
    categories: cultural,
    shortDescription: "Cultural organization building community among Korean students.",
  }),
  club("Harvard-Radcliffe Asian American Association", {
    categories: [...cultural, ...social],
    shortDescription: "Community among Asian American undergraduates through educational and social events.",
  }),
  club("Harvard Undergraduate Mexican Organization", { categories: cultural }),
  club("Fuerza Latina", { categories: cultural, shortDescription: "Student group supporting Latinx students." }),
  // Theater
  club("Hasty Pudding Theatricals", {
    categories: theater,
    shortDescription: "Student theatrical society that stages an annual musical comedy.",
    instagramFollowers: 17000,
  }),
  club("The Harvard-Radcliffe Dramatic Club", {
    categories: theater,
    shortDescription: "Umbrella organization for campus theater, overseeing student productions.",
    instagramFollowers: 1200,
  }),
  club("The Harvard-Radcliffe Gilbert and Sullivan Players", {
    categories: [...theater, ...music],
    shortDescription: "Student company performing comic opera, open to musicians, actors and technicians.",
    searchTopics: "technical theater design crew",
    instagramFollowers: 600,
  }),
  club("PBHA's Student Theater Program", {
    categories: [...theater, ...service],
    orgType: "public_service_program",
    shortDescription: "Volunteer-taught theater program for third graders.",
  }),
  club("Harvard Pops Orchestra", {
    categories: music,
    shortDescription: "Student orchestra performing themed, theatrical concerts.",
  }),
  club("Harvard University Band", { categories: music, shortDescription: "The band plays at football games." }),
  // Dance and music
  club("The Harvard Ballet Company", {
    categories: dance,
    shortDescription: "Student-run company performing classical ballet.",
  }),
  club("The Harvard Ballet Folklorico de Aztlan", {
    categories: dance,
    shortDescription: "Undergraduate dance group celebrating Mexican heritage through traditional dances.",
  }),
  club("Harvard Crimson Dance Team", {
    categories: dance,
    shortDescription: "Competitive dance team performing jazz, lyrical, pom, and hip hop.",
    instagramFollowers: 6900,
  }),
  club("Expressions Dance Company", {
    categories: dance,
    shortDescription: "Student-run hip-hop dance group open to all experience levels.",
    instagramFollowers: 1100,
  }),
  club("Harvard Asian American Dance Troupe", {
    categories: [...dance, ...cultural],
    shortDescription:
      "Student dance troupe performing traditional and fusion Asian dance, open to all without audition.",
    joining: { ...open, noExperience: true },
  }),
  club("Harvard Swing Dance Society", { categories: dance, shortDescription: "Swing dance lessons." }),
  club("The Noteables", {
    categories: theater,
    shortDescription: "A non-audition group that performs revue-style musical theater.",
    joining: { ...open, noExperience: true },
  }),
  club("Harvard Combat Sports Club", {
    categories: sports,
    shortDescription: "Martial arts club for beginners.",
    joining: { ...open, noExperience: true },
  }),
  club("Harvard Opportunes", {
    categories: acap,
    shortDescription: "Contemporary a cappella group.",
    joining: audition,
    joinModes: ["audition"],
  }),
  club("Harvard College Students Piano Society", {
    categories: music,
    shortDescription: "Community of student pianists.",
  }),
  club("Harvard Radcliffe Orchestra", {
    categories: music,
    shortDescription: "Student symphony orchestra playing classical music.",
  }),
  // Startups and finance
  club("Startups at Harvard", { categories: startupsCat, shortDescription: "Community for student founders." }),
  club("Harvard Undergraduate Tap Company", { categories: dance }),
  club("Harvard Undergraduate Alternative Investment Club", {
    categories: finance,
    shortDescription: "Finance group teaching alternative investments.",
    joining: noCutComp,
    joinModes: ["comp"],
  }),
  club("Harvard Investment Association", {
    categories: finance,
    shortDescription: "Undergraduate finance group teaching investing.",
    joining: comp,
    joinModes: ["comp"],
  }),
  club("Harvard Financial Analysts Club", {
    categories: finance,
    shortDescription: "Finance education group.",
    joining: comp,
    joinModes: ["comp"],
  }),
  club("The Crimson Business Board", {
    categories: [...prepro, cat("publications-media", "Publications")],
    shortDescription: "Student business team that funds the newspaper through advertising.",
  }),
  club("Harvard Undergraduate Music Business Association", {
    categories: [...music, ...prepro],
    shortDescription: "Student group exploring the music industry.",
  }),
  club("Harvard Undergraduate Consulting Group", {
    categories: consulting,
    shortDescription: "Student consulting group.",
    joining: open,
    joinModes: ["open"],
  }),
  club("Harvard Undergraduate Consulting on Business and the Environment", {
    categories: consulting,
    shortDescription: "Consulting on sustainability.",
    joining: open,
    joinModes: ["open"],
  }),
  club("Harvard Undergraduate Social Impact Consulting Group", {
    categories: consulting,
    shortDescription: "Pro bono consulting for nonprofits.",
    joining: open,
    joinModes: ["open"],
  }),
  club("Harvard Debate Council", {
    categories: [cat("competition-teams", "Competition teams")],
    shortDescription: "Undergraduate debate team.",
    searchTopics: "hdc consulting workshops",
    joining: open,
    joinModes: ["open"],
  }),
  // Social
  club("Harvard Community of Humanists, Atheists, and Agnostics", {
    categories: religious,
    shortDescription: "Undergraduate community of secular thinkers who meet for weekly discussions and social events.",
    joining: open,
  }),
  club("Harvard Undergraduate Kaizen Club", {
    categories: social,
    shortDescription: "Social club for making friends through weekly dinners.",
    joining: open,
  }),
  // Seasons
  club("Radcliffe Pitches", {
    categories: acap,
    recruitingSeasons: ["spring"],
    cycles: [cycle({ termKey: "2027-fall" })],
  }),
  club("Harvard College Debating Union", {
    categories: [cat("competition-teams", "Competition teams")],
    recruitingSeasons: ["fall"],
    cycles: [cycle({ termKey: "2027-spring" })],
  }),
  club("Harvard Undergraduate Federal Reserve Challenge", {
    categories: [cat("competition-teams", "Competition teams")],
    recruitingSeasons: ["spring"],
    cycles: [cycle({ termKey: "2027-spring", status: "upcoming", deadline: { at: "2027-02-06", precision: "date" } })],
  }),
  club("Harvard Spring Pattern Club", { categories: social, recruitingSeasons: ["spring"], instagramFollowers: 90000 }),
  // Graduate groups
  club("Public Health Innovation x Technology Student Forum", {
    affiliationScope: "unknown",
    categories: [cat("medicine-health", "Medicine & Health")],
    shortDescription: "The Harvard Chan forum on public health innovation and technology.",
  }),
  club("Harvard Global Health Innovation Society", {
    categories: [cat("medicine-health", "Medicine & Health")],
    shortDescription: "Undergraduates working on public health innovation and technology.",
  }),
  club("Harvard Undergraduate Health Innovation Group", {
    categories: [cat("medicine-health", "Medicine & Health")],
    shortDescription: "Undergraduates exploring health innovation and technology startups.",
  }),
];

const IX = CLUBS;
const isLeaf = (s: string) => !["performing-arts", "pre-professional"].includes(s);
const run = (text: string, limit = 60) =>
  searchLocal(IX, { text, filters: ClubFilters.parse({}), sort: "relevance", offset: 0, limit, now: NOW });
const names = (text: string) => run(text).clubs.map((c) => c.name);
const byName = (name: string) => CLUBS.find((c) => c.name === name)!;
const before = (list: string[], a: string, b: string) => {
  expect(list).toContain(a);
  expect(list).toContain(b);
  expect(list.indexOf(a)).toBeLessThan(list.indexOf(b));
};

describe("function words and negated asks (round 10)", () => {
  it("never corrects or requires function words and contractions", () => {
    // "that" had become "thai", "dont" "done", "much" "mich", "this" "thin".
    const r = run("clubs that don't need experience");
    expect(r.corrected).toBeNull();
    expect(r.constraints.map((c) => c.filter)).toEqual(["noExperience"]);
    expect(r.searchedText).toBe("");
    const crimson = run("how much time does the crimson business board take");
    expect(crimson.corrected).toBeNull();
    expect(crimson.clubs[0]?.name).toBe("The Crimson Business Board");
    const pub = run("join a consulting group this semester");
    expect(pub.corrected).toBeNull();
    expect(pub.constraints.map((c) => c.filter)).toEqual(["stillTime"]);
    expect(pub.searchedText).toContain("consulting");
    expect(parseQuery("that much this", new Set(["thai", "mich", "thin"])).corrected).toBeNull();
  });

  it("reads 'don't need experience', 'don't require applications' and 'i don't want to comp' as filters", () => {
    expect(run("dont need experience").constraints.map((c) => c.filter)).toEqual(["noExperience"]);
    expect(run("doesn't require prior experience").constraints.map((c) => c.filter)).toEqual(["noExperience"]);
    // Open membership, like "no application": the club takes everyone.
    for (const q of ["dont require applications", "don't require an application", "dont have to apply"])
      expect(run(q).constraints.map((c) => c.filter)).toEqual(["openJoin"]);
    for (const q of ["i dont want to comp", "consulting clubs that don't require a comp"])
      expect(run(q).constraints.map((c) => c.filter)).toEqual(["noComp"]);
    expect(names("dont require applications")).toContain("Harvard Undergraduate Consulting Group");
  });
});

describe("identity searches (round 10)", () => {
  it("'middle eastern' and 'mena' find Arab, Turkish, Kurdish and Israeli groups before a Middle East conference", () => {
    for (const q of ["middle eastern", "mena"]) {
      const r = names(q);
      for (const x of [
        "Harvard Society of Arab Students",
        "Harvard College Turkish Student Association",
        "Harvard Undergraduate Kurdish Cultural Association",
        "Israelis of Harvard",
      ])
        expect(r).toContain(x);
      if (r.includes("Harvard Model Congress Middle East"))
        before(r, "Harvard College Turkish Student Association", "Harvard Model Congress Middle East");
    }
  });

  it("'african' finds country groups, not a drumming group's activity list", () => {
    const r = names("african");
    expect(r[0]).toBe("Harvard African Students Association");
    for (const x of [
      "Harvard College Nigerian Students Association",
      "Harvard Undergraduate Association of Ghanaian Students",
      "Harvard Undergraduate Somali Student Association",
    ])
      expect(r).toContain(x);
    expect(r).not.toContain("The Harvard Undergraduate Drummers");
  });

  it("'<demonym> american' finds the community's groups, then the groups its Americans also join", () => {
    const k = names("korean american");
    before(k, "Harvard Korean Association", "Harvard-Radcliffe Asian American Association");
    const m = names("mexican americans");
    before(m, "Harvard Undergraduate Mexican Organization", "Fuerza Latina");
  });
});

describe("topic precision (round 10)", () => {
  it("theater: theatrical concerts and a band's plays aren't theater; the theater groups lead", () => {
    const r = names("theater");
    expect(r).not.toContain("Harvard Pops Orchestra");
    expect(r).not.toContain("Harvard University Band");
    // "Theatricals" is the word itself; a theater program for third graders follows the groups.
    expect(r[0]).toBe("Hasty Pudding Theatricals");
    before(r, "The Harvard-Radcliffe Dramatic Club", "PBHA's Student Theater Program");
    before(r, "The Harvard-Radcliffe Gilbert and Sullivan Players", "PBHA's Student Theater Program");
    expect(names("theatre")[0]).toBe("Hasty Pudding Theatricals");
  });

  it("'start a company' is startups, never a dance company", () => {
    for (const q of ["start a company", "found a company", "start a startup", "start my own business"]) {
      const r = names(q);
      expect(r[0]).toBe("Startups at Harvard");
      expect(r).not.toContain("Harvard Undergraduate Tap Company");
      expect(r).not.toContain("The Harvard Ballet Company");
    }
  });

  it("a dance named in a club's name counts though its one-liner names a community", () => {
    const r = names("ballet");
    expect(r.slice(0, 2)).toEqual(
      expect.arrayContaining(["The Harvard Ballet Company", "The Harvard Ballet Folklorico de Aztlan"]),
    );
  });

  it("'hip hop' leads with the group that says it is one, not one listing it", () => {
    before(names("hip hop"), "Expressions Dance Company", "Harvard Crimson Dance Team");
  });

  it("k-pop: the Asian dance troupe, then Korean groups, then other dance groups", () => {
    for (const q of ["k-pop", "kpop"]) {
      const r = names(q);
      expect(r[0]).toBe("Harvard Asian American Dance Troupe");
      before(r, "Harvard Korean Association", "Harvard Crimson Dance Team");
      expect(r).not.toContain("Harvard-Radcliffe Asian American Association");
    }
  });

  it("'dont audition': clubs saying so and performing groups first; tryouts mean teams", () => {
    const r = names("dont audition");
    expect(r.slice(0, 2)).toEqual(expect.arrayContaining(["Harvard Asian American Dance Troupe", "The Noteables"]));
    before(r, "The Noteables", "Harvard Combat Sports Club");
    expect(r).not.toContain("Harvard Opportunes");
    before(names("no tryouts"), "Harvard Combat Sports Club", "The Noteables");
  });

  it("'make friends': 'Community' in a name doesn't stand in for meeting people", () => {
    before(
      names("make friends"),
      "Harvard Undergraduate Kaizen Club",
      "Harvard Community of Humanists, Atheists, and Agnostics",
    );
  });
});

describe("constraints (round 10)", () => {
  it("'no comp finance' with none left offers the no-cut comps", () => {
    const r = run("no comp finance");
    expect(r.total).toBe(0);
    const hint = r.relaxed.find((x) => x.constraint === "noComp");
    expect(hint?.noCuts?.map((c) => c.name)).toEqual(["Harvard Undergraduate Alternative Investment Club"]);
  });

  it("an activity-list mention doesn't answer a topic under a constraint", () => {
    const r = names("consulting dont require applications");
    expect(r).toContain("Harvard Undergraduate Consulting Group");
    expect(r).not.toContain("Harvard Debate Council");
    // Without a constraint it still shows, after the consulting groups.
    before(names("consulting"), "Harvard Undergraduate Social Impact Consulting Group", "Harvard Debate Council");
  });

  it("a typed season puts dated and announced rounds in it first and follows announced rounds", () => {
    const r = run("what can i join in spring");
    expect(r.constraints.map((c) => c.filter)).toEqual(["recruitingSeason"]);
    const order = r.clubs.map((c) => c.name);
    expect(order[0]).toBe("Harvard Undergraduate Federal Reserve Challenge");
    expect(order[1]).toBe("Harvard College Debating Union");
    expect(order).toContain("Harvard Spring Pattern Club");
    // Announced for Fall 2027: not a spring club, whatever its pattern says.
    expect(order).not.toContain("Radcliffe Pitches");
    expect(names("fall recruiting")).toContain("Radcliffe Pitches");
  });
});

describe("topics, resumes and similar clubs (round 10)", () => {
  it("Finance & consulting picks business groups by name, not arts business", () => {
    const fc = INTENTS.find((i) => i.slug === "finance-consulting")!;
    expect(matchesIntent(byName("The Crimson Business Board"), fc)).toBe(true);
    expect(matchesIntent(byName("Harvard Undergraduate Federal Reserve Challenge"), fc)).toBe(true);
    expect(matchesIntent(byName("Harvard Undergraduate Music Business Association"), fc)).toBe(false);
  });

  it("an instrument on a resume ranks its club before generic music; clinical work is pre-med", () => {
    const piano = readResumeInterests("Jane Doe\nEXPERIENCE\nTaught piano to children\nPlayed piano at recitals", IX);
    expect(piano.map((i) => i.key)).toContain("w:piano");
    expect(matchResume(IX, piano)[0]?.club.name).toBe("Harvard College Students Piano Society");
    const hospital = readResumeInterests("John Roe\nVolunteer at a hospital, transporting patients", IX);
    expect(hospital.map((i) => i.key)).toContain("c:premed");
  });

  it("a graduate group named so follows College groups in similar clubs", () => {
    expect(graduateNamed(byName("Public Health Innovation x Technology Student Forum"))).toBe(true);
    expect(graduateNamed(byName("Harvard Global Health Innovation Society"))).toBe(false);
    const sim = similarClubs(byName("Harvard Global Health Innovation Society"), IX, { isLeaf, limit: 5 }).map(
      (s) => s.club.name,
    );
    before(sim, "Harvard Undergraduate Health Innovation Group", "Public Health Innovation x Technology Student Forum");
  });
});
