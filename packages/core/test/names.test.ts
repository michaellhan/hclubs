import { describe, expect, it } from "vitest";
import {
  blockingKey,
  initialsOf,
  looksLikeAcronym,
  normalizeAcronym,
  normalizeName,
  slugify,
  trigramSimilarity,
} from "../src";

describe("normalizeName", () => {
  it("lowercases, strips punctuation and leading article", () => {
    expect(normalizeName("The Harvard Crimson")).toBe("harvard crimson");
    expect(normalizeName("  Harvard   Crimson!! ")).toBe("harvard crimson");
  });
  it("normalizes ampersands, apostrophes and diacritics", () => {
    expect(normalizeName("Arts & Crafts")).toBe("arts and crafts");
    expect(normalizeName("Women’s Club")).toBe("womens club");
    expect(normalizeName("Société Française")).toBe("societe francaise");
  });
  it("keeps distinguishing tokens like 'undergraduate'", () => {
    expect(normalizeName("Harvard Undergraduate Economics Association")).not.toBe(
      normalizeName("Harvard Economics Association"),
    );
  });
});

describe("blockingKey", () => {
  it("removes noise tokens for candidate blocking only", () => {
    expect(blockingKey("Harvard Undergraduate Economics Association")).toBe("economics");
    expect(blockingKey("The Harvard College Economics Club")).toBe("economics");
  });
});

describe("slugify", () => {
  it("produces url-safe slugs", () => {
    expect(slugify("Harvard Computer Society (HCS)")).toBe("harvard-computer-society-hcs");
    expect(slugify("Alzheimer’s Buddies")).toBe("alzheimers-buddies");
  });
  it("truncates at a word boundary", () => {
    const s = slugify("word ".repeat(40), 30);
    expect(s.length).toBeLessThanOrEqual(30);
    expect(s.endsWith("-")).toBe(false);
  });
});

describe("acronyms", () => {
  it("normalizes dotted acronyms", () => {
    expect(normalizeAcronym("H.U.C.G.")).toBe("HUCG");
  });
  it("detects plausible acronyms", () => {
    expect(looksLikeAcronym("HCS")).toBe(true);
    expect(looksLikeAcronym("Harvard")).toBe(false);
  });
  it("derives initials without stopwords", () => {
    expect(initialsOf("Harvard Computer Society")).toBe("HCS");
    expect(initialsOf("Society of Women Engineers")).toBe("SWE");
  });
});

describe("trigramSimilarity", () => {
  it("is 1 for identical normalized names and lower for different ones", () => {
    expect(trigramSimilarity("Harvard Crimson", "The Harvard Crimson")).toBe(1);
    expect(trigramSimilarity("Harvard Ballroom Dance Team", "Harvard Ballroom")).toBeGreaterThan(0.4);
    expect(trigramSimilarity("Harvard Ballroom", "Harvard Robotics Club")).toBeLessThan(0.4);
  });
});
