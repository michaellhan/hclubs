import { describe, expect, it } from "vitest";
import { assessActivity, isVagueTimeReference, parseDateExpression, parseTermExpression, verifyLink } from "../src";

const REF = new Date("2026-09-30T16:00:00Z"); // Wednesday, Sep 30 2026 (campus time)

describe("parseDateExpression", () => {
  it("parses explicit dates with year as high confidence", () => {
    expect(parseDateExpression("Applications due October 3, 2026", null)).toMatchObject({
      at: "2026-10-03",
      precision: "date",
      confidence: "high",
    });
    expect(parseDateExpression("deadline: 2026-10-03", null)?.at).toBe("2026-10-03");
  });
  it("infers the year only with a reference date, at medium confidence", () => {
    expect(parseDateExpression("applications close September 18", null)).toBeNull();
    const r = parseDateExpression("applications close September 18", REF);
    expect(r).toMatchObject({
      at: "2026-09-18",
      confidence: "medium",
      originalText: "applications close September 18",
    });
    expect(r?.notes).toContain("year inferred from reference date");
    // January seen in late September → next January.
    expect(parseDateExpression("apply by Jan. 20th", REF)?.at).toBe("2027-01-20");
  });
  it("parses times in Eastern time with the correct DST offset", () => {
    expect(parseDateExpression("Due Oct 3, 2026 at 11:59 PM ET", null)).toMatchObject({
      at: "2026-10-03T23:59:00-04:00",
      precision: "datetime",
    });
    expect(parseDateExpression("Due Dec 1, 2026 by 5pm", null)?.at).toBe("2026-12-01T17:00:00-05:00");
    expect(parseDateExpression("due November 2, 2026 at midnight", null)?.at).toBe("2026-11-02T23:59:00-05:00");
  });
  it("resolves weekdays only against a reference, at low confidence", () => {
    expect(parseDateExpression("apply by 11:59 PM ET Friday", null)).toBeNull();
    expect(parseDateExpression("apply by 11:59 PM ET Friday", REF)).toMatchObject({
      at: "2026-10-02T23:59:00-04:00",
      confidence: "low",
    });
    expect(parseDateExpression("next Monday", REF)?.at).toBe("2026-10-12");
  });
  it("rejects impossible dates", () => {
    expect(parseDateExpression("February 30, 2026", null)).toBeNull();
  });
  it("numeric dates assume US order", () => {
    expect(parseDateExpression("due 10/3/26", null)).toMatchObject({ at: "2026-10-03", confidence: "high" });
  });
});

describe("parseTermExpression", () => {
  it("parses absolute terms", () => {
    expect(parseTermExpression("Fall 2026 recruitment", null)).toMatchObject({ termKey: "2026-fall", relative: false });
    expect(parseTermExpression("Spring '27 comp", null)?.termKey).toBe("2027-spring");
    expect(parseTermExpression("Autumn semester 2025", null)?.termKey).toBe("2025-fall");
  });
  it("resolves relative terms only with a reference", () => {
    expect(parseTermExpression("this fall", null)).toBeNull();
    expect(parseTermExpression("this fall", REF)).toMatchObject({
      termKey: "2026-fall",
      relative: true,
      confidence: "medium",
    });
    expect(parseTermExpression("next spring", REF)?.termKey).toBe("2027-spring");
    expect(parseTermExpression("next semester", REF)?.termKey).toBe("2027-spring");
    expect(parseTermExpression("this spring", new Date("2026-02-01T12:00:00Z"))?.termKey).toBe("2026-spring");
  });
  it("flags vague phrases that must not be converted", () => {
    expect(isVagueTimeReference("comp starts next week")).toBe(true);
    expect(isVagueTimeReference("Applications close October 3")).toBe(false);
  });
});

describe("assessActivity", () => {
  const none = {
    stated: null,
    officialListingObservedAt: null,
    latestRecruitingDate: null,
    latestYearOnWebsite: null,
    websiteFetchedAt: null,
  };
  it("unknown with no signals — never inactive by default", () => {
    expect(assessActivity(none, REF)).toMatchObject({ status: "unknown", confidence: 0 });
  });
  it("an old website alone is not 'inactive'", () => {
    const r = assessActivity({ ...none, latestYearOnWebsite: 2019, websiteFetchedAt: REF }, REF);
    expect(r.status).toBe("possibly_dormant");
    expect(r.confidence).toBeLessThan(0.5);
  });
  it("recruiting + official listing ⇒ active", () => {
    const r = assessActivity(
      { ...none, latestRecruitingDate: new Date("2026-10-05"), officialListingObservedAt: REF },
      REF,
    );
    expect(r.status).toBe("active");
    expect(r.reasons.length).toBe(2);
  });
  it("one signal ⇒ likely active", () => {
    expect(assessActivity({ ...none, officialListingObservedAt: REF }, REF).status).toBe("likely_active");
  });
  it("stated status wins", () => {
    expect(assessActivity({ ...none, stated: { status: "inactive", observedAt: REF, tier: 1 } }, REF).status).toBe(
      "inactive",
    );
  });
});

describe("verifyLink", () => {
  it("verified when listed by Harvard or the club's own verified site", () => {
    expect(
      verifyLink({
        kind: "instagram",
        evidence: [{ sourceTier: 1, fromVerifiedOfficialSite: false, assertion: "stated" }],
      }).status,
    ).toBe("verified");
    expect(
      verifyLink({
        kind: "instagram",
        evidence: [{ sourceTier: 2, fromVerifiedOfficialSite: true, assertion: "stated" }],
      }).status,
    ).toBe("verified");
  });
  it("Wikipedia-only links stay unverified", () => {
    const r = verifyLink({
      kind: "website",
      evidence: [{ sourceTier: 8, fromVerifiedOfficialSite: false, assertion: "stated" }],
    });
    expect(r.status).toBe("unverified");
  });
  it("name match or reciprocal makes it probable, not verified", () => {
    expect(
      verifyLink({
        kind: "website",
        evidence: [{ sourceTier: 8, fromVerifiedOfficialSite: false, assertion: "stated" }],
        nameMatchOnPage: true,
      }).status,
    ).toBe("probable");
  });
});
