import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { extractDeterministic } from "../src/extract/deterministic";
import { eventBlurbProblem, namedLeader, namesPeopleProblem } from "../src/extract/evidence-rules";
import { checkSummary } from "../src/stages/summarize";
import { htmlToDocument } from "../src/parse/document";
import { cleanText } from "../src/parse/html";

/**
 * People named in club text (live student testing, 2026-10-12): a dance company's profile showed
 * an About text crediting alumni with class years and a "mission" that was a show blurb ending
 * "Directed by <name> '25 and <name> '25". The extractor's personal-text filter never matched
 * " '25" (a `\b` before the apostrophe needs a word character), the audit's names_people rule
 * only knew leader keywords, and `<br>` lines ran together ("2024the"). Fixture names are fictional.
 */

const dir = fileURLToPath(new URL("./fixtures/people-in-text/", import.meta.url));
const FETCHED = new Date("2026-10-12T16:00:00Z");
const CLUB = ["Example Modern Dance Company"];

const extract = (file: string, path: string, role: "about" | "other") =>
  extractDeterministic({
    doc: htmlToDocument(readFileSync(dir + file, "utf8"), `https://modern-dance.test${path}`),
    role,
    fetchedAt: FETCHED,
    clubNames: CLUB,
    clubAcronyms: ["EMDC"],
  });
const text = (claims: ReturnType<typeof extract>, field: string) =>
  claims.filter((c) => c.fieldKey === field).map((c) => String(c.value));

describe("block text (1.16.24)", () => {
  it("separates lines broken by <br> and zero-width spaces", () => {
    const doc = htmlToDocument(readFileSync(dir + "shows.html", "utf8"), "https://modern-dance.test/shows");
    expect(doc.text).toMatch(/Spring 2024 the late hour Life tells us/);
    expect(doc.text).not.toMatch(/2024\u200b?the|hourLife|20th\.\u200b?Directed/);
    expect(cleanText("Spring 2024\u200bthe")).toBe("Spring 2024 the");
  });
});

describe("descriptions and missions never name people or blurb a show (1.16.24)", () => {
  it("takes no mission from a show blurb with director credits", () => {
    const claims = extract("shows.html", "/our-shows.html", "other");
    expect(text(claims, "club.mission")).toEqual([]);
    expect(text(claims, "club.long_description")).toEqual([]);
  });

  it("skips an About paragraph naming choreographers and alumni with class years for the next one", () => {
    const claims = extract("about.html", "/about-us.html", "about");
    expect(text(claims, "club.long_description")).toEqual([
      expect.stringMatching(/^We are a contemporary dance group/),
    ]);
  });
});

describe("namesPeopleProblem", () => {
  it.each([
    ["Directed by Jane Roe '25 and Mara Quill '25.", "Jane Roe"],
    ["Directed by Jane Roe ’25.", "Jane Roe"],
    ["we have invited alumni Nora Vance (2010) to create works", "Nora Vance"],
    ["Jane Doe, Class of 2025, started the group.", "Jane Doe"],
    ["Our captain is Lyndsey Marsh '23, Captain", "Lyndsey Marsh"],
    ["Choreographed by Tomas Elling, the piece closes the show.", "Tomas Elling"],
    ["Past choreographers and teachers include Ada Brightwater, Tomas Elling.", "Ada Brightwater"],
    ["Music directed by Piet McHarlow.", "Piet McHarlow"],
    ["Harvard's real estate group, led by Jaeden Kinlock and Landon Elks.", "Jaeden Kinlock"],
  ])("flags %j", (t, name) => {
    expect(namesPeopleProblem(t)?.why).toContain(name);
  });

  it.each([
    // Club names that contain a person's name.
    ["The John Adams Society is a conservative debate society.", ["John Adams Society"]],
    ["The Gilbert and Sullivan Players (1956) perform two operettas a year.", ["Gilbert and Sullivan Players"]],
    ["The Phillips Brooks House Association (1904) is home to dozens of programs.", ["Phillips Brooks House Association"]],
    ["The Phillips Brooks House Association, a student-run nonprofit.", []],
    ["Dorothy Smith Society ('25 cohort) meets weekly.", ["Dorothy Smith Society"]],
    // Terms, shows and places with a year are not people.
    ["Our Fall Show '25 sold out.", []],
    ["Founded in 1976, the company performs twice a year.", []],
    ["Harvard College (1636) students run the program.", []],
    // A headline about a class, not a person.
    ["Visitas Welcomes Class of 2030 Admitted Students to Harvard Campus", []],
    // Notable alumni are public figures; roles without names; an '-run' compound.
    ["Notable alumni include Yo-Yo Ma, Alan Gilbert, and John Harbison.", []],
    ["Weekly meetings led by the student chair.", []],
    ["Publishing Zeitgeist, an undergraduate-run magazine of popular philosophy", []],
    ["Choreographed by both students and a professional choreographer.", []],
    ["A choir led by Harvard's Director of Choral Activities.", []],
  ])("leaves %j alone", (t, own) => {
    expect(namesPeopleProblem(t, own)).toBeNull();
  });

  it("keeps namedLeader's founding-story rule but not '-run' compounds", () => {
    expect(namedLeader("Jane Doe, a junior in Lowell House, started the group.")).toBe("Jane Doe");
    expect(namedLeader("Publishing Zeitgeist, an undergraduate-run magazine")).toBeNull();
  });
});

describe("eventBlurbProblem", () => {
  it("flags text that opens with a term and year or states one show's aim", () => {
    expect(eventBlurbProblem("Spring 2024 the late hour Life tells us to rush")?.check).toBe("event_blurb");
    expect(eventBlurbProblem("Fall '23: our winter showcase")?.check).toBe("event_blurb");
    expect(
      eventBlurbProblem("Life tells us to rush. At the core of our spring 2024 show, we aim to visualize time.")?.check,
    ).toBe("event_blurb");
  });
  it("leaves missions and descriptions that mention shows alone", () => {
    expect(eventBlurbProblem("Our mission is to perform concerts across Boston every spring.")).toBeNull();
    expect(eventBlurbProblem("We aim to make dance accessible; each spring 2024 cohort performs.")).toBeNull();
    expect(eventBlurbProblem("In fall 2024 we became a recognized group. We aim to teach swing.")).toBeNull();
  });
});

describe("summaries", () => {
  it("are refused when they name a person", () => {
    const source = "Directed by Jane Roe '25, the company performs contemporary dance.";
    expect(
      checkSummary({ summary: "Contemporary dance company directed by Jane Roe '25.", basis_quote: source }, source),
    ).toEqual({ ok: false, why: expect.stringContaining("Jane Roe") });
  });
});

describe("staff titles", () => {
  it("leave a public music director alone", () => {
    expect(namesPeopleProblem("With Music Director Federico Cortese, an entirely student-run board.")).toBeNull();
  });
});
