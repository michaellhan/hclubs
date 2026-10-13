import { describe, expect, it } from "vitest";
import {
  aboutTextProblem,
  archivalSubjectProblem,
  historyClaimProblem,
  historyPageProblem,
  namesPeopleProblem,
  noticeProblem,
  pastNarrativeProblem,
  personalBioProblem,
} from "../src/extract/evidence-rules";
import { groundExtraction, type LlmPage } from "../src/extract/llm/extractor";
import type { LlmExtraction } from "../src/extract/llm/schema";

/**
 * Three About texts that slipped past the 1.16.48/g25 rules (rejected by hand, 2026-10-13):
 * an officer's first-person bio and a "classes have begun" notice on the Ballroom Dance Club's
 * site, and the Wireless Club's history page citing the Harvard University Archives.
 */

const BALLROOM = ["Harvard Ballroom Dance Team", "HBDT"];
const WIRELESS = ["Harvard College Wireless Club"];

const OFFICER_BIO =
  "Professionally, I've led UX design at companies like Amazon, and I'm excited to apply a design-thinking lens to HBDT's revenue growth and sustainability. Outside of ballroom, you'll find me at the Harvard Innovation Labs, hitting the gym, or munching on local treats (I'm easily bribed with sweets).";
const CLASSES_BEGUN =
  "Classes for the semester have also begun! Want to join? Check our classes page for more information about the schedule, and if you have questions, make sure to send us an e-mail!";
const ARCHIVES =
  'The Club averaged about 25 members and acquired a quenched spark gap transmitter which gave "very satisfactory results." (All quotations, unless otherwise identified, are taken from the Harvard University Archives.) 1AF was recognized as a control station in the Boston area.';

describe("first-person career or life text is a bio (1.16.49, g26)", () => {
  it("rejects the Ballroom officer's bio and similar first-person lines", () => {
    expect(personalBioProblem(OFFICER_BIO, BALLROOM)?.check).toBe("names_people");
    expect(namesPeopleProblem(OFFICER_BIO, BALLROOM)?.check).toBe("names_people");
    for (const t of [
      "I've worked in consulting for five years before coming to Harvard.",
      "I have been dancing since I was four.",
      "Outside of class you'll find me on the river or at Lamont.",
      "In my free time I bake bread.",
      "Before Harvard, my career was in finance.",
    ])
      expect(personalBioProblem(t, BALLROOM)?.check, t).toBe("names_people");
  });
  it("keeps the club's own 'we' text", () => {
    for (const t of [
      "We've led Harvard dance since 1960, teaching ballroom and Latin to hundreds of students.",
      "We have worked with local schools for over a decade.",
      "HBDT is Harvard's competitive ballroom team; you'll find us at competitions across the Northeast.",
      "Our members have competed at nationals, and we welcome dancers of every level.",
      "The club offers lessons in our free time slots on weekends.",
    ])
      expect(personalBioProblem(t, BALLROOM), t).toBeNull();
  });
});

describe("notices that something has begun or point to another page (1.16.49, g26)", () => {
  it("rejects the Ballroom classes notice", () => {
    expect(noticeProblem(CLASSES_BEGUN)?.check).toBe("notice");
    expect(aboutTextProblem(CLASSES_BEGUN)?.check).toBe("notice");
    expect(noticeProblem("Practices have officially started! See you on the courts.")?.check).toBe("notice");
    expect(noticeProblem("Interested in joining? Visit our join page to sign up.")?.check).toBe("notice");
  });
  it("keeps descriptions that mention starting or joining later on", () => {
    for (const t of [
      "The Harvard Ballroom Dance Team is a competitive team. Since practices have begun, new dancers are welcome.",
      "We are a ballroom dance team open to all students. Want to join? Check our classes page!",
      "The club has started a mentoring program for first-years.",
      "Since it began in 1960, the club has taught ballroom to hundreds of students.",
    ])
      expect(noticeProblem(t), t).toBeNull();
  });
});

describe("text citing the University Archives is archival history (1.16.49, g26)", () => {
  it("flags the Wireless Club history paragraph", () => {
    expect(pastNarrativeProblem(ARCHIVES)?.check).toBe("past_narrative");
    expect(archivalSubjectProblem(ARCHIVES, WIRELESS)?.check).toBe("archive_project");
    const page = historyPageProblem("https://w1af.harvard.edu/php/history.php");
    expect(historyClaimProblem("club.long_description", ARCHIVES, page)?.check).toBe("history_page");
    expect(archivalSubjectProblem("Source: Harvard University Archives. The club met in Cruft.")?.check).toBe(
      "archive_project",
    );
  });
  it("keeps current About text that mentions the club's history or the Archives once", () => {
    for (const t of [
      "Founded in 1909, the Harvard College Wireless Club is Harvard's amateur radio club. We operate station W1AF from the roof of the Science Center.",
      "The Wireless Club is one of the oldest amateur radio clubs in the country; it began in 1909 and today runs licensing classes.",
      "Harvard Undergraduate Archives Club is a group of students who digitize and transcribe records for the University Archives.",
    ]) {
      expect(pastNarrativeProblem(t), t).toBeNull();
      expect(archivalSubjectProblem(t, WIRELESS), t).toBeNull();
    }
  });
});

describe("LLM grounding applies the new rules (g26)", () => {
  const empty = (): LlmExtraction => ({
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
  });
  it("rejects all three texts as descriptions", () => {
    for (const [text, url, names] of [
      [OFFICER_BIO, "https://harvardballroom.org/about", BALLROOM],
      [CLASSES_BEGUN, "https://harvardballroom.org/", BALLROOM],
      [ARCHIVES, "https://w1af.harvard.edu/php/about.php", WIRELESS],
    ] as const) {
      const page: LlmPage = { url, role: "about", snapshotId: "s", text };
      const r = groundExtraction({ ...empty(), short_description: { value: text, quote: text } }, [page], new Date(), [
        ...names,
      ]);
      expect(r.claims, text.slice(0, 40)).toEqual([]);
    }
  });
});
