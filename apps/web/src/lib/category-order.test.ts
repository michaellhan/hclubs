import { describe, expect, it } from "vitest";
import { compareNames, orderCategoryClubs } from "./category-overview";

const club = (name: string, shortDescription: string | null = "x") => ({ name, shortDescription });

describe("orderCategoryClubs", () => {
  it("puts live clubs first, then described, then sparse; numbers last in each group", () => {
    const clubs = [
      club("1636 Leadership Forum"),
      club("Zeta"),
      club("Alpha", null),
      club("Beta"),
      club("Gamma"),
      club("1L"),
    ];
    const out = orderCategoryClubs(clubs, (c) => c.name === "Zeta").map((c) => c.name);
    expect(out).toEqual(["Zeta", "Beta", "Gamma", "1L", "1636 Leadership Forum", "Alpha"]);
  });

  it("is A-Z when nobody is live and treats blank descriptions as missing", () => {
    const out = orderCategoryClubs([club("B"), club("A", "  "), club("C")], () => false).map((c) => c.name);
    expect(out).toEqual(["B", "C", "A"]);
  });
});

describe("compareNames", () => {
  it("sorts letters before digits and ignores accents/case", () => {
    expect(["2x", "éa", "Ab"].sort(compareNames)).toEqual(["Ab", "éa", "2x"]);
  });

  it("ignores a leading The", () => {
    expect(["Tango", "The Harvard Ballet Company", "Eleganza", "Theater Club"].sort(compareNames)).toEqual([
      "Eleganza",
      "The Harvard Ballet Company",
      "Tango",
      "Theater Club",
    ]);
  });
});
