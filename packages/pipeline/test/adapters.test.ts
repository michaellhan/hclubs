import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { SOURCE_TYPE_TIER } from "@hci/core";
import { ADAPTERS, ADAPTER_ORDER, OFFLINE_FIXTURES, splitWikiEntry } from "../src/adapters";
import type { DiscoveredOrganization } from "../src/types";

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
