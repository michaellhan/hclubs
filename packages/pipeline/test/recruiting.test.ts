import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { dateFitsTerm, extractDeterministic, extractJoinModes, type PageRole } from "../src/extract/deterministic";
import { htmlToDocument } from "../src/parse/document";
import { findRecruitingIssues, type CycleClaimRow } from "../src/recruiting/audit";
import { applicationFormLinks, classifyRecruitingPage, scoreRecruitingLink } from "../src/recruiting/signals";
import { recruitingQuery, scoreSearchResult } from "../src/stages/recruiting";
import type { ExtractedClaim } from "../src/types";

/** Synthetic recruiting pages for fictional clubs (test/fixtures/recruiting). No network. */
const dir = fileURLToPath(new URL("./fixtures/recruiting/", import.meta.url));
const FETCHED = new Date("2026-09-10T15:00:00Z");
const page = (file: string, url: string) => htmlToDocument(readFileSync(`${dir}${file}`, "utf8"), url);
const extract = (file: string, url: string, role: PageRole, names: string[]) =>
  extractDeterministic({ doc: page(file, url), role, fetchedAt: FETCHED, clubNames: names, clubAcronyms: [] });
const of = (claims: ExtractedClaim[], key: string) => claims.filter((c) => c.fieldKey === key);
const at = (c: ExtractedClaim) => (c.value as { at: string }).at;

describe("recruiting page classification", () => {
  it("tells active, informational, historical, membership and irrelevant pages apart", () => {
    const kind = (file: string, url: string) => classifyRecruitingPage(page(file, url), FETCHED).kind;
    expect(kind("current-deadline.html", "https://debate.example/apply")).toBe("active_application");
    expect(kind("audition-page.html", "https://chorale.example/auditions")).toBe("active_application");
    expect(kind("comp-page.html", "https://gazette.example/comp")).toBe("active_application");
    expect(kind("historical-deadline.html", "https://review.example/comp")).toBe("historical");
    expect(kind("membership-page.html", "https://hiking.example/get-involved")).toBe("membership");
    expect(kind("irrelevant-page.html", "https://hiking.example/photos")).toBe("irrelevant");
  });

  it("scores joining/recruiting links above news and archive links", () => {
    expect(scoreRecruitingLink("https://club.example/apply", "Apply")).toBeGreaterThan(
      scoreRecruitingLink("https://club.example/join", "Join us"),
    );
    expect(scoreRecruitingLink("https://club.example/comp")).toBeGreaterThan(0);
    expect(scoreRecruitingLink("https://club.example/2019/03/comp-recap", "Comp recap")).toBe(2);
    expect(scoreRecruitingLink("https://club.example/photos", "Photos")).toBe(0);
  });
});

