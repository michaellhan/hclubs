import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { SOURCE_TYPE_TIER } from "@hci/core";
import { ADAPTERS, ADAPTER_ORDER, OFFLINE_FIXTURES, splitWikiEntry, wikiEntryDescription } from "../src/adapters";
import type { DiscoveredOrganization } from "../src/types";
import { SCOPE_EXTRACTOR } from "../src/extract/scope";

/** Fixture-based tests for every discovery adapter (pages saved 2026-09-30). No network. */
const root = fileURLToPath(new URL("./fixtures/", import.meta.url));

function parseAll(adapter: string): DiscoveredOrganization[] {
  const a = ADAPTERS[adapter];
  if (!a) throw new Error(adapter);
  return Object.entries(OFFLINE_FIXTURES[adapter] ?? {}).flatMap(
    ([url, file]) =>
      a.parse({
        url,
        finalUrl: url,
        body: readFileSync(root + file, "utf8"),
        fetchedAt: new Date("2026-09-30T12:00:00Z"),
      }).organizations,
  );
}
const byName = (orgs: DiscoveredOrganization[], name: string) => orgs.find((o) => o.name === name);
const claimsOf = (o: DiscoveredOrganization | undefined, field: string) =>
  o?.claims.filter((c) => c.fieldKey === field) ?? [];

describe("adapter registry", () => {
  it("runs sources in trust order: official Harvard first, lower-trust breadth sources last", () => {
    const tiers = ADAPTER_ORDER.map((a) => SOURCE_TYPE_TIER[a.sourceType]);
    expect(tiers).toEqual([...tiers].sort((a, b) => a - b));
    expect(ADAPTER_ORDER[0]?.sourceType).toBe("harvard_official");
    expect(ADAPTER_ORDER.at(-1)?.sourceType).toBe("public_web");
  });
  it("every adapter has offline fixtures", () => {
    for (const a of ADAPTER_ORDER) expect(Object.keys(OFFLINE_FIXTURES[a.name] ?? {}).length).toBeGreaterThan(0);
  });
});

describe("SEAS student organizations", () => {
  const orgs = parseAll("seas-student-orgs");
  it("parses all 23 listed orgs with their links", () => {
    expect(orgs).toHaveLength(23);
    expect(orgs.filter((o) => claimsOf(o, "club.link").length > 0)).toHaveLength(22);
  });
  it("name-derived keys are shared by 'X (ACR)' and 'X' and are not identity ids", () => {
    const conc = parseAll("seas-orgs-by-concentration").filter((o) => o.name === "Harvard Computer Society");
    expect(conc.length).toBeGreaterThanOrEqual(1);
    expect(new Set(conc.map((o) => o.externalKey))).toEqual(new Set(["harvard-computer-society"]));
    expect(conc.every((o) => o.identity.externalIds.length === 0)).toBe(true);
  });
  it("splits 'Name (ACR)' into name + acronym", () => {
    const h = orgs.find((o) => o.acronym === "HackHarvard");
    expect(h?.name).toBe("HackHarvard Undergraduate Hackathon");
  });
  it("records recognition only because the page states it", () => {
    const r = claimsOf(orgs[0], "club.recognition_status")[0];
    expect(r?.value).toBe("recognized");
    expect(r?.assertionKind).toBe("stated");
  });
});

describe("SEAS orgs by concentration", () => {
  const orgs = parseAll("seas-orgs-by-concentration");
  it("parses concentration lists and community/project links", () => {
    expect(orgs.length).toBeGreaterThanOrEqual(30); // orgs listed in two sections are merged into one candidate
    const huma = orgs.find((o) => o.acronym === "HUMA");
    expect(huma?.name).toBe("Harvard Undergraduate Mathematics Association");
    expect(String(claimsOf(huma, "club.short_description")[0]?.value)).toMatch(/^Dedicated to/);
  });
  it("unwraps proofpoint-wrapped links", () => {
    const urls = orgs.flatMap((o) => claimsOf(o, "club.link").map((c) => (c.value as { url: string }).url));
    expect(urls.some((u) => u.includes("urldefense"))).toBe(false);
  });
  it("flags graduate-school groups by name (inferred)", () => {
    const gsas = orgs.find((o) => /GSAS/.test(o.name));
    expect(claimsOf(gsas, "club.affiliation_scope")[0]).toMatchObject({
      value: "graduate_school",
      assertionKind: "inferred",
    });
  });
});

