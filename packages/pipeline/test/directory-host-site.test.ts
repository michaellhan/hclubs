import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq, like } from "drizzle-orm";
import {
  createClub,
  getClubProfile,
  resolveClubs,
  schema,
  seedTaxonomy,
  startRun,
  upsertClaim,
  upsertSource,
  type Db,
} from "@hci/db";
import { createTestDb } from "@hci/db/testing";
import { crawlSite, emptyCrawlStats } from "../src/crawl/site";
import { FixtureFetcher } from "../src/fetch/fixture-fetcher";
import { silentLogger } from "../src/logger";
import { MemorySnapshotStore } from "../src/snapshots/store";
import { directoryHostedSite, runEnrichment } from "../src/stages/enrich";
import { runRecruiting } from "../src/stages/recruiting";
import type { SourceFetcher } from "../src/types";

/**
 * A club whose own website is a directory host's home (PBHA is pbha.org, also the host of the
 * pbha-programs adapter). The general crawl skips such hosts, so pbha.org/apply ("The deadline
 * for PBHA's volunteer application for Fall 2026 was Friday, September 18, 2026.") was never
 * read and PBHA showed no Fall 2026 round. Its joining page is read now; the program pages
 * on the same host are not read as PBHA's.
 */
const fixtures = fileURLToPath(new URL("./fixtures/directory-host-site/", import.meta.url));
const NOW = new Date("2026-10-13T16:00:00Z");
const files = {
  "https://www.pbha.org/": `${fixtures}home.html`,
  "https://pbha.org/": `${fixtures}home.html`,
  "https://pbha.org/apply": `${fixtures}apply.html`,
  "https://pbha.org/programs/leaders": `${fixtures}program.html`,
  "https://pbha.org/programs/mentors": `${fixtures}program.html`,
};

describe("directoryHostedSite", () => {
  it("is a verified website at a directory host's home", () => {
    expect(directoryHostedSite("https://www.pbha.org/", "verified")).toBe("harvard_official");
    expect(directoryHostedSite("https://iop.harvard.edu", "verified")).toBe("harvard_official");
  });
  it("never a program page, an unverified link, a crawlable club site or a portal", () => {
    expect(directoryHostedSite("https://pbha.org/programs/leaders", "verified")).toBeNull();
    expect(directoryHostedSite("https://www.pbha.org/", "probable")).toBeNull();
    expect(directoryHostedSite("https://example-robotics.test/", "verified")).toBeNull();
    expect(directoryHostedSite("https://hcs.harvard.edu", "verified")).toBeNull(); // crawled normally
    expect(directoryHostedSite("https://college.harvard.edu", "verified")).toBeNull();
    expect(directoryHostedSite("https://en.wikipedia.org/", "verified")).toBe("public_web");
  });
});

