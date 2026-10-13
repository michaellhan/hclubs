import { describe, expect, it } from "vitest";
import { deriveJoining, joinQuoteScope, type JoiningInput } from "../src/joining";
import type { ResolvedValue } from "../src/resolve/resolver";

/**
 * Joining derivation (ADR 0041): scoped processes, open vs process vs mixed, no-cut comps,
 * first-years and dues as yes / no / unknown — on quotes taken from real club pages.
 */
let n = 0;
function rv(value: unknown, quote: string | null, observedAt = "2026-09-30T00:00:00Z"): ResolvedValue<unknown> {
  n++;
  return {
    value,
    claimId: `claim-${n}`,
    badge: "verified",
    confidence: 0.9,
    assertionKind: "stated",
    bestTier: 2,
    observedAt,
    asOf: null,
    stale: false,
    sources: [
      {
        sourceId: `src-${n}`,
        sourceType: "club_website",
        url: `https://club.example.invalid/${n}`,
        title: null,
        observedAt,
        isFixture: true,
        quote,
      },
    ],
  };
}
const mode = (m: string, quote: string | null) => rv(m, quote);
function derive(over: Partial<JoiningInput>) {
  return deriveJoining({
    joinModes: [],
    freshmenEligible: [],
    eligibleClasses: [],
    cycleEligibleClasses: [],
    dues: null,
    tags: [],
    ...over,
  });
}

describe("role scope of a selective process", () => {
  it.each([
    ["Apply to join the HGCC Executive Board!", "leadership"],
    ["As soon as the comp is over, you’re welcome to apply for a spot on our board.", "leadership"],
    ["If you would like to apply to be a director, please fill out this form.", "leadership"],
    ["Frosh Reps - Applications now open!", "leadership"],
    ["WPC 27 Ambassador Applications Open!", "leadership"],
    ["A description of the committees and the application form are included here.", "leadership"],
    // Plural (WISHR): "Applications for … committees" is a committee seat, not membership.
    ["Applications for WISHR committees are accepted on a rolling basis.", "leadership"],
    // Positions are roles (Plant Based, joining-v4).
    ["Fill out the form to apply to one or more of the available positions.", "leadership"],
    ["Positions available for the 2026-27 year: treasurer, events lead.", "leadership"],
    ["Position applications are due Friday.", "leadership"],
    ["Tryouts for competition teams are typically held at the start of the academic year.", "team"],
    ["We’ve also opened up our competitive case team application to all!", "team"],
    ["Each year, contending conductors audition with the orchestra.", "ensemble"],
    ["Acting roles are cast by audition for each show.", "ensemble"],
    ["After completion of the HFAC Comp, top students apply to manage HFAC’s $100,000 long-short equity fund.", "fund"],
  ])("role: %s", (q, role) => expect(joinQuoteScope(q)).toEqual({ scope: "role", role }));

  it.each([
    "Comp is the process through which prospective board members can join Crimson Business.",
    "If you’re interested in joining HUSL or becoming a board member, please fill out the form below.",
    "The Pitches choose new group members through an audition process.",
    "Fall 2026 Applications are now open!",
    "Apply to be a member for one of our Spring 2026 projects here",
    "At the beginning of each semester, students can submit proposals to join our cohort, which will be reviewed by the OpenBio executive board.",
    "Each year, our Executive Board selects 40 of the most accomplished Harvard undergraduates to staff our conference.",
    "Our application consists of a resume drop & an interview with members of the Board.",
    "Apply to join the club: positions are open to new members every fall.",
    "Any and all Harvard students with an interest in real estate are encouraged to apply for open positions.",
  ])("general: %s", (q) => expect(joinQuoteScope(q).scope).toBe("general"));
});

