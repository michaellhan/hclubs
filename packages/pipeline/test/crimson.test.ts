import { describe, expect, it } from "vitest";
import { htmlToDocument } from "../src/parse/document";
import { articleHeadline, articleMention, crimsonArticle, redactPeople, searchableNames } from "../src/stages/crimson";

const article = (title: string, paragraphs: string[]) =>
  htmlToDocument(
    `<html><head><title>${title}</title></head><body><article>${paragraphs.map((p) => `<p>${p}</p>`).join("")}</article></body></html>`,
    "https://www.thecrimson.com/article/2020/11/12/poker/",
  );

describe("crimson mentions", () => {
  it("recognizes article URLs and dates them from the path", () => {
    expect(crimsonArticle("https://www.thecrimson.com/article/2020/11/12/poker-club-zoom/?utm=x")).toEqual({
      url: "https://www.thecrimson.com/article/2020/11/12/poker-club-zoom/",
      publishedOn: "2020-11-12",
    });
    expect(crimsonArticle("https://www.thecrimson.com/tag/poker/")).toBeNull();
    expect(crimsonArticle("https://example.com/article/2020/1/1/x/")).toBeNull();
  });
  it("uses only names specific enough to search article text", () => {
    const names = searchableNames({
      name: "Harvard Undergraduate Poker Club",
      acronym: null,
      aliases: ["Harvard College"],
    });
    expect(names).toContain("Harvard Undergraduate Poker Club");
    expect(names).not.toContain("Harvard College");
    expect(searchableNames({ name: "The Harvard Crimson", acronym: null, aliases: [] })).toEqual([]);
  });
  it("prefers a sentence without students' names, else redacts them", () => {
    const names = ["Harvard Undergraduate Poker Club"];
    const withName = article("From the Poker Table | News | The Harvard Crimson", [
      "Chen ’22, founder of the Harvard Undergraduate Poker Club, moved games online.",
    ]);
    expect(articleMention(withName, names)).toBe(
      "[a student], founder of the Harvard Undergraduate Poker Club, moved games online.",
    );
    const both = article("x", [
      "Jane Doe ’23 joined the Harvard Undergraduate Poker Club.",
      "The Harvard Undergraduate Poker Club meets weekly.",
    ]);
    expect(articleMention(both, names)).toBe("The Harvard Undergraduate Poker Club meets weekly.");
    expect(articleMention(article("x", ["Nothing about it."]), names)).toBeNull();
    expect(redactPeople("Said Alex B. Kim '25 and Lee ’24.")).toBe("Said [a student] and [a student].");
  });
  it("strips the section and publisher from headlines", () => {
    expect(articleHeadline(article("From the Poker Table to the Zoom Screen | News | The Harvard Crimson", []))).toBe(
      "From the Poker Table to the Zoom Screen",
    );
  });
});
