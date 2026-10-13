import { describe, expect, it } from "vitest";
import { parseSlugList } from "./local-list";
import { parseClubsParam } from "./saved";

// A 100 000-character "slug" in storage or a link used to be written straight back into the
// /compare URL, which the host refuses: the page came up blank.
describe("slug length", () => {
  const long = "x".repeat(100_000);
  it("drops over-long slugs from stored lists", () => {
    expect(parseSlugList(JSON.stringify([long, "harvard-crimson"]), 4)).toEqual(["harvard-crimson"]);
  });
  it("drops over-long slugs from shared saved links", () => {
    expect(parseClubsParam(`${long},harvard-crimson`)).toEqual(["harvard-crimson"]);
  });
  it("keeps the longest real slug", () => {
    const real = "a".repeat(79);
    expect(parseSlugList(JSON.stringify([real]), 4)).toEqual([real]);
  });
});
