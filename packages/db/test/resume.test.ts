import { describe, expect, it } from "vitest";
import { normalizeName } from "@hci/core";
import {
  clubAudience,
  likelyGraduate,
  matchResume,
  NO_JOINING_FACTS,
  readResumeInterests,
  resumeAudiences,
  type IndexClub,
} from "../src/local";

/** Resume → club recommendations. Hand-made index; names illustrative, text invented for the test. */
let n = 0;
const cat = (slug: string, name = slug) => ({ slug, name, isPrimary: false });

function club(name: string, over: Partial<IndexClub> = {}): IndexClub {
  return {
    id: `rs-${++n}`,
    slug: normalizeName(name).replace(/ /g, "-"),
    name,
    acronym: null,
    shortDescription: null,
    orgType: null,
    recognitionStatus: "recognized",
    activityStatus: "active",
    joinModes: [],
    freshmenEligible: null,
    joining: NO_JOINING_FACTS,
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
    quickLinks: { website: null, instagram: null },
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

const CLUBS = [
  club("Harvard Investment Club", {
    categories: [cat("finance", "Finance")],
    shortDescription: "Student investing fund.",
  }),
  club("Harvard Computer Society", { categories: [cat("tech", "Tech")], shortDescription: "Software projects." }),
  club("Harvard Undergraduate Bhangra", { categories: [cat("dance", "Dance")] }),
  club("Radcliffe Pitches", { categories: [cat("a-cappella", "A cappella")] }),
  club("Phillips Brooks House Association", { categories: [cat("public-service", "Public service")] }),
  club("Harvard Rowing Club"),
  club("Harvard Law School Investing Group", {
    categories: [cat("finance", "Finance")],
    affiliationScope: "graduate_school",
  }),
  club("Old Investing Society", { categories: [cat("finance", "Finance")], activityStatus: "defunct" }),
];

const keys = (text: string) => readResumeInterests(text, CLUBS).map((i) => i.key);

describe("readResumeInterests", () => {
  it("reads topics and counts repeats", () => {
    const ints = readResumeInterests(
      "Jane Doe\nSummer intern: equity research, investment banking, stock pitches\nBuilt software in Python",
      CLUBS,
    );
    const finance = ints.find((i) => i.key === "c:finance");
    expect(finance?.count).toBeGreaterThanOrEqual(2);
    expect(ints.map((i) => i.key)).toContain("c:software");
  });

  it("skips contact lines and the name at the top", () => {
    // "Bhangra" as someone's surname on the first line, and an email naming Rowing, are not interests.
    expect(keys("Alex Bhangra\nalex.rowing@example.com | (617) 555-1234\nChess")).toEqual([]);
  });

  it("takes a rare club-name word only as a capitalized name, not an ordinary word", () => {
    expect(keys("Analyst\nstock pitches to the fund")).not.toContain("w:pitches");
    expect(keys("Analyst\nBhangra dancer for 10 years")).toContain("w:bhangra");
  });

  it("drops a club-name word inside a longer proper name (a school)", () => {
    expect(keys("Alex Kim\nPhillips Academy, Class of 2030")).not.toContain("w:phillips");
  });

  it("never reads generic resume phrases as topics", () => {
    expect(keys("Alex\nRan social media for a cafe; customer service")).toEqual([]);
  });
});

describe("matchResume", () => {
  it("ranks clubs for the resume's interests and says why", () => {
    const ints = readResumeInterests("Alex\nInvestment club treasurer; equity research; Bhangra dancer", CLUBS);
    const picks = matchResume(CLUBS, ints);
    const names = picks.map((p) => p.club.name);
    expect(names).toContain("Harvard Investment Club");
    expect(names).toContain("Harvard Undergraduate Bhangra");
    expect(picks.find((p) => p.club.name === "Harvard Investment Club")?.interests).toContain("Finance & investing");
  });

  it("leaves out graduate-school groups and clubs that ended", () => {
    const ints = readResumeInterests("Alex\nInvestment club; investing; finance", CLUBS);
    const names = matchResume(CLUBS, ints).map((p) => p.club.name);
    expect(names).not.toContain("Harvard Law School Investing Group");
    expect(names).not.toContain("Old Investing Society");
  });

  it("returns nothing without interests", () => {
    expect(matchResume(CLUBS, [])).toEqual([]);
  });
});

describe("resume review regressions", () => {
  const more = [
    ...CLUBS,
    club("Strong Women Strong Girls", { categories: [cat("public-service", "Public service")] }),
    club("Harvard Chess Club"),
  ];

  it("reads a one-line list of interests (not taken for a name)", () => {
    expect(readResumeInterests("coding, debate, a cappella", more).map((i) => i.key)).toEqual(
      expect.arrayContaining(["c:software", "c:debate", "c:a-cappella"]),
    );
    expect(readResumeInterests("Rowing, Chess", more).map((i) => i.key)).toContain("w:chess");
  });

  it("never reads an outside organization's name as the student's identity", () => {
    const ints = readResumeInterests("Alex\nVolunteer tutor at Boys & Girls Club", more).map((i) => i.key);
    expect(ints).not.toContain("w:girls");
    expect(ints).not.toContain("w:boys");
  });

  it("reads skills and job titles as topics", () => {
    const ints = readResumeInterests("Alex\nPython, SQL\nequity research and valuation", more).map((i) => i.key);
    expect(ints).toEqual(expect.arrayContaining(["c:software", "c:finance"]));
  });

  it("spreads picks across interests when the second is at least half as strong", () => {
    const fin = Array.from({ length: 8 }, (_, k) =>
      club(`Investing Fund ${String.fromCharCode(65 + k)}`, { categories: [cat("finance", "Finance")] }),
    );
    const clubs = [...fin, club("Harvard Undergraduate Bhangra", { categories: [cat("dance", "Dance")] })];
    const ints = readResumeInterests("Alex\ninvesting investing investing finance\nBhangra", clubs);
    const names = matchResume(clubs, ints).map((p) => p.club.name);
    expect(names.indexOf("Harvard Undergraduate Bhangra")).toBeLessThan(6);
  });

  it("suggests women's or men's clubs only when the resume places the student there", () => {
    const tech = [cat("tech", "Tech")];
    const clubs = [
      club("Harvard Computer Society", { categories: tech }),
      club("Harvard Undergraduate Women in Computer Science", { categories: tech }),
      club("Harvard Men's Soccer Club"),
      club("Harvard Women's Soccer Club"),
      club("Fox Club", { shortDescription: "All-male final club for undergraduates." }),
      club("SAB Club", { shortDescription: "Gender-neutral final club, founded as an all-women's society." }),
    ];
    expect(clubAudience(clubs[1]!)).toBe("women");
    expect(clubAudience(clubs[2]!)).toBe("men");
    expect(clubAudience(clubs[4]!)).toBe("men");
    expect(clubAudience(clubs[5]!)).toBeNull();
    const pick = (text: string) =>
      matchResume(clubs, readResumeInterests(text, clubs), 30, undefined, resumeAudiences(text)).map(
        (p) => p.club.name,
      );
    const man = pick("John Smith\nBuilt software in Python and Java\nSoccer");
    expect(man).toContain("Harvard Computer Society");
    expect(man).not.toContain("Harvard Undergraduate Women in Computer Science");
    expect(man).not.toContain("Harvard Women's Soccer Club");
    const woman = pick("Jane Doe\nBuilt software in Python\nSociety of Women Engineers\nWomen's Varsity Soccer");
    expect(woman).toContain("Harvard Undergraduate Women in Computer Science");
    expect(woman).not.toContain("Harvard Men's Soccer Club");
    expect(resumeAudiences("Men's Lacrosse, captain")).toEqual(new Set(["men"]));
    expect(resumeAudiences("Python, React")).toEqual(new Set());
  });
});

describe("student testing round 4: a pre-med resume", () => {
  const bio = [cat("academic-stem", "Academic & Research")];
  const sport = [cat("athletics-recreation", "Athletics")];
  const service = [cat("public-service", "Public service")];
  const clubs = [
    club("Harvard Undergraduate OpenBio Laboratory", {
      categories: bio,
      shortDescription: "Biology lab space with cell culture and a community of builders.",
    }),
    club("CrimsonEMS", {
      categories: [cat("medicine-health", "Health & Medicine")],
      shortDescription: "Student-run emergency medical services group that trains students as EMTs.",
    }),
    club("Harvard Premedical Society", { categories: [cat("medicine-health", "Health & Medicine")] }),
    club("Tennis (Club Sport)", { categories: sport, affiliationScope: "unknown" }),
    club("Harvard Table Tennis Club", { categories: sport }),
    club("Harvard Men's Tennis Club", { categories: sport }),
    club("Harvard Women's Tennis Club", { categories: sport }),
    club("Harvard Squash Club", { categories: sport }),
    club("Work Force Tutoring", { categories: service, shortDescription: "Volunteer tutoring and homework help." }),
    club("PBHA Refugee Youth Tutoring", { categories: service }),
    club("PBHA Food Pantry", { categories: service, shortDescription: "Volunteers run a weekly food pantry." }),
    club("Minority Biomedical Scientists of Harvard", {
      categories: [...bio, cat("medicine-health", "Health & Medicine")],
      affiliationScope: "unknown",
      shortDescription: "Career development for scientists from underrepresented groups.",
    }),
    club("Harvard Undergraduate Biology Society", {
      categories: [...bio, cat("medicine-health", "Health & Medicine")],
      shortDescription: "Biology research talks.",
    }),
  ];
  const RESUME = [
    "Alex Kim",
    "Undergraduate Researcher, Smith Lab: cell culture and tissue culture, biology research",
    "Hospital Volunteer",
    "Volunteer EMT trainee",
    "Tutored high school students in chemistry",
    "Club tennis",
  ].join("\n");
  const ints = () => readResumeInterests(RESUME, clubs);
  const matches = () => matchResume(clubs, ints(), 30);
  const picks = () => matches().map((p) => p.club.name);
  const read = (text: string) => readResumeInterests(text, clubs);

  it("reads lab phrases as biology, never as culture", () => {
    const k = ints().map((i) => i.key);
    expect(k).not.toContain("c:culture");
    expect(k).toContain("c:biology");
    expect(read("Alex\nGrew bacterial cultures and cell lines").map((i) => i.key)).not.toContain("c:culture");
    expect(read("Alex\nShaped our company culture").map((i) => i.key)).not.toContain("c:culture");
    // A student's own culture still counts.
    expect(read("Alex\nKorean cultural society").map((i) => i.key)).toContain("c:culture");
  });

  it("reaches a club named for the activity through a credential (EMT → CrimsonEMS)", () => {
    expect(ints().map((i) => i.label)).toContain("EMS");
    const ems = matches().find((m) => m.club.name === "CrimsonEMS");
    expect(ems?.interests[0]).toBe("EMS");
    expect(ems?.reasons.map((r) => r.kind)).toContain("name");
    const names = picks();
    // It leads the other health clubs, which the resume reaches only by topic.
    expect(names.indexOf("CrimsonEMS")).toBeLessThan(names.indexOf("Harvard Premedical Society"));
    expect(read("Alex\nParamedic, 2 years").map((i) => i.label)).toContain("EMS");
  });

  it("reads lowercase sports as interests (club tennis, intramural squash)", () => {
    expect(ints().map((i) => i.key)).toContain("w:tennis");
    expect(picks()).toContain("Tennis (Club Sport)");
    // Gendered teams still need the resume to say so.
    expect(picks()).not.toContain("Harvard Men's Tennis Club");
    expect(read("Alex\nintramural squash").map((i) => i.key)).toContain("w:squash");
  });

  it("reads tutoring verbs as a tutoring interest that reaches tutoring programs, not all service", () => {
    expect(ints().map((i) => i.label)).toContain("Tutoring");
    const names = picks();
    expect(names).toContain("Work Force Tutoring");
    expect(names).toContain("PBHA Refugee Youth Tutoring");
    expect(matches().find((m) => m.club.name === "PBHA Food Pantry")?.interests ?? []).not.toContain("Tutoring");
    expect(read("Alex\nTutor for SAT prep").map((i) => i.label)).toContain("Tutoring");
  });

  it("ranks a likely-graduate group below the College's own picks", () => {
    const names = picks();
    expect(names).toContain("Harvard Undergraduate Biology Society");
    expect(names.indexOf("Minority Biomedical Scientists of Harvard")).toBeGreaterThan(
      names.indexOf("Harvard Undergraduate Biology Society"),
    );
    expect(likelyGraduate(clubs.find((c) => c.name.startsWith("Minority"))!)).toBe(true);
    const sitn = club("Science in the News", {
      affiliationScope: "unknown",
      shortDescription: "Gives science PhD students teaching practice.",
    });
    expect(likelyGraduate(sitn)).toBe(true);
    const mixed = club("AI Safety Team", {
      affiliationScope: "cross_school",
      shortDescription: "Supports undergraduate and graduate students in research.",
    });
    expect(likelyGraduate(mixed)).toBe(false);
    expect(likelyGraduate(club("Society of Black Scientists and Engineers"))).toBe(false);
  });
});

describe("a math/CS resume with publications and section headings (owner's test resume 2026-10-17)", () => {
  const clubs = [
    club("Harvard Poker Club", { categories: [cat("games", "Hobbies & Games")] }),
    club("Harvard Financial Analysts Club", { categories: [cat("finance", "Finance")] }),
    club("Cancer Awareness Society", { categories: [cat("health", "Health")] }),
    club("Patient Advocacy Collective", { categories: [cat("health", "Health")] }),
    club("Academic Bowl Team", { categories: [cat("academic", "Academic")] }),
    club("Harvard Undergraduate Mathematics Association", { categories: [cat("math", "Math")] }),
    club("Startups at Harvard", { categories: [cat("startups", "Startups")] }),
  ];
  const text = [
    "Jordan Lee",
    "jlee@college.harvard.edu ◦ (555) 555-0100",
    "Education",
    "Harvard University Aug 2026 – May 2030 (expected)",
    "• Relevant Coursework: Math 55a (Studies in Algebra), Stat 110, CS 121",
    "• Activities: Harvard Financial Analysts Club,",
    "Startups @ Harvard, Harvard Computer Society, Poker Club",
    "Experience",
    "Intern, Example Labs New York, NY",
    "• Built machine learning models in Python",
    "Publications",
    "Machine learning for predicting adverse events in clinical patients. Journal of Examples, 2026",
    "Kinase Inhibitors in Cancer Patients Using Tissue Selectivity. Clinical Pharmacology, 2026 (co-author)",
    "Academic Competition Awards",
    "USA Math Olympiad Silver Medalist 2026",
    "Technical Skills",
    "Languages: Python, Java, TypeScript",
  ].join("\n");
  const interests = readResumeInterests(text, clubs);
  const keys = interests.map((i) => i.key);

  it("reads nothing from paper titles under Publications", () => {
    expect(keys).not.toContain("c:premed");
    expect(keys).not.toContain("w:patients");
    expect(keys).not.toContain("w:cancer");
  });
  it("never makes a chip of a section heading, a place name or a plural job title", () => {
    expect(keys).not.toContain("w:academic");
    expect(keys).not.toContain("c:journalism"); // "New York" isn't news; "Publications" is a heading
    expect(keys).not.toContain("w:analysts");
    expect(keys).not.toContain("w:studies");
  });
  it("reads a line with an @ that isn't an email, and keeps the real interests", () => {
    expect(keys).toEqual(expect.arrayContaining(["c:software", "c:ai", "c:math", "c:entrepreneurship", "w:poker"]));
  });
  it("reads topics from a heading line but no club-name words", () => {
    expect(keys).toContain("c:competition"); // "Academic Competition Awards"
  });
});

describe("resume sections and noise words: what must still be read (review of the 2026-10-17 fix)", () => {
  const clubs = [
    club("Harvard Ballet Company", { categories: [cat("dance", "Dance")] }),
    club("Harvard Undergraduate Bhangra", { categories: [cat("dance", "Dance")] }),
    club("Harvard Robotics Club", { categories: [cat("tech", "Tech")] }),
    club("Natives at Harvard College", { categories: [cat("cultural", "Cultural & identity")] }),
    club("Harvard Undergraduates of New Zealand", { categories: [cat("cultural", "Cultural & identity")] }),
    club("Harvard Mock Trial Association", { categories: [cat("debate", "Debate")] }),
    club("Harvard Debate Council", { categories: [cat("debate", "Debate")] }),
  ];
  const keysOf = (text: string) => readResumeInterests(text, clubs).map((i) => i.key);

  it("a publications section ends at the next heading, even one it doesn't know", () => {
    for (const next of ["Skills, Activities & Interests", "Hobbies", "Leadership/Activities", "Activities:"]) {
      const keys = keysOf(
        [
          "Experience",
          "Intern",
          "Publications",
          "Kim A. Memory consolidation in mice. 2025",
          next,
          "Bhangra, piano",
        ].join("\n"),
      );
      expect(keys, next).toContain("w:bhangra");
      expect(keys, next).toContain("c:music");
    }
  });
  it("a paper title wrapped across lines, or a journal's name, doesn't end the publications section", () => {
    const keys = keysOf(
      [
        "Publications",
        "Kinase Inhibitors in Cancer",
        "Patients Using Tissue Selectivity",
        "Journal of Clinical Oncology",
        "Hospital patient outcomes, 2026 (co-author)",
        "Hobbies",
        "Bhangra",
      ].join("\n"),
    );
    expect(keys).not.toContain("c:premed");
    expect(keys).toContain("w:bhangra");
  });
  it("a heading that also names research isn't a publications section", () => {
    const keys = keysOf("Research & Publications\nResearch Assistant, Robotics lab: built drones in Python");
    expect(keys).toEqual(expect.arrayContaining(["c:robotics", "c:software"]));
  });
  it("New Zealand stays a name, and a new pipeline is not news", () => {
    expect(keysOf("Experience\nHarvard Undergraduates of New Zealand, social chair")).toContain("w:zealand");
    expect(keysOf("Experience\nDeveloped a new data pipeline in Python")).not.toContain("c:journalism");
  });
  it("a club's plural name word is not a noise word", () => {
    expect(keysOf("Activities\nNatives at Harvard College, board member")).toContain("w:natives");
  });
  it("a named activity keeps its own chip beside its topic (Mock Trial)", () => {
    const interests = readResumeInterests("Activities\nMock Trial, witness", clubs);
    expect(interests.map((i) => i.key)).toContain("w:mock trial");
    expect(matchResume(clubs, interests)[0]?.club.name).toBe("Harvard Mock Trial Association");
  });
  it("writing code is software, never journalism; writing articles still is", () => {
    expect(keysOf("Experience\nDeveloped recovery software, writing Go implementation")).not.toContain("c:journalism");
    expect(keysOf("Experience\nWrote articles for the school newspaper")).toContain("c:journalism");
  });
  it("still drops a plain email line", () => {
    expect(keysOf("Experience\nbhangra.fan@college.harvard.edu\nRowing")).not.toContain("w:bhangra");
  });
});

describe("chips on a biology and film resume (persona round 8, 2026-10-17)", () => {
  const clubs = [
    club("Harvard Undergraduate Film Club", { categories: [cat("hobbies-games", "Hobbies & Games")] }),
    club("Harvard Video Game Development Club", { categories: [cat("technology", "Tech")] }),
    club("Harvard Microbiology Society", { categories: [cat("academic-stem", "Academic")] }),
    club("Harvard Hobbies Club", { categories: [cat("hobbies-games", "Hobbies & Games")] }),
    club("Harvard Mock Trial Association", { categories: [cat("debate", "Debate")] }),
    club("Harvard Debate Council", { categories: [cat("debate", "Debate")] }),
  ];
  const keys = (text: string) => readResumeInterests(text, clubs).map((i) => i.key);

  it("a section heading is never a chip", () => {
    expect(keys("Experience\nIntern\nHobbies\nPhotography")).not.toContain("c:hobbies");
  });
  it("no word chip that repeats its topic (Films beside Film & video) or names another sense (Videos)", () => {
    const k = keys("Activities\nWatching films and making videos, film club");
    expect(k).toContain("c:film");
    expect(k).not.toContain("w:films");
    expect(k).not.toContain("w:videos");
  });
  it("a named activity whose club isn't named for the topic keeps its chip (Mock Trial)", () => {
    expect(keys("Activities\nMock Trial, witness")).toContain("w:mock trial");
  });
  it("school dances aren't dancing; lab techniques are biology", () => {
    expect(keys("Activities\nDJ at school dances")).not.toContain("c:dance");
    const bio = readResumeInterests("Experience\nRan PCR and gel electrophoresis; cultured bacteria", clubs);
    expect(bio.find((i) => i.key === "c:biology")?.count).toBe(3);
  });
  it("a narrower phrase keeps its chip; a volunteering heading is service; voice cloning isn't biology", () => {
    const more = [
      ...clubs,
      club("Harvard Computational Biology Society", { categories: [cat("academic-stem", "Academic")] }),
    ];
    const k = (text: string) => readResumeInterests(text, more).map((i) => i.key);
    expect(k("Experience\nComputational Biology research")).toContain("w:computational biology");
    expect(k("Leadership & Volunteering\nRed Cross")).toContain("c:service");
    expect(k("Experience\nVoice cloning with deep learning")).not.toContain("c:biology");
  });
  it("a newspaper's arts editor is journalism, not visual art", () => {
    const k = keys("Activities\nSchool Newspaper, Arts Editor: edited the arts section");
    expect(k).toContain("c:journalism");
    expect(k).not.toContain("c:arts");
  });
});
