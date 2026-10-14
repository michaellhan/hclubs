import { describe, expect, it } from "vitest";
import { parseSlugList } from "./local-list";

describe("parseSlugList", () => {
  it("drops duplicate slugs on read, keeping first order", () => {
    expect(parseSlugList(JSON.stringify(["harvard-crimson", "a", "harvard-crimson", "a", "b"]), 100)).toEqual([
      "harvard-crimson",
      "a",
      "b",
    ]);
  });
  it("caps after de-duping, so duplicates never use up the cap", () => {
    expect(parseSlugList(JSON.stringify(["a", "a", "a", "b", "c"]), 3)).toEqual(["a", "b", "c"]);
  });
  it("ignores corrupt or non-array values", () => {
    expect(parseSlugList("{", 5)).toEqual([]);
    expect(parseSlugList('{"a":1}', 5)).toEqual([]);
    expect(parseSlugList(null, 5)).toEqual([]);
  });
});
