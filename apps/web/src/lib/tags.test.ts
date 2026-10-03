import { describe, expect, it } from "vitest";
import { shownTags } from "./tags";

describe("shownTags", () => {
  it("shows affiliation labels and drops listing noise", () => {
    expect(
      shownTags([
        "seas-affiliated",
        "computer science",
        "pbha",
        "student club/group",
        "male final clubs",
        "female final clubs",
      ]),
    ).toEqual([
      { label: "PBHA program", query: "pbha" },
      { label: "Final club", query: "final club" },
    ]);
    expect(shownTags(["no comping requirement", "a cappella groups"])).toEqual([]);
  });
});
