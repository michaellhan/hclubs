import { describe, expect, it } from "vitest";
import {
  CONTRIBUTION_TYPE_DEFS,
  COMP_AGGREGATION,
  CompReportInput,
  aggregateCompReports,
  contributionTemplate,
  contributionTypeOf,
  duplicateTarget,
  parseDues,
  parseFieldValue,
  parseJoinModes,
  parseProposals,
  parseRange,
  readTemplateAnswers,
  redactContactDetails,
  type CompReport,
} from "../src";

const AT = new Date("2026-09-30T16:00:00Z");
const LIVE_FORM_OPTIONS = [
  "Recruiting deadline or dates",
  "How to join / comp process",
  "Time commitment",
  "Size (number of members)",
  "Dues",
  "Website or social link",
  "Club seems inactive",
  "I run this club",
  "Feedback about the site",
  "Other",
];

describe("contribution templates", () => {
  it("every type preselects an option the live form has", () => {
    for (const d of CONTRIBUTION_TYPE_DEFS) expect(LIVE_FORM_OPTIONS).toContain(d.formOption);
  });

  it("a filled template round-trips into proposals; blank lines propose nothing", () => {
    const filled = contributionTemplate("time_commitment")
      .replace("member: ", "member: about 3-4")
      .concat("\nAlso they meet Thursdays.");
    const { answers, freeText } = readTemplateAnswers(filled);
    expect([...answers.keys()]).toEqual(["hours per week as a member"]);
    expect(freeText).toBe("Also they meet Thursdays.");
    expect(parseProposals(filled, { submittedAt: AT })).toEqual([
      expect.objectContaining({
        fieldKey: "club.hours_per_week",
        value: { min: 3, max: 4, qualifier: "member" },
        note: "approximate",
      }),
    ]);
  });

  it("reads labels without their hints and joins continuation lines", () => {
    const p = parseProposals("instagram: @harvardchess\nWhat the club does: Weekly chess\nand blitz tournaments.", {
      submittedAt: AT,
    });
    expect(p.map((x) => [x.fieldKey, x.value])).toEqual([
      ["club.link", { kind: "instagram", url: "https://www.instagram.com/harvardchess/", handle: "harvardchess" }],
      ["club.short_description", "Weekly chess and blitz tournaments."],
    ]);
  });

  it("every parsed value passes its field's schema", () => {
    const text = [
      "Website: harvardchess.org",
      "Instagram (link or @handle): https://instagram.com/harvardchess",
      "Application link: https://forms.gle/abc123",
      "Deadline (date, and time if known): Friday, October 9 at 11:59 pm",
      "Term (e.g. Fall 2026): Fall 2026",
      "How to join: application and then an interview",
      "Number of members: 30-40",
      "Dues (amount and how often, or none): $50 a semester",
      "Hours per week during the comp or application: 5",
      "Who can join: all undergraduates, first-years welcome",
      "Why it seems inactive: no events since 2024",
      "New name: Harvard Chess Society",
      "Old name: Harvard Chess Club",
      "Same club as: https://hclubs.app/clubs/harvard-chess-club/",
    ].join("\n");
    const ps = parseProposals(text, { submittedAt: AT });
    for (const p of ps) {
      expect(p.value, `${p.label}: ${p.note}`).not.toBeNull();
      if (p.fieldKey !== "duplicate_of") expect(parseFieldValue(p.fieldKey, p.value).ok, p.label).toBe(true);
    }
    const by = (k: string) => ps.filter((p) => p.fieldKey === k).map((p) => p.value);
    expect(by("cycle.deadline")[0]).toMatchObject({
      at: expect.stringMatching(/^2026-10-09T23:59/),
      precision: "datetime",
    });
    expect(ps.find((p) => p.fieldKey === "cycle.deadline")?.termKey).toBe("2026-fall");
    expect(by("club.link")).toContainEqual(expect.objectContaining({ kind: "application_form" }));
    expect(by("club.join_mode")).toEqual(["application"]);
    expect(by("club.member_count")).toEqual([{ kind: "range", min: 30, max: 40 }]);
    expect(by("club.activity_status")).toEqual(["possibly_dormant"]);
    expect(by("club.freshmen_eligible")).toEqual([true]);
    expect(by("duplicate_of")).toEqual(["harvard-chess-club"]);
  });

  it("leaves a value null, with a reason, rather than guess", () => {
    const ps = parseProposals("Dues: depends\nNumber of members: lots\nWebsite: our linktree, ask me", {
      submittedAt: AT,
    });
    expect(ps.map((p) => [p.fieldKey, p.value, Boolean(p.note)])).toEqual([
      ["club.dues", null, true],
      ["club.member_count", null, true],
      ["club.link", null, true],
    ]);
    // A deadline with no term takes the term its date falls in, flagged for the reviewer.
    const [d] = parseProposals("Deadline: 2/1/2027", { submittedAt: AT });
    expect(d).toMatchObject({ termKey: "2027-spring", note: expect.stringContaining("confirm") });
  });

  it("small value parsers", () => {
    expect(parseRange("under 2 hours")).toEqual({ min: null, max: 2, approx: false });
    expect(parseRange("10+")).toEqual({ min: 10, max: null, approx: false });
    expect(parseDues("none")).toEqual({ hasDues: false });
    expect(parseDues("$0")).toEqual({ hasDues: false });
    expect(parseDues("$25 per year")).toEqual({ hasDues: true, amountUsd: 25, note: "per year" });
    expect(parseJoinModes("open to anyone, no audition")).toEqual(["open"]);
    expect(parseJoinModes("auditions, then callbacks")).toEqual(["audition"]);
    expect(duplicateTarget("Harvard Chess Club")).toBe("Harvard Chess Club");
  });

  it("works out the type from the answered lines, else the form option", () => {
    expect(contributionTypeOf("Other", "Dues: $20")).toBe("dues");
    expect(contributionTypeOf("Other", "What the club does: chess\nInstagram: @x")).toBe("missing_info");
    expect(contributionTypeOf("Time commitment", "they meet a lot")).toBe("time_commitment");
    expect(contributionTypeOf("Other", "free text only")).toBe("other");
  });
});

