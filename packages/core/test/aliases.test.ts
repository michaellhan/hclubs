import { describe, expect, it } from "vitest";
import { aliasRestatesName, restatesWithSexSuffix } from "../src/aliases";

const WICS = { name: "Harvard Undergraduate Women in Computer Science", acronym: "WiCS" };

describe("aliases that only restate the club's name (persona round 8)", () => {
  it.each([
    // The name without its place words, with or without the acronym (WiCS's two aliases).
    ["Women in Computer Science", WICS],
    ["Women in Computer Science (WiCS)", WICS],
    ["WiCS: Women in Computer Science", WICS],
    ["Harvard Women in Computer Science", WICS],
    ["The Harvard Advocate", { name: "Harvard Advocate", acronym: null }],
    ["Harvard College Chess Club", { name: "Harvard Chess Club", acronym: null }],
    ["Political Review", { name: "Harvard Political Review", acronym: "HPR" }],
    ["Harvard Undergraduate Dance & Movement", { name: "Dance and Movement", acronym: null }],
    // The sex-suffix rule rides along (round 7).
    ["Soccer M", { name: "Harvard Men's Soccer Club", acronym: null }],
  ])("hides %s", (alias, club) => {
    expect(aliasRestatesName(alias, club)).toBe(true);
  });

  it.each([
    // A shorter or different name is news.
    ["Ultimate Frisbee", { name: "Harvard Men's Ultimate Frisbee Club", acronym: null }],
    ["Women in CS", WICS],
    ["Harvard Computer Society", { name: "Harvard Undergraduate Women in Computer Science", acronym: "WiCS" }],
    // A former name.
    ["AI Safety Student Team", { name: "AI Safety Team", acronym: "AIST" }],
    // The acronym alone is the web's own rule, and "Harvard" alone says nothing either way.
    ["Harvard", { name: "Harvard Advocate", acronym: null }],
    // Some of the name's words only.
    ["Women in Science", WICS],
  ])("keeps %s", (alias, club) => {
    expect(aliasRestatesName(alias, club)).toBe(false);
  });

  it("keeps the round 7 sex-suffix cases", () => {
    expect(restatesWithSexSuffix("Ultimate Frisbee (Men's Club Sport)", "Harvard Men's Ultimate Frisbee Club")).toBe(
      true,
    );
    expect(restatesWithSexSuffix("Basketball M", "Harvard Men's Hoopsters Club")).toBe(false);
    expect(restatesWithSexSuffix("W", "Harvard W Club")).toBe(false);
  });
});
