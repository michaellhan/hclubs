import { describe, expect, it } from "vitest";
import { independentReference } from "../src";

const ev = (over: Partial<Parameters<typeof independentReference>[0][number]>) => ({
  tier: 8,
  sourceOwnedByClub: false,
  sourceUrl: "https://example.test/page",
  extractor: "link-graph",
  quote: "Example Club",
  assertion: "stated" as const,
  ...over,
});

describe("independentReference (ownership-v2, ADR 0039)", () => {
  it("accepts a Harvard-related page that links the site by the club's name", () => {
    expect(independentReference([ev({ tier: 7, sourceUrl: "https://harvardindependent.com/a" })])).toMatch(
      /harvardindependent\.com/,
    );
  });
  it("accepts Wikipedia's website row, not any Wikipedia link", () => {
    const wiki = { sourceUrl: "https://en.wikipedia.org/wiki/Example_Club", extractor: "site-deterministic" };
    expect(independentReference([ev({ ...wiki, quote: "Website: example.org" })])).toMatch(/Wikipedia/);
    expect(independentReference([ev({ ...wiki, quote: "the original" })])).toBeNull();
  });
  it("needs two different sites when the references are ordinary web pages", () => {
    const a = ev({ sourceUrl: "https://lite.sister-club.org/" });
    expect(independentReference([a, ev({ sourceUrl: "https://sister-club.org/about" })])).toBeNull();
    expect(independentReference([a, ev({ sourceUrl: "https://another.org/" })])).toMatch(/2 other sites/);
  });
  it("never counts the club's own pages or inferred evidence", () => {
    expect(independentReference([ev({ tier: 6, sourceOwnedByClub: true })])).toBeNull();
    expect(independentReference([ev({ tier: 6, assertion: "inferred" })])).toBeNull();
  });
});
