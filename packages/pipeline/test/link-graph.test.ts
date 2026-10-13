import { describe, expect, it } from "vitest";
import { siteKeyHasInitials } from "../src/sites/candidates";
import { isSharedHostFolder, pathScopedRoot, sameSite } from "../src/crawl/site";
import { anchorForms, anchorMatches, buildNameKeys, siteRootOf } from "../src/sites/link-graph";

const clubs = [
  { id: "a", name: "Fictional Undergraduate Law Review", acronym: "FULR", aliases: [] },
  { id: "b", name: "Fictional Chess Society", acronym: null, aliases: ["Chess at Fictional"] },
  // Two clubs sharing a name key: never matched.
  { id: "c", name: "Fictional Running Club", acronym: null, aliases: [] },
  { id: "d", name: "Fictional Running Club", acronym: null, aliases: [] },
  // One-word names never match ("Baseball" links go everywhere).
  { id: "e", name: "Baseball", acronym: null, aliases: [] },
];
const keys = buildNameKeys(clubs);
const link = (url: string, text: string) => ({ url, text, chrome: false });

describe("link-graph anchors (ADR 0038)", () => {
  it("matches a link whose text is exactly a club's name, alias or acronym", () => {
    const got = anchorMatches(
      "https://directory.example.edu/orgs",
      [
        link("https://fulr.example.org/", "Fictional Undergraduate Law Review"),
        link("https://chess.example.org/", "Chess at Fictional"),
        link("https://www.instagram.com/fulr_official", "FULR"),
      ],
      keys,
    );
    expect(got.map((m) => [m.clubId, m.kind])).toEqual([
      ["a", "website"],
      ["b", "website"],
      ["a", "social"],
    ]);
  });
  it("ignores shared names, one-word names, partial text and links back into the same site", () => {
    const got = anchorMatches(
      "https://directory.example.edu/orgs",
      [
        link("https://run.example.org/", "Fictional Running Club"),
        link("https://groupgear.example.com/", "Baseball"),
        link("https://fulr.example.org/", "Read the Fictional Undergraduate Law Review article"),
        link("https://directory.example.edu/fulr", "Fictional Undergraduate Law Review"),
        link("https://commons.wikimedia.org/x", "Fictional Chess Society"),
      ],
      keys,
    );
    expect(got).toEqual([]);
  });
  it("reduces a link to the site root to check, keeping hosted-site paths", () => {
    expect(siteRootOf("https://hcs.harvard.edu/~room13/about.html")).toBe("https://hcs.harvard.edu/~room13/");
    expect(siteRootOf("https://hcs.harvard.edu/")).toBeNull();
    expect(siteRootOf("https://sites.google.com/view/fictional-club/home")).toBe(
      "https://sites.google.com/view/fictional-club/",
    );
    expect(siteRootOf("https://www.fulr.example.org/join?x=1")).toBe("https://www.fulr.example.org/");
  });
  it("reads club initials in a domain", () => {
    expect(
      siteKeyHasInitials("hulr.org", { name: "Harvard Undergraduate Law Review", acronym: null, aliases: [] }),
    ).toBe(true);
    expect(
      siteKeyHasInitials("harvardgaasa.com", {
        name: "Harvard College Generational African American Students Association",
        acronym: null,
        aliases: [],
      }),
    ).toBe(true);
    expect(siteKeyHasInitials("gocrimson.com", { name: "Harvard Crimson", acronym: null, aliases: [] })).toBe(false);
  });
});

