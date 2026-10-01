import { describe, expect, it } from "vitest";
import { completenessTier } from "@hci/db/local";
import {
  bucketFor,
  distinctiveTokens,
  findDuplicatePairs,
  initialisms,
  nameSimilarity,
  scoreCandidate,
  type IdentityClub,
} from "../src/name-only/identity";
import { paidQueries, searchableName } from "../src/stages/name-only";

/**
 * Regression cases from the first name-only run (ADR 0032): each "reject" below was a real
 * candidate the first scorer accepted. Club names are real index entries; URLs are the
 * shapes seen in search results.
 */
const club = (name: string, acronym: string | null = null): IdentityClub => ({
  name,
  acronym,
  aliases: [],
  college: true,
});
const verdict = (url: string, title: string, c: IdentityClub, description = "") =>
  scoreCandidate({ url, title, description }, c).verdict;

describe("completeness tiers", () => {
  const base = {
    shortDescription: null,
    quickLinks: { website: null, instagram: null },
    joinModes: [],
    currentCycle: null,
    memberCount: null,
    hoursPerWeek: null,
    logo: null,
    pressCount: 0,
  };
  it("classifies from public facts only", () => {
    expect(completenessTier(base)).toBe("name_only");
    expect(completenessTier({ ...base, pressCount: 2 })).toBe("sparse");
    expect(completenessTier({ ...base, quickLinks: { website: null, instagram: "https://instagram.com/x" } })).toBe(
      "sparse",
    );
    expect(completenessTier({ ...base, shortDescription: "A club.", logo: "https://x/logo.png" })).toBe("partial");
    expect(
      completenessTier({
        ...base,
        shortDescription: "A club.",
        quickLinks: { website: "https://x.org", instagram: null },
        joinModes: ["comp"],
      }),
    ).toBe("rich");
  });
});

describe("buckets", () => {
  const b = (name: string, tags: string[] = [], acronym: string | null = null, duplicate = false) =>
    bucketFor({ name, acronym, tags, duplicate });
  it("routes clubs by where their information most likely lives", () => {
    expect(b("Adams House Committee", ["house committee"])).toBe("college_program");
    expect(b("PBHA's Peer Health Exchange", ["pbha"])).toBe("pbha_program");
    expect(b("The Seneca", ["female final clubs"])).toBe("invitation_only_social");
    expect(b("Harvard Undergraduates Supporting Policy, Advocacy, and Reform for Kids", [], "HU-SPARK")).toBe(
      "distinctive_acronym",
    );
    expect(b("Harvard Undergraduate Bulgarian Club")).toBe("distinctive_name");
    expect(b("Harvard Undergraduate Book Club")).toBe("generic_name");
    expect(b("Harvard Undergraduate Book Club", [], null, true)).toBe("likely_duplicate");
  });
  it("strips boilerplate from names", () => {
    expect(distinctiveTokens("Harvard Undergraduate Bulgarian Club")).toEqual(["bulgarian"]);
    expect(searchableName("PBHA's Peer Health Exchange")).toBe("Peer Health Exchange");
    expect(searchableName("Harvard Undergraduate Nepali Student Association")).toBe("Nepali Student Association");
    expect(paidQueries({ name: "Harvard Undergraduate Music Business Association", acronym: "HUMBA" })).toEqual([
      '"Music Business Association" Harvard instagram',
      '"HUMBA" Harvard club',
    ]);
  });
});

