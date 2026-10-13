import { describe, expect, it } from "vitest";
import { normalizeName } from "@hci/core";
import {
  ClubFilters,
  INTENTS,
  interpretQuery,
  matchesIntent,
  matchResume,
  NO_JOINING_FACTS,
  readResumeInterests,
  reasonText,
  searchLocal,
  similarClubs,
  type IndexClub,
} from "../src/local";

/**
 * Round-12 ranking from student testing (2026-10-13; a sophomore pre-professional, a first-year
 * musician and a keyboard/screen-reader junior): class years read like "for freshmen"; a
 * category club whose topic word sits in its activity list still answers a season; a word in a
 * list of chores isn't the topic; case interviews are consulting; a Startups & VC topic;
 * "no audition" puts auditioning clubs last; instruments and orchestras apart from the music
 * umbrella; "sing" reads "Singers"; /match reads orchestras and puts audience clubs after
 * general ones; Volunteer orders service programs first; a parent's programs are similar to it;
 * stated hours alone never outrank the topic word. Hand-made index; descriptions invented.
 */
const NOW = new Date("2026-10-13T16:00:00Z");
const J = NO_JOINING_FACTS;
let n = 0;
const cat = (slug: string, name = slug) => ({ slug, name, isPrimary: false });

function club(name: string, over: Partial<IndexClub> = {}): IndexClub {
  const cats = over.categories ?? [];
  return {
    id: `r12-${++n}`,
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

const finance = [cat("pre-professional", "Pre-professional"), cat("finance", "Finance & Investing")];
const consulting = [cat("pre-professional", "Pre-professional"), cat("consulting", "Consulting")];
const pol = [cat("political-advocacy", "Politics & Policy")];
const music = [cat("performing-arts", "Performing Arts"), cat("music", "Music")];
const acappella = [cat("performing-arts", "Performing Arts"), cat("a-cappella", "A cappella")];
const service = [cat("public-service", "Public Service")];
const mentoring = [cat("public-service", "Public Service"), cat("mentoring-education", "Mentoring & Education")];
const entre = [cat("entrepreneurship", "Entrepreneurship")];
const tech = [cat("technology", "Technology & Engineering")];
const religious = [cat("religious-spiritual", "Religious & Spiritual")];
const application = { ...J, access: "process" as const, general: ["application" as const] };
const audition = { ...J, access: "process" as const, general: ["audition" as const] };
const open = { ...J, access: "open" as const, general: ["open" as const], noExperience: true as const };
const ALL_YEARS = ["first_year", "sophomore", "junior", "senior"] as IndexClub["eligibleClasses"];

const CLUBS: IndexClub[] = [
  // Finance and consulting
  club("Harvard Financial Analysts Club", {
    categories: finance,
    shortDescription: "Student group teaching finance through stock pitches.",
    eligibleClasses: ALL_YEARS,
    recruitingSeasons: ["fall"],
  }),
  club("Harvard Investment Association", {
    categories: finance,
    shortDescription: "Student investment fund teaching finance.",
    instagramFollowers: 5000,
    recruitingSeasons: ["spring"],
  }),
  club("Harvard Undergraduate Data Analytics Group", {
    acronym: "HDAG",
    categories: [...consulting, ...tech],
    shortDescription: "Non-profit student group turning organizations' data into decisions.",
    searchTopics: "pro bono consulting data science workshops",
    recruitingSeasons: ["fall", "spring"],
  }),
  club("Harvard Undergraduate Consulting Group", {
    categories: consulting,
    shortDescription: "Student consulting firm advising companies.",
    recruitingSeasons: ["spring"],
  }),
  club("Harvard Strategy Consulting Partners", {
    categories: consulting,
    shortDescription: "Student consultants running client projects.",
  }),
  club("Conferences Committee", {
    categories: pol,
    shortDescription:
      "Student program running political conferences, handling scheduling, publicity, finances, and hospitality.",
    joinModes: ["application"],
    joining: application,
    recruitingSeasons: ["fall", "spring"],
  }),
  // Startups
  club("Harvard College Ventures", {
    categories: tech,
    shortDescription: "Student group connecting undergraduates with founders and startups.",
  }),
  club("Startups at Harvard", { categories: entre }),
  club("Harvard Undergraduate Venture Capital Group", {
    acronym: "VCG",
    categories: [...entre, ...finance],
    shortDescription: "Student group investing in early-stage companies.",
  }),
  club("Harvard Startup Jazz Band", {
    categories: music,
    shortDescription: "Jazz band playing at startup launch parties.",
  }),
  // Music
  club("Harvard Radcliffe Orchestra", {
    categories: music,
    shortDescription: "Student-run symphony orchestra.",
    joinModes: ["audition"],
    joining: audition,
    instagramFollowers: 3000,
  }),
  club("Mozart Society Orchestra", { categories: music, shortDescription: "Undergraduate chamber orchestra." }),
  club("Harvard Undergraduate Music Business Association", {
    categories: music,
    shortDescription: "Student group exploring careers in the music industry.",
    instagramFollowers: 4000,
  }),
  club("Harvard Steel Drum Ensemble", {
    categories: music,
    shortDescription: "Open steel drum ensemble, no experience needed.",
    joinModes: ["open"],
    joining: open,
  }),
  club("Harvard Crimson Cellos", {
    categories: [cat("performing-arts", "Performing Arts")],
    shortDescription: "Cello ensemble arranging popular songs.",
  }),
  club("The Kuumba Singers of Harvard", {
    categories: music,
    shortDescription: "Choir expressing the creativity and spirituality of Black people through song.",
  }),
  club("Harvard Fallen Leaves", { categories: acappella, shortDescription: "Co-ed a cappella group." }),
  club("Harvard Night Owls", { categories: acappella, shortDescription: "All-gender a cappella group." }),
  club("Harvard Undergraduate Choir", {
    categories: music,
    shortDescription: "Mixed choir singing sacred music.",
  }),
  club("Harvard Shalom Chorus", {
    categories: acappella,
    shortDescription: "Jewish a cappella group singing in Hebrew.",
    instagramFollowers: 9000,
  }),
  // Service
  club("The Phillips Brooks House Association", {
    acronym: "PBHA",
    orgType: "public_service_program",
    categories: service,
    shortDescription: "Umbrella for student-run public service programs.",
    searchNames: "phillips brooks house association | pbha",
  }),
  club("PBHA's Chinatown Afterschool Program", {
    categories: mentoring,
    shortDescription: "Volunteer tutors running an afterschool program for Chinatown children.",
  }),
  club("PBHA's Prison Education Project", {
    categories: service,
    shortDescription: "Volunteers teaching classes in local prisons.",
  }),
  club("Harvard Model Nations Conference", {
    categories: [...pol, cat("mentoring-education", "Mentoring & Education"), cat("public-service", "Public Service")],
    shortDescription: "Student-run conference hosting high school delegates.",
    instagramFollowers: 20000,
  }),
  club("Harvard Global Health Forum", {
    categories: [cat("medicine-health", "Health"), ...mentoring],
    shortDescription: "Student forum on global health careers.",
    hoursPerWeek: { min: null, max: 1 },
  }),
  club("Harvard Food Rescue", {
    categories: service,
    shortDescription: "Volunteers collecting surplus dining hall food for shelters.",
  }),
  club("Harvard Catholic Forum", {
    categories: religious,
    shortDescription: "Lectures on theology and scripture.",
    searchTopics: "lectures schola sings at sunday mass",
  }),
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
  if (list.includes(b)) expect(list.indexOf(a)).toBeLessThan(list.indexOf(b));
};

describe("class years read like 'for freshmen' (Round 12)", () => {
  it("is never required text and never a spelling problem", () => {
    const q = interpretQuery("finance clubs for sophomores");
    expect(q.text).toBe("finance clubs");
    const r = search("finance clubs for sophomores");
    expect(r.total).toBeGreaterThan(0);
    expect(r.unknownWords).toEqual([]);
    expect(r.soft).toEqual(["sophomores"]);
    // A club stating it takes sophomores first.
    expect(r.clubs[0]!.name).toBe("Harvard Financial Analysts Club");
    expect(r.reasons[r.clubs[0]!.id]!.map(reasonText)).toContain("Says it takes sophomores");
  });

  it("covers juniors, seniors and upperclassmen; alone it asks what they can still join", () => {
    expect(interpretQuery("consulting for juniors").text).toBe("consulting");
    expect(interpretQuery("finance for upperclassmen").text).toBe("finance");
    expect(search("clubs for seniors").constraints.map((c) => c.filter)).toEqual(["stillTime"]);
    expect(search("consulting for juniors").total).toBeGreaterThan(0);
  });

  it("says a word is unknown only when it is", () => {
    expect(search("finance zqxvb").unknownWords).toEqual(["zqxvb"]);
    expect(search("finance consulting").unknownWords).toEqual([]);
  });
});

describe("a category club answers a season and a constraint (Round 12)", () => {
  it("keeps a Consulting club whose word is only in its activity list", () => {
    const r = search("consulting spring");
    const got = r.clubs.map((c) => c.name);
    expect(got).toContain("Harvard Undergraduate Data Analytics Group");
    const hdag = r.clubs.find((c) => c.acronym === "HDAG")!;
    expect(r.reasons[hdag.id]).toContainEqual(expect.objectContaining({ kind: "category", slug: "consulting" }));
    // The same rule under another constraint.
    expect(names("consulting no comp")).not.toContain("Harvard Strategy Consulting Partners");
    expect(names("consulting fall")).toContain("Harvard Undergraduate Data Analytics Group");
  });

  it("drops a word in a list of chores under a constraint", () => {
    expect(names("finance spring")).toEqual(["Harvard Investment Association"]);
    expect(names("finance fall")).not.toContain("Conferences Committee");
    // Without a constraint it is still found, after the finance clubs.
    before(names("finance"), "Harvard Investment Association", "Conferences Committee");
  });
});

describe("case interviews are consulting (Round 12)", () => {
  it("finds consulting clubs", () => {
    for (const q of ["case interview", "case interviews", "case prep"]) {
      const got = names(q);
      expect(got).toContain("Harvard Undergraduate Consulting Group");
      expect(got).toContain("Harvard Undergraduate Data Analytics Group");
      expect(got).not.toContain("Conferences Committee");
    }
  });
});

describe("Startups & VC topic (Round 12)", () => {
  const intent = INTENTS.find((i) => i.slug === "explore-startups")!;
  it("picks founders, startups and venture capital groups, never a band", () => {
    const got = CLUBS.filter((c) => matchesIntent(c, intent)).map((c) => c.name);
    expect(got).toEqual(
      expect.arrayContaining([
        "Harvard College Ventures",
        "Startups at Harvard",
        "Harvard Undergraduate Venture Capital Group",
      ]),
    );
    expect(got).not.toContain("Harvard Startup Jazz Band");
  });
});

describe("musicians (Round 12)", () => {
  it("'no audition' puts auditioning clubs last, whatever their name", () => {
    const got = names("orchestra no audition");
    expect(got.at(-1)).toBe("Harvard Radcliffe Orchestra");
    expect(got[0]).toBe("Mozart Society Orchestra");
    expect(names("music no audition").at(-1)).toBe("Harvard Radcliffe Orchestra");
  });

  it("an open club found only through the wider Music category doesn't lead an orchestra query", () => {
    before(names("orchestra no audition"), "Mozart Society Orchestra", "Harvard Steel Drum Ensemble");
    // "Music" is still the topic itself for "music beginner".
    expect(names("music beginner")[0]).toBe("Harvard Steel Drum Ensemble");
  });

  it("instrument words find orchestras and string groups before the music umbrella", () => {
    for (const q of ["violin", "viola", "strings"]) {
      before(names(q), "Mozart Society Orchestra", "Harvard Undergraduate Music Business Association");
      before(names(q), "Harvard Radcliffe Orchestra", "Harvard Undergraduate Music Business Association");
    }
    expect(names("cello")[0]).toBe("Harvard Crimson Cellos");
    before(names("cello"), "Harvard Crimson Cellos", "Harvard Undergraduate Music Business Association");
  });

  it("'sing' reads a name's 'Singers' as the word itself", () => {
    const got = names("sing");
    before(got, "The Kuumba Singers of Harvard", "Harvard Fallen Leaves");
    before(got, "The Kuumba Singers of Harvard", "Harvard Catholic Forum");
    expect(got.at(-1)).toBe("Harvard Catholic Forum");
    // The stem keeps three letters ("sing" isn't "s"): "singer" too.
    before(names("singer"), "The Kuumba Singers of Harvard", "Harvard Night Owls");
  });

  it("/match reads violin and orchestra, and puts audience clubs after general ones", () => {
    const resume =
      "Jane Doe\nConcertmaster, Lexington Symphony Orchestra (violin)\nSoprano in chamber choir\nAll-State Orchestra";
    const interests = readResumeInterests(resume, CLUBS);
    expect(interests.map((i) => i.label)).toContain("Orchestra & strings");
    const got = matchResume(CLUBS, interests).map((m) => m.club.name);
    expect(got[0]).toBe("Harvard Radcliffe Orchestra");
    before(got, "Mozart Society Orchestra", "Harvard Shalom Chorus");
    before(got, "Harvard Undergraduate Choir", "Harvard Shalom Chorus");
    // A resume naming the faith keeps its group where it was.
    const named = readResumeInterests(`${resume}\nHillel Jewish a cappella`, CLUBS);
    expect(matchResume(CLUBS, named).map((m) => m.club.name)).toContain("Harvard Shalom Chorus");
  });
});

describe("volunteering (Round 12)", () => {
  it("the Volunteer topic orders service programs before secondary-category clubs", () => {
    const got = names("", { intent: "volunteer" });
    before(got, "PBHA's Chinatown Afterschool Program", "Harvard Model Nations Conference");
    before(got, "Harvard Food Rescue", "Harvard Model Nations Conference");
    before(got, "The Phillips Brooks House Association", "Harvard Global Health Forum");
  });

  it("stated hours alone never outrank clubs saying the topic word", () => {
    const got = names("volunteer low commitment");
    before(got, "Harvard Food Rescue", "Harvard Global Health Forum");
    before(got, "PBHA's Prison Education Project", "Harvard Global Health Forum");
  });

  it("a parent's programs are its similar clubs, and the parent theirs", () => {
    const pbha = CLUBS.find((c) => c.acronym === "PBHA")!;
    const got = similarClubs(pbha, CLUBS, { isLeaf: (s) => s !== "public-service" });
    expect(got.slice(0, 2).map((s) => s.club.name)).toEqual(
      expect.arrayContaining(["PBHA's Chinatown Afterschool Program", "PBHA's Prison Education Project"]),
    );
    expect(got[0]!.reasons[0]).toBe("A PBHA program");
    const program = CLUBS.find((c) => c.name === "PBHA's Prison Education Project")!;
    const back = similarClubs(program, CLUBS, { isLeaf: (s) => s !== "public-service" });
    expect(back.map((s) => s.club.name)).toContain("The Phillips Brooks House Association");
  });
});
