import { describe, expect, it } from "vitest";
import { isSearchSource } from "./known-by-name";

describe("isSearchSource", () => {
  it("flags search queries by title or host", () => {
    expect(isSearchSource({ url: "https://search.brave.com/search?q=x", title: 'Brave Search: "x"' })).toBe(true);
    expect(isSearchSource({ url: "https://api.search.brave.com/res/v1/web/search?q=x" })).toBe(true);
    expect(isSearchSource({ url: "https://www.google.com/search?q=x" })).toBe(true);
  });
  it("keeps real pages", () => {
    expect(isSearchSource({ url: "https://en.wikipedia.org/wiki/Harvard", title: "Harvard" })).toBe(false);
    expect(isSearchSource({ url: "https://www.google.com/maps", title: null })).toBe(false);
    expect(isSearchSource({ url: "not a url" })).toBe(false);
  });
});
