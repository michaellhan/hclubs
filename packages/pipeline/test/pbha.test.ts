import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parsePbhaListing } from "../src/adapters/pbha-programs";

const fixture = (name: string) =>
  readFileSync(fileURLToPath(new URL(`./fixtures/pbha-programs/${name}`, import.meta.url)), "utf-8");

const page = (file: string, url = "https://www.pbha.org/programs") =>
  parsePbhaListing({ url, finalUrl: url, body: fixture(file), fetchedAt: new Date("2026-09-30T00:00:00Z") });

describe("PBHA programs adapter (fixtures fetched 2026-09-30)", () => {
  const p1 = page("listing.html");

  it("parses every program entry on the page", () => {
    expect(p1.organizations).toHaveLength(18);
    expect(p1.warnings).toEqual([]);
  });

  it("extracts name, stable key and canonical program URL", () => {
    const buddies = p1.organizations.find((o) => o.externalKey === "alzheimersbuddies");
    expect(buddies).toBeDefined();
    expect(buddies?.name).toBe("Alzheimer’s Buddies");
    expect(buddies?.identity.externalIds).toEqual([{ system: "pbha", id: "alzheimersbuddies" }]);
    expect(buddies?.identity.urls).toEqual(["https://pbha.org/programs/alzheimersbuddies"]);
  });

  it("records the description as a stated claim with a verbatim quote", () => {
    const buddies = p1.organizations.find((o) => o.externalKey === "alzheimersbuddies");
    const desc = buddies?.claims.find((c) => c.fieldKey === "club.short_description");
    expect(desc?.assertionKind).toBe("stated");
    expect(String(desc?.value)).toMatch(/^Harvard College Alzheimer’s Buddies addresses/);
    expect(desc?.quote).toBe(desc?.value);
  });

  it("keeps topical tags, drops weekday/format tags, maps categories as inferred", () => {
    const buddies = p1.organizations.find((o) => o.externalKey === "alzheimersbuddies");
    const tags = buddies?.claims.filter((c) => c.fieldKey === "club.tag").map((c) => c.value);
    expect(tags).toEqual(expect.arrayContaining(["adult services", "health"]));
    expect(tags).not.toContain("sunday");
    expect(tags).not.toContain("in-person");
    const cats = buddies?.claims.filter((c) => c.fieldKey === "club.category");
    expect(cats?.map((c) => c.value)).toEqual(
      expect.arrayContaining(["public-service", "adult-services", "health-service"]),
    );
    expect(cats?.every((c) => c.assertionKind === "inferred" && !c.isDirect)).toBe(true);
  });

  it("never fabricates fields the page does not state", () => {
    const fields = new Set(p1.organizations.flatMap((o) => o.claims.map((c) => c.fieldKey)));
    for (const forbidden of [
      "club.member_count",
      "club.hours_per_week",
      "club.freshmen_eligible",
      "club.recognition_status",
    ]) {
      expect(fields.has(forbidden as never)).toBe(false);
    }
  });

  it("handles entries without a description", () => {
    const all = [
      ...p1.organizations,
      ...page("listing-page-2.html").organizations,
      ...page("listing-page-3.html").organizations,
    ];
    const withoutDesc = all.filter((o) => !o.claims.some((c) => c.fieldKey.endsWith("description")));
    for (const o of withoutDesc) expect(o.claims.some((c) => c.fieldKey === "club.name")).toBe(true);
  });

  it("follows opaque pagination cursors from rel=next", () => {
    expect(p1.nextUrls).toEqual(["https://www.pbha.org/programs?offset=1734301560265"]);
    expect(page("listing-page-3.html").nextUrls).toHaveLength(1);
  });

  it("produces unique keys across pages", () => {
    const keys = ["listing.html", "listing-page-2.html", "listing-page-3.html"].flatMap((f) =>
      page(f).organizations.map((o) => o.externalKey),
    );
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys.length).toBe(54);
  });

  it("tolerates the doubled /programs/programs/ link quirk seen on the live site", () => {
    const scas = page("listing-page-3.html").organizations.find(
      (o) => o.externalKey === "small-claims-advisory-service",
    );
    expect(scas?.name).toBe("Small Claims Advisory Service");
    expect(scas?.claims.some((c) => c.fieldKey.endsWith("description"))).toBe(false); // empty excerpt ⇒ no claim
  });

  it("warns instead of throwing when the structure changes", () => {
    const r = parsePbhaListing({
      url: "x",
      finalUrl: "https://www.pbha.org/programs",
      body: "<html><body><p>Redesigned</p></body></html>",
      fetchedAt: new Date(),
    });
    expect(r.organizations).toEqual([]);
    expect(r.warnings[0]).toMatch(/structure may have changed/);
  });
});
