import { describe, expect, it } from "vitest";
import {
  assessActivity,
  harvardGroupHost,
  isVagueTimeReference,
  parseDateExpression,
  parseTermExpression,
  verifyLink,
} from "../src";

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
  it("counts recent news coverage as a sign of activity, old coverage not at all", () => {
    const recent = assessActivity({ ...none, latestPressMentionAt: new Date(REF.getTime() - 90 * 86_400_000) }, REF);
    expect(recent.status).toBe("likely_active");
    expect(recent.reasons).toContain("covered in the news within the last year");
    const old = assessActivity({ ...none, latestPressMentionAt: new Date(REF.getTime() - 900 * 86_400_000) }, REF);
    expect(old.status).toBe("unknown");
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

describe("assessActivity: endings and edge cases (activity-v3)", () => {
  const none = {
    stated: null,
    officialListingObservedAt: null,
    latestRecruitingDate: null,
    latestYearOnWebsite: null,
    websiteFetchedAt: null,
  };
  const daysAgo = (n: number) => new Date(REF.getTime() - n * 86_400_000);
  it("a stated ending never wears off, unlike a stated 'active'", () => {
    const ended = assessActivity({ ...none, stated: { status: "defunct", observedAt: daysAgo(2000), tier: 8 } }, REF);
    expect(ended.status).toBe("defunct");
    const oldActive = assessActivity(
      { ...none, stated: { status: "active", observedAt: daysAgo(2000), tier: 2 } },
      REF,
    );
    expect(oldActive.status).toBe("unknown");
  });
  it("a defunct statement outranks fresh-looking signals (an old site still online, a SOCO-era listing)", () => {
    const r = assessActivity(
      {
        ...none,
        stated: { status: "defunct", observedAt: daysAgo(1), tier: 8 },
        latestRecruitingDate: daysAgo(10),
        officialListingObservedAt: daysAgo(1),
      },
      REF,
    );
    expect(r.status).toBe("defunct");
  });
  it("a website that is up but says nothing recent is not 'active'", () => {
    expect(assessActivity({ ...none, websiteFetchedAt: daysAgo(1) }, REF).status).toBe("unknown");
  });
  it("a listing alone is only 'likely active'; nothing at all stays unknown, never inactive", () => {
    expect(assessActivity({ ...none, officialListingObservedAt: daysAgo(30) }, REF).status).toBe("likely_active");
    expect(assessActivity({ ...none, latestYearOnWebsite: 2018, websiteFetchedAt: null }, REF).status).not.toBe(
      "inactive",
    );
  });
});

describe("verifyLink", () => {
  it("ownership-v2: a title match plus an independent named reference verifies a site", () => {
    const base = { kind: "website" as const, evidence: [], nameMatchOnPage: true };
    expect(verifyLink({ ...base, independentReference: "thecrimson.com links it by the club's name" })).toMatchObject({
      status: "verified",
      signals: ["names the club, and thecrimson.com links it by the club's name"],
    });
    // Neither signal alone is enough.
    expect(verifyLink(base).status).toBe("probable");
    expect(verifyLink({ ...base, nameMatchOnPage: false, independentReference: "x" }).status).toBe("unverified");
  });

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
    // Reciprocity alone (no name match) is not enough either.
    expect(
      verifyLink({
        kind: "website",
        evidence: [{ sourceTier: 8, fromVerifiedOfficialSite: false, assertion: "stated" }],
        reciprocal: true,
      }).status,
    ).toBe("probable");
  });
  it("ownership-v1: a name match plus an independent signal makes a site the club's", () => {
    const ev = [{ sourceTier: 8, fromVerifiedOfficialSite: false, assertion: "stated" as const }];
    expect(verifyLink({ kind: "website", evidence: ev, nameMatchOnPage: true, reciprocal: true })).toMatchObject({
      status: "verified",
      signals: ["names the club and links to its confirmed account"],
    });
    expect(
      verifyLink({ kind: "website", evidence: ev, nameMatchOnPage: true, harvardHostedGroupSite: true }).status,
    ).toBe("verified");
  });
  it("knows which hosts Harvard runs for student groups", () => {
    expect(harvardGroupHost("https://hcs.harvard.edu/~room13")).toBe(true);
    expect(harvardGroupHost("https://dynamo.hcs.harvard.edu/")).toBe(true);
    expect(harvardGroupHost("https://orgs.law.harvard.edu/example")).toBe(true);
    expect(harvardGroupHost("https://hcs.harvard.edu/")).toBe(false);
    expect(harvardGroupHost("https://www.harvard.edu/")).toBe(false);
    expect(harvardGroupHost("https://harvard.edu.example.com/")).toBe(false);
  });
});

describe("daylight-saving boundaries", () => {
  it("gives a time its own offset on the day the clocks change", () => {
    const ref = new Date("2026-09-30T16:00:00Z");
    // DST ends at 2:00 AM on Sunday, November 1, 2026: midnight is still EDT, evening is EST.
    expect(parseDateExpression("November 1, 2026 at 12:00 AM", ref)?.at).toBe("2026-11-01T00:00:00-04:00");
    expect(parseDateExpression("November 1, 2026 at 5:00 PM", ref)?.at).toBe("2026-11-01T17:00:00-05:00");
    // DST starts at 2:00 AM on Sunday, March 14, 2027.
    expect(parseDateExpression("March 14, 2027 at 1:00 AM", ref)?.at).toBe("2027-03-14T01:00:00-05:00");
    expect(parseDateExpression("March 14, 2027 at 11:59 PM", ref)?.at).toBe("2027-03-14T23:59:00-04:00");
  });
});

describe("time ranges take the start time", () => {
  const at = (s: string) => parseDateExpression(s, REF)?.at;
  it("shares the end's am/pm with the start", () => {
    expect(at("Saturday September 5, 12:30-2:30PM")).toBe("2026-09-05T12:30:00-04:00");
    expect(at("Sept 5 7-9pm")).toBe("2026-09-05T19:00:00-04:00");
    expect(at("Sept 5 from 12:30 to 2:30 PM")).toBe("2026-09-05T12:30:00-04:00");
    expect(at("September 5, 11am-1pm")).toBe("2026-09-05T11:00:00-04:00");
    expect(at("September 5, 11-1pm")).toBe("2026-09-05T11:00:00-04:00");
  });
  it("keeps the explicit start and single times", () => {
    expect(at("September 5, 12:30pm-2:30pm")).toBe("2026-09-05T12:30:00-04:00");
    expect(at("Sept 5, 2:30 PM")).toBe("2026-09-05T14:30:00-04:00");
    expect(at("Sept 5 at 11:59 PM")).toBe("2026-09-05T23:59:00-04:00");
  });
  it("does not read a day range as a time range", () => {
    expect(at("Sept 5-7pm")).toBe("2026-09-05T19:00:00-04:00");
  });
});
