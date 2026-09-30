import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { schema, seedTaxonomy, type Db } from "@hci/db";
import { createTestDb } from "@hci/db/testing";
import { silentLogger } from "../src/logger";
import { htmlToDocument } from "../src/parse/document";
import {
  harvardOrgFromPage,
  orgLinkCandidates,
  orgNameFromSegment,
  orgNameFromTitle,
  possibleOrgHost,
} from "../src/sites/org-page";
import type { WebSearchProvider } from "../src/sites/search";
import { MemorySnapshotStore } from "../src/snapshots/store";
import { curatedPageMatch, runCurate } from "../src/stages/curate";
import { runWebDiscovery } from "../src/stages/web-discovery";
import type { FetchResult, SourceCandidate, SourceFetcher } from "../src/types";

const page = (title: string, body = "") =>
  `<html><head><title>${title}</title></head><body><main><p>${body}</p></main></body></html>`;
const doc = (html: string, url = "https://example.test/") => htmlToDocument(html, url);

describe("orgNameFromSegment", () => {
  it("accepts Harvard student-org names", () => {
    expect(orgNameFromSegment("Harvard Undergraduate Poker Club")).toBe("Harvard Undergraduate Poker Club");
    expect(orgNameFromSegment("Startups at Harvard")).toBe("Startups at Harvard");
    expect(orgNameFromSegment("Harvard College Democrats")).toBe("Harvard College Democrats");
    expect(orgNameFromSegment("Harvard-Radcliffe Asian American Association")).not.toBeNull();
    expect(orgNameFromSegment("Welcome to the Harvard Chess Club")).toBe("the Harvard Chess Club");
  });
  it("rejects alumni, graduate-school, office and non-name segments", () => {
    expect(orgNameFromSegment("Harvard Club of Boston")).toBeNull();
    expect(orgNameFromSegment("Harvard Business School Finance Club")).toBeNull();
    expect(orgNameFromSegment("Harvard Law Review")).toBeNull();
    expect(orgNameFromSegment("Harvard Varsity Club")).toBeNull();
    expect(orgNameFromSegment("Harvard Debate Council Summer Workshops")).toBeNull();
    expect(orgNameFromSegment("Harvard University")).toBeNull();
    expect(orgNameFromSegment("Home")).toBeNull();
    expect(orgNameFromSegment("Poker Club")).toBeNull();
    expect(orgNameFromSegment("How to join a Harvard club")).toBeNull();
  });
  it("prefers an org-noun segment over an 'at Harvard' tagline", () => {
    expect(orgNameFromTitle("Free Speech at Harvard | Harvard College Union Society")).toBe(
      "Harvard College Union Society",
    );
    expect(orgNameFromTitle("Home | Crimson Poker")).toBeNull();
  });
});

describe("possibleOrgHost", () => {
  it("allows club domains and HCS-hosted sites, not platforms, news, offices or grad schools", () => {
    expect(possibleOrgHost("https://harvardcollegepoker.com/")).toBe(true);
    expect(possibleOrgHost("https://socialgood.hcs.harvard.edu/")).toBe(true);
    expect(possibleOrgHost("https://hcs.harvard.edu/")).toBe(false);
    expect(possibleOrgHost("https://college.harvard.edu/")).toBe(false);
    expect(possibleOrgHost("https://www.instagram.com/x")).toBe(false);
    expect(possibleOrgHost("https://www.thecrimson.com/article/x")).toBe(false);
    expect(possibleOrgHost("https://harvardgsdreclub.com/")).toBe(false);
  });
});

describe("harvardOrgFromPage", () => {
  it("needs an org name in a heading and a page about students", () => {
    expect(
      harvardOrgFromPage(doc(page("Harvard Poker Club", "A community of undergraduate players."), "https://hpc.test/")),
    ).toEqual({ name: "Harvard Poker Club", quote: "Harvard Poker Club" });
    expect(harvardOrgFromPage(doc(page("Harvard Poker Club", "Buy chips online."), "https://hpc.test/"))).toBeNull();
    expect(
      harvardOrgFromPage(
        doc(page("HarvardCafe.com", "Premium Domain For Sale. Students"), "https://harvardcafe.test/"),
      ),
    ).toBeNull();
    // A town historical society in Harvard, MA: members, no students.
    expect(
      harvardOrgFromPage(
        doc(page("Harvard Historical Society", "Join as a member. Public programs."), "https://hhs.test/"),
      ),
    ).toBeNull();
    // Taglines are names only when the domain spells them.
    const tagline = page("Free Speech at Harvard", "A community of Harvard students.");
    expect(harvardOrgFromPage(doc(tagline, "https://theharvardunion.test/"))).toBeNull();
    expect(
      harvardOrgFromPage(doc(page("Startups at Harvard", "For students."), "https://startupsatharvard.test/")),
    ).toEqual({
      name: "Startups at Harvard",
      quote: "Startups at Harvard",
    });
  });
});

describe("orgLinkCandidates", () => {
  it("keeps external links whose anchor names an org or whose host says harvard", () => {
    const d = doc(
      `<html><body><main>
        <a href="https://harvardmun.test/">HMUN</a>
        <a href="https://sister.test/">Harvard Undergraduate Chess Club</a>
        <a href="https://sponsor.test/">Our sponsor</a>
        <a href="https://www.instagram.com/harvardx/">Harvard X Club</a>
        <a href="/about">Harvard About Club</a>
      </main></body></html>`,
      "https://club.test/",
    );
    expect(orgLinkCandidates("https://club.test/", d.links).map((c) => c.root)).toEqual([
      "https://harvardmun.test/",
      "https://sister.test/",
    ]);
  });
});

