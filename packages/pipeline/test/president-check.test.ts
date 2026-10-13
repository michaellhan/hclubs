import { describe, expect, it } from "vitest";
import { extractRecruitingSeasons } from "../src/extract/deterministic";
import {
  aboutTextProblem,
  bookingPitchProblem,
  duesProblem,
  navLabelActivityProblem,
  seasonScopeProblem,
  stitchedTextProblem,
} from "../src/extract/evidence-rules";
import { groundExtraction, type LlmPage } from "../src/extract/llm/extractor";
import type { LlmExtraction } from "../src/extract/llm/schema";
import { htmlToDocument } from "../src/parse/document";
import { pressMentionProblem, siblingInHeadline } from "../src/stages/crimson";
import { factProblem } from "../src/stages/facts";

/** A club president checked live profiles against the clubs' own sites (2026-10-13). */

const FETCHED = new Date("2026-10-12T16:00:00Z");

describe("recruiting seasons: shows and production positions (1.16.47, g24)", () => {
  // Trimmed from hastypudding.org/comp: cast, band and tech audition in September; the Creative
  // Team's writers comp in spring; the show runs February to March.
  const HPT = `<html><body><h1>Comp The Pudding.</h1>
    <p>J-Term: January 11 – January 24, 2027</p>
    <p>Show Season: February 5 – March 19, 2027</p>
    <h2>Comp Cast</h2><p>Auditions: September 4 – September 6, 2026 (sign up here)</p>
    <h2>Comp Creative</h2>
    <p>When: Script, lyrics, composer, and choreographer comps are all held in the Spring. The Poster comp is held in the Fall.</p>
    </body></html>`;

  it("reads no season from the Creative Team's position comps or the show season", () => {
    const got = extractRecruitingSeasons({
      doc: htmlToDocument(HPT, "https://hastypudding.org/comp"),
      role: "recruiting",
      fetchedAt: FETCHED,
      clubNames: ["Hasty Pudding Theatricals"],
      clubAcronyms: [],
    });
    expect(got).toEqual([]);
  });

  it("names the problem", () => {
    expect(seasonScopeProblem("Show Season: February 5 – March 19, 2027")?.check).toBe("performance_season");
    expect(seasonScopeProblem("Our concert season runs every spring.")?.check).toBe("performance_season");
    expect(
      seasonScopeProblem("Script, lyrics, composer, and choreographer comps are all held in the Spring.")?.check,
    ).toBe("position_comp");
    expect(seasonScopeProblem("The Poster comp is held in the Fall.")?.check).toBe("position_comp");
  });

  it("keeps a club's own recruiting pattern", () => {
    expect(seasonScopeProblem("We recruit new members every fall and spring.")).toBeNull();
    expect(seasonScopeProblem("Our comp runs each semester and is open to all.")).toBeNull();
    const got = extractRecruitingSeasons({
      doc: htmlToDocument(
        "<html><body><h1>Join</h1><p>We hold auditions every fall.</p></body></html>",
        "https://x.test/join",
      ),
      role: "join",
      fetchedAt: FETCHED,
      clubNames: ["Example Singers"],
      clubAcronyms: [],
    });
    expect(got.map((c) => c.value)).toEqual([["fall"]]);
  });

  it("LLM grounding rejects the same seasons", () => {
    const quote =
      "Script, lyrics, composer, and choreographer comps are all held in the Spring. The Poster comp is held in the Fall.";
    const page: LlmPage = { url: "https://hastypudding.org/comp", role: "recruiting", snapshotId: "s", text: quote };
    const r = groundExtraction(
      { ...empty(), recruiting_seasons: { value: ["fall", "spring"], quote } },
      [page],
      FETCHED,
    );
    expect(r.claims.filter((c) => c.fieldKey === "club.recruiting_seasons")).toEqual([]);
    expect(r.rejected.join(" ")).toMatch(/production positions/);
  });
});

