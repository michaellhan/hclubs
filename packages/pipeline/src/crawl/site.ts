import { desc, eq } from "drizzle-orm";
import { normalizeUrl, siteKey, type SourceType } from "@hci/core";
import { recordFetchAttempt, recordSnapshot, schema, upsertSource, type Db } from "@hci/db";
import type { Logger } from "../logger";
import type { PageRole } from "../extract/deterministic";
import { htmlToDocument, type PageDocument } from "../parse/document";
import type { SnapshotStore } from "../snapshots/store";
import type { SourceFetcher } from "../types";

/**
 * Shallow, prioritized crawler for a club's own website (M2 §5). Never recursive beyond
 * `maxDepth`, never leaves the site boundary, skips binaries, dedupes by content hash,
 * honors per-page freshness windows, and records every attempt.
 */

export interface CrawledPage {
  url: string;
  role: PageRole;
  depth: number;
  sourceId: string;
  sourceType: SourceType;
  snapshotId: string;
  fetchedAt: Date;
  doc: PageDocument;
  /** New content since the last snapshot (false for 304 / identical hash / fresh reuse). */
  changed: boolean;
}

export interface CrawlStats {
  pagesFetched: number;
  pagesUnchanged: number;
  pagesSkippedFresh: number;
  pagesFailed: number;
  pagesNeedBrowser: number;
  pagesRobotsBlocked: number;
}

export const emptyCrawlStats = (): CrawlStats => ({
  pagesFetched: 0,
  pagesUnchanged: 0,
  pagesSkippedFresh: 0,
  pagesFailed: 0,
  pagesNeedBrowser: 0,
  pagesRobotsBlocked: 0,
});

const BINARY =
  /\.(pdf|jpe?g|png|gif|webp|svg|ico|zip|gz|docx?|xlsx?|pptx?|mp[34]|m4a|mov|avi|wav|ics|dmg|exe|css|js|json|xml|rss)(\?|$)/i;

const ROLE_PATTERNS: [PageRole, RegExp, number][] = [
  ["recruiting", /\b(apply|applications?|recruit(?:ing|ment)?|comp(?:ing)?|audition|tryouts?|join-?us-?now)\b/i, 10],
  ["join", /\b(join|get-?involved|membership|become-a-member|how-to-join)\b/i, 9],
  ["about", /\b(about|mission|who-?we-?are|our-?story|history)\b/i, 8],
  ["faq", /\b(faq|frequently-asked|questions)\b/i, 7],
  ["projects", /\b(projects?|our-?work|portfolio|clients|publications?|performances?|competitions?|programs?)\b/i, 5],
  ["sponsors", /\b(sponsors?|partners?|supporters|donors)\b/i, 5],
  ["events", /\b(events?|calendar|speakers?)\b/i, 4],
  ["team", /\b(team|board|leadership|officers|people|staff|members|executive)\b/i, 3],
  ["contact", /\b(contact|connect)\b/i, 2],
];

export function classifyPageRole(url: string, anchorText = "", title = ""): PageRole {
  let path = "";
  try {
    path = new URL(url).pathname.replace(/[_/]+/g, "-");
  } catch {
    return "other";
  }
  if (path === "" || path === "-" || /^-(index|home)(\.html?)?-?$/i.test(path)) return "home";
  const hay = `${path} ${anchorText} ${title}`;
  for (const [role, re] of ROLE_PATTERNS) if (re.test(hay)) return role;
  return "other";
}

const rolePriority = (role: PageRole) => ROLE_PATTERNS.find(([r]) => r === role)?.[2] ?? (role === "home" ? 11 : 0);

/** Same-site test honoring shared hosts (sites.google.com/view/x etc.). */
export function sameSite(rootUrl: string, url: string): boolean {
  const a = siteKey(rootUrl);
  const b = siteKey(url);
  if (a && b && a === b) return true;
  try {
    const ra = new URL(rootUrl);
    const rb = new URL(url);
    // Unknown shared hosts: stay under the root path prefix.
    return (
      ra.hostname.replace(/^www\./, "") === rb.hostname.replace(/^www\./, "") &&
      rb.pathname.startsWith(ra.pathname.replace(/\/[^/]*$/, "/"))
    );
  } catch {
    return false;
  }
}

