import { describe, expect, it } from "vitest";
import { listedSources } from "../src/queries/clubs";

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
