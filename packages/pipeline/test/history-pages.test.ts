import { describe, expect, it } from "vitest";
import { classifyPageRole } from "../src/crawl/site";
import { extractCommitmentAndSize, extractDeterministic } from "../src/extract/deterministic";
import {
  archivalSubjectProblem,
  historyClaimProblem,
  historyPageProblem,
  pastFactProblem,
} from "../src/extract/evidence-rules";
import { groundExtraction, type LlmPage } from "../src/extract/llm/extractor";
import type { LlmExtraction } from "../src/extract/llm/schema";
import { htmlToDocument } from "../src/parse/document";
import { checkContent } from "../src/audit/checks/content";
import { checkFacts } from "../src/audit/checks/facts";
import type { AuditClaim, AuditClub, AuditData } from "../src/audit/types";

/**
 * Club history and archive pages read as current facts (rejected by hand, 2026-10-13): the
 * Wireless Club's history page gave a 1909 professor as its About text and "averaged about 25
 * members" (its early years) as its size; STAHR's gave a note about digitizing the observatory
 * logbooks as its About text.
 */

const FETCHED = new Date("2026-10-13T12:00:00Z");
const WIRELESS = ["Harvard College Wireless Club"];
const STAHR = ["Student Astronomers at Harvard-Radcliffe"];

const PIERCE =
  'Pierce was the Rumford Professor of Physics and Director of the Crufts High Tension Laboratory, where the Club held meetings for many years. His "5 K. W. Pierce System" wireless telegraph at Harvard is listed in The First Annual Wireless Blue Book of the Wireless Association of America, dated May 1909.';
const AVERAGED =
  'The Club averaged about 25 members and acquired a quenched spark gap transmitter which gave "very satisfactory results." (All quotations, unless otherwise identified, are taken from the Harvard University Archives.) 1AF was recognized as a control station in the Boston area.';
const LOGBOOKS =
  "Our logbooks record all the visitors who have passed through the observatory since its installation in 1976! Each one tells a story, and we’re currently in the process of digitizing ALL of them. Due to WordPress limits on file sizes, most logbooks are broken up into a few PDFs.";
const WIRELESS_ABOUT =
  "Founded in 1909, the Harvard College Wireless Club is Harvard's amateur radio club. We operate station W1AF from the roof of the Science Center, teach licensing classes and talk to operators around the world.";

