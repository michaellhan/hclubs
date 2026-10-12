import { and, desc, eq, inArray, ne, notInArray, sql } from "drizzle-orm";
import { matchOrganization, siteKey } from "@hci/core";
import {
  SITE_IDENTITY_EXTRACTOR,
  finishRun,
  recordFetchAttempt,
  recordSnapshot,
  resolveClubs,
  schema,
  startRun,
  upsertClaim,
  upsertSource,
  type Db,
} from "@hci/db";
import { crawlSite, emptyCrawlStats, type CrawlStats } from "../crawl/site";
import { loadKnownOrgs, resolveMention } from "../entity/resolve";
import type { Logger } from "../logger";
import { htmlToDocument } from "../parse/document";
import type { SearchResult } from "../sites/candidates";
import { harvardOrgFromPage, orgLinkCandidates, orgNameFromTitle, possibleOrgHost } from "../sites/org-page";
import { SearchCreditError, type WebSearchProvider } from "../sites/search";
import { sweepQueries } from "../sites/sweep-queries";
import type { SnapshotStore } from "../snapshots/store";
import type { SourceFetcher } from "../types";

/**
 * discover-web (ADR 0025): find Harvard student organizations that no Harvard directory
 * we can read lists. Candidate sites come from
 *   1. search sweeps: one official-search-API query per topic ("Harvard undergraduate
 *      finance club"); results whose title names a Harvard org, reduced to site roots;
 *   2. link snowballing: links on pages we already crawled (club sites, directories,
 *      Wikipedia) whose anchor text names a Harvard org or whose host says "harvard".
 * Each candidate's home page is fetched politely and accepted only when
 * `harvardOrgFromPage` finds an org name in its title and the page talks about students.
 * A new org becomes a club (tier-8 public web evidence, website "probable"); a definite
 * match to a known club only adds the website; anything merely similar is left for review.
 */

export const WEB_DISCOVERY_VERSION = "1";
export const WEB_DISCOVERY_ADAPTER = "web-discovery";

export interface WebDiscoveryOptions {
  search?: WebSearchProvider | null;
  topics?: string[];
  outlinks?: boolean;
  /** Max candidate home pages fetched this run (default 400). */
  maxProbes?: number;
  concurrency?: number;
  searchFreshnessDays?: number;
  dryRun?: boolean;
}

export interface WebDiscoveryCounters extends CrawlStats {
  searches: number;
  searchesReused: number;
  searchFailures: number;
  snapshotsScanned: number;
  candidates: number;
  candidatesKnownSite: number;
  probed: number;
  notAnOrgPage: number;
  clubsCreated: number;
  websitesAddedToKnownClubs: number;
  needsReview: number;
  [key: string]: number;
}

export interface WebDiscoveryFinding {
  root: string;
  via: "search" | "outlink";
  name: string;
  outcome: "created" | "website_added" | "needs_review" | "would_create" | "known";
  club: string | null;
  note: string;
}

interface Candidate {
  root: string;
  key: string;
  via: "search" | "outlink";
  hint: string;
}

async function pool<T>(items: T[], concurrency: number, fn: (item: T) => Promise<void>): Promise<void> {
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.max(1, concurrency) }, async () => {
      while (i < items.length) {
        const item = items[i++];
        if (item !== undefined) await fn(item);
      }
    }),
  );
}