describe("curatedPageMatch", () => {
  it("accepts a heading with the club's full name even without a Harvard mention", () => {
    const names = { name: "Charles River Economics Labs", acronym: "CREL", aliases: [] };
    expect(curatedPageMatch(doc(page("Charles River Economics Labs", "Pro bono research")), names)).toBe(
      "Charles River Economics Labs",
    );
    expect(curatedPageMatch(doc(page("Home", "Pro bono research")), names)).toBeNull();
  });
  it("needs a Harvard mention for an acronym-only heading", () => {
    const names = {
      name: "Harvard Undergraduate Consulting on Business and the Environment",
      acronym: "HUCBE",
      aliases: [],
    };
    expect(curatedPageMatch(doc(page("Home | HUCBE", "Harvard students consulting")), names)).toBe("Home | HUCBE");
    expect(curatedPageMatch(doc(page("Home | HUCBE", "Consulting")), names)).toBeNull();
  });
});

// --- Stages, end to end (no network) ----------------------------------------------------------

const NOW = new Date("2026-09-30T16:00:00Z");

class HtmlFetcher implements SourceFetcher {
  constructor(private readonly pages: Record<string, string>) {}
  async fetch(c: SourceCandidate): Promise<FetchResult> {
    const html = this.pages[c.url.replace(/\/$/, "")];
    const base = {
      requestedUrl: c.url,
      finalUrl: c.url,
      etag: null,
      lastModified: null,
      fetchedAt: NOW,
      attempts: 1,
      durationMs: 0,
      method: "fixture" as const,
    };
    if (!html) return { ...base, status: "http_error", httpStatus: 404, contentType: null, body: null, error: "404" };
    return {
      ...base,
      status: "ok",
      httpStatus: 200,
      contentType: "text/html",
      body: new TextEncoder().encode(html),
      error: null,
    };
  }
}

describe("curate and discover-web stages", () => {
  let db: Db;
  let close: () => Promise<void>;
  beforeAll(async () => {
    ({ db, close } = await createTestDb());
    await seedTaxonomy(db);
  });
  afterAll(async () => close());
  const deps = (pages: Record<string, string>) => ({
    db,
    fetcher: new HtmlFetcher(pages),
    store: new MemorySnapshotStore(),
    logger: silentLogger,
    now: () => NOW,
  });

  it("curate creates a listed club with a verified site and an unfetched Instagram link", async () => {
    const d = deps({ "https://poker.test": page("Harvard Poker Club", "Undergraduate poker at Harvard.") });
    const entries = [
      {
        name: "Harvard Undergraduate Poker Club",
        aliases: ["Harvard Poker Club"],
        website: "https://poker.test/",
        instagram: "https://www.instagram.com/harvardpoker/",
      },
      { name: "Nowhere Club", website: "https://missing.test/" },
    ];
    const r = await runCurate(d, { entries });
    expect(r.outcomes.map((o) => o.action)).toEqual(["created", "skipped: no confirmed link"]);
    const [club] = await db.select().from(schema.club).where(eq(schema.club.slug, "harvard-undergraduate-poker-club"));
    expect(club?.dataOrigin).toBe("editorial");
    const links = await db
      .select()
      .from(schema.clubLink)
      .where(eq(schema.clubLink.clubId, club?.id ?? ""));
    expect(links.map((l) => [l.kind, l.status]).sort()).toEqual([
      ["instagram", "verified"],
      ["website", "verified"],
    ]);
    // Idempotent: a second run creates nothing new.
    const again = await runCurate(d, { entries });
    expect(again.outcomes[0]?.action).toBe("matched");
  });

  it("discover-web creates clubs from search results whose page names a Harvard org", async () => {
    const search: WebSearchProvider = {
      name: "fake",
      requestUrl: (q) => `https://search.test/?q=${encodeURIComponent(q)}`,
      search: async (q) => ({
        requestUrl: `https://search.test/?q=${encodeURIComponent(q)}`,
        raw: new Uint8Array(),
        results: [
          { url: "https://chess.test/about", title: "About | Harvard Undergraduate Chess Club" },
          { url: "https://news.test/story", title: "Chess is booming" },
          { url: "https://poker.test/", title: "Harvard Poker Club" },
        ],
      }),
    };
    const d = deps({
      "https://chess.test": page("Harvard Undergraduate Chess Club", "Weekly meetings for students."),
    });
    const r = await runWebDiscovery(d, { search, topics: ["chess"] });
    expect(r.counters.clubsCreated).toBe(1);
    // poker.test is already the curated club's site.
    expect(r.counters.candidatesKnownSite).toBe(1);
    expect(r.findings).toMatchObject([{ name: "Harvard Undergraduate Chess Club", outcome: "created" }]);
    const [link] = await db
      .select()
      .from(schema.clubLink)
      .innerJoin(schema.club, eq(schema.club.id, schema.clubLink.clubId))
      .where(eq(schema.club.slug, "harvard-undergraduate-chess-club"));
    expect(link?.club_link.status).toBe("probable");
  });
});