describe("access", () => {
  it("open general membership with a selective board stays open", () => {
    const j = derive({
      joinModes: [
        mode(
          "open",
          "Joining is really easy—we have no comp process or application—and is open to all Harvard College students.",
        ),
        mode("application", "Apply to join our executive board!"),
      ],
    });
    expect(j.access).toBe("open");
    expect(j.general).toEqual(["open"]);
    expect(j.roles).toEqual([{ mode: "application", role: "leadership" }]);
    expect(j.comp).toBe(false);
    expect(j.basis.comp?.rule).toBe("open_membership");
  });

  it("auditions only for some seats don't make an open ensemble selective", () => {
    const j = derive({
      joinModes: [
        mode("open", "Sign up for the mailing list, follow us on Instagram, or just show up."),
        mode("tryout", "Tryouts for competition teams are typically held at the start of the academic year."),
      ],
    });
    expect(j.access).toBe("open");
    expect(j.roles).toEqual([{ mode: "tryout", role: "team" }]);
  });

  it("a stated process for members is 'process' — never 'selective' by itself", () => {
    const j = derive({ joinModes: [mode("audition", "Auditions will take place over the course of one week.")] });
    expect(j.access).toBe("process");
    expect(j.general).toEqual(["audition"]);
    expect(j.comp).toBe(null);
  });

  it("general open and general process statements are 'mixed', a conflict", () => {
    const j = derive({
      joinModes: [
        mode("open", "anyone who wants to join the Band can join"),
        mode("audition", "Let us know you’re interested by registering as a Candidate, then come in for an audition."),
      ],
    });
    expect(j.access).toBe("mixed");
    expect(j.conflicts).toContain("access");
  });

  it("nothing stated is unknown, not open", () => {
    const j = derive({});
    expect(j).toMatchObject({ access: null, comp: null, firstYears: null, dues: null, general: [], roles: [] });
  });
});

describe("comp", () => {
  const flag = rv("no comping requirement", "No Comping Requirement");

  it("the College directory flag says no comp, and nothing about an application", () => {
    const j = derive({ tags: [flag], joinModes: [mode("application", "Please complete our written application.")] });
    expect(j.comp).toBe(false);
    expect(j.basis.comp?.rule).toBe("college_directory_no_comp");
    expect(j.access).toBe("process");
  });

  it("a directory listing with no recruiting text is unknown, not open", () => {
    const j = derive({ tags: [rv("Public Service", "Public Service")] });
    expect(j.access).toBe(null);
    expect(j.comp).toBe(null);
  });

  it("a stated comp against the directory's flag is a conflict", () => {
    const j = derive({ tags: [flag], joinModes: [mode("comp", "Our fall comp starts in September.")] });
    expect(j.comp).toBe(null);
    expect(j.conflicts).toContain("comp");
  });

  it("completion-based comps have no cuts; a comp beside an application doesn't", () => {
    const comp = mode("comp", "We run a completion-based comp during both the fall and spring semesters.");
    expect(derive({ joinModes: [comp] }).noCuts).toBe(true);
    expect(derive({ joinModes: [comp, mode("application", "Please complete our written application.")] }).noCuts).toBe(
      false,
    );
    expect(derive({ joinModes: [mode("comp", "Our comp is competitive.")] }).noCuts).toBe(false);
    expect(
      derive({
        joinModes: [mode("audition", "The company’s semesterly auditions are no-cuts and designed to be fun.")],
      }).noCuts,
    ).toBe(true);
  });

  it("an open quote that explains the audition makes it open and no-cut, not mixed (Harvard University Band)", () => {
    const j = derive({
      joinModes: [
        mode("audition", "Let us know you’re interested by registering as a Candidate, then come in for an audition."),
        mode("open", "There’s no need to sweat our auditions — anyone who wants to join the Band can join."),
      ],
    });
    // joining-v5: anyone can join (Open membership, Still time to join); the audition stays, with no cuts.
    expect(j.access).toBe("open");
    expect(j.general).toEqual(expect.arrayContaining(["open", "audition"]));
    expect(j.noCuts).toBe(true);
    expect(j.comp).toBe(false);
    expect(j.conflicts).not.toContain("access");
    // An open quote that doesn't mention the process still disagrees with it.
    const k = derive({
      joinModes: [
        mode("audition", "Come in for an audition."),
        mode("open", "Anyone who wants to join the Band can join."),
      ],
    });
    expect(k.access).toBe("mixed");
    expect(k.noCuts).toBe(false);
  });
});

