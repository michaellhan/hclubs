import { describe, expect, it } from "vitest";
import { CuratedFactsEntry, CURATED_FACTS, type CuratedFact } from "../src/curated/facts";
import { betterSourceType, factProblem, factsSourceType } from "../src/stages/facts";

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

  it("takes an acronym only as a word of its quote, in the page's own case", () => {
    const acr = (value: string, quote: string) => factProblem(fact({ field: "club.acronym", value, quote }), "");
    expect(acr("FGS", "The Fictional Gazette Society (FGS) was founded in 1990.")).toBeNull();
    expect(acr("FGS", "FGS members meet weekly on Tuesdays.")).toBeNull();
    // Inside a longer word, or in another case, it isn't the club's acronym.
    expect(acr("FGS", "The FGSA meets weekly on Tuesday evenings.")).not.toBeNull();
    expect(acr("FGS", "The fgs club meets weekly on Tuesday evenings.")).not.toBeNull();
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

  // Regression (2026-10-13): an IOP program page read as public_web evidence although its
  // source row is harvard_official.
  it("types a Harvard office page as harvard_official and keeps a source's better type", () => {
    expect(factsSourceType("https://iop.harvard.edu/program/fictional", [])).toBe("harvard_official");
    expect(betterSourceType("public_web", "harvard_official")).toBe("harvard_official");
    expect(betterSourceType("club_website", "public_web")).toBe("club_website");
    expect(betterSourceType("public_web", null)).toBe("public_web");
  });

  // Regression (2026-10-12): the Crimson's comp site, comp.thecrimson.com, was typed as
  // "Other website" beside its verified thecrimson.com, so its facts carried a tier-8 confidence.
  it("types a subdomain of the verified website as the club's site, never on a shared or path-scoped host", () => {
    expect(factsSourceType("https://comp.fictional.example.org/", ["https://www.fictional.example.org/"])).toBe(
      "club_website",
    );
    // A look-alike host that only ends in the same letters is not a subdomain.
    expect(factsSourceType("https://notfictional.example.org/", ["https://fictional.example.org/"])).toBe("public_web");
    // Path-scoped club site on a shared host: the host's subdomains are someone else's.
    expect(factsSourceType("https://apply.host.example.com/", ["https://host.example.com/fictional/"])).toBe(
      "public_web",
    );
    // A school's shared host: apply.hbs.edu is MBA admissions, not the club's.
    expect(factsSourceType("https://apply.hbs.edu/", ["https://www.hbs.edu/"])).toBe("public_web");
    expect(factsSourceType("https://other.hcs.harvard.edu/", ["https://fictional.hcs.harvard.edu/"])).toBe(
      "public_web",
    );
  });

  // Round 4 (2026-10-13): the Club Sports Office's interest form, the one way in it names for
  // every club sport. A link fact needs the URL as a body link and its link text in the quote.
  it("accepts a link only when the page links it in its body from words in the quote", () => {
    const quote =
      "For more information about a specific organization, please inquire by submitting the Fictional Interest Form.";
    const value = {
      kind: "application_form",
      url: "https://forms.example.invalid/r/abc",
      label: "Interest form",
    } as const;
    const link = fact({ field: "club.link", value, quote });
    const body = { url: "https://forms.example.invalid/r/abc", text: "Fictional Interest Form", chrome: false };
    expect(factProblem(link, quote, [body])).toBeNull();
    expect(factProblem(link, quote, [])).toMatch(/does not link/);
    expect(factProblem(link, quote, [{ ...body, chrome: true }])).toMatch(/does not link/);
    expect(factProblem(link, quote, [{ ...body, text: "Some other form" }])).toMatch(/link's own text/);
    // A website or social account is not a joining link.
    expect(() =>
      CuratedFactsEntry.parse({
        slug: "fixture-club",
        url: "https://fictional.example.org/",
        facts: [{ field: "club.link", value: { ...value, kind: "website" }, quote }],
      }),
    ).toThrow();
    expect(factsSourceType("https://soco.college.harvard.edu/clubsports/club-sport-organizations/", [])).toBe(
      "harvard_official",
    );
    expect(factsSourceType("https://soco.college.harvard.edu/257812/home/", [])).toBe("public_web");
  });

  it("the committed list parses", () => {
    for (const e of CURATED_FACTS) expect(() => CuratedFactsEntry.parse(e)).not.toThrow();
  });
});
