import { describe, expect, it } from "vitest";
import { classEligibility } from "../src/eligibility";

/** Real sentences from club pages (ADR 0041), plus the classic false positives. */
const fy = (s: string, ctx: "membership" | "any" = "any") => classEligibility(s, ctx)?.firstYears ?? null;

describe("classEligibility: first-years named", () => {
  it.each([
    "First-years welcome!",
    "Freshmen are especially encouraged to apply.",
    "First-years can join at any point in the semester.",
    "First-years must apply through the common application.",
    "Any and all positions are open to everyone, including freshmen and new members.",
    "You can be an incoming first-year student or an upperclass student.",
    "Whether you are a first-year exploring your interests or a senior with research experience, HUCA welcomes all Harvard undergraduates.",
    "This initiative is open to all incoming Harvard first-years.",
  ])("yes: %s", (s) => expect(fy(s)).toBe(true));

  it("reads an explicit list including first-years", () => {
    expect(classEligibility("Open to first-years, sophomores, and juniors.")).toEqual({
      firstYears: true,
      kind: "explicit",
      classes: ["first_year", "sophomore", "junior"],
    });
  });

  it("expands ranges: first-years through juniors", () => {
    expect(
      classEligibility("This application is open to currently enrolled Harvard undergraduates, first-years through juniors.")
        ?.classes,
    ).toEqual(["first_year", "sophomore", "junior"]);
  });

  it.each([
    "Not open to first-years.",
    "First-years are not eligible to comp the business board.",
    "Membership is open to all undergraduates except first-years.",
    "First-years cannot apply.",
  ])("no: %s", (s) => expect(fy(s)).toBe(false));

  it("a qualified 'not until spring' is not a no", () => {
    expect(fy("First-years may not comp until the spring semester.")).toBe(null);
  });
});

describe("classEligibility: lists without first-years", () => {
  it.each([
    "Membership is open to sophomores, juniors, and seniors.",
    "Open to sophomores and up.",
    "Upperclass students only.",
    "The club currently operates a traditional punch process for sophomore and junior men at the college.",
    "If you haven't taken any time off, you can first apply in the spring of your sophomore year.",
  ])("restriction → no: %s", (s) => expect(fy(s)).toBe(false));

  it.each([
    "The A.D. Club's members are male students who typically join during their sophomore year.",
    "Our seniors lead workshops for new members.",
  ])("description → unknown: %s", (s) => expect(fy(s)).toBe(null));
});

describe("classEligibility: populations", () => {
  it.each([
    "Membership is open to all Harvard undergraduates who are interested in microbiology.",
    "Joining is really easy—we have no comp process or application—and is open to all Harvard College students.",
    "Any Harvard College student with an interest in debate is welcome to join the team",
    "Our fall tryout process is open to any student at Harvard College.",
    "We encourage everyone to apply, regardless of class year, concentration, or (lack of) experience.",
    "All class years, schools, and concentrations are welcome!",
  ])("all undergraduates → yes: %s", (s) => expect(classEligibility(s)).toMatchObject({ firstYears: true, kind: "population" }));

  it("a bare 'everyone is welcome' counts only for a membership statement", () => {
    expect(fy("Everyone is welcome!")).toBe(null);
    expect(fy("Everyone is welcome!", "membership")).toBe(true);
  });

  it("graduate-only and outside populations don't include first-years", () => {
    expect(fy("Its membership is open to all HLS students, regardless of class year.")).toBe(null);
    expect(fy("Open to all high school students and rising college freshmen.")).toBe(null);
  });
});

describe("classEligibility: mentions that aren't about joining", () => {
  it.each([
    "Freshman Welcome Event 2026",
    "In 1976, RCS sang at Freshman Welcome in Harvard Yard for the first time.",
    "We hold yearly concerts (Fall Jam, Harvard-Yale Jam, Freshman Jam).",
    "IGP is THRILLED to welcome two new Freshman, Hope and Frank, to the group!",
    "In freshman year, I joined the AI Project Incubator.",
    "Jazmin Garza FRESHMAN REPRESENTATIVE",
  ])("ignored: %s", (s) => expect(fy(s)).toBe(null));
});

describe("classEligibility: populations with graduate students", () => {
  it.each([
    "All graduate and undergraduate students enrolled in a degree-granting program at Harvard University are eligible and welcome for full membership.",
    "Current undergraduate and graduate students can apply to MakeHarvard!",
    "HUMC is open to undergraduates.",
  ])("includes undergraduates → yes: %s", (s) => expect(classEligibility(s)?.firstYears).toBe(true));

  it("composition statements aren't eligibility", () => {
    expect(classEligibility("Our team includes both undergraduates and graduates.")).toBe(null);
  });
});

describe("classEligibility: membership composition", () => {
  it("members from all four years include first-years", () => {
    expect(classEligibility("The Hasty Pudding Club is co-ed and has members from all four years.")?.firstYears).toBe(true);
  });
  it("anyone enrolled in undergrad includes first-years; high school alone doesn't", () => {
    expect(classEligibility("We welcome anyone currently enrolled in high school or undergrad.")?.firstYears).toBe(true);
    expect(classEligibility("We welcome anyone currently enrolled in high school.")).toBe(null);
  });
});

describe("classEligibility: excluded years", () => {
  it("'No academic Seniors.' alone says nothing about first-years", () => {
    expect(classEligibility("No academic Seniors. Direct general inquiries to the comp directors.")).toBe(null);
  });
  it("'freshmen, sophomores, and juniors only' → yes", () => {
    expect(classEligibility("Harvard enrolled academic freshmen, sophomores, and juniors only.")?.firstYears).toBe(true);
  });
  it("'no academic seniors' leaves first-years in", () => {
    expect(
      classEligibility("Comps are limited to the undergraduate students of Harvard University. No academic Seniors."),
    ).toEqual({ firstYears: true, kind: "explicit", classes: ["first_year", "sophomore", "junior"] });
  });
});

describe("classEligibility: loose ranges", () => {
  it("'first apply as a sophomore … as late as senior year' is sophomores through seniors", () => {
    expect(
      classEligibility(
        "If you haven't taken any time off, you can first apply in the spring of your sophomore year, and can apply as late as the fall of your senior year.",
      ),
    ).toEqual({ firstYears: false, kind: "list", classes: ["sophomore", "junior", "senior"] });
  });
});
