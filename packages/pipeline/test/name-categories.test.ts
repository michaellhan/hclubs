import { describe, expect, it } from "vitest";
import { categoriesFromName } from "../src/stages/name-categories";

/** Categories a club's name settles (ADR 0034), including the names that must not match. */
describe("categoriesFromName", () => {
  it("reads the categories a name states plainly", () => {
    expect(categoriesFromName("Harvard Undergraduate Black Premedical Society")).toEqual(["medicine-health"]);
    expect(categoriesFromName("Harvard Undergraduate Combat Robotics Club")).toEqual(["technology"]);
    expect(categoriesFromName("Women in AI")).toEqual(["technology"]);
    expect(categoriesFromName("Harvard Undergraduate Health Policy Review").sort()).toEqual([
      "medicine-health",
      "publications-media",
    ]);
    expect(categoriesFromName("Harvard Undergraduate Social Impact Consulting Group")).toEqual(["consulting"]);
    expect(categoriesFromName("The Harvard Speech and Parliamentary Debate Society")).toEqual(["competition-teams"]);
  });

  it("leaves names whose word means something else", () => {
    expect(
      categoriesFromName("Harvard Undergraduate Music in Hospitals and Nursing Homes Using Entertainment"),
    ).not.toContain("medicine-health");
    expect(
      categoriesFromName(
        "Harvard College Association of Student Practice and Learning of Yan Xin Life Science and Technology",
      ),
    ).toEqual([]);
    expect(categoriesFromName("Harvard Data Ventures")).toEqual([]);
    expect(categoriesFromName("The John Adams Society: A Harvard Undergraduate Debating Society")).toEqual([]);
    // "ai" inside a word or lowercase never counts.
    expect(categoriesFromName("Harvard Undergraduate Hawaii Club")).toEqual([]);
  });
});

describe("performing-arts names (v2)", () => {
  it("settles the art a name states, and nothing a name merely suggests", async () => {
    const { categoriesFromName } = await import("../src/stages/name-categories");
    expect(categoriesFromName("Harvard Ballet Company")).toEqual(["dance"]);
    expect(categoriesFromName("Harvard-Radcliffe Dramatic Club")).toEqual(["theater"]);
    expect(categoriesFromName("Harvard University Jazz Bands")).toEqual(["music"]);
    expect(categoriesFromName("Harvard Dance Marathon")).toEqual([]);
    expect(categoriesFromName("Harvard-Radcliffe Gilbert and Sullivan Players")).toEqual([]);
  });
});