describe("booking pitches are never About text", () => {
  it("rejects the Krokodiloes' booking line", () => {
    const kroks =
      "The Kroks perform their signature blend of jazz and swing standards during the academic year at private functions, charity fundraisers & special occasions throughout the New England area. To book us for your next event, use the booking form linked below.";
    expect(bookingPitchProblem(kroks)?.check).toBe("booking_pitch");
    expect(aboutTextProblem(kroks)?.check).toBe("booking_pitch");
    expect(bookingPitchProblem("For booking inquiries, email us.")?.check).toBe("booking_pitch");
  });
  it("keeps a long About that only ends with an invitation to book (the Opportunes)", () => {
    expect(
      bookingPitchProblem(
        "The Opportunes are Harvard's oldest (and boldest) all-gender a cappella group, bringing you the best that collegiate a cappella has to offer from Harvard since 1980. Our style ranges from the soulful stylings of Whitney Houston to the epic drama of Labrinth. Catch us at one of our many events on campus and around the world, or book us today and we'll come to you! Can't wait to see us live? Check our latest studio album.",
      ),
    ).toBeNull();
    expect(
      bookingPitchProblem(
        "The Harvard Krokodiloes have sung jazz and swing standards since 1946. Hear Harvard's oldest a cappella group on tour, or book the Kroks for your event.",
      )?.check,
    ).toBe("booking_pitch");
  });
  it("keeps descriptions that mention performing for audiences", () => {
    expect(
      bookingPitchProblem("The Harvard Krokodiloes are Harvard's oldest a cappella group, founded in 1946."),
    ).toBeNull();
    expect(bookingPitchProblem("We perform at weddings, galas and campus events every semester.")).toBeNull();
  });
});

describe("a mission is one sentence of the club's, never two stitched (g23)", () => {
  const quote =
    "As the only daily newspaper of Harvard University and the City of Cambridge, we have a unique obligation to our readers. To serve them ethically, we aim to:";
  it("rejects the Crimson's stitched mission", () => {
    expect(
      stitchedTextProblem(
        "As the only daily newspaper of Harvard University and the City of Cambridge, to serve readers ethically",
        quote,
      )?.check,
    ).toBe("stitched_text");
  });
  it("keeps a mission taken from one sentence, lightly reworded", () => {
    expect(
      stitchedTextProblem(
        "To promote academic enrichment for children of low-income families in Boston's Chinatown community.",
        "PBHA's Chinatown Afterschool Program seeks to promote academic enrichment for children of low-income families in Boston’s Chinatown community. We meet weekly.",
      ),
    ).toBeNull();
    expect(stitchedTextProblem("Spread joy through music.", "the Kroks spread joy through music")).toBeNull();
  });
  it("LLM grounding drops it", () => {
    const page: LlmPage = { url: "https://thecrimson.com/about", role: "about", snapshotId: "s", text: quote };
    const r = groundExtraction(
      {
        ...empty(),
        mission: {
          value:
            "As the only daily newspaper of Harvard University and the City of Cambridge, to serve readers ethically",
          quote,
        },
      },
      [page],
      FETCHED,
    );
    expect(r.claims.filter((c) => c.fieldKey === "club.mission")).toEqual([]);
  });
});

describe("a site's menu is never activities (g23)", () => {
  const menu = "News ·Opinion ·Arts ·Blog ·Magazine ·Multimedia ·Sports";
  it("rejects menu labels", () => {
    expect(navLabelActivityProblem("News", menu)?.check).toBe("nav_label");
    expect(navLabelActivityProblem("Sports", "Home | About | Sports | Contact")?.check).toBe("nav_label");
  });
  it("keeps activities quoted from sentences or a real list item", () => {
    expect(
      navLabelActivityProblem(
        "Publishes a daily newspaper",
        "The Crimson publishes every morning, Monday through Friday.",
      ),
    ).toBeNull();
    expect(navLabelActivityProblem("Hackathons", "Hackathons")).toBeNull();
  });
  it("LLM grounding drops them", () => {
    const page: LlmPage = { url: "https://thecrimson.com", role: "home", snapshotId: "s", text: menu };
    const r = groundExtraction({ ...empty(), activities: [{ value: "News", quote: menu }] }, [page], FETCHED);
    expect(r.claims).toEqual([]);
  });
});

describe("dues with what they cover (the Outing Club)", () => {
  const quote = "Membership costs $20 /6 months and we offer full no-questions-asked financial aid.";
  it("reads 'Membership costs $20' as dues", () => {
    expect(duesProblem(quote, 20)).toBeNull();
    expect(duesProblem("Tickets cost $20 at the door.", 20)).not.toBeNull();
  });
  it("needs the period in the quote, word for word", () => {
    const fact = (period: string) =>
      ({ field: "club.dues", value: { hasDues: true, amountUsd: 20, period }, quote }) as const;
    expect(factProblem(fact("6 months"), quote)).toBeNull();
    expect(factProblem(fact("semester"), quote)).toMatch(/not in the quote/);
  });
});