describe("recruiting extraction", () => {
  it("reads a current deadline, its stages and its application form", () => {
    const claims = extract("current-deadline.html", "https://debate.example/apply", "recruiting", [
      "Example Debate Society",
    ]);
    const deadlines = of(claims, "cycle.deadline");
    expect(deadlines.map(at)).toEqual(["2026-09-18T23:59:00-04:00"]);
    expect(deadlines[0]?.cycleTermKey).toBe("2026-fall");
    expect(deadlines[0]?.quote).toContain("due Friday, September 18 at 11:59 PM");
    expect(of(claims, "cycle.application_url").map((c) => c.value)).toEqual(["https://forms.gle/exampleDebateApp"]);
    const stages = of(claims, "cycle.stages")[0]?.value as { kind: string; label: string }[];
    expect(stages.map((s) => s.kind)).toEqual(["info_session", "written_application", "coffee_chat", "interview"]);
    expect(stages.map((s) => s.label)).toContain("Final round interview");
  });

  it("never turns an old cycle's page into a current deadline", () => {
    const claims = extract("historical-deadline.html", "https://review.example/comp", "recruiting", ["Example Review"]);
    expect(of(claims, "cycle.deadline")).toEqual([]);
  });

  it("doesn't resolve 'this Friday' against the crawl date", () => {
    const claims = extract("ambiguous-date.html", "https://robotics.example/join", "join", ["Example Robotics"]);
    expect(of(claims, "cycle.deadline")).toEqual([]);
    // The recurring pattern is still a fact.
    expect(of(claims, "club.recruiting_seasons").map((c) => c.value)).toEqual([["fall"]]);
  });

  it("reads a comp page's opening date, deadline and pathways", () => {
    const claims = extract("comp-page.html", "https://gazette.example/comp", "recruiting", ["Example Gazette"]);
    expect(of(claims, "cycle.opens_at").map(at)).toEqual(["2026-09-03"]);
    expect(of(claims, "cycle.deadline").map(at)).toEqual(["2026-10-09"]);
    expect(of(claims, "club.join_mode").map((c) => c.value)).toEqual(expect.arrayContaining(["comp"]));
  });

  it("files an audition sign-up deadline under the term it names", () => {
    const claims = extract("audition-page.html", "https://chorale.example/auditions", "recruiting", [
      "Example Chorale",
    ]);
    const d = of(claims, "cycle.deadline");
    expect(d.map(at)).toEqual(["2027-01-22"]);
    expect(d[0]?.cycleTermKey).toBe("2027-spring");
    expect(of(claims, "club.join_mode").map((c) => c.value)).toContain("audition");
    expect(of(claims, "cycle.application_url")).toHaveLength(1);
  });

  it("keeps each cycle of a multi-cycle page apart and ignores none of the dates' terms", () => {
    const claims = extract("multiple-cycles.html", "https://consulting.example/recruiting", "recruiting", [
      "Example Consulting Group",
    ]);
    const byTerm = of(claims, "cycle.deadline").map((c) => [c.cycleTermKey, at(c)]);
    expect(byTerm).toEqual(
      expect.arrayContaining([
        ["2026-fall", "2026-09-25"],
        ["2027-spring", "2027-02-05"],
        ["2025-fall", "2025-09-26"],
      ]),
    );
  });

  it("reads open membership on a generic membership page, and nothing from an irrelevant page", () => {
    const m = extract("membership-page.html", "https://hiking.example/get-involved", "join", ["Example Hiking Club"]);
    expect(of(m, "club.join_mode").map((c) => c.value)).toEqual(["open"]);
    expect(of(m, "cycle.deadline")).toEqual([]);
    const i = extract("irrelevant-page.html", "https://hiking.example/photos", "other", ["Example Hiking Club"]);
    expect(i.filter((c) => c.fieldKey.startsWith("cycle."))).toEqual([]);
  });

  it("records 'applications are open' under the current term the page names, with its form", () => {
    const claims = extract("stated-open.html", "https://analytics.example/apply", "recruiting", [
      "Example Analytics Group",
    ]);
    expect(of(claims, "cycle.stated_status").map((c) => [c.value, c.cycleTermKey])).toEqual([["open", "2026-fall"]]);
    expect(of(claims, "cycle.application_url").map((c) => c.value)).toEqual(["https://forms.gle/exampleAnalytics"]);
  });

  it("reads 'when Spring applications open' as a later opening, and 'this semester's … closed' as now (1.16.20)", () => {
    const doc = htmlToDocument(
      "<html><body><main><h1>Get involved</h1><p>Applications to this semester's fellowships have closed. Fill out the interest form and we'll email you when Spring 2027 applications open.</p></main></body></html>",
      "https://safety.example/involved",
    );
    const claims = extractDeterministic({
      doc,
      role: "join",
      fetchedAt: new Date("2026-10-11T16:00:00Z"),
      clubNames: ["Example Safety Team"],
      clubAcronyms: [],
    });
    expect(of(claims, "cycle.stated_status").map((c) => [c.value, c.cycleTermKey])).toEqual([["closed", "2026-fall"]]);
  });

  it("doesn't read a founding year as the recruiting term", () => {
    const doc = htmlToDocument(
      "<html><body><main><h1>Join</h1><p>Established in the fall of 1981, we compete nationally.</p><p>Applications are open.</p></main></body></html>",
      "https://club.example/join",
    );
    const claims = extractDeterministic({
      doc,
      role: "join",
      fetchedAt: FETCHED,
      clubNames: ["Example Club"],
      clubAcronyms: [],
    });
    expect(of(claims, "cycle.stated_status")).toEqual([]);
  });

  it("drops a deadline that belongs to a board application named just before it (1.16.13)", () => {
    const html = (lead: string) =>
      `<html><body><main><h1>Get in touch</h1><h4>${lead} Apply by September 24th @ 11:59 PM!</h4></main></body></html>`;
    const run = (lead: string) =>
      extractDeterministic({
        doc: htmlToDocument(html(lead), "https://club.example/contact"),
        role: "join",
        fetchedAt: FETCHED,
        clubNames: ["Example Club"],
        clubAcronyms: [],
      });
    expect(of(run("Example Board Applications are open!!"), "cycle.deadline")).toEqual([]);
    expect(of(run("Member applications are open!!"), "cycle.deadline").map(at)).toEqual(["2026-09-24T23:59:00-04:00"]);
  });

  it("treats 'open until <date>' as a deadline", () => {
    const doc = htmlToDocument(
      "<html><body><main><h1>Apply</h1><p>The 2026 application form is open until October 4th, 2026.</p></main></body></html>",
      "https://club.example/apply",
    );
    const claims = extractDeterministic({
      doc,
      role: "recruiting",
      fetchedAt: FETCHED,
      clubNames: ["Example Club"],
      clubAcronyms: [],
    });
    expect(of(claims, "cycle.deadline").map(at)).toEqual(["2026-10-04"]);
  });
});

