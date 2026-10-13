import { describe, expect, it } from "vitest";
import { extractDeterministic } from "../src/extract/deterministic";
import { outsiderEventPageProblem } from "../src/extract/evidence-rules";
import { htmlToDocument } from "../src/parse/document";

/**
 * Student testing round 4 (2026-10-13, pre-med persona). Pages are fictional clubs with the
 * layout of the page that went wrong.
 */

/** VISION's Global Health and Leadership Conference page: the "Apply Now" form is for high-schoolers. */
const HIGH_SCHOOL_CONFERENCE_PAGE = `<html><head><title>Example Global Health Society</title></head><body><main>
  <h1>Example College</h1>
  <h1>Global Health and Leadership Conference</h1>
  <h3>The conference brings together faculty, students, and guests to educate and mentor high school students.</h3>
  <h1>Want to learn more? <a href="https://forms.gle/exampleHighSchoolForm">Apply Now</a></h1>
  <p>Students are paired with a college mentor for their community project.</p>
</main></body></html>`;

/** The club's own page for its members: the same button joins the club. */
const CLUB_JOIN_PAGE = `<html><head><title>Example Global Health Society</title></head><body><main>
  <h1>Join Example Global Health Society</h1>
  <p>We mentor high school students and run an annual conference. Interested in joining? <a href="https://forms.gle/exampleMemberForm">Apply Now</a></p>
</main></body></html>`;

const run = (html: string, url: string) =>
  extractDeterministic({
    doc: htmlToDocument(html, url),
    role: "join",
    fetchedAt: new Date("2026-10-13T00:00:00Z"),
    clubNames: ["Example Global Health Society"],
    clubAcronyms: [],
  });

const forms = (html: string, url: string) =>
  run(html, url).filter((c) => c.fieldKey === "club.link" && (c.value as { kind: string }).kind === "application_form");

describe("extractor 1.16.39–40: an outsider event's application is not the club's", () => {
  it("drops the Apply Now form on a high-school conference page", () => {
    expect(forms(HIGH_SCHOOL_CONFERENCE_PAGE, "https://example-ghs.test/GHLCApply.html")).toHaveLength(0);
  });

  it("reads who the event is for from the meta description when the body doesn't say", () => {
    const schedule = `<html><head><title>Example Global Health Society</title>
      <meta name="description" content="The conference brings together guests to mentor high school students."></head><body><main>
      <h1>Schedule</h1><h1>Global Health and Leadership Conference</h1>
      <h1>Want to learn more? <a href="https://forms.gle/exampleHighSchoolForm">Apply Now</a></h1>
      <p>Enjoy a weekend packed with lectures and workshops.</p>
    </main></body></html>`;
    expect(forms(schedule, "https://example-ghs.test/GHLCSchedule.html")).toHaveLength(0);
  });

  it("keeps the form on the club's own joining page", () => {
    expect(forms(CLUB_JOIN_PAGE, "https://example-ghs.test/join")).toHaveLength(1);
  });

  it("needs both an event in the title and outside participants on the page", () => {
    expect(
      outsiderEventPageProblem(["Summer Cancer Symposium"], "A program open to high school students.")?.check,
    ).toBe("outsider_application");
    expect(outsiderEventPageProblem(["Summer Cancer Symposium"], "Our members present their research.")).toBe(null);
    expect(outsiderEventPageProblem(["About us"], "We mentor high school students.")).toBe(null);
    // A page that recruits the club's own members is never an outsider page.
    expect(
      outsiderEventPageProblem(
        ["Annual Conference"],
        "We mentor high school students. Interested in joining? Join our team!",
      ),
    ).toBe(null);
  });
});
