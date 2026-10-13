import { describe, expect, it } from "vitest";
import { seasonWords } from "./join-timing";

describe("seasonWords", () => {
  it("lists seasons with commas and one and", () => {
    expect(seasonWords(["fall", "spring", "summer"])).toBe("in fall, spring and summer");
    expect(seasonWords(["fall", "spring"])).toBe("in fall and spring");
    expect(seasonWords(["fall", "rolling"])).toBe("in fall and on a rolling basis");
  });
});
