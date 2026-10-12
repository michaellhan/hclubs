import { describe, expect, it } from "vitest";
import { extractScope, listingScopeClaims, schoolHostOf, scopeStatements } from "../src/extract/scope";
import { htmlToDocument } from "../src/parse/document";

const page = (body: string, url = "https://example.org/about") =>
  htmlToDocument(`<html><head><title>About</title></head><body><main>${body}</main></body></html>`, url);

const scopes = (body: string) => scopeStatements(page(body)).map((f) => `${f.scope}:${f.school ?? "-"}`);

describe("scope statements (ADR 0038)", () => {
  it("reads self-describing graduate-school statements", () => {
    expect(scopes("<p>The Fictional Consulting Club is a GSAS student organization with many members.</p>")).toEqual([
      "graduate_school:gsas",
    ]);
    expect(scopes("<p>Its membership is open to all HLS students, regardless of class year.</p>")).toEqual([
      "graduate_school:hls",
    ]);
    expect(
      scopes("<p>Each student club at Harvard Business School (HBS) is open to all matriculated HBS students.</p>"),
    ).toEqual(["graduate_school:hbs"]);
    expect(scopes("<p>We are a student organization at Harvard Medical School devoted to imaging.</p>")).toEqual([
      "graduate_school:hms",
    ]);
  });

  it("ignores mentions that say nothing about the organization's members", () => {
    expect(scopes("<p>The book features many Harvard Business School students and their stories.</p>")).toEqual([]);
    expect(scopes("<p>HLAB, a clinic run by Harvard Law School students, provides free legal services.</p>")).toEqual(
      [],
    );
    expect(scopes("<p>Post a job for HBS students and alumni.</p>")).toEqual([]);
    expect(scopes("<p>Our speaker is a Harvard Law School professor.</p>")).toEqual([]);
  });

  it("reads College and cross-school statements", () => {
    expect(scopes("<p>The Example Society is an undergraduate student organization at Harvard.</p>")).toEqual([
      "harvard_college:college",
    ]);
    expect(scopes("<p>Membership is open to all Harvard undergraduates, no experience needed.</p>")).toEqual([
      "harvard_college:college",
    ]);
    expect(scopes("<p>Our team welcomes undergraduate and graduate students from every field.</p>")).toEqual([
      "cross_school:-",
    ]);
    expect(scopes("<p>Membership is open to Harvard students from all of Harvard's schools.</p>")).toEqual([
      "university_wide:-",
    ]);
  });

  it("reads program pages that describe their own members (v4)", () => {
    for (const p of [
      "The Policy Program is an undergraduate-run think tank that develops policy research.",
      "The initiative is spearheaded by undergraduate students who write poll questions.",
      "The Conservative Coalition is a hub for all Harvard College students interested in politics.",
      "Harvard College Students only.",
      "CIVICS recruits and trains talented undergraduate students to teach civics.",
    ])
      expect(scopes(`<p>${p}</p>`)).toEqual(["harvard_college:college"]);
    // A mention of students is still not a statement about the group.
    expect(scopes("<p>Undergraduate students serve as liaisons to each Fellow.</p>")).toEqual([]);
    expect(scopes("<p>The clinic is run by Harvard Law School students.</p>")).toEqual([]);
    expect(scopes("<p>HUCG is an entirely student-run non-profit organization.</p>")).toEqual([]);
    expect(scopes("<p>Group led by Harvard Undergraduates Jane Doe and John Roe.</p>")).toEqual([]);
  });

  it("does not take who may join (beyond Harvard) as where the group belongs (v3)", () => {
    // From a club's choir subpage: an audience, not the club's school.
    expect(
      scopes(
        "<p>Open to undergraduate and graduate students, as well as recent graduates, from Harvard and other area universities or conservatories.</p>",
      ),
    ).toEqual([]);
  });

  it("states nothing when a page points at two different scopes", () => {
    const doc = page(
      "<p>The Example Club is an undergraduate student organization.</p><p>Our partner is a GSAS student organization.</p>",
    );
    expect(extractScope({ doc, ownSite: false }).filter((c) => c.assertionKind === "stated")).toEqual([]);
  });

  it("infers the school from a site the school hosts for its groups", () => {
    expect(schoolHostOf("https://orgs.law.harvard.edu/example")).toBe("hls");
    expect(schoolHostOf("https://clinics.law.harvard.edu/example/join")).toBe("hls");
    expect(schoolHostOf("https://www.hbs.edu/mba/student-life/activities-government-and-clubs/student-clubs/x")).toBe(
      "hbs",
    );
    expect(schoolHostOf("https://www.hbs.edu/news/articles")).toBeNull();
    expect(schoolHostOf("https://seas.harvard.edu/x")).toBeNull();
    const claims = extractScope({
      doc: page("<p>Welcome.</p>", "https://orgs.law.harvard.edu/example"),
      ownSite: true,
    });
    expect(claims.map((c) => [c.fieldKey, c.value, c.assertionKind])).toEqual([
      ["club.school", "hls", "inferred"],
      ["club.affiliation_scope", "graduate_school", "inferred"],
    ]);
    // A directory page on a school host is not the group's own site.
    expect(
      extractScope({ doc: page("<p>Welcome.</p>", "https://orgs.law.harvard.edu/example"), ownSite: false }),
    ).toEqual([]);
  });

  it("carries its own extractor identity and a verbatim quote", () => {
    const [c] = extractScope({ doc: page("<p>Its membership is open to all HLS students.</p>"), ownSite: false });
    expect(c?.extractor).toEqual({ name: "scope-statements", version: "9" });
    expect(c?.quote).toBe("Its membership is open to all HLS students.");
  });
});

