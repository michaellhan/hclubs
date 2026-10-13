import { describe, expect, it } from "vitest";
import { distinctAliases, restatesWithSexSuffix } from "./format";

describe("aliases that restate the name with a listing suffix (round 7)", () => {
  it.each([
    ["Ultimate Frisbee M", "Harvard Men's Ultimate Frisbee Club"],
    ["Volleyball W", "Harvard Women's Volleyball Club"],
    ["Soccer M", "Harvard Men's Soccer Club"],
    ["Ice Hockey W", "Harvard Women's Ice Hockey Club"],
    ["Boxing (Club Sport)", "Harvard Boxing Club"],
    ["Ultimate Frisbee (Men's Club Sport)", "Harvard Men's Ultimate Frisbee Club"],
  ])("hides %s beside %s", (alias, name) => {
    expect(restatesWithSexSuffix(alias, name)).toBe(true);
  });

  it.each([
    // A word the name doesn't have is news.
    ["Basketball M", "Harvard Men's Hoopsters Club"],
    // No suffix: other rules decide.
    ["Ultimate Frisbee", "Harvard Men's Ultimate Frisbee Club"],
    ["HUM", "Harvard Undergraduate Mathematics"],
    // A name word that happens to be one letter isn't a suffix of nothing.
    ["W", "Harvard W Club"],
  ])("keeps %s beside %s", (alias, name) => {
    expect(restatesWithSexSuffix(alias, name)).toBe(false);
  });

  it("distinctAliases leaves them out and keeps real alternate names", () => {
    const got = distinctAliases({
      name: "Harvard Men's Ultimate Frisbee Club",
      acronym: null,
      aliases: [{ alias: "Ultimate Frisbee M" }, { alias: "Red Line" }],
    }).map((a) => a.alias);
    expect(got).toEqual(["Red Line"]);
  });
});
