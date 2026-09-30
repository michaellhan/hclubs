import { describe, expect, it } from "vitest";
import { parseSocoDirectory, parseSocoEntries } from "../src/adapters/soco-directory";

// Synthetic sample in the copied page's shape (fictional groups and people).
const SAMPLE = `Groups (3)
Join
Select Fictional Kite Society's group. Select the group and click on the Join button at the bottom of the page to register for this group

Fictional Kite Society
Hobbies and Special Interests - No Dues Required, No Comping Requirement

Website
Contact: Pat Example, Email group officers
Lifetime membership

Select Example Office's group. Select the group and click on the Join button at the bottom of the page to register for this group

Example Office
Office
Website
Lifetime membership

Select Imaginary Debate Union (IDU)'s group. Select the group and click on the Join button at the bottom of the page to register for this group

Imaginary Debate Union (IDU)
Academic and Pre-Professional - Domestic Travel
Website
Group Not Registered Yet
Lifetime membership
`;

const page = { url: "u", finalUrl: "u", body: SAMPLE, fetchedAt: new Date("2026-09-30") };

describe("soco-directory", () => {
  it("splits the category from its flags at ' - ' (not inside Pre-Professional)", () => {
    const entries = parseSocoEntries(SAMPLE);
    expect(entries.map((e) => [e.name, e.category, e.flags, e.registered])).toEqual([
      ["Fictional Kite Society", "Hobbies and Special Interests", ["No Dues Required", "No Comping Requirement"], true],
      ["Example Office", "Office", [], true],
      ["Imaginary Debate Union (IDU)", "Academic and Pre-Professional", ["Domestic Travel"], false],
    ]);
  });

  it("skips offices, keeps no contact names, and states dues/registration", () => {
    const { organizations } = parseSocoDirectory(page);
    expect(organizations.map((o) => o.name)).toEqual(["Fictional Kite Society", "Imaginary Debate Union"]);
    expect(JSON.stringify(organizations)).not.toContain("Pat Example");
    const kite = organizations[0]!.claims;
    expect(kite.find((c) => c.fieldKey === "club.dues")?.value).toEqual({ hasDues: false });
    expect(kite.find((c) => c.fieldKey === "club.recognition_status")?.value).toBe("recognized");
    expect(kite.filter((c) => c.fieldKey === "club.tag").map((c) => c.value)).toEqual([
      "hobbies and special interests",
      "no comping requirement",
    ]);
    const idu = organizations[1]!;
    expect(idu.acronym).toBe("IDU");
    expect(idu.claims.some((c) => c.fieldKey === "club.recognition_status")).toBe(false);
    expect(idu.claims.every((c) => c.extractionMethod === "manual")).toBe(true);
  });
});