/** Search once per query; a stored response younger than the freshness window is replayed. */
export async function cachedSearch(
  deps: { db: Db; store: SnapshotStore; now: () => Date },
  provider: WebSearchProvider,
  query: string,
  runId: string,
  adapter: string,
  freshnessDays = 180,
): Promise<{ results: SearchResult[]; sourceId: string; snapshotId: string; fetchedAt: Date; reused: boolean }> {
  const { db, store, now } = deps;
  const sourceId = await upsertSource(db, {
    url: provider.requestUrl(query),
    sourceType: "public_web",
    adapter,
    title: `Search (${provider.name}): ${query}`,
  });
  const [src] = await db.select().from(schema.source).where(eq(schema.source.id, sourceId));
  if (src?.lastFetchedAt && now().getTime() - src.lastFetchedAt.getTime() < freshnessDays * 86_400_000) {
    const [snap] = await db
      .select()
      .from(schema.sourceSnapshot)
      .where(eq(schema.sourceSnapshot.sourceId, sourceId))
      .orderBy(desc(schema.sourceSnapshot.fetchedAt))
      .limit(1);
    if (snap) {
      const raw = JSON.parse(new TextDecoder().decode(await store.get(snap.storageKey))) as { results: SearchResult[] };
      return { results: raw.results, sourceId, snapshotId: snap.id, fetchedAt: snap.fetchedAt, reused: true };
    }
  }
  const started = Date.now();
  const res = await provider.search(query);
  const body = new TextEncoder().encode(
    JSON.stringify({ provider: provider.name, query, requestUrl: res.requestUrl, results: res.results }),
  );
  const put = await store.put(body);
  const fetchedAt = now();
  const snap = await recordSnapshot(db, {
    sourceId,
    ingestionRunId: runId,
    fetchedAt,
    finalUrl: res.requestUrl,
    httpStatus: 200,
    contentType: "application/json",
    contentSha256: put.sha256,
    byteSize: put.byteSize,
    storageKey: put.key,
    extractedText: res.results.map((r) => `${r.title}\n${r.url}\n${r.description ?? ""}`).join("\n\n"),
    fetchMethod: "api",
  });
  await recordFetchAttempt(db, {
    sourceId,
    ingestionRunId: runId,
    url: res.requestUrl,
    status: "ok",
    httpStatus: 200,
    errorMessage: null,
    attempts: 1,
    durationMs: Date.now() - started,
    snapshotId: snap.snapshotId,
  });
  return { results: res.results, sourceId, snapshotId: snap.snapshotId, fetchedAt, reused: false };
}