describe("join pathways", () => {
  const modes = (text: string) =>
    extractJoinModes({
      doc: htmlToDocument(`<html><body><main><p>${text}</p></main></body></html>`, "https://club.example/join"),
      role: "join",
      fetchedAt: FETCHED,
      clubNames: ["Example Club"],
      clubAcronyms: [],
    }).map((c) => c.value);
  it("reads invitation-only and attendance-based membership", () => {
    expect(modes("Membership is by invitation only.")).toEqual(["invite_only"]);
    expect(modes("Attend at least three meetings to become a voting member.")).toEqual(["attendance_based"]);
  });
  it("doesn't read 'no auditions' as an audition", () => {
    expect(modes("We are a non-auditioned group: no auditions required, everyone is welcome.")).toEqual(["open"]);
  });
});

describe("application forms", () => {
  it("keeps forms presented as the application and skips feedback/merch forms", () => {
    const doc = htmlToDocument(
      `<html><body><main>
        <a href="https://forms.gle/app">Apply here</a>
        <a href="https://forms.gle/merch">Merch order form</a>
        <a href="https://docs.google.com/forms/d/e/x/viewform">Give us feedback</a>
      </main></body></html>`,
      "https://club.example/",
    );
    expect(applicationFormLinks(doc, false).map((l) => l.url)).toEqual(["https://forms.gle/app"]);
  });
});

describe("dates and terms", () => {
  it("knows which recruiting window a date can belong to", () => {
    expect(dateFitsTerm("2026-09-18", "2026-fall")).toBe(true);
    expect(dateFitsTerm("2026-11-20", "2027-spring")).toBe(true); // spring comps recruit in late fall
    expect(dateFitsTerm("2025-09-18", "2026-fall")).toBe(false);
    expect(dateFitsTerm("2026-04-17", "2016-fall")).toBe(false);
  });
});

describe("search fallback", () => {
  const club = { name: "Harvard Undergraduate Example Society", acronym: "HUES", siteHost: null };
  it("builds site-restricted queries for clubs with a site, named queries otherwise", () => {
    expect(recruitingQuery({ name: "X", site: { url: "https://hues.example/" } })).toMatch(/^site:hues\.example /);
    expect(recruitingQuery({ name: "Example Society", site: null })).toMatch(/^"Example Society" Harvard \(apply/);
  });
  it("accepts results that name the club or sit on its site, never news or social pages", () => {
    expect(
      scoreSearchResult({ url: "https://hues.example/apply", title: "Apply | Example Society" }, club),
    ).toBeGreaterThanOrEqual(15);
    expect(scoreSearchResult({ url: "https://www.thecrimson.com/x", title: "Example Society comp" }, club)).toBe(0);
    expect(scoreSearchResult({ url: "https://other.example/apply", title: "Apply to Other Club" }, club)).toBe(0);
  });
});

describe("recruiting quality audit", () => {
  const row = (over: Partial<CycleClaimRow>): CycleClaimRow => ({
    id: "c1",
    clubId: "club-a",
    slug: "club-a",
    fieldKey: "cycle.deadline",
    value: { at: "2026-09-18", precision: "date" },
    termKey: "2026-fall",
    evidence: 1,
    sourceTypes: ["club_website"],
    ...over,
  });
  const sites = new Map([["club-a", ["club-a.example"]]]);
  const kinds = (rows: CycleClaimRow[]) => findRecruitingIssues(rows, sites, FETCHED).map((i) => i.kind);

  it("passes a sound deadline", () => {
    expect(kinds([row({})])).toEqual([]);
  });
  it("rejects a date filed under the wrong term, and implausible terms", () => {
    expect(kinds([row({ termKey: "2016-fall" })])).toEqual(["date_outside_term"]);
    expect(kinds([row({ termKey: "2031-fall" })])).toEqual(["implausible_term"]);
  });
  it("rejects facts without evidence and status taken from articles", () => {
    expect(kinds([row({ evidence: 0 })])).toEqual(["no_evidence"]);
    expect(kinds([row({ fieldKey: "cycle.stated_status", value: "open", sourceTypes: ["harvard_crimson"] })])).toEqual([
      "status_from_article",
    ]);
  });
  it("rejects application URLs on unrelated domains or claimed by two clubs", () => {
    expect(kinds([row({ fieldKey: "cycle.application_url", value: "https://unrelated.example/apply" })])).toEqual([
      "application_url_unrelated_domain",
    ]);
    expect(kinds([row({ fieldKey: "cycle.application_url", value: "https://club-a.example/apply" })])).toEqual([]);
    const shared = "https://forms.gle/same";
    expect(
      kinds([
        row({ fieldKey: "cycle.application_url", value: shared }),
        row({ id: "c2", clubId: "club-b", slug: "club-b", fieldKey: "cycle.application_url", value: shared }),
      ]),
    ).toEqual(["application_url_shared_by_clubs", "application_url_shared_by_clubs"]);
  });
  it("drops the duplicate of a date recorded under two terms", () => {
    const issues = findRecruitingIssues(
      [row({ value: { at: "2026-08-31" } }), row({ id: "c2", termKey: "2026-summer", value: { at: "2026-08-31" } })],
      sites,
      FETCHED,
    );
    expect(issues.map((i) => [i.kind, i.termKey])).toEqual([["duplicate_cycle_date", "2026-summer"]]);
  });
});
