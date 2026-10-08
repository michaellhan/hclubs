import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { createClub, resolveClubs, schema, seedTaxonomy, upsertClaim, upsertSource, type Db } from "@hci/db";
import { createTestDb } from "@hci/db/testing";
import { silentLogger } from "../src/logger";
import { htmlToDocument } from "../src/parse/document";
import {
  classifySearchResult,
  guessDomains,
  headingNamesClub,
  identityNames,
  searchQuery,
  siteIdentity,
  titleNamesClub,
  handleNamesClub,
  socialResultNamesClub,
} from "../src/sites/candidates";
import type { WebSearchProvider } from "../src/sites/search";
import { MemorySnapshotStore } from "../src/snapshots/store";
import { runFindSites } from "../src/stages/find-sites";
import type { FetchResult, SourceCandidate, SourceFetcher } from "../src/types";

const page = (title: string, body = "", h1 = "") =>
  `<html><head><title>${title}</title></head><body>${h1 ? `<h1>${h1}</h1>` : ""}<main><p>${body}</p></main></body></html>`;
const doc = (html: string, url = "https://example.test/") => htmlToDocument(html, url);

describe("guessDomains", () => {
  it("builds harvard-prefixed domains from the distinctive part of the name", () => {
    const d = guessDomains({ name: "Harvard Undergraduate Women in Business", acronym: null, aliases: [] });
    expect(d).toContain("harvardwomeninbusiness.org");
    expect(d).toContain("harvardwomenbusiness.org");
    expect(d.every((x) => /\.(org|com)$/.test(x))).toBe(true);
  });
  it("uses 'Harvard <sport> club' forms for club sports", () => {
    const d = guessDomains({ name: "Running (Club Sport)", acronym: null, aliases: [] });
    expect(d).toContain("harvardrunningclub.org");
    expect(d).not.toContain("harvardclubsport.org");
  });
  it("never guesses bare acronym domains from derived initials", () => {
    const d = guessDomains({ name: "Boston Refugee Youth Enrichment", acronym: "BRYE", aliases: [] });
    expect(d).not.toContain("brye.org");
    expect(guessDomains({ name: "Harvard Undergraduate Women in Business", acronym: "HUWIB", aliases: [] })).toContain(
      "huwib.org",
    );
  });
  it("returns nothing for names that are only institution words", () => {
    expect(guessDomains({ name: "Harvard College", acronym: null, aliases: [] })).toEqual([]);
  });
});

describe("siteIdentity", () => {
  const club = { name: "Harvard Opportunes", acronym: null, aliases: [] };
  it("accepts a home page whose title names the club and mentions Harvard", () => {
    expect(
      siteIdentity(doc(page("The Harvard Opportunes | Home", "Harvard's oldest co-ed a cappella group")), club),
    ).toBe("The Harvard Opportunes | Home");
  });
  it("rejects parked domains even when the title contains the name", () => {
    expect(
      siteIdentity(doc(page("HarvardOpportunes.com is for sale", "This domain is for sale. Harvard")), club),
    ).toBeNull();
    expect(siteIdentity(doc(page("Harvard Opportunes", "Buy this domain today")), club)).toBeNull();
  });
  it("rejects pages that never mention Harvard", () => {
    const other = { name: "Veritas Financial Group", acronym: null, aliases: [] };
    expect(
      siteIdentity(doc(page("Veritas Financial Group | Wealth management", "Advisors in Ohio")), other),
    ).toBeNull();
    expect(
      siteIdentity(doc(page("Veritas Financial Group", "An undergraduate investment club at Harvard College")), other),
    ).toBe("Veritas Financial Group");
  });
  it("needs 'Harvard' in the title for an acronym-only match", () => {
    const acr = { name: "Harvard College Developers for Development", acronym: "D4D", aliases: [] };
    expect(siteIdentity(doc(page("D4D", "We build software. Harvard")), acr)).toBeNull();
    expect(siteIdentity(doc(page("Harvard D4D", "We build software.")), acr)).toBe("Harvard D4D");
  });
  it("matches club sports by 'Harvard <sport> Club'", () => {
    const sport = { name: "Running (Club Sport)", acronym: null, aliases: [] };
    expect(identityNames(sport)).toContain("Harvard Running Club");
    expect(siteIdentity(doc(page("Harvard Running Club", "Runs from the Harvard MAC")), sport)).toBe(
      "Harvard Running Club",
    );
    expect(siteIdentity(doc(page("Harvard Running", "Varsity cross country")), sport)).toBeNull();
  });
});