describe("anchor forms and crawl scope (ADR 0040)", () => {
  it("reads the club's full name out of '(Acronym)', 'official website' and, on Harvard pages, a dropped 'Harvard'", () => {
    const k = buildNameKeys([
      { id: "key", name: "Crimson Key Society", acronym: null, aliases: [] },
      { id: "bsa", name: "Harvard Black Students Association", acronym: null, aliases: [] },
      { id: "dins", name: "Harvard Din & Tonics", acronym: null, aliases: [] },
    ]);
    const page = [
      link("https://crimsonkeysociety.org/", "Crimson Key Society (Key)"),
      link("https://theharvardbsa.com/", "Black Students Association"),
      link("https://dins.com/", "The Harvard Din & Tonics official website"),
    ];
    expect(anchorMatches("https://news.example.com/a", page, k, true).map((m) => m.clubId)).toEqual([
      "key",
      "bsa",
      "dins",
    ]);
    // Off Harvard-related pages, "Black Students Association" could be anyone's.
    expect(anchorMatches("https://news.example.com/a", page, k, false).map((m) => m.clubId)).toEqual(["key", "dins"]);
    expect(anchorForms("Black Students Association", true)).toContain("Harvard Black Students Association");
    // Never a part of the name.
    expect(anchorForms("Key", true)).not.toContain("Crimson Key Society");
  });

  it("keeps a crawl inside a club's folder on someone else's host, not on its own domain", () => {
    const hbs = "https://www.hbs.edu/mba/student-life/student-clubs/entrepreneurship-club";
    expect(pathScopedRoot(hbs, { name: "HBS Entrepreneurship Club", acronym: null, aliases: [] })).toBe(true);
    expect(sameSite(hbs, "https://hbs.edu/mba/admissions/application-dates", true)).toBe(false);
    expect(sameSite(hbs, `${hbs}/events`, true)).toBe(true);
    const chapter = "https://www.scientistafoundation.com/harvard.html";
    expect(pathScopedRoot(chapter, { name: "Scientista", acronym: null, aliases: [] })).toBe(true);
    expect(sameSite(chapter, "https://scientistafoundation.com/chapter-application.html", true)).toBe(false);
    // The club's own domain, a generic first page, a shared host keyed by its path: whole site.
    const hro = { name: "Harvard Radcliffe Orchestra", acronym: "HRO", aliases: [] };
    expect(pathScopedRoot("https://harvardradcliffeorchestra.org/about-hro", hro)).toBe(false);
    expect(pathScopedRoot("https://prod-seasecocar.drupalsites.harvard.edu/about", hro)).toBe(false);
    expect(pathScopedRoot("https://alzheimersbuddies.wixsite.com/harvard", hro)).toBe(false);
    // An article about Harvard on the club's own site is not a chapter page.
    expect(
      pathScopedRoot("https://hodp.org/project/gender-disparity-in-harvard-faculty", {
        name: "Harvard Undergraduate Open Data Project",
        acronym: "HODP",
        aliases: [],
      }),
    ).toBe(false);
    // A club-named folder on a host shared with sibling groups (the Institute of 1770).
    const pudding = "https://www.hastypudding.org/hasty-pudding-club";
    expect(pathScopedRoot(pudding, { name: "Hasty Pudding Club", acronym: null, aliases: [] })).toBe(true);
    expect(sameSite(pudding, "https://hastypudding.org/comp", true)).toBe(false);
    // A folder on a shared host is the whole site, never a sibling folder, even when the
    // root is the folder itself (the path-prefix fallback had let "/view/" in).
    for (const [root, inside, sibling] of [
      [
        "https://sites.google.com/view/fictionalclub",
        "https://sites.google.com/view/fictionalclub/join",
        "https://sites.google.com/view/otherclub/apply",
      ],
      [
        "https://sites.google.com/site/fictionalclub/",
        "https://sites.google.com/site/fictionalclub/about",
        "https://sites.google.com/site/otherclub",
      ],
      [
        "https://sites.harvard.edu/fictionalclub",
        "https://sites.harvard.edu/fictionalclub/about/",
        "https://sites.harvard.edu/other-office/apply/",
      ],
      ["https://hcs.harvard.edu/~fict", "https://hcs.harvard.edu/~fict/join", "https://hcs.harvard.edu/~other"],
      [
        "https://pbha.org/programs/fictional",
        "https://pbha.org/programs/fictional/apply",
        "https://pbha.org/programs/another",
      ],
      ["https://fict.wixsite.com/club", "https://fict.wixsite.com/club/join", "https://fict.wixsite.com/other-site"],
    ] as const) {
      expect(isSharedHostFolder(root)).toBe(true);
      expect(sameSite(root, inside)).toBe(true);
      expect(sameSite(root, sibling)).toBe(false);
      expect(sameSite(root, sibling.replace(/^https:\/\//, "https://www."))).toBe(false);
    }
    // The bare shared host isn't the club's either.
    expect(sameSite("https://sites.google.com/view/fictionalclub", "https://sites.google.com/")).toBe(false);
    // A club's own domain and generic hosts keep their rules.
    expect(isSharedHostFolder("https://fictionalclub.org/about")).toBe(false);
    expect(sameSite("https://fictionalclub.org/", "https://www.fictionalclub.org/join")).toBe(true);
    // "/php/index.php" scopes to "/php".
    expect(sameSite("https://w1af.harvard.edu/php/index.php", "https://w1af.harvard.edu/php/contact.php", true)).toBe(
      true,
    );
  });
});
