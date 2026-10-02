import { describe, expect, it } from "vitest";
import { CuratedFactsEntry, CURATED_FACTS, type CuratedFact } from "../src/curated/facts";
import { factProblem, factsSourceType } from "../src/stages/facts";

const fact = (f: CuratedFact) => f;

describe("editor-read facts (ADR 0044)", () => {
  it("accepts a quote that states the value", () => {
    expect(
      factProblem(
        fact({ field: "club.hours_per_week", value: { min: 3, max: 5 }, quote: "Members spend 3-5 hours a week." }),
        "",
      ),
    ).toBeNull();
    expect(
      factProblem(
        fact({ field: "club.join_mode", value: "comp", quote: "Anyone can comp the Fictional Gazette each semester." }),
        "",
      ),
    ).toBeNull();
    expect(
      factProblem(
        fact({ field: "club.freshmen_eligible", value: true, quote: "First-years are welcome to join the club." }),
        "",
      ),
    ).toBeNull();
  });

  it("rejects numbers the quote doesn't contain, negated processes and unsupported eligibility", () => {
    expect(
      factProblem(
        fact({ field: "club.hours_per_week", value: { min: 4, max: 6 }, quote: "Members spend 3-5 hours a week." }),
        "",
      ),
    ).toMatch(/does not appear/);
    expect(
      factProblem(
        fact({ field: "club.member_count", value: { kind: "exact", count: 80 }, quote: "We have about 60 members." }),
        "",
      ),
    ).toMatch(/does not appear/);
    expect(
      factProblem(
        fact({ field: "club.join_mode", value: "audition", quote: "There are no auditions; everyone is welcome." }),
        "",
      ),
    ).not.toBeNull();
    expect(
      factProblem(
        fact({ field: "club.freshmen_eligible", value: true, quote: "Our board applications open in the spring." }),
        "",
      ),
    ).not.toBeNull();
    expect(
      factProblem(
        fact({
          field: "club.meeting_frequency",
          value: "Every 2 weeks",
          quote: "We meet every other week on Sundays.",
        }),
        "",
      ),
    ).toMatch(/2 does not appear/);
  });

  it("types the page as the club's site only on its verified website (and below its folder)", () => {
    expect(factsSourceType("https://fictional.example.org/join", ["https://www.fictional.example.org/"])).toBe(
      "club_website",
    );
    expect(factsSourceType("https://host.example.com/fictional/comp", ["https://host.example.com/fictional/"])).toBe(
      "club_website",
    );
    expect(factsSourceType("https://host.example.com/other/comp", ["https://host.example.com/fictional/"])).toBe(
      "public_web",
    );
    expect(factsSourceType("https://www.thecrimson.com/article/x", [])).toBe("harvard_crimson");
    expect(factsSourceType("https://fictional.example.org/join", [])).toBe("public_web");
  });

  it("the committed list parses", () => {
    for (const e of CURATED_FACTS) expect(() => CuratedFactsEntry.parse(e)).not.toThrow();
  });
});