describe("search results", () => {
  const club = { name: "Harvard Opportunes", acronym: null, aliases: [] };
  it("keeps social profiles only when the result title names the club", () => {
    const ok = classifySearchResult(
      { url: "https://www.instagram.com/harvardopportunes/", title: "The Harvard Opportunes (@harvardopportunes)" },
      club,
    );
    expect(ok).toMatchObject({ kind: "social", link: { kind: "instagram", handle: "harvardopportunes" } });
    expect(
      classifySearchResult(
        { url: "https://www.instagram.com/someone/", title: "Someone (@someone) • Instagram" },
        club,
      ),
    ).toBeNull();
    expect(
      classifySearchResult(
        { url: "https://www.instagram.com/p/Cabc123/", title: "Harvard Opportunes on Instagram" },
        club,
      ),
    ).toBeNull();
  });
  it("reduces sites to their root and drops news/platform hosts", () => {
    expect(
      classifySearchResult({ url: "https://www.opportunes.org/about/history", title: "History" }, club),
    ).toMatchObject({ kind: "site", root: "https://opportunes.org/" });
    expect(
      classifySearchResult({ url: "https://www.oppies.net/", title: "The Harvard Opportunes | Home" }, club),
    ).toMatchObject({ kind: "site", root: "https://oppies.net/" });
    // Unrelated namesakes: neither the title nor the host mentions the club.
    expect(classifySearchResult({ url: "https://thecarycollection.com/", title: "Vintage finds" }, club)).toBeNull();
    const t4sg = { name: "Harvard Computer Society Tech for Social Good", acronym: "T4SG", aliases: [] };
    expect(classifySearchResult({ url: "https://www.t4sg.org/projects", title: "Projects" }, t4sg)).toMatchObject({
      kind: "site",
    });
    expect(
      classifySearchResult(
        { url: "https://www.thecrimson.com/article/2025/1/1/opportunes/", title: "Opportunes" },
        club,
      ),
    ).toBeNull();
    expect(classifySearchResult({ url: "https://en.wikipedia.org/wiki/Opportunes", title: "x" }, club)).toBeNull();
    expect(classifySearchResult({ url: "https://college.harvard.edu/x", title: "x" }, club)).toBeNull();
  });
  it("builds a quoted query and adds Harvard when the name lacks it", () => {
    expect(searchQuery(club)).toBe('"Harvard Opportunes"');
    expect(searchQuery({ name: "Veritas Financial Group", acronym: null, aliases: [] })).toBe(
      '"Veritas Financial Group" Harvard',
    );
    expect(titleNamesClub("Opportunes – a cappella", club)).toBe(false);
  });
});

// --- Stage, end to end (no network) ----------------------------------------------------------

const NOW = new Date("2026-09-30T16:00:00Z");

