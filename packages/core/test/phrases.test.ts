import { describe, expect, it } from "vitest";
import { collapseSimilarPhrases } from "../src";

describe("collapseSimilarPhrases", () => {
  it("keeps the most specific of near-duplicate activity bullets", () => {
    expect(
      collapseSimilarPhrases([
        "Parody of the Harvard Crimson",
        "Parodies of the Harvard Crimson",
        "Publishes five issues of the magazine annually",
        "Parodies of other magazines and popular literature",
        "Parodies other magazines and popular literature",
        "Publishes five issues annually",
        "Publishes five issues of a humor magazine annually",
      ]),
    ).toEqual([
      "Parodies of the Harvard Crimson",
      "Publishes five issues of a humor magazine annually",
      "Parodies of other magazines and popular literature",
    ]);
  });

  it("leaves distinct activities alone", () => {
    const items = ["Weekly rehearsals", "Spring concert at Sanders Theatre", "Annual tour", "Workshops with alumni"];
    expect(collapseSimilarPhrases(items)).toEqual(items);
  });
});

describe("cleanDescriptionText (audit regression)", () => {
  it("drops Wikipedia markers and capitalizes fragments for display", async () => {
    const { cleanDescriptionText } = await import("../src/normalize/phrases");
    expect(
      cleanDescriptionText("fields one of the top intercollegiate debate teams in the world.[citation needed]"),
    ).toBe("Fields one of the top intercollegiate debate teams in the world.");
    expect(cleanDescriptionText("provides political opportunities[clarification needed] to undergraduates.")).toBe(
      "Provides political opportunities to undergraduates.",
    );
    expect(cleanDescriptionText("Boxing has been popular since the 19th century.[1] It was")).toBe(
      "Boxing has been popular since the 19th century. It was",
    );
    expect(cleanDescriptionText("performs Bharatanatyam.")).toBe("Performs Bharatanatyam.");
    expect(cleanDescriptionText(null)).toBeNull();
  });
});

describe("reworded activities", () => {
  it("collapses a long activity said twice in other words, keeps short distinct ones", async () => {
    const { collapseSimilarPhrases } = await import("../src");
    expect(
      collapseSimilarPhrases([
        "Consulting on entering new markets, developing new products, and customized primary research and advice",
        "Consulting on market entry, product development, and customized primary research and advice",
        "Weekly workshops on case interviews",
        "Weekly workshops on financial modeling",
      ]),
    ).toHaveLength(3);
  });
});

describe("collapseSimilarPhrases: verb forms", () => {
  it("treats 'Publishes' and 'Publishing' bullets as one", () => {
    expect(
      collapseSimilarPhrases([
        "Publishes an Arts section on Tuesdays",
        "Publishing an Arts section on Tuesdays",
        "Hosts a spring concert",
      ]),
    ).toEqual(["Publishing an Arts section on Tuesdays", "Hosts a spring concert"]);
  });
});