describe("history, archive and alumni pages (1.16.48, g25)", () => {
  it("marks history and archive pages by URL", () => {
    for (const url of [
      "https://w1af.harvard.edu/php/history.php",
      "https://sites.harvard.edu/stahr/history",
      "https://example.org/our-history/",
      "https://example.org/about/history-of-the-club",
      "https://example.org/archives",
      "https://example.org/past-boards",
      "https://example.org/past-events",
      "https://example.org/Club_History.html",
    ])
      expect(historyPageProblem(url)?.check, url).toBe("history_page");
    expect(historyPageProblem("https://example.org/alumni")?.check).toBe("alumni_page");
    expect(historyPageProblem("https://example.org/about-us/alumni")?.check).toBe("alumni_page");
  });
  it("marks them by title or heading", () => {
    expect(historyPageProblem("https://x.org/p/12", "History | Wireless Club")?.check).toBe("history_page");
    expect(historyPageProblem("https://x.org/p/12", "A Brief History of the Glee Club")?.check).toBe("history_page");
    expect(historyPageProblem("https://x.org/p/12", null, "Our History")?.check).toBe("history_page");
    expect(historyPageProblem("https://x.org/p/12", "Alumni – Harvard Band")?.check).toBe("alumni_page");
  });
  it("never marks a club named for history, or its own pages", () => {
    for (const [url, title] of [
      ["https://sites.harvard.edu/history", "Harvard Undergraduate History Club"],
      ["https://historyclub.example.org/", "History Club | Harvard"],
      ["https://example.org/history-club/about", "About the History Club"],
      ["https://w1af.harvard.edu/php/index.php", "Harvard College Wireless Club"],
      ["https://example.org/about", "About Us"],
      ["https://example.org/join", "Join"],
      ["https://sites.google.com/view/alumni/home", "Home"],
    ] as const)
      expect(historyPageProblem(url, title), url).toBeNull();
  });
  it("judges a history page's claims one by one", () => {
    const history = historyPageProblem("https://harvardpolo.com/history.html");
    const alumni = historyPageProblem("https://example.org/alumni");
    // Current facts need a sentence that says they are current (Polo's and the Glee Club's do).
    expect(
      historyClaimProblem(
        "club.member_count",
        "The team, reestablished in 2006, currently has 22 members and practices regularly at the Harvard Polo and Equestrian Center.",
        history,
      ),
    ).toBeNull();
    expect(
      historyClaimProblem(
        "club.member_count",
        "Today’s Harvard Glee Club consists of about 70 members of all gender identities.",
        history,
      ),
    ).toBeNull();
    expect(historyClaimProblem("club.member_count", "The Club averaged about 25 members.", history)?.check).toBe(
      "history_page",
    );
    expect(historyClaimProblem("club.join_mode", "Membership was by election.", history)?.check).toBe("history_page");
    // About text that tells the past, and recruiting rounds, never; links and activities stand.
    expect(historyClaimProblem("club.long_description", PIERCE, history)?.check).toBe("history_page");
    expect(
      historyClaimProblem(
        "club.short_description",
        "The Radcliffe Choral Society, founded in 1899, is a treble (soprano-alto) choral ensemble.",
        history,
      ),
    ).toBeNull();
    expect(historyClaimProblem("cycle.deadline", "Auditions are due September 4.", history)?.check).toBe(
      "history_page",
    );
    expect(historyClaimProblem("club.link", "home page", history)).toBeNull();
    expect(historyClaimProblem("club.activity", "Annual Spring Break Tour of Bermuda", history)).toBeNull();
    // An alumni page speaks about alumni.
    expect(historyClaimProblem("club.activity", "Alumni weekend events", alumni)?.check).toBe("alumni_page");
    expect(historyClaimProblem("club.long_description", "We are a club.", alumni)?.check).toBe("alumni_page");
    expect(historyClaimProblem("club.link", "LinkedIn", alumni)).toBeNull();
    expect(historyClaimProblem("club.member_count", "anything", null)).toBeNull();
  });
  it("crawler roles are unchanged: a history page still crawls as about", () => {
    // No separate "history" role: the LLM cache key carries each page's role, so a new role
    // would make every cached history-page chunk unreplayable.
    expect(classifyPageRole("https://w1af.harvard.edu/php/history.php")).toBe("about");
  });

  it("the deterministic extractor reads no About text or size from the Wireless Club's history page", () => {
    const html = `<html><head><title>History | W1AF</title></head><body><main>
      <h1>History</h1><p>${PIERCE}</p><p>${AVERAGED}</p>
      <p>Visit our <a href="https://w1af.harvard.edu/">home page</a>.</p></main></body></html>`;
    const ctx = {
      doc: htmlToDocument(html, "https://w1af.harvard.edu/php/history.php"),
      role: "about" as const,
      fetchedAt: FETCHED,
      clubNames: WIRELESS,
      clubAcronyms: [],
    };
    const fields = extractDeterministic(ctx).map((c) => c.fieldKey);
    expect(fields).not.toContain("club.long_description");
    expect(fields).not.toContain("club.member_count");
    // Team pages call the size extractor directly.
    expect(extractCommitmentAndSize({ ...ctx, role: "team" })).toEqual([]);
  });
  it("…but keeps a history page's current facts (Polo, the Radcliffe Choral Society)", () => {
    const html = `<html><head><title>History | Harvard Polo</title></head><body><main>
      <p>The Radcliffe Choral Society, founded in 1899, is a treble (soprano-alto) choral ensemble, open to any student at Harvard University. We sing music from nine centuries and tour every year.</p>
      <p>The team, reestablished in 2006, currently has 22 members and practices regularly at the Harvard Polo and Equestrian Center in Hamilton, Massachusetts.</p>
      </main></body></html>`;
    const claims = extractDeterministic({
      doc: htmlToDocument(html, "https://harvardpolo.com/history.html"),
      role: "about",
      fetchedAt: FETCHED,
      clubNames: ["Radcliffe Choral Society", "Harvard Polo Club"],
      clubAcronyms: [],
    });
    expect(claims.filter((c) => c.fieldKey === "club.member_count").map((c) => c.value)).toEqual([
      { kind: "exact", count: 22 },
    ]);
    expect(claims.some((c) => c.fieldKey === "club.long_description")).toBe(true);
  });
  it("…and STAHR's logbook note is no description", () => {
    const html = `<html><head><title>History – STAHR</title></head><body><main><p>${LOGBOOKS}</p></main></body></html>`;
    const claims = extractDeterministic({
      doc: htmlToDocument(html, "https://sites.harvard.edu/stahr/history"),
      role: "about",
      fetchedAt: FETCHED,
      clubNames: STAHR,
      clubAcronyms: ["STAHR"],
    });
    expect(claims.filter((c) => c.fieldKey === "club.long_description")).toEqual([]);
  });
  it("keeps the club's current About, which mentions its founding year", () => {
    const html = `<html><head><title>Harvard College Wireless Club</title></head><body><main><p>${WIRELESS_ABOUT}</p>
      <p>Today the club has over 100 active members.</p></main></body></html>`;
    const claims = extractDeterministic({
      doc: htmlToDocument(html, "https://w1af.harvard.edu/php/index.php"),
      role: "home",
      fetchedAt: FETCHED,
      clubNames: WIRELESS,
      clubAcronyms: [],
    });
    expect(claims.filter((c) => c.fieldKey === "club.long_description").map((c) => c.value)).toEqual([WIRELESS_ABOUT]);
    expect(claims.filter((c) => c.fieldKey === "club.member_count").map((c) => c.value)).toEqual([
      { kind: "range", min: 100, max: null },
    ]);
  });
});