async function addPbha(db: Db): Promise<string> {
  const { id } = await createClub(db, { name: "Phillips Brooks House Association" });
  const src = await upsertSource(db, { url: "https://directory.harvard.test/orgs", sourceType: "harvard_official" });
  for (const [fieldKey, value] of [
    ["club.name", "Phillips Brooks House Association"],
    ["club.acronym", "PBHA"],
    ["club.link", { kind: "website", url: "https://www.pbha.org/" }],
  ] as const) {
    await upsertClaim(
      db,
      { clubId: id, fieldKey, value, assertionKind: "stated" },
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
  }
  await resolveClubs(db, { clubIds: [id], now: NOW });
  return id;
}

async function expectClosedFall2026Round(db: Db, clubId: string) {
  const [club] = await db.select().from(schema.club).where(eq(schema.club.id, clubId));
  const found = await getClubProfile(db, club!.slug, NOW);
  if (found.kind !== "found") throw new Error("missing");
  const p = found.profile;
  expect(p.currentCycle?.termKey).toBe("2026-fall");
  expect(p.currentCycle?.deadline).toMatchObject({ at: "2026-09-18", precision: "date" });
  expect(p.currentCycle?.status).toBe("closed");
  expect(p.joinModes).toContain("application");
}

const programSources = (db: Db) =>
  db.select().from(schema.source).where(like(schema.source.url, "%pbha.org/programs/%"));

describe("enrichment reads a directory-hosted club site's joining page only", () => {
  let db: Db;
  let close: () => Promise<void>;
  beforeAll(async () => {
    ({ db, close } = await createTestDb());
    await seedTaxonomy(db);
  });
  afterAll(async () => close());

  it("records the round from /apply and never reads the program pages as the club's", async () => {
    const clubId = await addPbha(db);
    const r = await runEnrichment(
      {
        db,
        fetcher: new FixtureFetcher(files, NOW),
        store: new MemorySnapshotStore(),
        logger: silentLogger,
        now: () => NOW,
      },
      { clubSlug: "phillips-brooks-house-association" },
    );
    expect(r.counters.clubsEnriched).toBe(1);
    expect(await programSources(db)).toEqual([]);
    const [apply] = await db.select().from(schema.source).where(eq(schema.source.url, "https://pbha.org/apply"));
    expect(apply).toMatchObject({ sourceType: "harvard_official", ownerClubId: clubId });
    // The home page's links (a youth program's enrolment form) aren't the club's application.
    const forms = await db
      .select()
      .from(schema.clubLink)
      .where(and(eq(schema.clubLink.clubId, clubId), like(schema.clubLink.url, "%tfaforms%")));
    expect(forms).toEqual([]);
    await expectClosedFall2026Round(db, clubId);
  });
});

describe("--offline reaches the club's stored joining page without its home page", () => {
  let db: Db;
  let close: () => Promise<void>;
  beforeAll(async () => {
    ({ db, close } = await createTestDb());
    await seedTaxonomy(db);
  });
  afterAll(async () => close());

  it("seeds the crawl with the club's own stored pages on that host", async () => {
    const clubId = await addPbha(db);
    const store = new MemorySnapshotStore();
    // Only /apply was ever stored (as `hci facts` did), owned by the club at the directory's tier.
    await crawlSite({
      rootUrl: "https://pbha.org/apply",
      clubId,
      officialSite: true,
      sourceTypeOverride: "harvard_official",
      db,
      fetcher: new FixtureFetcher(files, NOW),
      store,
      runId: await startRun(db, { job: "facts" }),
      logger: silentLogger,
      now: () => NOW,
      maxPages: 1,
      maxDepth: 0,
      freshnessMs: 0,
      force: false,
      stats: emptyCrawlStats(),
    });
    const offlineFetcher: SourceFetcher = {
      fetch: () => {
        throw new Error("offline run made a request");
      },
    };
    const r = await runEnrichment(
      { db, fetcher: offlineFetcher, store, logger: silentLogger, now: () => NOW },
      { clubSlug: "phillips-brooks-house-association", offline: true },
    );
    expect(r.errors).toEqual([]);
    expect(r.counters.clubsEnriched).toBe(1);
    await expectClosedFall2026Round(db, clubId);
  });
});

describe("the recruiting pass reads a directory-hosted club site's joining page", () => {
  let db: Db;
  let close: () => Promise<void>;
  beforeAll(async () => {
    ({ db, close } = await createTestDb());
    await seedTaxonomy(db);
  });
  afterAll(async () => close());

  it("plans and reads pbha.org/apply, not the program pages", async () => {
    const clubId = await addPbha(db);
    const deps = {
      db,
      fetcher: new FixtureFetcher(files, NOW),
      store: new MemorySnapshotStore(),
      logger: silentLogger,
      now: () => NOW,
    };
    const dry = await runRecruiting(deps, { clubSlug: "phillips-brooks-house-association", dryRun: true });
    expect(dry.planned[0]?.site).toMatch(/pbha\.org.*joining pages only/);
    const r = await runRecruiting(deps, { clubSlug: "phillips-brooks-house-association" });
    expect(r.counters.websitesExamined).toBe(1);
    expect(await programSources(db)).toEqual([]);
    await expectClosedFall2026Round(db, clubId);
  });
});