describe("duplicates and renames", () => {
  it("matches renamed spellings and same-link pairs, never auto-merging", () => {
    expect(
      nameSimilarity("Harvard Undergraduate Latines in Health Careers", "Harvard College Latinos in Health Careers"),
    ).toBe(1);
    expect(
      nameSimilarity("Harvard Undergraduate Black Pre-Law Association", "Harvard College Black Prelaw Association"),
    ).toBe(1);
    const clubs = [
      {
        id: "a",
        slug: "wiser",
        name: "Women in Science at Harvard–Radcliffe",
        acronym: null,
        websites: [],
        instagrams: [],
      },
      { id: "b", slug: "wishr", name: "WISHR", acronym: null, websites: [], instagrams: [] },
      {
        id: "c",
        slug: "chess",
        name: "Harvard Chess Club",
        acronym: null,
        websites: [],
        instagrams: ["https://instagram.com/hcc"],
      },
      {
        id: "d",
        slug: "chess2",
        name: "Crimson Chess",
        acronym: null,
        websites: [],
        instagrams: ["https://instagram.com/hcc"],
      },
      { id: "e", slug: "book", name: "Harvard Undergraduate Book Club", acronym: null, websites: [], instagrams: [] },
    ];
    const pairs = findDuplicatePairs(clubs, new Set(["a", "c", "e"]));
    expect(pairs.map((p) => [p.aSlug, p.bSlug])).toEqual(
      expect.arrayContaining([
        ["wiser", "wishr"],
        ["chess", "chess2"],
      ]),
    );
    expect(pairs.some((p) => p.aSlug === "book" || p.bSlug === "book")).toBe(false);
  });

  it("doesn't pair one-letter-off names or sibling programs", () => {
    expect(nameSimilarity("Harvard College Iranian Association", "Harvard Undergraduate Italian Society")).toBe(0);
    expect(nameSimilarity("Harvard College Student Baking Club", "Harvard Boxing Club")).toBe(0);
    const clubs = [
      {
        id: "a",
        slug: "brye-summer",
        name: "PBHA's Boston Refugee Youth Enrichment Summer Program",
        acronym: null,
        websites: [],
        instagrams: [],
      },
      {
        id: "b",
        slug: "brye-afterschool",
        name: "PBHA's Boston Refugee Youth Enrichment Afterschool",
        acronym: null,
        websites: [],
        instagrams: [],
      },
      {
        id: "c",
        slug: "nmun",
        name: "Harvard National Model United Nations",
        acronym: null,
        websites: [],
        instagrams: [],
      },
      {
        id: "d",
        slug: "wmun",
        name: "Harvard World Model United Nations",
        acronym: null,
        websites: [],
        instagrams: [],
      },
    ];
    expect(findDuplicatePairs(clubs, new Set(["a", "b", "c", "d"]))).toEqual([]);
  });
});

