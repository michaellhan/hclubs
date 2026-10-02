import { describe, expect, it } from "vitest";
import { dedupeNearDuplicates } from "../src";

const shown = (v: string[]) => dedupeNearDuplicates(v).map((i) => v[i]);

describe("dedupeNearDuplicates", () => {
  it("folds synonyms and number phrasings", () => {
    expect(shown(["Spring vacation tour in Bermuda", "Spring break tour in Bermuda"])).toEqual([
      "Spring vacation tour in Bermuda",
    ]);
    expect(shown(["Performing more than 200 concerts annually", "Performing 200+ concerts annually"])).toHaveLength(1);
  });
  it("keeps the fuller value when one is contained in another", () => {
    expect(
      shown([
        "Recording albums",
        "Recording albums and videos",
        "Recording albums and videos, and performing 200+ concerts annually",
      ]),
    ).toEqual(["Recording albums and videos, and performing 200+ concerts annually"]);
  });
  it("keeps distinct activities and never lets a one-word value swallow others", () => {
    const v = [
      "Annual Winter Tour in January",
      "Recording albums and videos",
      "Tour",
      "Television and radio performances",
    ];
    expect(shown(v)).toEqual(v);
  });
});
