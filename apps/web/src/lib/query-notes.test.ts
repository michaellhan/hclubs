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
    expect(constraintLabel("noDues")).toBe("No dues");
  });
  it("turns phrases into filters and leaves the remaining words", () => {
    const r = constraintsToFilters(
      [
        { filter: "noComp", phrase: "no comp" },
        { filter: "noDues", phrase: "free" },
      ],
      "finance",
      base,
    );
    expect(r.q).toBe("finance");
    expect(r.filters.noComp && r.filters.noDues).toBe(true);
    expect(constraintsToFilters([{ filter: "openJoin", phrase: "open" }], "", base).q).toBeNull();
  });
  it("reads an hours limit and says who it leaves out", () => {
    const c = [{ filter: "maxHours" as const, phrase: "under 3 hours a week", value: 3 }];
    expect(constraintSentences(c, 40)).toEqual([
      "Read “under 3 hours a week” as up to 3 hours a week. Clubs that don't say their hours aren't included (40 don't say).",
    ]);
    expect(constraintLabel("maxHours", 5)).toBe("up to 5 hours a week");
    expect(constraintsToFilters(c, "", base).filters.maxHours).toBe(3);
  });
  it("is quiet without soft words", () => {
    expect(softSentence([])).toBeNull();
    expect(softSentence(["beginner"])).toContain("“beginner”");
    expect(softSentence(["beginner"])).toContain("doesn't leave the others out");
    // Alone, soft words select clubs, so the note must not claim nothing was left out.
    expect(softSentence(["beginner"], true)).toBe(
      "Showing clubs that say they fit “beginner”. Few clubs state their hours or level, so many others may fit too.",
    );
  });
  it("says negated phrases can't be searched, or nothing", () => {
    expect(negatedSentence([])).toBeNull();
    expect(negatedSentence(["not recruiting"])).toBe(
      "We can't search for clubs that aren't something (“not recruiting”); showing everything matching the rest.",
    );
  });
});

describe("processSentence", () => {
  it("says process words lift rather than match", async () => {
    const { processSentence } = await import("./query-notes");
    expect(processSentence([], false)).toBeNull();
    expect(processSentence(["comp"], false)).toContain("the word itself isn't required");
    expect(processSentence(["comp"], true)).toBe("Showing clubs whose joining process or round matches “comp”.");
  });
});
