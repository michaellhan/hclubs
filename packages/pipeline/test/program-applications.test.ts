import { describe, expect, it } from "vitest";
import { extractDeterministic } from "../src/extract/deterministic";
import {
  headingAbove,
  joinModeProblem,
  outsiderLinkProblem,
  programApplicationProblem,
} from "../src/extract/evidence-rules";
import { htmlToDocument } from "../src/parse/document";

/**
 * Applications for a club's programs (a trek, a member grant, a scholarship, a funded
 * fellowship) are not how members join (ADR 0051 amendment, extractor 1.16.26, grounding g14).
 * Startups at Harvard showed "Application" and "Usually recruits on a rolling basis" from its
 * trek deadline and its grant review (student testing, 2026-10-12). The page below has the
 * same layout with a fictional club.
 */
const PAGE = `<html><body><main>
  <h1>Where student builders meet</h1>
  <p>Example Builders is a community of students who enjoy building products.</p>
  <h2>What we do</h2>
  <h3>Member Grants</h3>
  <p>We are piloting grants of up to $10k for early-stage startups founded by members. No equity required. Applications are reviewed on a rolling basis.</p>
  <h3>Builder Trek</h3>
  <p>A fully funded, five-day trip to New York City in early 2027. Visit startups and VC firms. Apply by October 10. Grace period through October 12.</p>
  <p><a href="https://forms.gle/exampleTrekForm">Apply now</a></p>
  <h2>Join Us</h2>
  <p>If you're a student interested in joining our events this semester, please fill out this <a href="https://forms.gle/exampleInterest">interest form</a>.</p>
</main></body></html>`;

const run = () =>
  extractDeterministic({
    doc: htmlToDocument(PAGE, "https://example-builders.test/"),
    role: "home",
    fetchedAt: new Date("2026-10-08T16:00:00Z"),
    clubNames: ["Example Builders"],
    clubAcronyms: [],
  });

describe("programApplicationProblem", () => {
  it.each([
    "Applications for the Spring 2026 Trek have closed.",
    "Trek applications are due September 20.",
    "Apply for a member grant by November 1.",
    "Scholarship applications are now open.",
    "Fellowships of up to $5,000 are available; applications are due March 1.",
  ])("rejects a program's application said in the sentence: %s", (s) =>
    expect(programApplicationProblem(s)?.check).toBe("program_application"),
  );

  it.each([
    "Applications are due September 12.",
    "Fellowship applications open in January for Spring and will re-open in September for Fall cohorts.",
    "After completing one of the intro fellowships, Harvard students can apply for membership.",
    "Apply to join our team by October 1.",
  ])("keeps membership applications and intro fellowships: %s", (s) => expect(programApplicationProblem(s)).toBe(null));

  it("reads the section heading a sentence sits under", () => {
    const text =
      "# Club\nAbout us.\n### Member Grants\nWe fund startups. Applications are reviewed on a rolling basis.\n## Join Us\nFill out the form.";
    expect(headingAbove(text, "Applications are reviewed on a rolling basis.")).toBe("Member Grants");
    expect(headingAbove(text, "Fill out the form.")).toBe("Join Us");
    expect(headingAbove(text, "Not on the page.")).toBe(null);
    expect(programApplicationProblem("Applications are reviewed on a rolling basis.", text)?.why).toContain(
      "Member Grants",
    );
    // Joining words in the sentence or the heading keep it.
    expect(
      programApplicationProblem(
        "New members apply by October 1.",
        text.replace("We fund", "New members apply by October 1. We fund"),
      ),
    ).toBe(null);
    expect(programApplicationProblem("Fill out the form.", text)).toBe(null);
  });

  it("is part of the shared join-mode and link rules", () => {
    expect(joinModeProblem("application", "Applications for the Spring 2026 Trek have closed.")).not.toBe(null);
    expect(outsiderLinkProblem("Apply for Startup Trek 2027")).not.toBe(null);
    expect(outsiderLinkProblem(null, null, "Member Grants")).not.toBe(null);
    expect(outsiderLinkProblem("interest form")).toBe(null);
  });
});

describe("deterministic extractor on a page with a trek and member grants (1.16.26)", () => {
  const got = run();
  const values = (field: string) => got.filter((c) => c.fieldKey === field).map((c) => c.value);

  it("takes no join mode, recruiting season or recruiting date from the programs", () => {
    expect(values("club.join_mode")).toEqual([]);
    expect(values("club.recruiting_seasons")).toEqual([]);
    expect(values("cycle.deadline")).toEqual([]);
    expect(values("cycle.process_type")).toEqual([]);
  });

  it("keeps the interest form and drops the trek's form", () => {
    const urls = got
      .filter((c) => c.fieldKey === "club.link")
      .map((c) => (c.value as { url: string; kind: string }).url);
    expect(urls).toContain("https://forms.gle/exampleInterest");
    expect(urls).not.toContain("https://forms.gle/exampleTrekForm");
  });
});