describe("privacy", () => {
  it("removes emails and phone numbers but keeps links and dates", () => {
    const r = redactContactDetails(
      "Email jane.doe@college.harvard.edu or call (617) 555-0134. Site: https://x.org/2026-10-01 deadline 10/9.",
    );
    expect(r.removed).toBe(2);
    expect(r.text).not.toContain("jane");
    expect(r.text).not.toContain("555");
    expect(r.text).toContain("https://x.org/2026-10-01");
    expect(r.text).toContain("10/9");
  });
});

describe("comp-report aggregation (display stays off)", () => {
  const base = { clubId: "0190f1d4-0000-7000-8000-000000000001", termKey: "2026-fall" };
  const reports = (n: number, admitted: number, extra: Partial<CompReport> = {}): CompReport[] =>
    Array.from({ length: n }, (_, i) =>
      CompReportInput.parse({
        ...base,
        applied: true,
        accepted: i < admitted,
        furthestStage: i < admitted ? "final_round" : "interview",
        approxApplicants: 100 + i,
        hoursSpent: 10,
        ...extra,
      }),
    );

  it("is off by default and shows nothing below the minimum, not even the count", () => {
    expect(COMP_AGGREGATION.displayEnabled).toBe(false);
    expect(aggregateCompReports(reports(4, 2))).toEqual({
      source: "community",
      shown: false,
      reason: "fewer than 5 reports",
    });
  });

  it("needs more reports, and enough on each side, before showing an admitted share", () => {
    const small = aggregateCompReports(reports(8, 4));
    expect(small).toMatchObject({ shown: true, reports: 8, admittedShare: null });
    // 10 reports but only 2 admitted: the admitted group is too small to show.
    expect(aggregateCompReports(reports(10, 2))).toMatchObject({ admittedShare: null });
    expect(aggregateCompReports(reports(12, 3))).toMatchObject({ admittedShare: { low: 20, high: 30, of: 12 } });
    // Everyone admitted would reveal every reporter's outcome.
    expect(aggregateCompReports(reports(12, 12))).toMatchObject({ admittedShare: null });
  });

  it("hides small stage groups, rounds estimates and never breaks down by class year", () => {
    const r = aggregateCompReports([...reports(6, 0), ...reports(2, 0, { furthestStage: "case_interview" })]);
    expect(r).toMatchObject({
      shown: true,
      furthestStages: [{ stage: "interview", reports: 6 }],
      otherStages: 0,
      medianApplicantsEstimate: 100,
      medianHoursSpent: 10,
    });
    expect(JSON.stringify(r)).not.toMatch(/classYear|notes/);
  });

  it("rejects reports that can't be true and mixing cycles", () => {
    expect(() => CompReportInput.parse({ ...base, applied: false, accepted: true })).toThrow();
    expect(() =>
      aggregateCompReports([...reports(5, 0), ...reports(1, 0).map((x) => ({ ...x, termKey: "2027-spring" }))]),
    ).toThrow(/one club cycle/);
  });
});
