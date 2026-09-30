import { lookup } from "node:dns/promises";
import { and, desc, eq, inArray, ne, sql } from "drizzle-orm";
import { siteKey } from "@hci/core";
import {
  SITE_IDENTITY_EXTRACTOR,
  finishRun,
  rejectClaims,
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
import type { Logger } from "../logger";
import { htmlToDocument } from "../parse/document";
import {
  classifySearchResult,
  excludedSiteHost,
  guessDomains,
  identityNames,
  searchQuery,
  siteIdentity,
  titleNamesClub,
  type ClubNames,
  type SearchResult,
} from "../sites/candidates";
import { SearchCreditError, type WebSearchProvider } from "../sites/search";
import type { SnapshotStore } from "../snapshots/store";
import type { SourceFetcher } from "../types";
import { cachedSearch } from "./web-discovery";

/**
 * find-sites (ADR 0023): for clubs with no known website, gather candidate sites from
 * guessed domains and (optionally) an official search API, fetch each candidate's home
 * page, and write a `club.link` website claim only when the page names the club
 * (`siteIdentity`). Social profiles whose search-result title names the club are written
 * as tier-8 claims (they stay "unverified" until an official channel links them).
 * Enrichment then crawls the new probable sites like any other.
 */

export const FINDER_VERSION = "2";
export const SEARCH_EXTRACTOR = "web-search";

export interface FindSitesOptions {
  clubSlug?: string;
  limit?: number;
  guess?: boolean;
  search?: WebSearchProvider | null;
  /** Reuse a stored search response for the same query if younger than this (default 180 days). */
  searchFreshnessDays?: number;
  concurrency?: number;
  /** Max candidate sites probed per club (default 6). */
  maxProbes?: number;
}

export interface FindSitesCounters extends CrawlStats {
  clubsConsidered: number;
  domainsGuessed: number;
  domainsResolved: number;
  searches: number;
  searchesReused: number;
  searchFailures: number;
  candidatesProbed: number;
  sitesFound: number;
  sitesFoundByGuess: number;
  sitesFoundBySearch: number;
  sitesSkippedOtherClub: number;
  socialLinksFound: number;
  clubsFailed: number;
  [key: string]: number;
}

export type HostResolver = (host: string) => Promise<boolean>;

export const dnsResolves: HostResolver = async (host) => {
  try {
    await Promise.race([
      lookup(host),
      new Promise((_, reject) => setTimeout(() => reject(new Error("dns timeout")), 4000)),
    ]);
    return true;
  } catch {
    return false;
  }
};

interface Target extends ClubNames {
  id: string;
  slug: string;
  needsSite: boolean;
  needsInstagram: boolean;
}

async function selectTargets(db: Db, opts: FindSitesOptions): Promise<Target[]> {
  const conds = [eq(schema.club.recordState, "active"), ne(schema.club.dataOrigin, "fixture")];
  if (opts.clubSlug) conds.push(eq(schema.club.slug, opts.clubSlug));
  const clubs = await db
    .select({
      id: schema.club.id,
      slug: schema.club.slug,
      name: schema.club.canonicalName,
      acronym: schema.club.acronym,
    })
    .from(schema.club)
    .where(and(...conds))
    .orderBy(schema.club.slug);
  if (clubs.length === 0) return [];
  const ids = clubs.map((c) => c.id);
  const links = await db
    .select({ clubId: schema.clubLink.clubId, kind: schema.clubLink.kind, status: schema.clubLink.status })
    .from(schema.clubLink)
    .where(and(inArray(schema.clubLink.clubId, ids), ne(schema.clubLink.status, "rejected")));
  const aliases = await db
    .select({ clubId: schema.clubAlias.clubId, alias: schema.clubAlias.alias })
    .from(schema.clubAlias)
    .where(inArray(schema.clubAlias.clubId, ids));
  const targets = clubs
    .map((c) => {
      const own = links.filter((l) => l.clubId === c.id);
      return {
        ...c,
        aliases: aliases.filter((a) => a.clubId === c.id).map((a) => a.alias),
        needsSite: !own.some((l) => l.kind === "website" && (l.status === "verified" || l.status === "probable")),
        needsInstagram: !own.some((l) => l.kind === "instagram"),
      };
    })
    .filter((t) => t.needsSite || (opts.search && t.needsInstagram))
    // Paid searches are capped per run: clubs missing both a site and an Instagram first.
    .sort((a, b) => Number(b.needsSite) + Number(b.needsInstagram) - (Number(a.needsSite) + Number(a.needsInstagram)));
  return opts.limit !== undefined ? targets.slice(0, opts.limit) : targets;
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

export async function runFindSites(
  deps: {
    db: Db;
    fetcher: SourceFetcher;
    store: SnapshotStore;
    logger: Logger;
    now?: () => Date;
    resolveHost?: HostResolver;
  },
  opts: FindSitesOptions = {},
): Promise<{
  runId: string;
  status: "succeeded" | "partial" | "failed";
  counters: FindSitesCounters;
  errors: string[];
}> {
  const { db, logger, store } = deps;
  const now = deps.now ?? (() => new Date());
  const resolveHost = deps.resolveHost ?? dnsResolves;
  const guess = opts.guess ?? true;
  const runId = await startRun(db, {
    job: "find-sites",
    adapter: "site-finder",
    adapterVersion: FINDER_VERSION,
    options: { ...opts, search: opts.search?.name ?? null },
  });
  const crawl = emptyCrawlStats();
  const c: FindSitesCounters = {
    ...crawl,
    clubsConsidered: 0,
    domainsGuessed: 0,
    domainsResolved: 0,
    searches: 0,
    searchesReused: 0,
    searchFailures: 0,
    candidatesProbed: 0,
    sitesFound: 0,
    sitesFoundByGuess: 0,
    sitesFoundBySearch: 0,
    sitesSkippedOtherClub: 0,
    socialLinksFound: 0,
    clubsFailed: 0,
  };
  const errors: string[] = [];
  const touched: string[] = [];

  // A site already attached to another club must not be claimed again by name similarity.
  const existing = await db
    .select({ clubId: schema.clubLink.clubId, url: schema.clubLink.url })
    .from(schema.clubLink)
    .where(and(eq(schema.clubLink.kind, "website"), ne(schema.clubLink.status, "rejected")));
  const siteOwner = new Map<string, string>();
  for (const e of existing) {
    const k = siteKey(e.url);
    if (k && !siteOwner.has(k)) siteOwner.set(k, e.clubId);
  }

  let searchStopped = false;
  async function searchFor(
    club: Target,
  ): Promise<{ results: SearchResult[]; sourceId: string; snapshotId: string; fetchedAt: Date } | null> {
    if (!opts.search || searchStopped) return null;
    const query = searchQuery(club);
    // The request URL (no credentials) identifies the query; a fresh stored response is reused.
    const sourceId = await upsertSource(db, {
      url: opts.search.requestUrl(query),
      sourceType: "public_web",
      adapter: SEARCH_EXTRACTOR,
      title: `Search (${opts.search.name}): ${query}`,
    });
    const [src] = await db.select().from(schema.source).where(eq(schema.source.id, sourceId));
    const maxAge = (opts.searchFreshnessDays ?? 180) * 86_400_000;
    if (src?.lastFetchedAt && now().getTime() - src.lastFetchedAt.getTime() < maxAge) {
      const [snap] = await db
        .select()
        .from(schema.sourceSnapshot)
        .where(eq(schema.sourceSnapshot.sourceId, sourceId))
        .orderBy(desc(schema.sourceSnapshot.fetchedAt))
        .limit(1);
      if (snap) {
        c.searchesReused++;
        const raw = JSON.parse(new TextDecoder().decode(await store.get(snap.storageKey))) as {
          results: SearchResult[];
        };
        return { results: raw.results, sourceId, snapshotId: snap.id, fetchedAt: snap.fetchedAt };
      }
    }
    const started = Date.now();
    try {
      const res = await opts.search.search(query);
      c.searches++;
      // Store the parsed results with the request URL: small, and enough to replay the decision.
      const body = new TextEncoder().encode(
        JSON.stringify({ provider: opts.search.name, query, requestUrl: res.requestUrl, results: res.results }),
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
      return { results: res.results, sourceId, snapshotId: snap.snapshotId, fetchedAt };
    } catch (error) {
      if (error instanceof SearchCreditError) {
        // Out of credit or at this run's cap: finish with guessed domains only.
        if (!searchStopped) errors.push(`search stopped: ${error.message}`);
        searchStopped = true;
        return null;
      }
      c.searchFailures++;
      errors.push(`search ${club.slug}: ${String(error)}`);
      return null;
    }
  }

  try {
    const targets = await selectTargets(db, opts);
    c.clubsConsidered = targets.length;
    await pool(targets, opts.concurrency ?? 4, async (club) => {
      const log = logger.child({ club: club.slug });
      try {
        const candidates: { root: string; via: "guess" | "search"; detail: string }[] = [];
        const search = await searchFor(club);
        let wrote = false;

        // Social profiles from search results (tier 8; "unverified" until an official page links them).
        if (search) {
          for (const [rank, r] of search.results.entries()) {
            const cand = classifySearchResult(r, club);
            if (!cand) continue;
            if (cand.kind === "site") {
              if (club.needsSite) candidates.push({ root: cand.root, via: "search", detail: `rank ${rank + 1}` });
              continue;
            }
            const res = await upsertClaim(
              db,
              {
                clubId: club.id,
                fieldKey: "club.link",
                value: {
                  kind: cand.link.kind,
                  url: cand.link.url,
                  ...(cand.link.handle ? { handle: cand.link.handle } : {}),
                },
                assertionKind: "stated",
              },
              {
                sourceId: search.sourceId,
                sourceType: "public_web",
                snapshotId: search.snapshotId,
                ingestionRunId: runId,
                observedAt: search.fetchedAt,
                quote: cand.quote,
                locator: { rank: rank + 1, resultUrl: r.url },
                extractionMethod: "structured_data",
                extractorName: SEARCH_EXTRACTOR,
                extractorVersion: FINDER_VERSION,
                isDirect: true,
              },
            );
            if (res.claimCreated) c.socialLinksFound++;
            wrote = true;
          }
        }

        if (club.needsSite && guess) {
          const domains = guessDomains(club);
          c.domainsGuessed += domains.length;
          const resolved = await Promise.all(domains.map(async (d) => ((await resolveHost(d)) ? d : null)));
          for (const d of resolved) {
            if (!d) continue;
            c.domainsResolved++;
            candidates.push({ root: `https://${d}/`, via: "guess", detail: d });
          }
        }

        const probed = new Set<string>();
        for (const cand of candidates) {
          if (probed.size >= (opts.maxProbes ?? 6)) break;
          const key = siteKey(cand.root);
          if (!key || probed.has(key)) continue;
          probed.add(key);
          const owner = siteOwner.get(key);
          if (owner && owner !== club.id) {
            c.sitesSkippedOtherClub++;
            continue;
          }
          c.candidatesProbed++;
          const [home] = await crawlSite({
            rootUrl: cand.root,
            clubId: club.id,
            officialSite: false,
            db,
            fetcher: deps.fetcher,
            store,
            runId,
            logger: log,
            now,
            maxPages: 1,
            maxDepth: 0,
            freshnessMs: 7 * 86_400_000,
            force: false,
            stats: crawl,
          });
          if (!home) continue;
          // Redirects (harvardx.com → harvardx.org) count as the final site.
          const finalKey = siteKey(home.doc.url) ?? key;
          const quote = siteIdentity(home.doc, club);
          if (!quote) continue;
          const finalOwner = siteOwner.get(finalKey);
          if (finalOwner && finalOwner !== club.id) {
            c.sitesSkippedOtherClub++;
            continue;
          }
          await upsertClaim(
            db,
            {
              clubId: club.id,
              fieldKey: "club.link",
              value: { kind: "website", url: cand.root },
              assertionKind: "stated",
            },
            {
              sourceId: home.sourceId,
              sourceType: "public_web",
              snapshotId: home.snapshotId,
              ingestionRunId: runId,
              observedAt: home.fetchedAt,
              quote,
              locator: {
                url: home.url,
                signal: "page title names the club",
                foundVia: cand.via,
                ...(cand.via === "search" ? { rank: cand.detail } : { domain: cand.detail }),
              },
              extractionMethod: "html_parse",
              // Same identity evidence as the enrichment probe, so the resolver marks it probable.
              extractorName: SITE_IDENTITY_EXTRACTOR,
              extractorVersion: `finder-${FINDER_VERSION}`,
              isDirect: true,
            },
          );
          siteOwner.set(key, club.id);
          c.sitesFound++;
          if (cand.via === "guess") c.sitesFoundByGuess++;
          else c.sitesFoundBySearch++;
          wrote = true;
          log.info({ site: cand.root, via: cand.via, quote }, "site found");
          break;
        }
        if (wrote) touched.push(club.id);
      } catch (error) {
        c.clubsFailed++;
        errors.push(`${club.slug}: ${error instanceof Error ? error.message : String(error)}`);
        log.error({ error: String(error) }, "find-sites failed for club");
      }
    });

    const stats = await resolveClubs(db, { clubIds: touched, now: now() });
    errors.push(...stats.errors.map((e) => `resolve ${e.clubId}: ${e.error}`));
    Object.assign(c, crawl);
    const status =
      c.clubsFailed > 0 && c.clubsFailed === c.clubsConsidered ? "failed" : errors.length ? "partial" : "succeeded";
    await finishRun(db, runId, { status, counters: c, errorSummary: errors.slice(0, 50).join("\n") || null });
    return { runId, status, counters: c, errors };
  } catch (error) {
    await finishRun(db, runId, { status: "failed", counters: c, errorSummary: String(error) });
    throw error;
  }
}

/**
 * Re-test websites the finder accepted under older, looser rules against the current
 * `siteIdentity` and host exclusions, using the stored home-page snapshot (no refetch).
 * A site that no longer passes, and that no other source supports, is rejected (never
 * deleted; audited in editorial_decision).
 */
export async function recheckFoundSites(
  deps: { db: Db; store: SnapshotStore; logger: Logger; now?: () => Date },
  opts: { dryRun?: boolean } = {},
): Promise<{ checked: number; rejected: { club: string; url: string; why: string }[] }> {
  const { db, store } = deps;
  const rows = await db
    .select({
      claimId: schema.claim.id,
      clubId: schema.claim.clubId,
      value: schema.claim.value,
      storageKey: schema.sourceSnapshot.storageKey,
      finalUrl: schema.sourceSnapshot.finalUrl,
    })
    .from(schema.claimEvidence)
    .innerJoin(schema.claim, eq(schema.claim.id, schema.claimEvidence.claimId))
    .innerJoin(schema.sourceSnapshot, eq(schema.sourceSnapshot.id, schema.claimEvidence.snapshotId))
    .where(
      and(
        eq(schema.claim.status, "active"),
        eq(schema.claim.fieldKey, "club.link"),
        eq(schema.claimEvidence.extractorName, SITE_IDENTITY_EXTRACTOR),
        sql`${schema.claimEvidence.extractorVersion} like 'finder-%'`,
        // Supported by something besides a title match (a directory, the club's own page…): keep.
        sql`not exists (select 1 from claim_evidence o where o.claim_id = ${schema.claim.id} and o.extractor_name <> ${SITE_IDENTITY_EXTRACTOR})`,
      ),
    );
  const clubIds = [...new Set(rows.map((r) => r.clubId))];
  const clubs = clubIds.length
    ? await db
        .select({
          id: schema.club.id,
          slug: schema.club.slug,
          name: schema.club.canonicalName,
          acronym: schema.club.acronym,
        })
        .from(schema.club)
        .where(inArray(schema.club.id, clubIds))
    : [];
  const aliases = clubIds.length
    ? await db
        .select({ clubId: schema.clubAlias.clubId, alias: schema.clubAlias.alias })
        .from(schema.clubAlias)
        .where(inArray(schema.clubAlias.clubId, clubIds))
    : [];
  const rejected: { club: string; url: string; why: string }[] = [];
  const rejectIds = new Set<string>();
  for (const r of rows) {
    const club = clubs.find((c) => c.id === r.clubId);
    if (!club || rejectIds.has(r.claimId)) continue;
    const url = (r.value as { url: string }).url;
    const names: ClubNames = {
      name: club.name,
      acronym: club.acronym,
      aliases: aliases.filter((a) => a.clubId === club.id).map((a) => a.alias),
    };
    let why: string | null = null;
    if (excludedSiteHost(url)) why = "host is a directory/platform, not a club site";
    else {
      const html = new TextDecoder().decode(await store.get(r.storageKey));
      if (!siteIdentity(htmlToDocument(html, r.finalUrl), names)) why = "page heading doesn't name the club";
    }
    if (why) {
      rejectIds.add(r.claimId);
      rejected.push({ club: club.slug, url, why });
    }
  }
  // Social profiles from search: the result title must still name the club.
  const socials = await db
    .select({
      claimId: schema.claim.id,
      clubId: schema.claim.clubId,
      value: schema.claim.value,
      quote: schema.claimEvidence.evidenceQuote,
    })
    .from(schema.claimEvidence)
    .innerJoin(schema.claim, eq(schema.claim.id, schema.claimEvidence.claimId))
    .where(
      and(
        eq(schema.claim.status, "active"),
        eq(schema.claim.fieldKey, "club.link"),
        eq(schema.claimEvidence.extractorName, SEARCH_EXTRACTOR),
        sql`not exists (select 1 from claim_evidence o where o.claim_id = ${schema.claim.id} and o.extractor_name <> ${SEARCH_EXTRACTOR})`,
      ),
    );
  const socialClubIds = [...new Set(socials.map((r) => r.clubId))].filter((id) => !clubs.some((c) => c.id === id));
  if (socialClubIds.length) {
    clubs.push(
      ...(await db
        .select({
          id: schema.club.id,
          slug: schema.club.slug,
          name: schema.club.canonicalName,
          acronym: schema.club.acronym,
        })
        .from(schema.club)
        .where(inArray(schema.club.id, socialClubIds))),
    );
    aliases.push(
      ...(await db
        .select({ clubId: schema.clubAlias.clubId, alias: schema.clubAlias.alias })
        .from(schema.clubAlias)
        .where(inArray(schema.clubAlias.clubId, socialClubIds))),
    );
  }
  for (const r of socials) {
    const club = clubs.find((c) => c.id === r.clubId);
    if (!club || rejectIds.has(r.claimId)) continue;
    const names: ClubNames = {
      name: club.name,
      acronym: club.acronym,
      aliases: aliases.filter((a) => a.clubId === club.id).map((a) => a.alias),
    };
    if (!titleNamesClub(r.quote ?? "", names)) {
      rejectIds.add(r.claimId);
      rejected.push({
        club: club.slug,
        url: (r.value as { url: string }).url,
        why: "search result title doesn't name the club",
      });
    }
  }
  rows.push(...socials.map((r) => ({ ...r, storageKey: "", finalUrl: "" })));
  if (!opts.dryRun && rejectIds.size > 0) {
    await rejectClaims(db, {
      claimIds: [...rejectIds],
      actor: "find-sites --recheck",
      reason: `site-finder v${FINDER_VERSION} rules no longer accept this website`,
      payload: { finderVersion: FINDER_VERSION },
    });
    await resolveClubs(db, {
      clubIds: [...new Set(rows.filter((r) => rejectIds.has(r.claimId)).map((r) => r.clubId))],
      now: (deps.now ?? (() => new Date()))(),
    });
  }
  return { checked: new Set(rows.map((r) => r.claimId)).size, rejected };
}

/**
 * Instagram accounts for clubs that have none (ADR 0028/0029). Paid search is batched:
 * `site:instagram.com ("A" OR "B" …)`, five clubs per query, and each result is
 * attributed only to the club its profile title names. Profiles are recorded like other
 * search-found social links (tier 8); Instagram itself is never fetched (§21).
 */
export async function runFindInstagram(
  deps: { db: Db; store: SnapshotStore; logger: Logger; now?: () => Date },
  opts: { search: WebSearchProvider; clubSlug?: string; limit?: number; batchSize?: number },
): Promise<{ runId: string; counters: Record<string, number>; errors: string[] }> {
  const { db, store } = deps;
  const now = deps.now ?? (() => new Date());
  const runId = await startRun(db, {
    job: "find-instagram",
    adapter: "site-finder",
    adapterVersion: FINDER_VERSION,
    options: { batchSize: opts.batchSize ?? 5 },
  });
  const c = { clubsConsidered: 0, searches: 0, searchesReused: 0, profilesFound: 0, clubsWithProfile: 0 };
  const errors: string[] = [];
  const touched = new Set<string>();
  try {
    const targets = (await selectTargets(db, { ...opts, search: opts.search })).filter((t) => t.needsInstagram);
    c.clubsConsidered = targets.length;
    const size = opts.search.paid ? (opts.batchSize ?? 5) : 1;
    for (let i = 0; i < targets.length; i += size) {
      const batch = targets.slice(i, i + size);
      // The name as the club's own account would title itself ("Harvard Archery Club"), and
      // "Harvard" outside the quotes, so namesakes elsewhere don't crowd out the results.
      const quoted = batch.map((t) => {
        const names = identityNames(t);
        const best = names.find((n) => /\b(harvard|radcliffe)\b/i.test(n)) ?? names[0] ?? t.name;
        return `"${best.replace(/"/g, "").trim()}"`;
      });
      const query = `site:instagram.com harvard ${quoted.length > 1 ? `(${quoted.join(" OR ")})` : quoted[0]}`;
      let r: Awaited<ReturnType<typeof cachedSearch>>;
      try {
        r = await cachedSearch({ db, store, now }, opts.search, query, runId, SEARCH_EXTRACTOR, 180);
      } catch (error) {
        if (error instanceof SearchCreditError) {
          errors.push(`search stopped: ${error.message}`);
          break;
        }
        errors.push(`${query}: ${String(error)}`);
        continue;
      }
      if (r.reused) c.searchesReused++;
      else c.searches++;
      for (const [rank, res] of r.results.entries()) {
        // A profile belongs to at most one club: the one whose name its title carries.
        const owners = batch.filter((t) => classifySearchResult(res, t)?.kind === "social");
        if (owners.length !== 1) continue;
        const club = owners[0]!; // length checked above
        const cand = classifySearchResult(res, club);
        if (!cand || cand.kind !== "social" || cand.link.kind !== "instagram") continue;
        const up = await upsertClaim(
          db,
          {
            clubId: club.id,
            fieldKey: "club.link",
            value: { kind: "instagram", url: cand.link.url, ...(cand.link.handle ? { handle: cand.link.handle } : {}) },
            assertionKind: "stated",
          },
          {
            sourceId: r.sourceId,
            sourceType: "public_web",
            snapshotId: r.snapshotId,
            ingestionRunId: runId,
            observedAt: r.fetchedAt,
            quote: cand.quote,
            locator: { rank: rank + 1, resultUrl: res.url },
            extractionMethod: "structured_data",
            extractorName: SEARCH_EXTRACTOR,
            extractorVersion: FINDER_VERSION,
            isDirect: true,
          },
        );
        if (up.claimCreated) c.profilesFound++;
        if (!touched.has(club.id)) c.clubsWithProfile++;
        touched.add(club.id);
      }
    }
    const stats = await resolveClubs(db, { clubIds: [...touched], now: now() });
    errors.push(...stats.errors.map((e) => `resolve ${e.clubId}: ${e.error}`));
    await finishRun(db, runId, {
      status: errors.length ? "partial" : "succeeded",
      counters: c,
      errorSummary: errors.join("\n") || null,
    });
    return { runId, counters: c, errors };
  } catch (error) {
    await finishRun(db, runId, { status: "failed", counters: c, errorSummary: String(error) });
    throw error;
  }
}
