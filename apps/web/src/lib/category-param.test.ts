import { describe, expect, it } from "vitest";
import { resolveCategorySlug } from "./category-param";

const cats = [
  { slug: "publications-media", parentSlug: null },
  { slug: "pre-professional", parentSlug: null },
  { slug: "pre-professional-finance", parentSlug: "pre-professional" },
  { slug: "performing-arts", parentSlug: null },
  { slug: "performing-arts-dance", parentSlug: "performing-arts" },
];

describe("resolveCategorySlug (/recruiting ?category=)", () => {
  it("keeps a known slug", () => {
    expect(resolveCategorySlug("publications-media", cats)).toBe("publications-media");
    expect(resolveCategorySlug("performing-arts-dance", cats)).toBe("performing-arts-dance");
  });

  it("maps a whole-word prefix to its one category, preferring the top-level one", () => {
    expect(resolveCategorySlug("publications", cats)).toBe("publications-media");
    expect(resolveCategorySlug("Publications", cats)).toBe("publications-media");
    expect(resolveCategorySlug("performing", cats)).toBe("performing-arts");
  });

  it("treats an unknown or ambiguous slug as no filter (never an empty page)", () => {
    expect(resolveCategorySlug("pub", cats)).toBeNull(); // not a whole word
    expect(resolveCategorySlug("nonsense", cats)).toBeNull();
    expect(resolveCategorySlug("pre", cats)).toBe("pre-professional");
    expect(resolveCategorySlug("<script>", cats)).toBeNull();
    expect(resolveCategorySlug(null, cats)).toBeNull();
    expect(resolveCategorySlug("", cats)).toBeNull();
  });
});
