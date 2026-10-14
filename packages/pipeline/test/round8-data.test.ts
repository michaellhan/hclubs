import { describe, expect, it } from "vitest";
import { aboutBeforeHistory } from "../src/extract/evidence-rules";

/**
 * Persona round 8: the Advocate's About page is one 1,800-character paragraph that says what the
 * magazine is and then tells its history (its motto, Roosevelt's editorship, pre-war editors).
 */
const ADVOCATE_LEAD =
  "The Harvard Advocate, founded in 1866, is the oldest continuously published collegiate literary magazine in the country. Over its long history, it can count T.S. Eliot, Conrad Aiken, and Norman Mailer among its members and e.e. cummings, Jack Kerouac, and Tom Wolfe as contributors to its pages. A quarterly magazine, The Advocate's mission is to publish the best art, fiction, poetry, and prose that the Harvard undergraduate community offers.";
const ADVOCATE_HISTORY =
  "When the Advocate was founded, it adopted the motto Dulce est Periculum (Danger is Sweet) which had been used by an earlier Harvard newspaper, the Collegian. The magazine originally avoided controversial topics, lest it be shut down by university authorities; by the time the editors were making the then-radical demand for coeducation at Harvard, the magazine had attracted the support of James Russell Lowell and Oliver Wendell Holmes, and its life was less precarious.";

describe("About text that runs on into the club's history (1.16.50)", () => {
  it("keeps the describing lead before the first sentence about the past", () => {
    expect(aboutBeforeHistory(`${ADVOCATE_LEAD} ${ADVOCATE_HISTORY}`)).toBe(ADVOCATE_LEAD);
  });
  it("also where page text glued two paragraphs together", () => {
    expect(aboutBeforeHistory(`${ADVOCATE_LEAD}${ADVOCATE_HISTORY}`)).toBe(ADVOCATE_LEAD);
  });
  it("never splits at initials ('T.S. Eliot') or a title", () => {
    const lead = aboutBeforeHistory(`${ADVOCATE_LEAD} ${ADVOCATE_HISTORY}`) ?? "";
    expect(lead).toContain("T.S. Eliot, Conrad Aiken");
    const portrait = "Its office on South St. keeps Mrs. Lowell's portrait above the door.";
    expect(aboutBeforeHistory(`${ADVOCATE_LEAD} ${portrait} ${ADVOCATE_HISTORY}`)).toBe(`${ADVOCATE_LEAD} ${portrait}`);
  });
  it("leaves short About text and text that never turns to the past alone", () => {
    expect(aboutBeforeHistory(`${ADVOCATE_LEAD} When it was founded, it was small.`)).toBeNull();
    const present = Array.from(
      { length: 6 },
      () => "We rehearse twice a week and perform at concerts across campus and in Boston each semester.",
    ).join(" ");
    expect(aboutBeforeHistory(present)).toBeNull();
  });
  it("gives nothing when the past starts before a usable lead", () => {
    expect(aboutBeforeHistory(`It was founded in 1901. ${ADVOCATE_HISTORY} ${ADVOCATE_HISTORY}`)).toBeNull();
  });
});