describe("facts about the past (1.16.48, g25)", () => {
  it("rejects past figures", () => {
    expect(pastFactProblem(AVERAGED, [25], FETCHED)?.check).toBe("past_fact");
    for (const [s, nums] of [
      ["In its early years the club had 30 members.", [30]],
      ["In the 1920s the society numbered over 200 members.", [200]],
      ["In 1985, the band counted 150 members.", [150]],
      ["The club used to have 40 members.", [40]],
      ["At the time, membership dues were $5 a semester.", [5]],
      ["By 2012 the club had grown to 60 members.", [60]],
      ["Members spent about 10 hours a week on the 1999 show; at its peak the team had 50 members.", [50]],
    ] as const)
      expect(pastFactProblem(s, nums, FETCHED)?.check, s).toBe("past_fact");
  });
  it("keeps present figures, including founding years and recent years", () => {
    for (const [s, nums] of [
      ["We have over 100 active members.", [100]],
      ["Founded in 1909, the club has over 100 active members.", [100]],
      ["Established in 1985, the club now has 60 members.", [60]],
      ["Since 2010 we have grown to 80 members.", [80]],
      ["In 2015 we were featured in the Crimson, and we have 60 members.", [60]],
      ["In 2024, the club had 45 members.", [45]],
      ["Dues of $20 are used to cover equipment.", [20]],
      ["Dues are paid at the time of joining: $15 per semester.", [15]],
      ["Members spend 3 to 5 hours per week.", [3, 5]],
      ["There are no dues.", []],
    ] as const)
      expect(pastFactProblem(s, nums, FETCHED), s).toBeNull();
  });
  it("the size extractor skips a past count on any page", () => {
    const html = `<html><body><main><p>In its early years the club had 30 members.</p></main></body></html>`;
    const got = extractCommitmentAndSize({
      doc: htmlToDocument(html, "https://x.test/about"),
      role: "about",
      fetchedAt: FETCHED,
      clubNames: ["Example Club"],
      clubAcronyms: [],
    });
    expect(got).toEqual([]);
  });
});

describe("text about a person or an archival project (1.16.48, g25)", () => {
  it("rejects the Wireless Club's professor and STAHR's logbook note", () => {
    expect(archivalSubjectProblem(PIERCE, WIRELESS)?.check).toBe("person_subject");
    expect(archivalSubjectProblem(LOGBOOKS, STAHR)?.check).toBe("archive_project");
    expect(archivalSubjectProblem("Dr. Jane Doe (1850–1920) was a physicist who taught radio at Harvard.")?.check).toBe(
      "person_subject",
    );
  });
  it("keeps club descriptions", () => {
    for (const t of [
      WIRELESS_ABOUT,
      "The Harvard College Wireless Club is the oldest amateur radio club in the country.",
      "STAHR is Harvard's undergraduate astronomy club; we run observing nights from the Science Center roof.",
      "Harvard Undergraduate Archives Club is a group of students who digitize and transcribe records for the University Archives.",
      "Members was the old name.",
      "Kennedy was the first president of the club's alumni board, and the club still meets weekly.",
      "Phillips Brooks House Association is a student-run public service organization.",
    ])
      expect(archivalSubjectProblem(t, [...WIRELESS, "Phillips Brooks House Association"]), t).toBeNull();
  });
});