describe("scope statements: audiences are not memberships", () => {
  it("skips events, competitions and meetings that are 'open to' a group", () => {
    expect(scopes("<p>Events are open to Harvard College students who present valid HUID.</p>")).toEqual([]);
    expect(scopes("<p>Every meeting listed is open to all undergraduate students.</p>")).toEqual([]);
    expect(scopes("<p>We host a concerto competition open to all Harvard undergraduates.</p>")).toEqual([]);
    expect(scopes("<p>Auditions are open to all Harvard undergraduates who play violin.</p>")).toEqual([
      "harvard_college:college",
    ]);
  });
});

describe("scope statements v6 (graduate and Extension School groups)", () => {
  it("reads graduate and Extension School self-descriptions from directory pages", () => {
    expect(
      scopes(
        "<p>HGWISE at Harvard University GSAS is a graduate student organization founded in 2005 dedicated to women in science.</p>",
      ).sort(),
    ).toEqual(["graduate_school:-", "graduate_school:gsas"]);
    expect(
      scopes(
        "<p>The Harvard Extension Student Association (HESA) is the elected representative body for all Harvard Extension School students.</p>",
      ),
    ).toEqual(["graduate_school:extension"]);
    expect(
      scopes("<p>Post-Baccalaureate student club for those interested in the fields of medicine and dentistry.</p>"),
    ).toEqual(["graduate_school:-"]);
  });
  it("v8: a school's chapter or a name spelled out as the school's", () => {
    expect(
      scopes(
        "<p>Harvard Chinese Students and Scholars Association – Graduate School of Arts and Sciences Chapter (HCSSA-GSAS Chapter) is a student organization.</p>",
      ),
    ).toContain("graduate_school:gsas");
    expect(
      scopes("<p>HIVE (Harvard GSE Innovation and Ventures in Education) is dedicated to helping students.</p>"),
    ).toEqual(["graduate_school:hgse"]);
    // A partnership or a mention isn't the group's own name.
    expect(scopes("<p>We co-host events with the Harvard GSE Ed Tech Club.</p>")).toEqual([]);
  });
  it("doesn't read graduate scope from a mention", () => {
    expect(scopes("<p>Our mentors include graduate students from across Harvard.</p>")).toEqual([]);
    expect(scopes("<p>We partner with the Harvard Extension School on a speaker series.</p>")).toEqual([]);
    expect(scopes("<p>Many alumni went on to post-baccalaureate programs in medicine.</p>")).toEqual([]);
  });
});