export async function runWebDiscovery(
  deps: { db: Db; fetcher: SourceFetcher; store: SnapshotStore; logger: Logger; now?: () => Date },
  opts: WebDiscoveryOptions = {},
): Promise<{ runId: string; counters: WebDiscoveryCounters; findings: WebDiscoveryFinding[]; errors: string[] }> {
  const { db, store, logger } = deps;
  const now = deps.now ?? (() => new Date());
  const runId = await startRun(db, {
    job: "discover-web",
    adapter: WEB_DISCOVERY_ADAPTER,
    adapterVersion: WEB_DISCOVERY_VERSION,
    options: { search: opts.search?.name ?? null, outlinks: opts.outlinks ?? false, dryRun: opts.dryRun ?? false },
  });
  const crawl = emptyCrawlStats();
  const c: WebDiscoveryCounters = {
    ...crawl,
    searches: 0,
    searchesReused: 0,
    searchFailures: 0,
    snapshotsScanned: 0,
    candidates: 0,
    candidatesKnownSite: 0,
    probed: 0,
    notAnOrgPage: 0,
    clubsCreated: 0,
    websitesAddedToKnownClubs: 0,
    needsReview: 0,
  };
  const errors: string[] = [];
  const findings: WebDiscoveryFinding[] = [];
  const touched = new Set<string>();

  try {
    // Sites already attached to a club are not candidates.
    const links = await db
      .select({ clubId: schema.clubLink.clubId, url: schema.clubLink.url })
      .from(schema.clubLink)
      .where(and(eq(schema.clubLink.kind, "website"), ne(schema.clubLink.status, "rejected")));
    const siteOwner = new Map<string, string>();
    for (const l of links) {
      const k = siteKey(l.url);
      if (k && !siteOwner.has(k)) siteOwner.set(k, l.clubId);
    }

    const candidates = new Map<string, Candidate>();
    const knownSeen = new Set<string>();
    const add = (url: string, via: Candidate["via"], hint: string) => {
      const key = siteKey(url);
      if (!key || !possibleOrgHost(url)) return;
      if (siteOwner.has(key)) {
        if (!knownSeen.has(key)) c.candidatesKnownSite++;
        knownSeen.add(key);
        return;
      }
      if (!candidates.has(key)) candidates.set(key, { root: `https://${key}/`, key, via, hint });
    };

    // 1. Search sweeps.
    if (opts.search) {
      for (const query of sweepQueries(opts.topics)) {
        try {
          const r = await cachedSearch(
            { db, store, now },
            opts.search,
            query,
            runId,
            WEB_DISCOVERY_ADAPTER,
            opts.searchFreshnessDays,
          );
          if (r.reused) c.searchesReused++;
          else c.searches++;
          for (const res of r.results) {
            const name = orgNameFromTitle(res.title);
            if (name) add(res.url, "search", `${name} (query: ${query})`);
          }
        } catch (error) {
          if (error instanceof SearchCreditError) {
            // Out of credit or at this run's cap: keep going with what we have.
            errors.push(`search stopped: ${error.message}`);
            break;
          }
          c.searchFailures++;
          errors.push(`search "${query}": ${String(error)}`);
        }
      }
    }

    // 2. Links on pages we already crawled (latest snapshot per HTML source).
    if (opts.outlinks) {
      const snaps = await db
        .selectDistinctOn([schema.sourceSnapshot.sourceId], {
          storageKey: schema.sourceSnapshot.storageKey,
          finalUrl: schema.sourceSnapshot.finalUrl,
        })
        .from(schema.sourceSnapshot)
        .innerJoin(schema.source, eq(schema.source.id, schema.sourceSnapshot.sourceId))
        .where(
          and(
            eq(schema.source.isFixture, false),
            sql`${schema.sourceSnapshot.contentType} ilike '%html%'`,
            notInArray(schema.source.adapter, [WEB_DISCOVERY_ADAPTER, "web-search"]),
          ),
        )
        .orderBy(schema.sourceSnapshot.sourceId, desc(schema.sourceSnapshot.fetchedAt));
      for (const s of snaps) {
        try {
          const html = new TextDecoder().decode(await store.get(s.storageKey));
          const doc = htmlToDocument(html, s.finalUrl);
          c.snapshotsScanned++;
          for (const cand of orgLinkCandidates(s.finalUrl, doc.links))
            add(cand.root, "outlink", `${cand.hint} (on ${s.finalUrl})`);
        } catch (error) {
          errors.push(`scan ${s.finalUrl}: ${String(error)}`);
        }
      }
    }
    c.candidates = candidates.size;
    logger.info({ candidates: candidates.size }, "web discovery candidates");

    // 3. Probe home pages and decide.
    const known = await loadKnownOrgs(db);
    const queue = [...candidates.values()].slice(0, opts.maxProbes ?? 400);
    // Entity resolution creates clubs: serialize the decision step so two pages of one org can't race.
    let lock = Promise.resolve();
    const serialized = <T>(fn: () => Promise<T>): Promise<T> => {
      const next = lock.then(fn);
      lock = next.then(
        () => undefined,
        () => undefined,
      );
      return next;
    };

    await pool(queue, opts.concurrency ?? 4, async (cand) => {
      try {
        c.probed++;
        const [home] = await crawlSite({
          rootUrl: cand.root,
          clubId: "00000000-0000-0000-0000-000000000000",
          officialSite: false,
          db,
          fetcher: deps.fetcher,
          store,
          runId,
          logger: logger.child({ candidate: cand.root }),
          now,
          maxPages: 1,
          maxDepth: 0,
          freshnessMs: 14 * 86_400_000,
          force: false,
          stats: crawl,
        });
        if (!home) return;
        const org = harvardOrgFromPage(home.doc);
        if (!org) {
          c.notAnOrgPage++;
          return;
        }
        const finalKey = siteKey(home.doc.url) ?? cand.key;
        await serialized(async () => {
          if (siteOwner.has(finalKey) || siteOwner.has(cand.key)) {
            findings.push({
              root: cand.root,
              via: cand.via,
              name: org.name,
              outcome: "known",
              club: null,
              note: "site already attached",
            });
            return;
          }
          const match = matchOrganization({ names: [org.name], urls: [cand.root] }, known);
          const finding: WebDiscoveryFinding = {
            root: cand.root,
            via: cand.via,
            name: org.name,
            outcome: "needs_review",
            club: null,
            note: cand.hint.slice(0, 120),
          };
          findings.push(finding);
          if (match.decision === "probable" || match.decision === "ambiguous") {
            c.needsReview++;
            const ids = match.candidates.slice(0, 2).map((m) => m.clubId);
            const rows = ids.length
              ? await db.select({ slug: schema.club.slug }).from(schema.club).where(inArray(schema.club.id, ids))
              : [];
            finding.note = `similar to ${rows.map((r) => r.slug).join(", ")}`;
            return;
          }
          if (opts.dryRun) {
            finding.outcome = match.decision === "definite" ? "website_added" : "would_create";
            return;
          }
          let clubId: string;
          // The record claims are filed under: a seen mention's own club, even if since merged (§12).
          let subjectId: string;
          if (match.decision === "definite" && match.clubId) {
            clubId = match.clubId;
            subjectId = clubId;
            finding.outcome = "website_added";
            c.websitesAddedToKnownClubs++;
          } else {
            const res = await resolveMention(db, {
              sourceId: home.sourceId,
              snapshotId: home.snapshotId,
              runId,
              org: {
                externalKey: `site:${finalKey}`,
                name: org.name,
                identity: { urls: [cand.root], externalIds: [] },
                claims: [],
              },
              known,
            });
            clubId = res.clubId;
            subjectId = res.subjectClubId;
            finding.outcome = res.decision === "new" ? "created" : "website_added";
            if (res.decision === "new") c.clubsCreated++;
            await upsertClaim(
              db,
              { clubId: subjectId, fieldKey: "club.name", value: org.name, assertionKind: "stated" },
              evidence(home, runId, org.quote, { signal: "site title" }),
            );
          }
          await upsertClaim(
            db,
            {
              clubId: subjectId,
              fieldKey: "club.link",
              value: { kind: "website", url: cand.root },
              assertionKind: "stated",
            },
            {
              ...evidence(home, runId, org.quote, {
                url: home.url,
                signal: "page title names the club",
                foundVia: cand.via,
              }),
              // Same identity evidence as the site finder, so the resolver marks it probable.
              extractorName: SITE_IDENTITY_EXTRACTOR,
            },
          );
          siteOwner.set(finalKey, clubId);
          siteOwner.set(cand.key, clubId);
          touched.add(clubId);
          const [row] = await db.select({ slug: schema.club.slug }).from(schema.club).where(eq(schema.club.id, clubId));
          finding.club = row?.slug ?? null;
        });
      } catch (error) {
        errors.push(`${cand.root}: ${String(error)}`);
      }
    });

    const stats = await resolveClubs(db, { clubIds: [...touched], now: now() });
    errors.push(...stats.errors.map((e) => `resolve ${e.clubId}: ${e.error}`));
    Object.assign(c, crawl);
    await finishRun(db, runId, {
      status: errors.length ? "partial" : "succeeded",
      counters: c,
      errorSummary: errors.slice(0, 50).join("\n") || null,
    });
    return { runId, counters: c, findings, errors };
  } catch (error) {
    await finishRun(db, runId, { status: "failed", counters: c, errorSummary: String(error) });
    throw error;
  }
}

function evidence(
  home: { sourceId: string; snapshotId: string; fetchedAt: Date },
  runId: string,
  quote: string,
  locator: Record<string, unknown>,
) {
  return {
    sourceId: home.sourceId,
    sourceType: "public_web" as const,
    snapshotId: home.snapshotId,
    ingestionRunId: runId,
    observedAt: home.fetchedAt,
    quote,
    locator,
    extractionMethod: "html_parse" as const,
    extractorName: WEB_DISCOVERY_ADAPTER,
    extractorVersion: WEB_DISCOVERY_VERSION,
    isDirect: true,
  };
}
