import { describe, expect, it } from "vitest";
import { siteKeyHasInitials } from "../src/sites/candidates";
import { anchorMatches, buildNameKeys, siteRootOf } from "../src/sites/link-graph";

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