describe("first-years", () => {
  it("'first-years welcome' → yes", () => {
    const j = derive({ freshmenEligible: [rv(true, "First-years welcome!")] });
    expect(j.firstYears).toBe(true);
    expect(j.basis.firstYears?.rule).toBe("first_years_named");
  });

  it("'open to all Harvard College students' on an open-membership claim → yes, with that claim as basis", () => {
    const open = mode("open", "Harvard Curling is open to all Harvard students.");
    const j = derive({ joinModes: [open] });
    expect(j.firstYears).toBe(true);
    expect(j.basis.firstYears).toMatchObject({ rule: "open_population", claimIds: [open.claimId] });
  });

  it("'first-years may apply' → first-years yes, but not open membership", () => {
    const j = derive({ joinModes: [mode("application", "First-years may apply through our fall application.")] });
    expect(j.firstYears).toBe(true);
    expect(j.access).toBe("process");
  });

  it("'open to sophomores, juniors, seniors' → no", () => {
    const j = derive({
      eligibleClasses: [
        rv(["sophomore", "junior", "senior"], "Membership is open to sophomores, juniors, and seniors."),
      ],
    });
    expect(j.firstYears).toBe(false);
  });

  it("a descriptive list is not a restriction", () => {
    const j = derive({
      eligibleClasses: [
        rv(["sophomore"], "The A.D. Club's members are male students who typically join during their sophomore year."),
      ],
    });
    expect(j.firstYears).toBe(null);
  });

  it("missing evidence → unknown", () => {
    expect(derive({ joinModes: [mode("comp", "Our comp starts in September.")] }).firstYears).toBe(null);
  });

  it("a specific class-year rule beats a generic population, keeping it as contrary evidence", () => {
    const generic = rv(
      ["first_year", "sophomore", "junior", "senior"],
      "Any Harvard undergraduate student may apply for Signet membership.",
    );
    const specific = rv(
      ["sophomore", "junior", "senior"],
      "If you haven’t taken any time off, you can first apply in the spring of your sophomore year.",
    );
    const j = derive({ eligibleClasses: [generic, specific] });
    expect(j.firstYears).toBe(false);
    expect(j.basis.firstYears?.contrary?.claimIds).toEqual([generic.claimId]);
    expect(j.conflicts).not.toContain("firstYears");
  });

  it("equally specific statements that disagree are a conflict (unknown)", () => {
    const j = derive({
      freshmenEligible: [
        rv(true, "First-years are welcome to comp."),
        rv(false, "First-years are not eligible to comp."),
      ],
    });
    expect(j.firstYears).toBe(null);
    expect(j.conflicts).toContain("firstYears");
  });

  it("a board's eligibility says nothing about membership", () => {
    const j = derive({
      joinModes: [mode("application", "First-years may apply to be a Freshman Representative on the board.")],
    });
    expect(j.firstYears).toBe(null);
    expect(j.roles).toEqual([{ mode: "application", role: "leadership" }]);
  });

  it("a punch for sophomores and juniors → no", () => {
    const j = derive({
      joinModes: [
        mode(
          "invite_only",
          "The club currently operates a traditional punch process for sophomore and junior men at the college.",
        ),
      ],
    });
    expect(j.firstYears).toBe(false);
  });
});

describe("dues", () => {
  it("no dues stated → false; conflicting dues → unknown with a conflict", () => {
    const none = rv({ hasDues: false }, "No Dues Required");
    expect(derive({ dues: { current: none, conflict: false } }).dues).toBe(false);
    const j = derive({ dues: { current: none, conflict: true } });
    expect(j.dues).toBe(null);
    expect(j.conflicts).toContain("dues");
    expect(derive({ dues: null }).dues).toBe(null);
  });
});