describe("LLM grounding applies the same rules (g25)", () => {
  const empty = (): LlmExtraction => ({
    short_description: null,
    mission: null,
    join_modes: [],
    eligible_classes: null,
    prior_experience: null,
    hours_per_week: null,
    member_count: null,
    dues: null,
    recruiting: [],
    recruiting_seasons: null,
    selectivity: [],
    activities: [],
    sponsors: [],
  });
  it("rejects a history page's size and a past figure on any page", () => {
    const history: LlmPage = {
      url: "https://w1af.harvard.edu/php/history.php",
      role: "about",
      snapshotId: "h",
      text: AVERAGED,
    };
    const r = groundExtraction(
      { ...empty(), member_count: { exact: 25, min: null, max: null, quote: AVERAGED } },
      [history],
      FETCHED,
      WIRELESS,
    );
    expect(r.claims).toEqual([]);
    const about: LlmPage = { ...history, url: "https://w1af.harvard.edu/php/about.php", snapshotId: "a" };
    const r2 = groundExtraction(
      { ...empty(), member_count: { exact: 25, min: null, max: null, quote: AVERAGED } },
      [about],
      FETCHED,
      WIRELESS,
    );
    expect(r2.claims).toEqual([]);
    expect(r2.rejected.join(" ")).toMatch(/past figure/);
  });
  it("rejects a description from a history page and an archival note anywhere", () => {
    const page: LlmPage = {
      url: "https://sites.harvard.edu/stahr/about",
      role: "about",
      snapshotId: "s",
      text: LOGBOOKS,
    };
    const r = groundExtraction(
      { ...empty(), short_description: { value: LOGBOOKS, quote: LOGBOOKS } },
      [page],
      FETCHED,
      STAHR,
    );
    expect(r.claims).toEqual([]);
  });
  it("keeps a present count", () => {
    const text = "Founded in 1909, the club has over 100 active members.";
    const page: LlmPage = { url: "https://w1af.harvard.edu/", role: "home", snapshotId: "p", text };
    const r = groundExtraction(
      { ...empty(), member_count: { exact: null, min: 100, max: null, quote: text } },
      [page],
      FETCHED,
      WIRELESS,
    );
    expect(r.claims.map((c) => c.fieldKey)).toEqual(["club.member_count"]);
  });
});

describe("the audit reports stored ones, report-only at first", () => {
  const club: AuditClub = {
    id: "w1af",
    slug: "harvard-college-wireless-club",
    name: "Harvard College Wireless Club",
    acronym: null,
    aliases: [],
    projectedAliases: [],
    college: true,
    affiliation: "harvard_college",
    topCategories: [],
    categories: [],
    displayedClaimIds: new Set(),
    shortDescription: null,
    joining: null,
    activityStatus: "active",
  };
  const claim = (id: string, fieldKey: string, value: unknown, url: string, quote: string): AuditClaim => ({
    id,
    clubId: club.id,
    fieldKey,
    value,
    status: "active",
    assertionKind: "stated",
    termKey: null,
    firstObservedAt: FETCHED,
    lastObservedAt: FETCHED,
    createdAt: FETCHED,
    evidence: [
      {
        sourceId: url,
        sourceUrl: url,
        sourceType: "club_website",
        tier: 2,
        ownerClubId: club.id,
        method: "html_parse",
        extractor: "site-deterministic",
        quote,
        confidence: 0.9,
        isDirect: true,
        observedAt: FETCHED,
        snapshotId: null,
        snapshotSourceId: null,
        snapshotFetchedAt: FETCHED,
      },
    ],
  });
  const data = (claims: AuditClaim[]): AuditData => ({
    now: FETCHED,
    clubs: new Map([[club.id, club]]),
    claims,
    rejectedLinkClaims: [],
    rejectedDatePages: new Map(),
    links: [],
    cycles: [],
    decidedPairs: new Set(),
    snapshotText: new Map(),
    categoryTop: new Map(),
    articleText: new Map(),
    dismissed: new Set(),
    formState: new Map(),
  });
  const HISTORY = "https://w1af.harvard.edu/php/history.php";

  it("flags the history page's description and count, and a past count elsewhere", () => {
    const d = data([
      claim("d", "club.long_description", PIERCE, HISTORY, PIERCE),
      claim("m", "club.member_count", { kind: "exact", count: 25 }, HISTORY, AVERAGED),
      claim("p", "club.member_count", { kind: "exact", count: 25 }, "https://w1af.harvard.edu/php/about.php", AVERAGED),
      claim("l", "club.link", { url: "https://w1af.harvard.edu/" }, HISTORY, "home page"),
    ]);
    const facts = checkFacts(d);
    const byClaim = (id: string) =>
      facts.filter((f) => f.fix?.kind === "reject_claims" && f.fix.claimIds.includes(id)).map((f) => f.check);
    expect(byClaim("d")).toEqual(["evidence.history_page"]);
    // Its quote has a present verb elsewhere ("are taken from the Archives"); the past figure rule catches it.
    expect(byClaim("m")).toEqual(["facts.past_fact"]);
    expect(byClaim("p")).toEqual(["facts.past_fact"]);
    expect(byClaim("l")).toEqual([]);
    // Report-only: `--apply` fixes only high-confidence findings.
    expect(facts.every((f) => f.confidence !== "high" || !f.check.match(/history_page|past_fact/))).toBe(true);
  });
  it("flags the person and archive subjects as description findings", () => {
    const d = data([
      claim("d", "club.long_description", PIERCE, "https://w1af.harvard.edu/php/about.php", PIERCE),
      claim("ok", "club.long_description", WIRELESS_ABOUT, "https://w1af.harvard.edu/", WIRELESS_ABOUT),
    ]);
    const found = checkContent(d).map((f) => [f.check, f.confidence, f.fix?.kind]);
    expect(found).toEqual([["description.person_subject", "medium", "reject_claims"]]);
  });
});