class HtmlFetcher implements SourceFetcher {
  readonly requested: string[] = [];
  constructor(private readonly pages: Record<string, string>) {}
  async fetch(c: SourceCandidate): Promise<FetchResult> {
    this.requested.push(c.url);
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

describe("find-sites stage", () => {
  let db: Db;
  let close: () => Promise<void>;
  beforeAll(async () => {
    ({ db, close } = await createTestDb());
    await seedTaxonomy(db);
  });
  afterAll(async () => close());

  async function club(name: string): Promise<string> {
    const { id } = await createClub(db, { name });
    const src = await upsertSource(db, { url: "https://directory.harvard.test/orgs", sourceType: "harvard_official" });
    await upsertClaim(
      db,
      { clubId: id, fieldKey: "club.name", value: name, assertionKind: "stated" },
      {
        sourceId: src,
        sourceType: "harvard_official",
        snapshotId: null,
        ingestionRunId: null,
        observedAt: NOW,
        extractionMethod: "manual",
        extractorName: "test",
        extractorVersion: "1",
        isDirect: true,
      },
    );
    await resolveClubs(db, { clubIds: [id], now: NOW });
    return id;
  }

  it("accepts a guessed domain only when its page names the club, as a probable link", async () => {
    const id = await club("Harvard Undergraduate Beekeepers");
    const fetcher = new HtmlFetcher({
      // Resolves but belongs to someone else: must be rejected.
      "https://harvardbeekeepers.com": page("Beekeeping supplies", "Shop hives"),
      "https://harvardbeekeepers.org": page("Harvard Undergraduate Beekeepers", "We keep bees at Harvard."),
    });
    const resolvable = new Set(["harvardbeekeepers.com", "harvardbeekeepers.org"]);
    const r = await runFindSites(
      {
        db,
        fetcher,
        store: new MemorySnapshotStore(),
        logger: silentLogger,
        now: () => NOW,
        resolveHost: async (h) => resolvable.has(h),
      },
      { clubSlug: "harvard-undergraduate-beekeepers" },
    );
    expect(r.status).toBe("succeeded");
    expect(r.counters.sitesFound).toBe(1);
    const links = await db
      .select()
      .from(schema.clubLink)
      .where(and(eq(schema.clubLink.clubId, id), eq(schema.clubLink.kind, "website")));
    expect(links).toHaveLength(1);
    expect(links[0]?.url).toBe("https://harvardbeekeepers.org/");
    expect(links[0]?.status).toBe("probable");
    // Only resolving hosts are fetched.
    expect(fetcher.requested.every((u) => /harvardbeekeepers\.(org|com)/.test(u))).toBe(true);

    // Idempotent: a second run finds the club already has a probable site and does nothing.
    const again = await runFindSites(
      {
        db,
        fetcher,
        store: new MemorySnapshotStore(),
        logger: silentLogger,
        now: () => NOW,
        resolveHost: async () => true,
      },
      { clubSlug: "harvard-undergraduate-beekeepers" },
    );
    expect(again.counters.clubsConsidered).toBe(0);
  });

  it("uses search results: social profiles as unverified links, sites only after the page check", async () => {
    const id = await club("Harvard Undergraduate Falconry Society");
    const search: WebSearchProvider = {
      name: "fake",
      paid: true,
      requestUrl: (q) => `https://search.example.test/?q=${encodeURIComponent(q)}`,
      search: async (q) => ({
        requestUrl: `https://search.example.test/?q=${encodeURIComponent(q)}`,
        raw: new Uint8Array(),
        results: [
          { url: "https://www.thecrimson.com/article/falconry", title: "Harvard Undergraduate Falconry Society soars" },
          { url: "https://falconry.example.test/about", title: "About us" },
          {
            url: "https://www.instagram.com/harvardfalconry/",
            title: "Harvard Undergraduate Falconry Society (@harvardfalconry)",
          },
          { url: "https://www.instagram.com/falconfan/", title: "Falcon Fan (@falconfan)" },
        ],
      }),
    };
    const fetcher = new HtmlFetcher({
      "https://falconry.example.test": page("Harvard Undergraduate Falconry Society", "Birds of prey at Harvard"),
    });
    const r = await runFindSites(
      {
        db,
        fetcher,
        store: new MemorySnapshotStore(),
        logger: silentLogger,
        now: () => NOW,
        resolveHost: async () => false,
      },
      { clubSlug: "harvard-undergraduate-falconry-society", search },
    );
    expect(r.counters.searches).toBe(1);
    expect(r.counters.sitesFoundBySearch).toBe(1);
    expect(r.counters.socialLinksFound).toBe(1);
    const links = await db.select().from(schema.clubLink).where(eq(schema.clubLink.clubId, id));
    const byKind = Object.fromEntries(links.map((l) => [l.kind, l]));
    expect(byKind.website?.url).toBe("https://falconry.example.test/");
    expect(byKind.website?.status).toBe("probable");
    expect(byKind.instagram?.url).toBe("https://www.instagram.com/harvardfalconry");
    expect(byKind.instagram?.status).toBe("unverified");
    // The news site was never fetched.
    expect(fetcher.requested.some((u) => u.includes("thecrimson"))).toBe(false);
  });
});

describe("heading rules (v2)", () => {
  it("needs a heading segment to BE the club's name, not merely contain it", () => {
    const crimson = { name: "Harvard Crimson", acronym: null, aliases: [] };
    expect(headingNamesClub("The Harvard Crimson Global Essay Comp | Join the Global Writing Challenge", crimson)).toBe(
      false,
    );
    expect(headingNamesClub("The Harvard Crimson", crimson)).toBe(true);
    const chap = { name: "Chinatown Afterschool Program (CHAP)", acronym: "CHAP", aliases: [] };
    expect(headingNamesClub("PBHA Chinatown Afterschool Program", chap)).toBe(true);
    const cit = { name: "Chinatown Citizenship", acronym: null, aliases: [] };
    expect(headingNamesClub("CHINATOWN CITIZENSHIP, A PBHA PROGRAM", cit)).toBe(true);
    const ryi = { name: "Roxbury Youth Initiative", acronym: null, aliases: [] };
    expect(headingNamesClub("Roxbury Youth Initiative Term-Time", ryi)).toBe(true);
  });
  it("tells club sports from varsity teams", () => {
    const curling = { name: "Curling (Club Sport)", acronym: null, aliases: [] };
    expect(headingNamesClub("Harvard Curling", curling, "Harvard Curling is a university-recognized club sport")).toBe(
      true,
    );
    const squash = { name: "Squash (Club Sport)", acronym: null, aliases: [] };
    expect(headingNamesClub("Home - Harvard Squash", squash, "MEN'S SEASON RECORD Ivy League 0 - 0")).toBe(false);
    const cdt = { name: "Crimson Dance Team (Club Sport)", acronym: null, aliases: [] };
    expect(headingNamesClub("Home | Harvard Crimson Dance Team", cdt)).toBe(true);
    // A plain alias of a club sport is still a sport name, not the club's.
    const baseball = { name: "Baseball (Club Sport)", acronym: null, aliases: ["Baseball"] };
    expect(titleNamesClub("Harvard Baseball (@HarvardBaseball)", baseball)).toBe(false);
    expect(handleNamesClub("harvardbaseball", "Harvard Baseball (@HarvardBaseball)", baseball)).toBe(false);
  });
  it("accepts an account whose handle is harvard + the club's distinctive name", () => {
    // The account drops "Club": the title test alone missed it (owner report, 2026-10-07).
    const cheer = { name: "Harvard Cheerleading Club", acronym: null, aliases: ["Harvard Cheer Club"] };
    const res = {
      url: "https://www.instagram.com/harvardcheerleading/",
      title: "Harvard Cheerleading (@harvardcheerleading) • Instagram photos and videos",
    };
    const c = classifySearchResult(res, cheer);
    expect(c?.kind === "social" ? c.link.handle : null).toBe("harvardcheerleading");
    // A handle that merely contains the name, or a title without Harvard, isn't enough.
    expect(handleNamesClub("harvardcheerleadingalumni", res.title, cheer)).toBe(false);
    expect(handleNamesClub("harvardcheerleading", "Cheerleading (@harvardcheerleading)", cheer)).toBe(false);
    // Short names (under six letters) are too generic to match on a handle.
    const chess = { name: "Harvard Chess Club", acronym: null, aliases: [] };
    expect(handleNamesClub("harvardchess", "Harvard Chess (@harvardchess)", chess)).toBe(false);
    // Club sports: "@harvardbaseball" is the varsity team.
    const baseball = { name: "Harvard Baseball Club", acronym: null, aliases: [], sport: true };
    expect(handleNamesClub("harvardbaseball", "Harvard Baseball (@harvardbaseball)", baseball)).toBe(false);
  });
  it("keeps other schools' same-named clubs and posts about a club out of its accounts", () => {
    const bmes = { name: "Biomedical Engineering Society", acronym: null, aliases: [] };
    expect(socialResultNamesClub("bmestamu", "Biomedical Engineering Society (@bmestamu)", bmes)).toBe(false);
    const ghungroo = { name: "Harvard Undergraduate Ghungroo", acronym: null, aliases: [] };
    expect(socialResultNamesClub("harvardcollege", "We are Harvard Undergraduate Ghungroo ...", ghungroo)).toBe(false);
    expect(
      socialResultNamesClub("harvardghungroo", "Harvard Undergraduate Ghungroo (@harvardghungroo)", ghungroo),
    ).toBe(true);
    const campaigns = { name: "Campaigns and Advocacy Program", acronym: null, aliases: [] };
    expect(
      socialResultNamesClub("harvardcampaigns", "Campaigns & Advocacy Program (@harvardcampaigns)", campaigns),
    ).toBe(true);
  });
  it("never treats directory program pages or music platforms as a club's site", () => {
    const club = { name: "Chinatown Teen", acronym: null, aliases: [] };
    expect(
      classifySearchResult({ url: "https://pbha.org/programs/chinatown-teen/", title: "Chinatown Teen — PBHA" }, club),
    ).toBeNull();
    // facebook.com/p/<Name>-<id> is a page (Facebook's URL for pages without a username): a
    // social candidate with its whole path, never a website and never cut to "/p" (ADR 0033).
    const fb = classifySearchResult(
      { url: "https://www.facebook.com/p/Chinatown-Teen-100064757543210/", title: "Chinatown Teen | Facebook" },
      club,
    );
    expect(fb?.kind === "social" ? fb.link.url : null).toBe(
      "https://www.facebook.com/p/Chinatown-Teen-100064757543210",
    );
  });
});

describe("find-sites --instagram", () => {
  it("searches one club per query and credits a profile only to the club its title names", async () => {
    const { createTestDb } = await import("@hci/db/testing");
    const { createClub, seedTaxonomy } = await import("@hci/db");
    const { runFindInstagram } = await import("../src/stages/find-sites");
    const { db, close } = await createTestDb();
    try {
      await seedTaxonomy(db);
      for (const n of ["Harvard Falconry Society", "Harvard Kite Club", "Harvard Yodel Club"])
        await createClub(db, { name: n });
      const queries: string[] = [];
      const search: WebSearchProvider = {
        name: "fake",
        paid: true,
        requestUrl: (q) => `https://search.example.test/?q=${encodeURIComponent(q)}`,
        search: async (q) => {
          queries.push(q);
          return {
            requestUrl: `https://search.example.test/?q=${encodeURIComponent(q)}`,
            raw: new Uint8Array(),
            results: [
              {
                url: "https://www.instagram.com/harvardkites/",
                title: "Harvard Kite Club (@harvardkites) • Instagram",
              },
              { url: "https://www.instagram.com/kitesofboston/", title: "Kites of Boston (@kitesofboston)" },
            ],
          };
        },
      };
      const r = await runFindInstagram(
        { db, store: new MemorySnapshotStore(), logger: silentLogger, now: () => NOW },
        { search },
      );
      // One unquoted query per club: five-club OR batches mostly came back empty.
      expect(queries).toHaveLength(3);
      expect(queries).toContain("site:instagram.com Harvard Kite Club");
      expect(r.counters.clubsWithProfile).toBe(1);
      const links = await db.select().from(schema.clubLink).where(eq(schema.clubLink.kind, "instagram"));
      expect(links).toHaveLength(1);
      expect(links[0]?.url).toMatch(/instagram\.com\/harvardkites\/?$/);
    } finally {
      await close();
    }
  });
});