describe("scope statements v9 (a club's chapter is not the club)", () => {
  // From harvardcssa.org (2026-09-30): the university-wide Harvard CSSA's site has pages about
  // its GSAS chapter. Before v9 these made the whole association a GSAS group.
  const HCSSA = ["Harvard Chinese Students & Scholars Association", "HCSSA", "Harvard CSSA"];
  it("a page about a subsidiary unit yields no scope", () => {
    const about = page(
      "<h4>Harvard Chinese Students and Scholars Association – Graduate School of Arts and Sciences Chapter</h4>" +
        "<p>Harvard Chinese Students and Scholars Association – Graduate School of Arts and Sciences Chapter (Harvard CSSA-GSAS Chapter, HCSSA-GSAS Chapter, HCSSA-GSASC). This chapter is a subsidiary organization under the HCSSA.</p>",
    );
    expect(scopeStatements(about)).toEqual([]);
    const constitution = page(
      "<p>The name of this organization shall be the Harvard Chinese Students and Scholars Association – Graduate School of Arts and Sciences Chapter (HCSSA-GSASC). This Chapter shall be a subsidiary to the HCSSA.</p>",
    );
    expect(extractScope({ doc: constitution, ownSite: true, clubNames: HCSSA })).toEqual([]);
  });
  it("a chapter named after the club is the club's chapter, not the club", () => {
    const mission = page(
      "<p>Harvard Chinese Students and Scholars Association – Graduate School of Arts and Sciences Chapter (HCSSA-GSAS Chapter) is dedicated to strengthening the connections between Chinese students and scholars.</p>",
    );
    expect(scopeStatements(mission, HCSSA)).toEqual([]);
    // Without the club's names (or for a club that is the chapter) the name still reads (v8).
    expect(scopeStatements(mission).map((f) => f.school)).toEqual(["gsas"]);
    expect(scopeStatements(mission, ["HCSSA-GSAS Chapter"]).map((f) => f.school)).toEqual(["gsas"]);
  });
  it("a mixed audience isn't a College group", () => {
    // Harvard Hillel's listing of its Reform Community: people beyond Harvard's students.
    expect(
      scopes(
        "<p>Our community is open to undergraduates, graduate students, community members, and anyone in between!</p>",
      ),
    ).toEqual([]);
    expect(scopes("<p>The club is open to undergraduates, alumni, and friends.</p>")).toEqual([]);
    // "graduates" may mean alumni: no College claim, and no cross-school one either.
    expect(scopes("<p>We are open to undergraduates and graduates of any concentration.</p>")).toEqual([]);
    expect(scopes("<p>Membership is open to all Harvard undergraduates and faculty advisors.</p>")).toEqual([]);
    // Who else may join, said separately, leaves "open to undergraduates" standing.
    expect(
      scopes(
        "<p>Harvard Club Sports are open to undergraduates, and eligibility for graduate students and affiliates follows the Club Sports Office membership rules.</p>",
      ),
    ).toEqual(["harvard_college:college"]);
    expect(scopes("<p>Membership is open to all Harvard undergraduates, no experience needed.</p>")).toEqual([
      "harvard_college:college",
    ]);
  });
  it("undergraduates and graduate students together read as cross-school, in any order", () => {
    for (const p of [
      "Membership is open to undergraduate and graduate students at Harvard.",
      "We are open to both undergraduate and graduate students.",
      "We are open to graduate and undergraduate students.",
      "Open to all Harvard undergrads and graduate students.",
      "We are open to all Harvard College students and graduate students.",
      "The club is open to undergraduates as well as graduate students.",
      "Our team welcomes undergraduate and graduate students from every field.",
      "The society is open to graduate students and undergraduates alike.",
    ])
      expect(scopes(`<p>${p}</p>`), p).toEqual(["cross_school:-"]);
  });
  it("reads a directory listing's description with the page rules", () => {
    const claims = listingScopeClaims(
      "HIVE (Harvard GSE Innovation and Ventures in Education) is dedicated to helping students develop, sustain, and/or support education ventures.",
      { clubNames: ["HIVE"], locator: { listing: "x" } },
    );
    expect(claims.map((c) => [c.fieldKey, c.value, c.assertionKind, c.locator])).toEqual([
      ["club.affiliation_scope", "graduate_school", "stated", { listing: "x" }],
      ["club.school", "hgse", "stated", { listing: "x" }],
    ]);
    expect(
      listingScopeClaims("A club for chess & <b>go</b> players at Harvard.", { clubNames: [], locator: {} }),
    ).toEqual([]);
    // Two scopes in one description state nothing.
    expect(
      listingScopeClaims("We are an undergraduate student organization. Our partner is a GSAS student organization.", {
        clubNames: [],
        locator: {},
      }),
    ).toEqual([]);
  });
});
