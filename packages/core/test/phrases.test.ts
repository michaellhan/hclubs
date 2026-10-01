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
