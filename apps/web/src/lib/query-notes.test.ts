import { describe, expect, it } from "vitest";
import { ClubFilters } from "@hci/db/local";
import {
  constraintLabel,
  constraintSentences,
  constraintsToFilters,
  negatedSentence,
  softSentence,
} from "./query-notes";

const base = ClubFilters.parse({});

describe("query notes", () => {
  it("says how a phrase was read", () => {
    expect(constraintSentences([{ filter: "noComp", phrase: "no comp" }])).toEqual([
      "Read “no comp” as the No comp filter.",
    ]);
    expect(constraintLabel("freshmenEligible")).toBe("First-years eligible");
  });
  it("turns phrases into filters and leaves the remaining words", () => {
    const r = constraintsToFilters(
      [
        { filter: "noComp", phrase: "no comp" },
        { filter: "freshmenEligible", phrase: "freshmen" },
      ],
      "finance",
      base,
    );
    expect(r.q).toBe("finance");
    expect(r.filters.noComp && r.filters.freshmenEligible).toBe(true);
    expect(constraintsToFilters([{ filter: "openJoin", phrase: "open" }], "", base).q).toBeNull();
  });
  it("is quiet without soft words", () => {
    expect(softSentence([])).toBeNull();
    expect(softSentence(["beginner"])).toContain("“beginner”");
  });
  it("says negated phrases can't be searched, or nothing", () => {
    expect(negatedSentence([])).toBeNull();
    expect(negatedSentence(["not recruiting"])).toBe(
      "We can't search for clubs that aren't something (“not recruiting”); showing everything matching the rest.",
    );
  });
});