describe("candidate scoring", () => {
  it("accepts the club's own profiles and sites", () => {
    expect(
      verdict(
        "https://www.instagram.com/harvard.undergraduate.nepali",
        "Harvard Nepali Students (@harvard.undergraduate.nepali)",
        club("Harvard Undergraduate Nepali Student Association"),
      ),
    ).toBe("accept");
    expect(
      verdict(
        "https://harvardcollegefrenchclub.com/",
        "Harvard College French Club",
        club("Harvard College Students French Club"),
      ),
    ).toBe("accept");
    expect(
      verdict(
        "https://humba.us/",
        "HUMBA — Harvard Undergraduate Music Business Association",
        club("Harvard Undergraduate Music Business Association", "HUMBA"),
      ),
    ).toBe("accept");
  });

  it("recognizes handles built from the name's initials", () => {
    expect(initialisms("Eating Concerns Hotline and Outreach")).toContain("echo");
    expect(initialisms("First-Year Urban Program")).toContain("fup");
    const accept = (url: string, title: string, name: string) => verdict(url, title, club(name));
    expect(
      accept(
        "https://www.instagram.com/harvardbasha",
        "BASHA (@harvardbasha) • Bengali Association of Students at Harvard",
        "Bengali Association of Students at Harvard College",
      ),
    ).toBe("accept");
    expect(
      accept(
        "https://www.instagram.com/hcgaasa",
        "HC GAASA (@hcgaasa) • Generational African American Students Association",
        "Harvard College Generational African American Students Association",
      ),
    ).toBe("accept");
    expect(accept("https://www.facebook.com/fupharvard", "First-Year Urban Program", "First-Year Urban Program")).toBe(
      "accept",
    );
    expect(accept("https://www.facebook.com/adams.hoco", "Adams House Committee", "Adams House Committee")).toBe(
      "accept",
    );
    // A Harvard office's page about the program is a Harvard source.
    expect(
      scoreCandidate(
        {
          url: "https://dining.harvard.edu/food-literacy-project",
          title: "Food Literacy Project | Harvard University Dining Services",
        },
        club("Food Literacy Project"),
      ).kind,
    ).toBe("harvard_directory");
  });

  it("takes a Harvard page only when it is about this club", () => {
    const kind = (url: string, title: string, name: string) => scoreCandidate({ url, title }, club(name));
    expect(
      kind(
        "https://kirkland.harvard.edu/house-committee",
        "House Committee | Kirkland House",
        "Kirkland House Committee",
      ).kind,
    ).toBe("harvard_directory");
    // Another house's committee, another PBHA program, a different fellowship, a dead portal.
    expect(
      kind("https://lowell.harvard.edu/house-committee", "House Committee | Lowell House", "All House Committee")
        .verdict,
    ).not.toBe("accept");
    expect(
      kind(
        "https://thehub.college.harvard.edu/organization/pbha-s-refugee-youth-summer-enrichment",
        "PBHA's Refugee Youth Summer Enrichment",
        "PBHA's Native American Youth Enrichment Program Summer",
      ).verdict,
    ).not.toBe("accept");
    expect(
      kind(
        "https://chaplains.harvard.edu/chaplaincies/adventist-christian-fellowship",
        "Adventist Christian Fellowship",
        "Harvard Undergraduate Christian Fellowship",
      ).verdict,
    ).not.toBe("accept");
    expect(
      kind("https://environment.harvard.edu/links/food-law-lab", "Food Law Lab", "Harvard Undergraduate Food Lab")
        .verdict,
    ).not.toBe("accept");
  });

  it("rejects the failure modes seen in the first run", () => {
    // Harvard portals, news and research pages are never a club's site.
    expect(
      verdict(
        "https://soco.college.harvard.edu/257891/home",
        "Bengali Association of Students at Harvard College",
        club("Bengali Association of Students at Harvard College"),
      ),
    ).toBe("reject");
    expect(
      verdict(
        "https://news.harvard.edu/gazette/story/2020/02/students-datamatch/",
        "Datamatch at Harvard",
        club("Datamatch"),
      ),
    ).toBe("reject");
    // Aggregators and articles naming the club.
    expect(
      verdict("https://causeiq.com/organizations/the-bee-club,203522249", "The Bee Club | Harvard", club("Bee Club")),
    ).toBe("reject");
    expect(
      verdict(
        "https://athleteally.org/harvard-athlete-ally-action-awards",
        "Harvard Athlete Ally awards",
        club("Athlete Ally: Harvard College Chapter"),
      ),
    ).toBe("reject");
    // Alumni clubs and other universities.
    expect(
      verdict(
        "https://www.instagram.com/harvardclubofaustralia",
        "Harvard Club of Australia (@harvardclubofaustralia)",
        club("Australian Undergraduate Society at Harvard College", "AUS"),
      ),
    ).not.toBe("accept");
    expect(
      verdict(
        "https://nyustern.campusgroups.com/sabas/",
        "South Asian Business Association",
        club("South Asian Business Association"),
      ),
    ).toBe("reject");
    // National organizations sharing a generic name.
    expect(
      verdict("https://www.facebook.com/sigmachi", "Sigma Chi stands with its Harvard chapter", club("Sigma Chi")),
    ).not.toBe("accept");
    // A neighbouring organization sharing one word of the name.
    expect(
      verdict(
        "https://www.linkedin.com/company/humanist-chaplaincy",
        "Humanist Chaplaincy at Harvard",
        club("Harvard Community of Humanists, Atheists, and Agnostics"),
      ),
    ).not.toBe("accept");
    // A site whose domain shares one word with the club ("campusreform" / "Reform Community").
    expect(verdict("https://campusreform.org/", "Harvard news", club("Reform Community"))).not.toBe("accept");
    // Business School groups for a College club.
    expect(
      verdict(
        "https://www.instagram.com/hbs.saba",
        "HBS South Asian Business Association (@hbs.saba)",
        club("South Asian Business Association"),
      ),
    ).not.toBe("accept");
  });
});
