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

  it("ambiguous exact-name duplicates are flagged ambiguous", () => {
    const r = matchOrganization({ names: ["Debate Society"] }, [
      { clubId: "a", names: ["Debate Society"] },
      { clubId: "b", names: ["Debate Society"] },
    ]);
    expect(r.decision).toBe("ambiguous");
  });

  it("matches a parenthetical acronym form to the plain name", () => {
    const r = matchOrganization({ names: ["Harvard Computer Society (HCS)"] }, known);
    expect(r).toMatchObject({ decision: "definite", clubId: "hcs" });
  });

  it("acronym plus overlapping description is a stronger (still reviewable) signal", () => {
    const r = matchOrganization(
      {
        names: ["HUEA Board"],
        acronyms: ["HUEA"],
        descriptions: ["Economics speaker events, research journal and alumni mentorship programs"],
      },
      [
        {
          clubId: "e",
          names: ["Harvard Undergraduate Economics Association"],
          acronyms: ["HUEA"],
          descriptions: [
            "We host economics speaker events, publish a research journal, and run mentorship programs with alumni",
          ],
        },
      ],
    );
    expect(r.decision).toBe("probable");
    expect(r.candidates[0]?.signals.map((s) => s.kind)).toContain("description");
    expect(r.explanation).toMatch(/likely duplicate/);
  });

  it("explains its decision", () => {
    expect(matchOrganization({ names: ["Harvard Crimson"] }, known).explanation).toMatch(/auto-matched: exact_name/);
  });

  it("men's and women's teams are different organizations", () => {
    const r = matchOrganization({ names: ["Basketball (Women's Club Sport)"] }, [
      { clubId: "m", names: ["Basketball (Men's Club Sport)"] },
    ]);
    expect(r.decision).toBe("new");
  });

  it("shared qualifiers like '(Club Sport)' don't create fuzzy matches", () => {
    const r = matchOrganization({ names: ["Curling (Club Sport)"] }, [
      { clubId: "c", names: ["Cycling (Club Sport)"] },
      { clubId: "k", names: ["Climbing (Club Sport)"] },
    ]);
    expect(r.decision).toBe("new");
  });

  it("generic names like 'Harvard College' carry no fuzzy signal", () => {
    const r = matchOrganization({ names: ["Harvard College"] }, [{ clubId: "o", names: ["Harvard College Opera"] }]);
    expect(r.decision).toBe("new");
  });
});

// matcher-v4 regression (2026-10-13): the Hasty Pudding Club, Institute of 1770 and
// Theatricals were auto-merged on hastypudding.org, a host each sits on as one folder, and on
// @thehastypudding read off that host's footer. Fictional stand-ins on a shared host.
describe("matchOrganization: shared hosts (matcher-v4)", () => {
  const host = "https://pudding-house.test";
  const social = "https://instagram.com/thepuddinghouse";
  const institute: KnownOrg = {
    clubId: "institute",
    names: ["The Pudding House Institute"],
    urls: [`${host}/`, social],
    hostDerivedSocials: [social],
  };
  const players: KnownOrg = {
    clubId: "players",
    names: ["Pudding House Players"],
    urls: [`${host}/pudding-house-players`, social],
    scopedSites: [`${host}/pudding-house-players`],
    hostDerivedSocials: [social],
  };
  const club: KnownOrg = {
    clubId: "club",
    names: ["Pudding House Club"],
    urls: [`${host}/pudding-house-club`, social],
    scopedSites: [`${host}/pudding-house-club`],
    hostDerivedSocials: [social],
  };

  it("different folders on one host are not a strong identifier (review at most)", () => {
    for (const [a, others] of [
      [club, [institute, players]],
      [players, [institute, club]],
      [institute, [club, players]],
    ] as const) {
      const r = matchOrganization(a, others);
      expect(r.decision).not.toBe("definite");
      expect(r.candidates.every((c) => !c.strong)).toBe(true);
      expect(r.candidates[0]?.signals.map((s) => s.kind)).toEqual(
        expect.arrayContaining(["shared_host", "shared_host_social"]),
      );
    }
  });

  it("a footer handle on the shared host doesn't identify, but one each club has independently does", () => {
    const own = { ...players, hostDerivedSocials: [] };
    const r = matchOrganization({ ...club, hostDerivedSocials: [] }, [own]);
    expect(r).toMatchObject({ decision: "definite", clubId: "players" });
    expect(r.candidates[0]?.signals.map((s) => s.kind)).toContain("social");
  });

  it("the same folder on a shared host still matches (a deep link inside it, or a discovered org without scope)", () => {
    const deep = matchOrganization({ names: ["The Players"], urls: [`${host}/pudding-house-players/about/`] }, [
      players,
      club,
    ]);
    expect(deep).toMatchObject({ decision: "definite", clubId: "players" });
    const { clubId: _id, ...playersIdentity } = players;
    const same = matchOrganization({ ...playersIdentity, names: ["House Players Troupe"] }, [players]);
    expect(same).toMatchObject({ decision: "definite", clubId: "players" });
  });

  it("a club that also links the host's root owns the host: its deep links aren't folders", () => {
    const owner: KnownOrg = {
      clubId: "owner",
      names: ["Open Data Group"],
      urls: ["https://data-group.test/", "https://data-group.test/project/one"],
      scopedSites: ["https://data-group.test/project/one"],
    };
    const r = matchOrganization({ names: ["Data Group Duplicate"], urls: ["https://data-group.test/"] }, [owner]);
    expect(r).toMatchObject({ decision: "definite", clubId: "owner" });
  });

  it("separate own domains still match on a shared social account", () => {
    const r = matchOrganization(
      { names: ["Gadget Guild"], urls: ["https://gadget-a.test/", "https://instagram.com/gadgetguild"] },
      [
        {
          clubId: "g",
          names: ["Harvard Gadget Guild"],
          urls: ["https://gadget-b.test/", "https://instagram.com/gadgetguild"],
        },
      ],
    );
    expect(r).toMatchObject({ decision: "definite", clubId: "g" });
  });
});