export async function crawlSite(input: {
  rootUrl: string;
  clubId: string;
  /** Pages of a verified official site are owned by the club (tier 2); others are public web. */
  officialSite: boolean;
  /** Override the source type (e.g. a Harvard directory's page about the club). */
  sourceTypeOverride?: SourceType;
  db: Db;
  fetcher: SourceFetcher;
  store: SnapshotStore;
  runId: string;
  logger: Logger;
  now: () => Date;
  maxPages: number;
  maxDepth: number;
  freshnessMs: number;
  force: boolean;
  stats: CrawlStats;
}): Promise<CrawledPage[]> {
  const { db, fetcher, store, stats, logger } = input;
  const root = normalizeUrl(input.rootUrl);
  if (!root) return [];
  const sourceType: SourceType = input.sourceTypeOverride ?? (input.officialSite ? "club_website" : "public_web");
  const queue: { url: string; depth: number; role: PageRole; priority: number }[] = [
    { url: root, depth: 0, role: "home", priority: 100 },
  ];
  const seen = new Set<string>([root]);
  const hashes = new Set<string>();
  const pages: CrawledPage[] = [];

  while (queue.length > 0 && pages.length + stats.pagesFailed < input.maxPages * 2 && pages.length < input.maxPages) {
    queue.sort((a, b) => b.priority - a.priority || a.depth - b.depth);
    const next = queue.shift();
    if (!next) break;

    const sourceId = await upsertSource(db, {
      url: next.url,
      sourceType,
      ownerClubId: input.officialSite ? input.clubId : null,
      adapter: "site-crawler",
      title: null,
    });
    await db.update(schema.source).set({ pageRole: next.role }).where(eq(schema.source.id, sourceId));
    const [src] = await db.select().from(schema.source).where(eq(schema.source.id, sourceId));
    const [previous] = await db
      .select()
      .from(schema.sourceSnapshot)
      .where(eq(schema.sourceSnapshot.sourceId, sourceId))
      .orderBy(desc(schema.sourceSnapshot.fetchedAt))
      .limit(1);

    let body: string | null = null;
    let snapshotId: string | null = null;
    let fetchedAt = input.now();
    let changed = false;
    const fresh =
      !input.force &&
      previous &&
      src?.lastFetchedAt &&
      input.now().getTime() - src.lastFetchedAt.getTime() < input.freshnessMs;

    if (fresh && previous) {
      body = new TextDecoder().decode(await store.get(previous.storageKey));
      snapshotId = previous.id;
      fetchedAt = previous.fetchedAt;
      stats.pagesSkippedFresh++;
    } else {
      const res = await fetcher.fetch(
        { url: next.url, sourceType },
        input.force ? undefined : { etag: previous?.etag ?? null, lastModified: previous?.lastModified ?? null },
      );
      let snapIsNew = false;
      if (res.status === "ok" && res.body) {
        const put = await store.put(res.body);
        body = new TextDecoder().decode(res.body);
        const doc0 = htmlToDocument(body, res.finalUrl);
        const snap = await recordSnapshot(db, {
          sourceId,
          ingestionRunId: input.runId,
          fetchedAt: res.fetchedAt,
          finalUrl: res.finalUrl,
          httpStatus: res.httpStatus,
          contentType: res.contentType,
          etag: res.etag,
          lastModified: res.lastModified,
          contentSha256: put.sha256,
          byteSize: put.byteSize,
          storageKey: put.key,
          extractedText: doc0.text.slice(0, 200_000),
          fetchMethod: res.method,
        });
        snapshotId = snap.snapshotId;
        snapIsNew = snap.isNew;
        fetchedAt = res.fetchedAt;
        changed = snap.isNew;
        if (snap.isNew) stats.pagesFetched++;
        else stats.pagesUnchanged++;
      } else if (res.status === "not_modified" && previous) {
        body = new TextDecoder().decode(await store.get(previous.storageKey));
        snapshotId = previous.id;
        fetchedAt = res.fetchedAt;
        stats.pagesUnchanged++;
        await db.update(schema.source).set({ lastFetchedAt: res.fetchedAt }).where(eq(schema.source.id, sourceId));
      } else if (res.status === "robots_disallowed") {
        stats.pagesRobotsBlocked++;
      } else {
        stats.pagesFailed++;
        logger.debug({ url: next.url, status: res.status, error: res.error }, "page fetch failed");
      }
      await recordFetchAttempt(db, {
        sourceId,
        ingestionRunId: input.runId,
        url: next.url,
        status: res.status,
        httpStatus: res.httpStatus,
        errorMessage: res.error,
        attempts: res.attempts,
        durationMs: res.durationMs,
        snapshotId: snapIsNew || res.status === "ok" ? snapshotId : null,
      });
    }
    if (body === null || snapshotId === null) continue;

    const doc = htmlToDocument(body, next.url);
    if (doc.looksJsRendered) {
      stats.pagesNeedBrowser++;
      await db.update(schema.source).set({ needsBrowser: true }).where(eq(schema.source.id, sourceId));
      // Still keep outbound links (footer socials are often server-rendered).
    }
    const [snapRow] = await db
      .select({ sha: schema.sourceSnapshot.contentSha256 })
      .from(schema.sourceSnapshot)
      .where(eq(schema.sourceSnapshot.id, snapshotId));
    if (snapRow && hashes.has(snapRow.sha)) continue; // identical content under another URL
    if (snapRow) hashes.add(snapRow.sha);
    if (doc.title)
      await db
        .update(schema.source)
        .set({ title: doc.title.slice(0, 300) })
        .where(eq(schema.source.id, sourceId));
    pages.push({
      url: next.url,
      role: next.role,
      depth: next.depth,
      sourceId,
      sourceType,
      snapshotId,
      fetchedAt,
      doc,
      changed,
    });

    if (next.depth >= input.maxDepth) continue;
    for (const link of doc.links) {
      const u = normalizeUrl(link.url);
      if (!u || seen.has(u) || BINARY.test(u) || u.startsWith("mailto:")) continue;
      if (!sameSite(root, u)) continue;
      seen.add(u);
      const role = classifyPageRole(u, link.text);
      if (role === "other" && next.depth >= 1) continue;
      queue.push({ url: u, depth: next.depth + 1, role, priority: rolePriority(role) - next.depth });
    }
  }
  return pages;
}
