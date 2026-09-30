import { describe, expect, it } from "vitest";
import { matchOrganization, type KnownOrg } from "../src";

const known: KnownOrg[] = [
  {
    clubId: "crimson",
    names: ["The Harvard Crimson"],
    acronyms: [],
    urls: ["https://www.thecrimson.com", "https://instagram.com/thecrimson"],
  },
  {
    clubId: "econ-undergrad",
    names: ["Harvard Undergraduate Economics Association"],
    acronyms: ["HUEA"],
    urls: ["https://huea.org"],
  },
  {
    clubId: "hcs",
    names: ["Harvard Computer Society"],
    acronyms: ["HCS"],
    urls: ["https://computersociety.example.org/"],
  },
  { clubId: "hcs-2", names: ["Harvard Chinese Students Association"], acronyms: ["HCSA"], urls: [] },
  {
    clubId: "pbha-buddies",
    names: ["Alzheimer's Buddies"],
    externalIds: [{ system: "pbha", id: "alzheimersbuddies" }],
  },
  { clubId: "ballroom", names: ["Harvard Ballroom Dance Team"], acronyms: [] },
];

describe("matchOrganization", () => {
  it("definite on exact normalized name (article/punctuation differences)", () => {
    const r = matchOrganization({ names: ["Harvard Crimson"] }, known);
    expect(r).toMatchObject({ decision: "definite", clubId: "crimson" });
  });

  it("definite on shared official domain despite different name", () => {
    const r = matchOrganization({ names: ["The Crimson Newspaper"], urls: ["http://thecrimson.com/about"] }, known);
    expect(r).toMatchObject({ decision: "definite", clubId: "crimson" });
  });

  it("definite on shared social handle", () => {
    const r = matchOrganization({ names: ["Crimson"], urls: ["https://www.instagram.com/TheCrimson/"] }, known);
    expect(r).toMatchObject({ decision: "definite", clubId: "crimson" });
  });

  it("definite on external directory id", () => {
    const r = matchOrganization(
      { names: ["Harvard College Alzheimer’s Buddies"], externalIds: [{ system: "pbha", id: "alzheimersbuddies" }] },
      known,
    );
    expect(r).toMatchObject({ decision: "definite", clubId: "pbha-buddies" });
  });

  it("does NOT treat 'Harvard Economics Association' as the undergraduate association", () => {
    const r = matchOrganization({ names: ["Harvard Economics Association"] }, known);
    expect(r.decision).toBe("probable");
    expect(r.clubId).toBe("econ-undergrad");
  });

  it("acronym-only matches are probable, never definite", () => {
    const r = matchOrganization({ names: ["HCS Club"], acronyms: ["HCS"] }, known);
    expect(r.decision).toBe("probable");
  });

  it("fuzzy partial names are probable", () => {
    const r = matchOrganization({ names: ["Harvard Ballroom"] }, known);
    expect(r).toMatchObject({ decision: "probable", clubId: "ballroom" });
  });

  it("conflicting ids from the same directory mean different organizations, even with the same name", () => {
    const r = matchOrganization(
      { names: ["Alzheimer's Buddies"], externalIds: [{ system: "pbha", id: "some-other-program" }] },
      known,
    );
    expect(r.decision).toBe("new");
  });

  it("similar names with distinct directory ids are not merge candidates (seen live: BRYE Teen vs BRYE Extension)", () => {
    const r = matchOrganization(
      {
        names: ["Boston Refugee Youth Enrichment (BRYE) Extension"],
        externalIds: [{ system: "pbha", id: "brye-extension" }],
      },
      [
        {
          clubId: "teen",
          names: ["Boston Refugee Youth Enrichment (BRYE) Teen"],
          externalIds: [{ system: "pbha", id: "brye-teen" }],
        },
      ],
    );
    expect(r).toMatchObject({ decision: "new", clubId: null });
  });

  it("exact name with a different official site is only probable", () => {
    const r = matchOrganization({ names: ["Harvard Computer Society"], urls: ["https://another-hcs.org"] }, known);
    expect(r.decision).toBe("probable");
  });

  it("generic hosts (forms, shorteners) never create a strong match", () => {
    const r = matchOrganization(
      { names: ["Totally Different Group"], urls: ["https://docs.google.com/forms/d/abc/viewform"] },
      [{ clubId: "x", names: ["Other Group"], urls: ["https://docs.google.com/forms/d/abc/viewform"] }],
    );
    expect(r.decision).not.toBe("definite");
  });

  it("returns new when nothing is plausible", () => {
    const r = matchOrganization({ names: ["Harvard Undergraduate Beekeepers"] }, known);
    expect(r).toMatchObject({ decision: "new", clubId: null });
  });

  it("ambiguous exact-name duplicates are probable", () => {
    const r = matchOrganization({ names: ["Debate Society"] }, [
      { clubId: "a", names: ["Debate Society"] },
      { clubId: "b", names: ["Debate Society"] },
    ]);
    expect(r.decision).toBe("probable");
  });
});