describe("SOCO club sports", () => {
  const orgs = parseAll("soco-club-sports");
  it("parses 47 sports and expands the M/W legend", () => {
    expect(orgs).toHaveLength(47);
    expect(byName(orgs, "Basketball (Men's Club Sport)")).toBeDefined();
    expect(byName(orgs, "Archery (Club Sport)")).toBeDefined();
  });
  it("keeps the raw listing as an alias and states the org type", () => {
    const b = byName(orgs, "Basketball (Women's Club Sport)");
    expect(claimsOf(b, "club.alias").map((c) => (c.value as { name: string }).name)).toContain("Basketball W");
    expect(claimsOf(b, "club.org_type").some((c) => c.assertionKind === "stated")).toBe(true);
  });
});

describe("IOP", () => {
  const orgs = parseAll("iop-programs");
  it("parses programs and coalitions with slugs as ids", () => {
    expect(orgs).toHaveLength(21);
    const cap = orgs.find((o) => o.acronym === "CAP");
    expect(cap?.identity.externalIds[0]).toEqual({ system: "iop", id: "campaigns-and-advocacy-program" });
  });
  it("repairs the unbalanced 'Harvard Political Union (HPU' name", () => {
    expect(orgs.find((o) => o.name.startsWith("Harvard Political Union"))?.acronym).toBe("HPU");
  });
});

describe("department and center pages", () => {
  it("CS advising: 15 clubs with descriptions", () => {
    const orgs = parseAll("dept-computer-science");
    expect(orgs).toHaveLength(15);
    const hcs = byName(orgs, "Harvard Computer Society");
    expect([...claimsOf(hcs, "club.short_description"), ...claimsOf(hcs, "club.long_description")]).toHaveLength(1);
  });
  it("MCB neuroscience: splits <br>-separated entries", () => {
    const orgs = parseAll("dept-mcb-neuroscience");
    expect(orgs.length).toBeGreaterThanOrEqual(10);
    expect(byName(orgs, "THURJ")).toBeDefined();
  });
  it("Latinx studies: excludes research centers and faculty/staff associations; keeps hub slugs as ids", () => {
    const orgs = parseAll("dept-latinx-studies");
    expect(orgs.some((o) => /faculty|DRCLAS|Center for Latin American/i.test(o.name))).toBe(false);
    expect(byName(orgs, "Fuerza Latina")?.identity.externalIds[0]).toEqual({
      system: "latinx-studies",
      id: "fuerza-latina",
    });
  });
  it("Math community: only undergraduate groups", () => {
    const orgs = parseAll("dept-math-community");
    expect(orgs.map((o) => o.acronym)).toEqual(expect.arrayContaining(["GIIM", "HUMA"]));
  });
  it("Innovation Labs: 19 groups with links and descriptions", () => {
    const orgs = parseAll("innovation-labs-student-groups");
    expect(orgs).toHaveLength(19);
    expect(orgs.every((o) => claimsOf(o, "club.link").length === 1)).toBe(true);
  });
  it("Innovation Labs: a description that spells the name out as a school's states its scope (v1.1.0)", () => {
    const orgs = parseAll("innovation-labs-student-groups");
    const hive = byName(orgs, "HIVE");
    const scope = claimsOf(hive, "club.affiliation_scope");
    expect(scope.map((c) => [c.value, c.assertionKind])).toEqual([["graduate_school", "stated"]]);
    expect(scope[0]?.quote).toBe(
      "HIVE (Harvard GSE Innovation and Ventures in Education) is dedicated to helping students develop, sustain, and/or support education ventures.",
    );
    expect(claimsOf(hive, "club.school").map((c) => c.value)).toEqual(["hgse"]);
    // Versioned by the scope rules, not the adapter: a scope-statements bump reaches listings.
    for (const c of [...scope, ...claimsOf(hive, "club.school")]) expect(c.extractor).toBe(SCOPE_EXTRACTOR);
    expect(hive?.scannedBy).toEqual([SCOPE_EXTRACTOR]);
    // Every scope claim from a listing quotes its description verbatim.
    for (const o of orgs)
      for (const c of [...claimsOf(o, "club.affiliation_scope"), ...claimsOf(o, "club.school")])
        if (c.assertionKind === "stated")
          expect(
            claimsOf(o, "club.short_description").concat(claimsOf(o, "club.long_description"))[0]?.quote,
          ).toContain(c.quote);
  });
  it("Mignone: paginates by following only the next page", () => {
    const a = ADAPTERS["mignone-student-clubs"]!;
    const url = Object.keys(OFFLINE_FIXTURES["mignone-student-clubs"]!)[0]!;
    const r = a.parse({
      url,
      finalUrl: url,
      body: readFileSync(root + "mignone-student-clubs/listing.html", "utf8"),
      fetchedAt: new Date(),
    });
    expect(r.nextUrls).toHaveLength(1);
    expect(r.nextUrls[0]).toMatch(/\/organizations\/page\/2/);
    expect(parseAll("mignone-student-clubs").length).toBeGreaterThanOrEqual(25);
  });
  it("Mignone: a name that says Extension School names its school (inferred)", () => {
    const a = ADAPTERS["mignone-student-clubs"]!;
    const entry = (name: string) =>
      `<div class="entry type-organization"><h2 class="entry-title"><a href="https://careerservices.fas.harvard.edu/organizations/${name.toLowerCase().replace(/\W+/g, "-")}/">${name}</a></h2></div>`;
    const url = "https://careerservices.fas.harvard.edu/organizations/?ctag[]=student-clubs";
    const r = a.parse({
      url,
      finalUrl: url,
      body: `<div class="post-wrapper">${entry("Harvard Extension School Psychology Student Club")}${entry("Harvard Undergraduate Psychology Club")}</div>`,
      fetchedAt: new Date(),
    });
    const school = (n: string) =>
      r.organizations.find((o) => o.name === n)?.claims.filter((c) => c.fieldKey === "club.school");
    expect(school("Harvard Extension School Psychology Student Club")?.map((c) => [c.value, c.assertionKind])).toEqual([
      ["extension", "inferred"],
    ]);
    expect(school("Harvard Undergraduate Psychology Club")).toEqual([]);
  });
});

