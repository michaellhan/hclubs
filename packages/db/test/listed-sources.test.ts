import { describe, expect, it } from "vitest";
import { listedSources, sourceTypeForClub } from "../src/queries/clubs";

describe("listedSources", () => {
  const row = (url: string, fieldKeys: string[]) => ({ url, fieldKeys });
  it("drops policy pages and posts that only repeat links", () => {
    const got = listedSources([
      row("https://paper.example/", ["club.link", "club.short_description"]),
      row("https://paper.example/about", ["club.mission"]),
      row("https://paper.example/about/privacy", ["club.long_description"]),
      row("https://paper.example/article/2026/10/2/story", ["club.link"]),
      row("https://club.example/news/fall-comp", ["cycle.deadline", "club.link"]),
    ]).map((r) => r.url);
    expect(got).toEqual([
      "https://paper.example/",
      "https://paper.example/about",
      "https://club.example/news/fall-comp",
    ]);
  });
});

describe("public source titles", () => {
  it("a title that is only a person's name shows the publication", async () => {
    const { personTitleless } = await import("../src/queries/public");
    const crimson = "https://thecrimson.com/article/2019/12/12/awnit-marta";
    expect(personTitleless("Awnit Marta | The Harvard Crimson", crimson)).toBe("The Harvard Crimson article");
    // Two capitalized words that aren't the article's own address stay as they are.
    expect(personTitleless("Ghungroo Returns | The Harvard Crimson", crimson)).toBe(
      "Ghungroo Returns | The Harvard Crimson",
    );
    expect(personTitleless("Harvard Undergraduate Bhangra", "https://x.org/")).toBe("Harvard Undergraduate Bhangra");
  });

  it("search results pages aren't listed sources", () => {
    const rows = [
      { url: "https://search.brave.com/search?q=x", fieldKeys: ["club.name"] },
      { url: "https://club.org/", fieldKeys: ["club.name"] },
    ];
    expect(listedSources(rows).map((r) => r.url)).toEqual(["https://club.org/"]);
  });
});

describe("sourceTypeForClub (2026-10-12)", () => {
  it("labels another club's own page as a Harvard-related publication, not this club's website", () => {
    expect(sourceTypeForClub("club_website", true)).toBe("harvard_related_other");
    expect(sourceTypeForClub("club_website", false)).toBe("club_website");
    expect(sourceTypeForClub("harvard_crimson", true)).toBe("harvard_crimson");
  });
});

describe("listedSources: pages of one paginated listing (round 3)", () => {
  const row = (url: string) => ({ url, fieldKeys: ["club.category"] });
  it("keeps one page of a listing, the first page when listed", () => {
    const out = listedSources([
      row("https://www.pbha.org/programs?offset=1734301560265"),
      row("https://www.pbha.org/programs"),
      row("https://www.pbha.org/programs?offset=1705368180217"),
    ]).map((r) => r.url);
    expect(out).toEqual(["https://www.pbha.org/programs"]);
    expect(
      listedSources([row("https://www.pbha.org/programs?offset=1"), row("https://www.pbha.org/programs?offset=2")]).map(
        (r) => r.url,
      ),
    ).toEqual(["https://www.pbha.org/programs?offset=1"]);
  });
  it("keeps pages a non-numeric page parameter routes to", () => {
    expect(listedSources([row("https://x.example/?page=about"), row("https://x.example/?page=join")])).toHaveLength(2);
  });
});
