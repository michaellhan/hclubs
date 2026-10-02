import { describe, expect, it } from "vitest";
import { directorySourceType } from "../src/stages/enrich";

/** Which linked pages the enrichment directory pass reads (ADR 0032, 0042). */
describe("directorySourceType", () => {
  it("reads the career center's page about one club", () => {
    expect(
      directorySourceType(
        "https://careerservices.fas.harvard.edu/organizations/harvard-graduate-women-in-science-and-engineering-hgwise",
      ),
    ).toBe("harvard_official");
  });
  it("still skips portal listings and generic hosts", () => {
    expect(
      directorySourceType("https://careerservices.fas.harvard.edu/organizations/?ctag[]=student-clubs"),
    ).toBeNull();
    expect(directorySourceType("https://careerservices.fas.harvard.edu/blog/some-post/")).toBeNull();
    expect(directorySourceType("https://soco.college.harvard.edu/club_signup")).toBeNull();
    expect(directorySourceType("https://pbha.org/programs/leaders")).toBe("harvard_official");
  });
});
