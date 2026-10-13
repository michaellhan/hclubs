import { describe, expect, it } from "vitest";
import { dedupeNearDuplicates, restates } from "../src";

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

describe("restates (retiring LLM paraphrases, 2026-10-12)", () => {
  it("treats a contained or reworded value as a restatement", () => {
    expect(restates("Yearly UN trip", "Yearly trip to the UN")).toBe(true);
    expect(restates("Publishes an Arts section on Tuesdays", "Publishing an Arts section on Tuesdays")).toBe(true);
    expect(
      restates(
        "Weekly meetings Fridays 3:30-5:30 in Boston's Chinatown",
        "Program meets Fridays 3:30-5:30 in Boston's Chinatown",
      ),
    ).toBe(true);
  });
  it("never retires the fuller wording or a different activity", () => {
    expect(restates("Black Legacy Ball, a February celebration of Black History Month", "Black Legacy Ball")).toBe(
      false,
    );
    expect(restates("Low-cost stethoscope", "Midpoint design presentations and final showcases")).toBe(false);
    expect(restates("Industry talks", "Workshops and faculty talks")).toBe(false);
    expect(restates("Tour", "Annual Winter Tour in January")).toBe(false);
    expect(restates("Starboy Pageant", "Annual Pageant and Gala")).toBe(false);
  });
});