describe("Wikipedia (tier 8)", () => {
  const orgs = parseAll("wikipedia-harvard-orgs");
  it("parses the list article (Parsoid HTML) and the social clubs article", () => {
    expect(orgs.length).toBeGreaterThanOrEqual(120);
    expect(byName(orgs, "The Harvard Krokodiloes")).toBeDefined();
    expect(byName(orgs, "Porcellian Club")).toBeDefined();
  });
  it("captures article links in Parsoid article HTML (as external ids, not as the org's own link)", () => {
    const k = byName(orgs, "The Harvard Krokodiloes");
    expect(k?.externalKey).toBe("harvard-krokodiloes"); // stable, name-derived mention key
    expect(k?.identity.externalIds).toEqual([{ system: "wikipedia-article", id: "the_harvard_krokodiloes" }]);
  });
  it("parses names out of prose conservatively", () => {
    expect(splitWikiEntry("Harvard Deepam performs Bharatanatyam, a classical dance.", null).name).toBe(
      "Harvard Deepam",
    );
    expect(
      splitWikiEntry(
        "Harvard Undergraduate Consulting on Business and the Environment is a strategy consulting group.",
        null,
      ).name,
    ).toBe("Harvard Undergraduate Consulting on Business and the Environment");
    expect(splitWikiEntry("The Harvard Crimson, the daily newspaper.", "The Harvard Crimson").name).toBe(
      "The Harvard Crimson",
    );
  });
  it("descriptions are whole entries, never a tail that starts mid-sentence or a maintenance tag (1.2.0)", () => {
    const desc = (name: string) =>
      claimsOf(byName(orgs, name), "club.short_description").concat(
        claimsOf(byName(orgs, name), "club.long_description"),
      )[0];
    // "Name performs …" / "Name, an …" / "Name, founded in 1919, plays …": the entry, verbatim.
    expect(desc("Harvard Deepam")?.value).toBe("Harvard Deepam performs Bharatanatyam.");
    expect(desc("The Noteables")?.value).toBe(
      "The Noteables, a non-audition group that performs revue-style musical theater.",
    );
    expect(desc("Harvard University Band")?.value).toBe(
      "Harvard University Band, founded in 1919, plays university sporting events and in other community venues.",
    );
    expect(desc("Harvard Bach Society Orchestra")?.value).toBe(
      'Harvard Bach Society Orchestra, founded in 1898 as "The Musical Club of Harvard University," is Harvard\'s chamber orchestra.',
    );
    // "Name, which …", "Name, founded in the 1960s.", "Name, in which …": no sentence, so nothing.
    for (const n of [
      "Harvard Baroque Chamber Orchestra",
      "Harvard Wind Ensemble",
      "Harvard Model Congress",
      "The Harvard International Review",
      "Harvard University Choir",
      "HarvardTHUD",
    ])
      expect(desc(n), n).toBeUndefined();
    // Maintenance tags are gone; footnotes never appear.
    expect(desc("The Harvard Institute of Politics")?.value).toBe(
      "The Harvard Institute of Politics, a non-partisan living memorial to President John F. Kennedy that promotes public service and provides political opportunities to undergraduates.",
    );
    for (const o of orgs)
      for (const c of [...claimsOf(o, "club.short_description"), ...claimsOf(o, "club.long_description")]) {
        expect(String(c.value), o.name).not.toMatch(/^[a-z(]|\[[^\]]*\]/);
        expect(c.quote).toBe(c.value);
      }
  });
  it("wikiEntryDescription: real list-entry shapes", () => {
    const d = (entry: string, name: string) =>
      wikiEntryDescription(entry, name, splitWikiEntry(entry, name).description);
    expect(d("Harvard Wind Ensemble, founded in the 1960s.", "Harvard Wind Ensemble")).toBeNull();
    expect(
      d(
        "Harvard Baroque Chamber Orchestra, which performs in the Memorial Church.",
        "Harvard Baroque Chamber Orchestra",
      ),
    ).toBeNull();
    expect(d("The Harvard Lampoon, founded in 1876 on the model of Punch.", "The Harvard Lampoon")).toBeNull();
    expect(
      d(
        "Harvard Pops Orchestra, known for their fun performances and innovative repertoire.",
        "Harvard Pops Orchestra",
      ),
    ).toBeNull();
    expect(d("Radcliffe Choral Society, founded in 1898, an all-women chorus.", "Radcliffe Choral Society")).toBeNull();
    expect(
      d(
        "The Harvard College Democrats, the largest partisan political group on campus.[citation needed]",
        "The Harvard College Democrats",
      ),
    ).toBe("The Harvard College Democrats, the largest partisan political group on campus.");
    expect(
      d(
        "The Harvard Independent, an alternative[clarification needed] weekly with news, opinion, sports, arts, and features.",
        "The Harvard Independent",
      ),
    ).toBe("The Harvard Independent, an alternative weekly with news, opinion, sports, arts, and features.");
    expect(
      d(
        "The Harvard Speech and Parliamentary Debate Society fields one of the top intercollegiate debate teams in the world.[citation needed]",
        "The Harvard Speech and Parliamentary Debate Society",
      ),
    ).toBe(
      "The Harvard Speech and Parliamentary Debate Society fields one of the top intercollegiate debate teams in the world.",
    );
    expect(
      d(
        "Harvard Undergraduates for Bipartisan Solutions, also known as Harvard Bipartisans, is a center for bipartisan and non-partisan thought, policymaking, and discussion.",
        "Harvard Undergraduates for Bipartisan Solutions",
      ),
    ).toMatch(/^Harvard Undergraduates for Bipartisan Solutions, also known as/);
    // A tail that is its own sentence stays as it is.
    expect(d("Example Society. The oldest debating club on campus.", "Example Society")).toBe(
      "The oldest debating club on campus.",
    );
  });
  it("records '(formerly X)' as a former-name alias", () => {
    const fdl = byName(orgs, "The FDL");
    expect(claimsOf(fdl, "club.alias").map((c) => c.value)).toContainEqual({
      name: "Kappa Kappa Gamma",
      kind: "former",
    });
  });
  it("never treats a Wikipedia article as the org's own link, and down-weights its descriptions", () => {
    for (const o of orgs)
      for (const l of claimsOf(o, "club.link")) expect((l.value as { kind: string }).kind).toBe("other");
    const d = claimsOf(byName(orgs, "The Harvard Krokodiloes"), "club.short_description")[0];
    expect(d?.confidenceFactor).toBe(0.8);
  });
  it("social clubs are typed as social organizations (inferred)", () => {
    expect(claimsOf(byName(orgs, "Fly Club"), "club.org_type")[0]).toMatchObject({
      value: "social_organization",
      assertionKind: "inferred",
    });
  });
});

describe("Harvard Hillel (tier 7)", () => {
  const orgs = parseAll("hillel-student-groups");

  it("parses each group with its own links", () => {
    expect(orgs).toHaveLength(14);
    const links = claimsOf(byName(orgs, "Tamid"), "club.link").map((c) => (c.value as { url: string }).url);
    expect(links).toEqual(
      expect.arrayContaining([
        "https://www.instagram.com/tamidatharvard",
        "https://www.linkedin.com/company/tamid-group-at-harvard",
      ]),
    );
    expect(orgs.find((o) => o.name.startsWith("ApiChorus"))?.identity.urls).toContain("https://apichorus.org");
  });

  it("never stores individual student contacts or emails", () => {
    const all = JSON.stringify(orgs);
    expect(all).not.toMatch(/Contact:/);
    expect(all).not.toMatch(/mailto:/);
  });
});

describe("wikipedia subsections", () => {
  it("a combined heading names no specific category", async () => {
    const { subsectionCategory } = await import("../src/adapters/wikipedia");
    expect(subsectionCategory("Theater and dance")).toEqual([]);
    expect(subsectionCategory("Dance")).toEqual(["dance"]);
    expect(subsectionCategory("A cappella")).toEqual(["a-cappella"]);
  });
});
