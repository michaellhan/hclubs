import { describe, expect, it } from "vitest";
import { sourceRows, sourceTitle } from "./provenance";

describe("profile sources list", () => {
  it("drops discovery's (page) suffixes", () => {
    expect(sourceTitle("Student clubs (career center) (page) (page)", "https://x.edu/a")).toBe(
      "Student clubs (career center)",
    );
    expect(sourceTitle(null, "https://www.example.org/a")).toBe("example.org");
  });

  it("lists one line per title and kind", () => {
    const rows = sourceRows([
      { url: "https://a.org/1", title: "Club article", sourceType: "club_website" },
      { url: "https://a.org/2", title: "Club article", sourceType: "club_website" },
      { url: "https://a.org/3", title: "Club article", sourceType: "club_recruiting_material" },
    ]);
    expect(rows.map((r) => r.url)).toEqual(["https://a.org/1", "https://a.org/3"]);
  });

  it("reads a page on the club's own host as its website, and a social account as one", () => {
    const rows = sourceRows([
      { url: "https://theharvardbsa.com/about-bsa", title: "About BSA", sourceType: "club_website" },
      { url: "https://theharvardbsa.com/donate", title: "About BSA", sourceType: "public_web" },
      { url: "https://theharvardbsa.com/gallery", title: "Gallery", sourceType: "public_web" },
      { url: "https://www.instagram.com/harvardsaa/", title: "Instagram: @harvardsaa", sourceType: "public_web" },
      { url: "https://news.example/a", title: "An article", sourceType: "public_web" },
    ]);
    expect(rows.map((r) => [r.label, r.kind])).toEqual([
      ["About BSA", "Club website"],
      ["Gallery", "Club website"],
      ["Instagram: @harvardsaa", "Social account"],
      ["An article", "Other website"],
    ]);
  });
});
