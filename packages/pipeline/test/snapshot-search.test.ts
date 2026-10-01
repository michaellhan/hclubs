import { describe, expect, it } from "vitest";
import { excerptAt, findOpportunities, searchTexts, type PageText } from "../src/snapshot-search";

const page = (clubId: string, text: string): PageText => ({
  clubId,
  slug: clubId,
  name: clubId,
  url: `https://${clubId}.test/`,
  role: null,
  fetchedAt: new Date("2026-09-30T12:00:00Z"),
  text,
});

describe("snapshot search", () => {
  it("returns the sentence around a hit, not the whole page", () => {
    const text = "We meet on Tuesdays. Members spend about 3 hours per week on projects. Join us!";
    const i = text.indexOf("3 hours");
    expect(excerptAt(text, i, 7)).toBe("Members spend about 3 hours per week on projects.");
  });

  it("finds each page once with distinct excerpts", () => {
    const hits = searchTexts(
      [page("a", "No dues. No dues. Free to join."), page("b", "Nothing here.")],
      /no dues|free to join/i,
    );
    expect(hits.map((h) => h.page.clubId)).toEqual(["a"]);
    expect(hits[0]!.excerpts).toEqual(["No dues.", "Free to join."]);
  });
});

describe("extraction opportunities", () => {
  it("lists only clubs still missing the field, with the page that may state it", () => {
    const pages = [page("knows", "We are open to all undergraduates."), page("missing", "Open to all class years!")];
    const present = new Map([["knows", new Set(["club.eligible_classes"])]]);
    const rows = findOpportunities(pages, present, ["knows", "missing", "silent"]);
    const eligibility = rows.find((r) => r.field === "eligibility")!;
    expect(eligibility.missing).toBe(2);
    expect(eligibility.leads.map((l) => l.slug)).toEqual(["missing"]);
  });
});
