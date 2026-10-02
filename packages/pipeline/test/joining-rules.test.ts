import { describe, expect, it } from "vitest";
import {
  eligibleClassesProblem,
  freshmenEligibleProblem,
  joinModeProblem,
} from "../src/extract/evidence-rules";

/**
 * The shared join-mode and eligibility rules (ADR 0041), used by the deterministic
 * extractor, LLM grounding and the audit. Every case is a quote from a real club page.
 */
describe("joinModeProblem", () => {
  it.each([
    ["audition", "We pride ourselves on having an inclusive and accessible comp process — we do not cut compers or require auditions/samples."],
    ["invite_only", "7:00 PM: Invitation Only"],
    ["attendance_based", "This allows any male student to attend A.D. Club's Punch events and possibly gain membership into the club."],
    ["attendance_based", "Students become Product Lab members upon successful completion of fellowship"],
    ["application", "LSP is a Marine Corps education program that helps high-caliber enlisted Marines with the application process."],
    ["application", "Before I even started the application process for medical school, I was convinced that taking the MCAT would be the worst part."],
    ["application", "Please take a moment to read the Finance Guidelines about the grant application process."],
    ["application", "Apply to Join HUMA Board 2025-26!"],
    ["audition", "Film clips of my performances allowed me to audition for the best companies throughout Europe."],
    ["open", "We’ll have tons of sweet treats from @maprangbakerycafe like coconut pandan cake, Thai tea cake, and basque cheesecake… Open to all Harvard students!"],
  ])("rejects %s: %s", (mode, quote) => expect(joinModeProblem(mode, quote)).not.toBe(null));

  it.each([
    ["application", "Volunteers should apply through the PBHA Application and select CASP."],
    ["application", "Fill out the volunteer Common App!"],
    ["audition", "The Pitches choose new group members through an audition process, held in the fall and spring."],
    ["comp", "HAI’s comp process is completion-based, revolving around hour-long weekly lectures."],
    ["tryout", "Tryouts for competition teams are typically held at the start of the academic year."],
    ["open", "Joining is really easy—we have no comp process or application—and is open to all Harvard College students."],
  ])("keeps %s: %s", (mode, quote) => expect(joinModeProblem(mode, quote)).toBe(null));

  it("a PBHA volunteer application on a page about the youth served is still the club's", () => {
    const page =
      "CASP serves elementary and middle school students in Cambridge. High school students join our summer program. Volunteers should apply through the PBHA Application and select CASP.";
    expect(joinModeProblem("application", "Volunteers should apply through the PBHA Application and select CASP.", page)).toBe(
      null,
    );
  });
});

describe("eligibility grounding", () => {
  it("first-years need a statement that opens membership to them", () => {
    expect(freshmenEligibleProblem(true, "Freshman Welcome Event 2026")).not.toBe(null);
    expect(freshmenEligibleProblem(true, "IGP is THRILLED to welcome two new Freshman, Hope and Frank, to the group!")).not.toBe(
      null,
    );
    expect(freshmenEligibleProblem(true, "First-years are especially encouraged to apply!")).toBe(null);
    expect(freshmenEligibleProblem(false, "First-years are not eligible to comp.")).toBe(null);
  });

  it("class lists need the years named or a restriction", () => {
    const all = ["first_year", "sophomore", "junior", "senior"];
    expect(eligibleClassesProblem(all, "includes both undergraduates and graduates")).not.toBe(null);
    expect(eligibleClassesProblem(all, "Membership is open to all Harvard undergraduates.")).toBe(null);
    expect(eligibleClassesProblem(["sophomore", "junior"], "a punch process for sophomore and junior men")).toBe(null);
    expect(eligibleClassesProblem(["graduate"], "We provide science PhD students the chance to hone their skills")).toBe(null);
    expect(eligibleClassesProblem(["sophomore"], "Our members love the spring retreat.")).not.toBe(null);
  });
});