describe("press: sibling organizations in headlines (press-v7)", () => {
  const others = ["hasty pudding theatricals", "hasty pudding club", "hasty pudding institute of 1770"];
  const hpt = { name: "Hasty Pudding Theatricals", acronym: null, aliases: [] };
  const institute = { name: "The Hasty Pudding Institute of 1770", acronym: null, aliases: [] };
  const ctx = { otherClubNames: others };
  const m = (title: string, quote: string, leadText?: string) => ({
    title,
    quote,
    publishedOn: "2014-01-27",
    ...(leadText ? { article: { mentions: 3, inLead: true, leadText } } : {}),
  });

  it("gives a headline naming the Club or the Institute to that organization", () => {
    expect(siblingInHeadline(hpt, "Hasty Pudding Club Finds New Home", others)).toEqual({
      kind: "sibling",
      name: "hasty pudding club",
    });
    expect(
      pressMentionProblem(
        hpt,
        m("Hasty Pudding Club Finds New Home", "The Hasty Pudding Theatricals will remain."),
        ctx,
      ),
    ).toMatch(/sibling organization/);
    expect(
      pressMentionProblem(
        hpt,
        m("Pudding Institute Will Relocate Clubhouse to Tommy Doyle’s Spot", "… the Hasty Pudding Theatricals …"),
        ctx,
      ),
    ).toMatch(/sibling organization/);
    expect(siblingInHeadline(institute, "Hasty Pudding Club Finds New Home", others)?.kind).toBe("sibling");
  });

  it("keeps a bare 'Hasty Pudding' headline only when the opening names this organization alone", () => {
    const umbrella =
      "The Hasty Pudding Institute of 1770—comprised of The Hasty Pudding Club, Hasty Pudding Theatricals, and Harvard Krokodiloes—cut the ribbon.";
    expect(pressMentionProblem(hpt, m("Hasty Pudding Cuts Ribbon on New Clubhouse", umbrella), ctx)).toMatch(
      /shared with sibling/,
    );
    expect(
      pressMentionProblem(
        hpt,
        m(
          "Hasty Pudding Announces Woman of the Year",
          "The Hasty Pudding Theatricals named its Woman of the Year.",
          "The Hasty Pudding Theatricals announced Tuesday that it will honor an actress at its annual roast.",
        ),
        ctx,
      ),
    ).toBeNull();
  });

  it("a headline with this club's full name stands; plural 'Clubs' isn't the Club", () => {
    expect(
      pressMentionProblem(
        hpt,
        m("Hasty Pudding Theatricals Undergrads Petition Grad Members", "Hasty Pudding Theatricals undergraduates …"),
        ctx,
      ),
    ).toBeNull();
    expect(siblingInHeadline(hpt, "Hasty Pudding Clubs To Merge Into Single Entity", others)?.kind).toBe("ambiguous");
  });

  it("a quote that is only the name, asked as a question, isn't press", () => {
    expect(
      pressMentionProblem(
        hpt,
        {
          title: "Not Victims: Another Case Against the Clubs",
          quote: "The Hasty Pudding Theatricals?",
          publishedOn: "2010-05-03",
        },
        ctx,
      ),
    ).toMatch(/only the club's name/);
    // A comp rundown's section heading stands.
    expect(
      pressMentionProblem(
        { name: "Harvard College Consulting Group", acronym: "HCCG", aliases: [] },
        { title: "Club Comp Rundown", quote: "Harvard College Consulting Group (HCCG)", publishedOn: "2023-09-14" },
        {},
      ),
    ).toBeNull();
  });
});

function empty(): LlmExtraction {
  return {
    short_description: null,
    mission: null,
    join_modes: [],
    eligible_classes: null,
    prior_experience: null,
    hours_per_week: null,
    member_count: null,
    dues: null,
    recruiting: [],
    recruiting_seasons: null,
    selectivity: [],
    activities: [],
    sponsors: [],
  };
}
