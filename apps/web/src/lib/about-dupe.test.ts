import { describe, expect, it } from "vitest";
import { aboutToShow, sentences } from "./about-dupe";

describe("aboutToShow", () => {
  it("hides About when it restates the one-liner", () => {
    expect(
      aboutToShow(
        "Student-led group supporting and advocating for the immigrant community on campus and beyond.",
        "Act on a Dream is a student-led, student-run organization at Harvard College focused on supporting and advocating for the immigrant community on campus and beyond.",
        "Act on a Dream at Harvard College",
      ),
    ).toBeNull();
  });

  it("keeps only the sentences the one-liner doesn't already say", () => {
    const oneLine =
      "The Suffolk Prison Education program provides one-on-one GED tutoring for inmates at the Suffolk County House of Corrections.";
    const extra = "The program also provides workshops based on other academic interests, from biochemistry to poetry.";
    expect(aboutToShow(oneLine, `${oneLine} ${extra}`, "PBHA's Suffolk Prison Education")).toBe(extra);
  });

  it("keeps About as is when it says something else", () => {
    const about = "Founded in 1908, the club stages four mainstage shows a year at the Loeb.";
    expect(aboutToShow("Umbrella organization for campus theater.", about, "Dramatic Club")).toBe(about);
  });

  it("shows About when there is no one-liner", () => {
    expect(aboutToShow(null, "Anything.", "X")).toBe("Anything.");
  });
});

describe("sentences", () => {
  it("doesn't split after initials or street abbreviations", () => {
    expect(sentences("The Phoenix S.K. Club is on Mt. Auburn Street. It was formed in 1895.")).toEqual([
      "The Phoenix S.K. Club is on Mt. Auburn Street.",
      "It was formed in 1895.",
    ]);
  });
});
