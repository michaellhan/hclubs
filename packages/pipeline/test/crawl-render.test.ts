import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { recordSnapshot, schema, startRun, upsertSource, type Db } from "@hci/db";
import { createTestDb } from "@hci/db/testing";
import { crawlSite, emptyCrawlStats } from "../src/crawl/site";
import { NoNetworkFetcher } from "../src/fetch/no-network-fetcher";
import { silentLogger } from "../src/logger";
import { MemorySnapshotStore } from "../src/snapshots/store";
import type { FetchResult, SourceFetcher } from "../src/types";

/**
 * A JS-only page (hcsproductlab.org/apply, 2026-09-30): the browser render holds the text, a
 * later static re-fetch is an empty shell. Replays must read the render, not the shell.
 */
let db: Db;
let close: () => Promise<void>;
const store = new MemorySnapshotStore();
const URL_ = "https://example-jsclub.test/apply";
const RENDER = `<html><head><title>Apply</title></head><body><main><h1>Apply</h1><p>Applications for the Fall 2026 semester have closed. Product Lab is open to all Harvard College undergraduates, regardless of concentration.</p></main></body></html>`;
const SHELL = `<html><head><title>Apply</title></head><body><div id="root"></div><script src="/a.js"></script><script src="/b.js"></script><script src="/c.js"></script></body></html>`;

beforeAll(async () => {
  ({ db, close } = await createTestDb());
});
afterAll(async () => close());

async function snapshot(sourceId: string, html: string, at: string, method: "static" | "browser", url = URL_) {
  const put = await store.put(new TextEncoder().encode(html));
  await recordSnapshot(db, {
    sourceId,
    ingestionRunId: null,
    fetchedAt: new Date(at),
    finalUrl: url,
    httpStatus: 200,
    contentType: "text/html",
    contentSha256: put.sha256,
    byteSize: put.byteSize,
    storageKey: put.key,
    extractedText: null,
    fetchMethod: method,
  });
}

async function crawlOnce(url: string, fetcher: SourceFetcher, offline: boolean) {
  const runId = await startRun(db, { job: "test", adapter: "test", adapterVersion: "1", options: {} });
  return crawlSite({
    rootUrl: url,
    rootRole: "recruiting",
    clubId: "00000000-0000-7000-8000-000000000000",
    officialSite: false,
    sourceTypeOverride: "club_website",
    db,
    fetcher,
    store,
    runId,
    logger: silentLogger,
    now: () => new Date("2026-10-12T12:00:00Z"),
    maxPages: 1,
    maxDepth: 0,
    freshnessMs: 0,
    force: false,
    offline,
    stats: emptyCrawlStats(),
  });
}

async function jsPage(url: string, newer: string) {
  const sourceId = await upsertSource(db, { url, sourceType: "club_website" });
  await snapshot(sourceId, RENDER, "2026-09-30T11:00:00Z", "browser", url);
  await snapshot(sourceId, newer, "2026-09-30T22:00:00Z", "static", url);
  await db.update(schema.source).set({ needsBrowser: true }).where(eq(schema.source.id, sourceId));
  return sourceId;
}

const needsBrowser = async (sourceId: string) =>
  (await db.select().from(schema.source).where(eq(schema.source.id, sourceId)))[0]?.needsBrowser;

/** A server that answers 304 Not Modified to every request. */
const notModified: SourceFetcher = {
  fetch: async (c): Promise<FetchResult> => ({
    status: "not_modified",
    requestedUrl: c.url,
    finalUrl: c.url,
    httpStatus: 304,
    contentType: null,
    etag: null,
    lastModified: null,
    body: null,
    fetchedAt: new Date("2026-10-12T12:00:00Z"),
    attempts: 1,
    durationMs: 1,
    error: null,
    method: "static",
  }),
};

describe("stored browser renders", () => {
  it("a 304 on the static shell reads the render, keeping its date and the flag", async () => {
    const url = "https://example-jsclub.test/join";
    const sourceId = await jsPage(url, SHELL);
    const pages = await crawlOnce(url, notModified, false);
    expect(pages[0]?.doc.text).toContain("Applications for the Fall 2026 semester have closed.");
    expect(pages[0]?.fetchedAt.toISOString()).toBe("2026-09-30T11:00:00.000Z");
    expect(await needsBrowser(sourceId)).toBe(true);
  });

  it("a newer static copy with real content wins over an old render, and clears the flag", async () => {
    const url = "https://example-jsclub.test/about";
    const content = `<html><head><title>About</title></head><body><main><h1>About</h1><p>We now publish our page as plain HTML. Membership is open to all Harvard undergraduates, no experience needed.</p><p>We meet every Tuesday evening in the Science Center to build small projects together, share what we learned that week, and plan the term's workshops and socials.</p></main></body></html>`;
    const sourceId = await jsPage(url, content);
    const pages = await crawlOnce(url, new NoNetworkFetcher(), true);
    expect(pages[0]?.doc.text).toContain("We now publish our page as plain HTML.");
    expect(pages[0]?.fetchedAt.toISOString()).toBe("2026-09-30T22:00:00.000Z");
    expect(await needsBrowser(sourceId)).toBe(false);
  });

  it("an offline replay reads the newest render, not a newer empty static shell", async () => {
    const sourceId = await upsertSource(db, { url: URL_, sourceType: "club_website" });
    await snapshot(sourceId, RENDER, "2026-09-30T11:00:00Z", "browser");
    await snapshot(sourceId, SHELL, "2026-09-30T22:00:00Z", "static");
    await db.update(schema.source).set({ needsBrowser: true }).where(eq(schema.source.id, sourceId));
    const runId = await startRun(db, { job: "test", adapter: "test", adapterVersion: "1", options: {} });
    const pages = await crawlSite({
      rootUrl: URL_,
      rootRole: "recruiting",
      clubId: "00000000-0000-7000-8000-000000000000",
      officialSite: false,
      sourceTypeOverride: "club_website",
      db,
      fetcher: new NoNetworkFetcher(),
      store,
      runId,
      logger: silentLogger,
      now: () => new Date("2026-10-12T12:00:00Z"),
      maxPages: 1,
      maxDepth: 0,
      freshnessMs: 0,
      force: false,
      offline: true,
      stats: emptyCrawlStats(),
    });
    expect(pages).toHaveLength(1);
    expect(pages[0]?.doc.text).toContain("Applications for the Fall 2026 semester have closed.");
    expect(pages[0]?.fetchedAt.toISOString()).toBe("2026-09-30T11:00:00.000Z");
    // The static page still needs the browser: reading its render doesn't clear the flag.
    const [src] = await db.select().from(schema.source).where(eq(schema.source.id, sourceId));
    expect(src?.needsBrowser).toBe(true);
  });
});
