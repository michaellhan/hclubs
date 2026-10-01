import { and, eq, inArray, ne, sql } from "drizzle-orm";
import {
  SOURCE_TYPE_TIER,
  classifyLink,
  computeConfidence,
  getField,
  normalizeUrl,
  siteKey,
  type SourceType,
} from "@hci/core";
import {
  SITE_IDENTITY_EXTRACTOR,
  ensureRecruitingCycle,
  finishRun,
  resolveClubs,
  schema,
  startRun,
  upsertClaim,
  upsertSource,
  type Db,
} from "@hci/db";
import { sitemapHints } from "../crawl/sitemap";
import { formDescriptionDoc, isFormUrl } from "../parse/forms";
import { crawlSite, emptyCrawlStats, inRecruitingSeason, type CrawledPage, type CrawlStats } from "../crawl/site";
import {
  DETERMINISTIC_EXTRACTOR,
  extractCommitmentAndSize,
  extractDescriptions,
  extractDeterministic,
  extractLinks,
  pageNamesClub,
} from "../extract/deterministic";
import { extractScope } from "../extract/scope";
import {
  LLM_EXTRACTOR,
  emptyLlmStats,
  extractWithLlm,
  type CachedExtraction,
  type CacheKey,
  type ExtractionCacheStore,
  type LlmPage,
  type LlmRunStats,
} from "../extract/llm/extractor";
import type { LlmProvider } from "../extract/llm/provider";
import { PROMPT_VERSION } from "../extract/llm/schema";
import type { Logger } from "../logger";
import type { SnapshotStore } from "../snapshots/store";
import type { ExtractedClaim, SourceFetcher } from "../types";

/**
 * Enrichment (M2 §4–8): for each canonical club, find its web presence, verify it,
 * shallow-crawl verified/probable official sites, extract claims deterministically (and
 * optionally with an LLM), write claims with provenance, and reconcile.
 */

/** Hosts that are directories/platforms, not a club's own site — never crawled as one. */
const NOT_A_CLUB_SITE =
  /(^|\.)(pbha\.org|soco\.college\.harvard\.edu|thehub\.college\.harvard\.edu|engage\.[a-z.]*harvard\.edu|campusgroups\.com|harvard\.edu$|wikipedia\.org|google\.com|linktr\.ee|instagram\.com|facebook\.com|linkedin\.com|x\.com|twitter\.com|youtube\.com|tiktok\.com|github\.com)$/i;
/** Club sites hosted by the Harvard Computer Society (socialgood.hcs.harvard.edu …) are the club's own. */
const HCS_HOSTED = /(^|\.)hcs\.harvard\.edu$/i;
const notAClubSite = (host: string) => NOT_A_CLUB_SITE.test(host) && !HCS_HOSTED.test(host);
/** Harvard portals and directories: pages *about* clubs, never a club's own site. */
const HARVARD_PORTAL =
  /(^|\.)(soco\.college|thehub\.college|dso\.college|engage\.[a-z.]+|careerservices\.fas|college|www|fas|seas)\.harvard\.edu$|^harvard\.edu$/i;
/**
 * A site we crawl as the club's. Club sites hosted on Harvard subdomains
 * (ewb.hsites.harvard.edu, hces.seas.harvard.edu) count when the link is verified, i.e.
 * a Harvard page listed it for this club; bare department and portal hosts never do.
 */
export function crawlableClubSite(url: string, status: string): boolean {
  let host: string;
  try {
    host = new URL(url).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return false;
  }
  if (!notAClubSite(host)) return true;
  return (
    status === "verified" && /\.harvard\.edu$/.test(host) && host.split(".").length >= 4 && !HARVARD_PORTAL.test(host)
  );
}

const LLM_PAGES_PER_CLUB = 6;
const MAX_APPLICATION_LINKS = 3;
const LLM_SKIP_ROLES = new Set(["team", "contact", "sponsors"]);
const LLM_ROLE_ORDER = ["join", "recruiting", "faq", "about", "home", "events"];
const llmRolePriority = (role: string) => {
  const i = LLM_ROLE_ORDER.indexOf(role);
  return i === -1 ? LLM_ROLE_ORDER.length : i;
};

export interface EnrichOptions {
  /** One slug, or several separated by commas. */
  clubSlug?: string;
  limit?: number;
  staleOnly?: boolean;
  /** Pages fetched more recently than this are reused, not refetched (unless force). */
  freshnessHours?: number;
  force?: boolean;
  maxPages?: number;
  maxDepth?: number;
  concurrency?: number;
  llm?: { provider: LlmProvider; dryRun: boolean; budgetUsd: number } | null;
  /** The fetcher renders JS-only pages in a browser: refetch pages flagged needs_browser. */
  browser?: boolean;
  /**
   * Re-extract from stored snapshots only: no requests at all (no sitemaps, no candidate
   * probes, no unfetched pages). Use after an extractor change to replay it for free.
   */
  offline?: boolean;
  /** Seed each site crawl from its sitemap's join/recruiting/FAQ/about pages (default true). */
  sitemaps?: boolean;
  /** Refetch window for joining/recruiting pages (default: 20 h in recruiting season, else as other pages). */
  recruitingFreshnessHours?: number;
}

export interface EnrichCounters extends CrawlStats {
  clubsConsidered: number;
  clubsWithSite: number;
  clubsEnriched: number;
  clubsFailed: number;
  sitesChecked: number;
  sitesConfirmedByName: number;
  sitesSkippedUnconfirmed: number;
  directoryPagesRead: number;
  sitemapHints: number;
  applicationPagesRead: number;
  claimsExtracted: number;
  claimsNew: number;
  claimsRejected: number;
  linksDiscovered: number;
  cyclesTouched: number;
  llmCalls: number;
  llmCacheHits: number;
  llmFailures: number;
  llmInputTokens: number;
  llmOutputTokens: number;
  llmCostUsd: number;
  llmRejectedValues: number;
  llmSkippedForBudget: number;
  llmDryRunEstimatedTokens: number;
  elapsedMs: number;
  [key: string]: number;
}

export class DbExtractionCache implements ExtractionCacheStore {
  constructor(private readonly db: Db) {}
  async get(key: CacheKey): Promise<CachedExtraction | null> {
    const [row] = await this.db
      .select()
      .from(schema.extractionCache)
      .where(
        and(
          eq(schema.extractionCache.textSha256, key.textSha256),
          eq(schema.extractionCache.extractor, key.extractor),
          eq(schema.extractionCache.promptVersion, key.promptVersion),
          eq(schema.extractionCache.provider, key.provider),
          eq(schema.extractionCache.model, key.model),
        ),
      );
    if (!row) return null;
    return {
      status: row.status as CachedExtraction["status"],
      output: row.output as CachedExtraction["output"],
      usage:
        row.inputTokens !== null
          ? { inputTokens: row.inputTokens, outputTokens: row.outputTokens ?? 0, costUsd: row.costUsd }
          : null,
      error: row.error,
    };
  }
  async put(key: CacheKey, v: CachedExtraction & { attempts: number; snapshotId: string | null }): Promise<void> {
    const values = {
      ...key,
      snapshotId: v.snapshotId,
      status: v.status,
      output: v.output,
      error: v.error,
      inputTokens: v.usage?.inputTokens ?? null,
      outputTokens: v.usage?.outputTokens ?? null,
      costUsd: v.usage?.costUsd ?? null,
      attempts: v.attempts,
    };
    await this.db
      .insert(schema.extractionCache)
      .values(values)
      .onConflictDoUpdate({
        target: [
          schema.extractionCache.textSha256,
          schema.extractionCache.extractor,
          schema.extractionCache.promptVersion,
          schema.extractionCache.provider,
          schema.extractionCache.model,
        ],
        set: { status: values.status, output: values.output, error: values.error, attempts: values.attempts },
      });
  }
}

interface TargetClub {
  id: string;
  slug: string;
  name: string;
  acronym: string | null;
  aliases: string[];
  sites: { url: string; status: string }[];
  /** Pages ABOUT the club on a directory (PBHA program page, IOP page, Wikipedia article…). */
  directoryPages: { url: string; sourceType: SourceType }[];
}

/** Directory hosts whose per-org pages we read for links/descriptions, with their trust. */
const DIRECTORY_PAGE_HOSTS: [RegExp, SourceType][] = [
  [/(^|\.)pbha\.org$/, "harvard_official"],
  [/(^|\.)iop\.harvard\.edu$/, "harvard_official"],
  [/(^|\.)careerservices\.fas\.harvard\.edu$/, "harvard_official"],
  [/(^|\.)en\.wikipedia\.org$/, "public_web"],
  // A Harvard office or House page about the club (ADR 0032); portals are excluded below.
  [/\.harvard\.edu$/, "harvard_official"],
];
const MAX_DIRECTORY_PAGES_PER_CLUB = 4;
function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}
function directorySourceType(url: string): SourceType | null {
  try {
    const host = new URL(url).hostname.replace(/^www\./, "");
    if (HARVARD_PORTAL.test(host) || /^(thehub|engage|calendar)\./.test(host)) return null;
    return DIRECTORY_PAGE_HOSTS.find(([re]) => re.test(host))?.[1] ?? null;
  } catch {
    return null;
  }
}

async function selectTargets(db: Db, opts: EnrichOptions, now: Date): Promise<TargetClub[]> {
  const conds = [eq(schema.club.recordState, "active"), ne(schema.club.dataOrigin, "fixture")];
  if (opts.clubSlug)
    conds.push(
      inArray(
        schema.club.slug,
        opts.clubSlug.split(",").map((s) => s.trim()),
      ),
    );
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
  const allLinks = await db
    .select({
      clubId: schema.clubLink.clubId,
      url: schema.clubLink.url,
      status: schema.clubLink.status,
      kind: schema.clubLink.kind,
    })
    .from(schema.clubLink)
    .where(
      and(
        inArray(schema.clubLink.clubId, ids),
        inArray(schema.clubLink.kind, ["website", "harvard_directory", "other"]),
        ne(schema.clubLink.status, "rejected"),
      ),
    );
  const links = allLinks.filter((l) => l.kind === "website");
  const aliases = await db
    .select({ clubId: schema.clubAlias.clubId, alias: schema.clubAlias.alias })
    .from(schema.clubAlias)
    .where(inArray(schema.clubAlias.clubId, ids));

  let targets: TargetClub[] = clubs.map((c) => ({
    ...c,
    aliases: aliases.filter((a) => a.clubId === c.id).map((a) => a.alias),
    sites: links
      .filter((l) => l.clubId === c.id)
      .filter((l) => crawlableClubSite(l.url, l.status))
      .sort((a, b) => (a.status === "verified" ? -1 : 0) - (b.status === "verified" ? -1 : 0))
      .slice(0, 2)
      .map((l) => ({ url: l.url, status: l.status })),
    directoryPages: allLinks
      .filter((l) => l.clubId === c.id && l.kind !== "website")
      .map((l) => ({ url: l.url, sourceType: directorySourceType(l.url) }))
      .filter((d): d is { url: string; sourceType: SourceType } => d.sourceType !== null)
      // Listing pages shared by many clubs (e.g. the club-sports table) carry nothing club-specific.
      .filter((d) => !/club-sport-organizations|\/programs\/?$/.test(d.url))
      // One page per directory site (official ones first), so e.g. a Wikipedia article isn't
      // crowded out by two Harvard listings of the same club.
      .sort((a, b) => SOURCE_TYPE_TIER[a.sourceType] - SOURCE_TYPE_TIER[b.sourceType])
      .filter((d, i, all) => all.findIndex((x) => hostOf(x.url) === hostOf(d.url)) === i)
      .slice(0, MAX_DIRECTORY_PAGES_PER_CLUB),
  }));
  targets = targets.filter((t) => t.sites.length > 0 || t.directoryPages.length > 0);

  if (opts.staleOnly) {
    const windowMs = (opts.freshnessHours ?? 168) * 3_600_000;
    const owned = await db
      .select({ owner: schema.source.ownerClubId, last: sql<Date | null>`max(${schema.source.lastFetchedAt})` })
      .from(schema.source)
      .where(inArray(schema.source.ownerClubId, ids))
      .groupBy(schema.source.ownerClubId);
    const lastBy = new Map(owned.map((o) => [o.owner, o.last ? new Date(o.last) : null]));
    targets = targets.filter((t) => {
      const last = lastBy.get(t.id);
      return !last || now.getTime() - last.getTime() > windowMs;
    });
  }
  return opts.limit !== undefined ? targets.slice(0, opts.limit) : targets;
}

async function pool<T>(items: T[], concurrency: number, fn: (item: T) => Promise<void>): Promise<void> {
  let i = 0;
  const workers = Array.from({ length: Math.max(1, concurrency) }, async () => {
    while (i < items.length) {
      const item = items[i++];
      if (item !== undefined) await fn(item);
    }
  });
  await Promise.all(workers);
}

export async function runEnrichment(
  deps: { db: Db; fetcher: SourceFetcher; store: SnapshotStore; logger: Logger; now?: () => Date },
  opts: EnrichOptions = {},
): Promise<{ runId: string; status: "succeeded" | "partial" | "failed"; counters: EnrichCounters; errors: string[] }> {
  const { db, logger } = deps;
  const now = deps.now ?? (() => new Date());
  const started = Date.now();
  const runId = await startRun(db, {
    job: "enrich",
    adapter: "site-crawler",
    adapterVersion: DETERMINISTIC_EXTRACTOR.version,
    options: {
      ...opts,
      llm: opts.llm
        ? {
            provider: opts.llm.provider.name,
            model: opts.llm.provider.model,
            dryRun: opts.llm.dryRun,
            budgetUsd: opts.llm.budgetUsd,
          }
        : null,
    },
  });
  const crawl = emptyCrawlStats();
  // During recruiting season, joining/recruiting pages and application forms are refetched
  // after a day instead of a week (conditional GETs keep unchanged pages cheap).
  const recruitingFreshnessMs =
    opts.recruitingFreshnessHours !== undefined
      ? opts.recruitingFreshnessHours * 3_600_000
      : inRecruitingSeason(now())
        ? 20 * 3_600_000
        : undefined;
  const llmStats: LlmRunStats = emptyLlmStats();
  const budget = { limitUsd: opts.llm?.budgetUsd ?? 0, spentUsd: 0 };
  const cache = new DbExtractionCache(db);
  const errors: string[] = [];
  const c: EnrichCounters = {
    ...crawl,
    clubsConsidered: 0,
    clubsWithSite: 0,
    clubsEnriched: 0,
    clubsFailed: 0,
    sitesChecked: 0,
    sitesConfirmedByName: 0,
    sitesSkippedUnconfirmed: 0,
    directoryPagesRead: 0,
    sitemapHints: 0,
    applicationPagesRead: 0,
    claimsExtracted: 0,
    claimsNew: 0,
    claimsRejected: 0,
    linksDiscovered: 0,
    cyclesTouched: 0,
    llmCalls: 0,
    llmCacheHits: 0,
    llmFailures: 0,
    llmInputTokens: 0,
    llmOutputTokens: 0,
    llmCostUsd: 0,
    llmRejectedValues: 0,
    llmSkippedForBudget: 0,
    llmDryRunEstimatedTokens: 0,
    elapsedMs: 0,
  };

  try {
    const targets = await selectTargets(db, opts, now());
    c.clubsConsidered = targets.length;
    const touched: string[] = [];

    await pool(targets, opts.concurrency ?? 4, async (club) => {
      const log = logger.child({ club: club.slug });
      try {
        c.clubsWithSite++;
        const names = [club.name, ...club.aliases];
        const acronyms = club.acronym ? [club.acronym] : [];
        // Write claims (shared by the directory pass and the site pass).
        const writeClaims = (items: { claim: ExtractedClaim; page: CrawledPage }[]) =>
          writeExtractedClaims(db, {
            clubId: club.id,
            runId,
            items,
            llmModel: opts.llm?.provider.model ?? null,
            counters: c,
            log,
          });

        let pages: CrawledPage[] = [];
        // 1) Directory pages about this club: read main-content links + description (tier of the directory).
        const dirPages: CrawledPage[] = [];
        for (const d of club.directoryPages) {
          dirPages.push(
            ...(await crawlSite({
              rootUrl: d.url,
              clubId: club.id,
              officialSite: false,
              sourceTypeOverride: d.sourceType,
              db,
              fetcher: deps.fetcher,
              store: deps.store,
              runId,
              logger: log,
              now,
              maxPages: 1,
              maxDepth: 0,
              freshnessMs: (opts.freshnessHours ?? 168) * 3_600_000,
              recruitingFreshnessMs,
              force: opts.force ?? false,
              offline: opts.offline ?? false,
              stats: crawl,
              retryBrowserPages: opts.browser ?? false,
            })),
          );
        }
        if (dirPages.length > 0) {
          c.directoryPagesRead += dirPages.length;
          const dirClaims: { claim: ExtractedClaim; page: CrawledPage }[] = [];
          for (const page of dirPages) {
            const ctx = {
              doc: page.doc,
              role: "about" as const,
              fetchedAt: page.fetchedAt,
              clubNames: names,
              clubAcronyms: acronyms,
              directoryPage: true,
            };
            for (const cl of [
              ...extractLinks(ctx),
              ...extractDescriptions(ctx),
              ...extractScope({ doc: page.doc, ownSite: false }),
            ]) {
              // Only the org's own channels; never links back into the directory site itself.
              if (
                cl.fieldKey === "club.link" &&
                ["application_page", "email"].includes((cl.value as { kind: string }).kind)
              )
                continue;
              dirClaims.push({ claim: cl, page });
            }
          }
          // Optional LLM pass over the directory pages themselves (a PBHA program page or an IOP
          // page often says how to get involved). A separate call from the site pass, so cached
          // site extractions stay valid; claims carry the directory's own tier.
          if (opts.llm) {
            const llmDirPages: LlmPage[] = dirPages
              .filter((p) => !p.doc.looksJsRendered && p.doc.text.length > 200)
              .map((p) => ({
                url: p.url,
                role: "directory",
                text: p.doc.text.slice(0, 15_000),
                snapshotId: p.snapshotId,
              }));
            if (llmDirPages.length > 0) {
              const bySnapshot = new Map(dirPages.map((p) => [p.snapshotId, p]));
              const llmClaims = await extractWithLlm(
                { clubName: club.name, pages: llmDirPages, fetchedAt: dirPages[0]?.fetchedAt ?? now() },
                { provider: opts.llm.provider, cache, budget, stats: llmStats, dryRun: opts.llm.dryRun, logger: log },
              );
              for (const cl of llmClaims) {
                const page = bySnapshot.get(cl.snapshotId);
                if (page) dirClaims.push({ claim: cl, page });
              }
            }
          }
          await writeClaims(dirClaims);
          await resolveClubs(db, { clubIds: [club.id], now: now() });
          // Websites newly listed on a directory page become crawl targets in this same run.
          const fresh = await db
            .select({ url: schema.clubLink.url, status: schema.clubLink.status })
            .from(schema.clubLink)
            .where(
              and(
                eq(schema.clubLink.clubId, club.id),
                eq(schema.clubLink.kind, "website"),
                ne(schema.clubLink.status, "rejected"),
              ),
            );
          for (const f of fresh) {
            let host = "";
            try {
              host = new URL(f.url).hostname.replace(/^www\./, "");
            } catch {
              continue;
            }
            if (notAClubSite(host) || club.sites.some((s) => s.url === f.url) || club.sites.length >= 2) continue;
            club.sites.push({ url: f.url, status: f.status });
          }
        }
        // 2) The club's own website(s).
        for (const site of club.sites) {
          c.sitesChecked++;
          let official = site.status === "verified";
          const siteRoot = normalizeUrl(site.url);
          if (!siteRoot) continue;
          if (!official) {
            // Candidate site: confirm identity on its home page before trusting it at all.
            const probe = await crawlSite({
              rootUrl: siteRoot,
              clubId: club.id,
              officialSite: false,
              db,
              fetcher: deps.fetcher,
              store: deps.store,
              runId,
              logger: log,
              now,
              maxPages: 1,
              maxDepth: 0,
              freshnessMs: (opts.freshnessHours ?? 168) * 3_600_000,
              recruitingFreshnessMs,
              force: opts.force ?? false,
              offline: opts.offline ?? false,
              stats: crawl,
              retryBrowserPages: opts.browser ?? false,
            });
            const home = probe[0];
            const matched = home ? pageNamesClub(home.doc, names, acronyms) : null;
            if (!home || !matched) {
              c.sitesSkippedUnconfirmed++;
              continue;
            }
            c.sitesConfirmedByName++;
            await upsertClaim(
              db,
              {
                clubId: club.id,
                fieldKey: "club.link",
                value: { kind: "website", url: siteRoot },
                assertionKind: "stated",
              },
              {
                sourceId: home.sourceId,
                sourceType: "public_web",
                snapshotId: home.snapshotId,
                ingestionRunId: runId,
                observedAt: home.fetchedAt,
                quote: matched,
                locator: { url: home.url, signal: "page title names the club" },
                extractionMethod: "html_parse",
                extractorName: SITE_IDENTITY_EXTRACTOR,
                extractorVersion: "1",
                isDirect: true,
              },
            );
            official = false; // probable: crawl, but pages stay tier-8 public web
          }
          // Pages the sitemap lists but the home page doesn't link directly (ADR 0027).
          const hints = opts.sitemaps === false || opts.offline ? [] : await sitemapHints(deps.fetcher, siteRoot);
          c.sitemapHints += hints.length;
          pages = pages.concat(
            await crawlSite({
              rootUrl: siteRoot,
              clubId: club.id,
              extraSeeds: hints,
              officialSite: official,
              db,
              fetcher: deps.fetcher,
              store: deps.store,
              runId,
              logger: log,
              now,
              maxPages: opts.maxPages ?? 6,
              maxDepth: opts.maxDepth ?? 1,
              freshnessMs: (opts.freshnessHours ?? 168) * 3_600_000,
              recruitingFreshnessMs,
              force: opts.force ?? false,
              offline: opts.offline ?? false,
              stats: crawl,
              retryBrowserPages: opts.browser ?? false,
            }),
          );
        }
        // 3) Application forms/pages the club links: forms are read as title + public
        //    description only (§21); both are "recruiting" pages for extraction (ADR 0027).
        const appLinks = await db
          .select({ url: schema.clubLink.url, status: schema.clubLink.status })
          .from(schema.clubLink)
          .where(
            and(
              eq(schema.clubLink.clubId, club.id),
              inArray(schema.clubLink.kind, ["application_form", "application_page"]),
              inArray(schema.clubLink.status, ["verified", "probable"]),
            ),
          )
          .limit(MAX_APPLICATION_LINKS);
        for (const link of appLinks) {
          const form = isFormUrl(link.url);
          const norm = normalizeUrl(link.url);
          if (!norm || pages.some((p) => p.url === norm)) continue;
          const got = await crawlSite({
            rootUrl: link.url,
            clubId: club.id,
            officialSite: false,
            sourceTypeOverride: link.status === "verified" ? "club_recruiting_material" : "public_web",
            roleOverride: "recruiting",
            db,
            fetcher: deps.fetcher,
            store: deps.store,
            runId,
            logger: log,
            now,
            maxPages: 1,
            maxDepth: 0,
            freshnessMs: (opts.freshnessHours ?? 168) * 3_600_000,
            recruitingFreshnessMs,
            force: opts.force ?? false,
            offline: opts.offline ?? false,
            stats: crawl,
          });
          for (const p of got) {
            c.applicationPagesRead++;
            pages.push(form ? { ...p, doc: formDescriptionDoc(p.doc) } : p);
          }
        }

        if (pages.length === 0) {
          if (dirPages.length > 0) {
            c.clubsEnriched++;
            touched.push(club.id);
          }
          return;
        }

        // Deterministic extraction per page.
        const extracted: { claim: ExtractedClaim; page: CrawledPage }[] = [];
        for (const page of pages) {
          const ctx = {
            doc: page.doc,
            role: page.role,
            fetchedAt: page.fetchedAt,
            clubNames: names,
            clubAcronyms: acronyms,
          };
          // Team/member pages: only links and aggregate size — never individual people.
          const claims =
            page.role === "team"
              ? [...extractLinks(ctx), ...extractCommitmentAndSize(ctx)]
              : page.doc.looksJsRendered
                ? extractLinks(ctx)
                : [...extractDeterministic(ctx), ...extractScope({ doc: page.doc, ownSite: true })];
          for (const cl of claims) extracted.push({ claim: cl, page });
        }

        // Optional LLM pass over the most informative pages (never whole sites).
        if (opts.llm) {
          // Joining/recruiting pages first; team pages never (people), contact/sponsor pages
          // rarely say anything the extractor wants.
          const llmPages: LlmPage[] = pages
            .filter((p) => !LLM_SKIP_ROLES.has(p.role) && !p.doc.looksJsRendered && p.doc.text.length > 200)
            .sort((a, b) => llmRolePriority(a.role) - llmRolePriority(b.role))
            .slice(0, LLM_PAGES_PER_CLUB)
            .map((p) => ({ url: p.url, role: p.role, text: p.doc.text.slice(0, 15_000), snapshotId: p.snapshotId }));
          if (llmPages.length > 0) {
            const bySnapshot = new Map(pages.map((p) => [p.snapshotId, p]));
            const llmClaims = await extractWithLlm(
              { clubName: club.name, pages: llmPages, fetchedAt: pages[0]?.fetchedAt ?? now() },
              { provider: opts.llm.provider, cache, budget, stats: llmStats, dryRun: opts.llm.dryRun, logger: log },
            );
            for (const cl of llmClaims) {
              const page = bySnapshot.get(cl.snapshotId);
              if (page) extracted.push({ claim: cl, page });
            }
          }
        }

        await writeClaims(extracted);
        c.clubsEnriched++;
        touched.push(club.id);
      } catch (error) {
        c.clubsFailed++;
        errors.push(`${club.slug}: ${error instanceof Error ? error.message : String(error)}`);
        log.error({ error: String(error) }, "enrichment failed for club");
      }
    });

    const stats = await resolveClubs(db, { clubIds: touched, now: now() });
    errors.push(...stats.errors.map((e) => `resolve ${e.clubId}: ${e.error}`));
    Object.assign(c, crawl, {
      llmCalls: llmStats.calls,
      llmCacheHits: llmStats.cacheHits,
      llmFailures: llmStats.failures,
      llmInputTokens: llmStats.inputTokens,
      llmOutputTokens: llmStats.outputTokens,
      llmCostUsd: Math.round(llmStats.costUsd * 10_000) / 10_000,
      llmRejectedValues: llmStats.rejectedValues,
      llmSkippedForBudget: llmStats.skippedForBudget,
      llmDryRunEstimatedTokens: llmStats.dryRunEstimatedTokens,
      elapsedMs: Date.now() - started,
    });
    const status =
      c.clubsFailed > 0 && c.clubsEnriched === 0 && c.clubsConsidered > 0
        ? "failed"
        : errors.length > 0
          ? "partial"
          : "succeeded";
    await finishRun(db, runId, { status, counters: c, errorSummary: errors.slice(0, 50).join("\n") || null });
    return { runId, status, counters: c, errors };
  } catch (error) {
    c.elapsedMs = Date.now() - started;
    await finishRun(db, runId, { status: "failed", counters: c, errorSummary: String(error) });
    throw error;
  }
}

/** Counters `writeExtractedClaims` updates. */
export interface ClaimWriteCounters {
  claimsExtracted: number;
  claimsNew: number;
  claimsRejected: number;
  linksDiscovered: number;
  cyclesTouched: number;
}

/**
 * Write extracted claims for one club with full provenance (source, snapshot, quote,
 * extractor). Cycle-scoped claims need a term; a club's own site listing itself as a
 * "website" adds nothing. Shared by enrichment and the recruiting pass.
 */
export async function writeExtractedClaims(
  db: Db,
  input: {
    clubId: string;
    runId: string;
    items: { claim: ExtractedClaim; page: CrawledPage }[];
    llmModel: string | null;
    counters: ClaimWriteCounters;
    log: Logger;
  },
): Promise<void> {
  const c = input.counters;
  for (const { claim: cl, page } of input.items) {
    const ownSite = siteKey(page.url);
    try {
      if (cl.fieldKey === "club.link") {
        const v = cl.value as { kind: string; url: string };
        if (v.kind === "website" && siteKey(v.url) === ownSite) continue;
        if (!classifyLink(v.url)) continue;
      }
      const field = getField(cl.fieldKey);
      let cycleId: string | null = null;
      if (field.subjectType === "recruiting_cycle") {
        if (!cl.cycleTermKey) {
          c.claimsRejected++;
          continue;
        }
        cycleId = await ensureRecruitingCycle(db, { clubId: input.clubId, termKey: cl.cycleTermKey });
        c.cyclesTouched++;
      }
      const sourceType: SourceType = page.sourceType;
      const llm = cl.extractionMethod === "llm";
      const r = await upsertClaim(
        db,
        {
          clubId: input.clubId,
          recruitingCycleId: cycleId,
          fieldKey: cl.fieldKey,
          value: cl.value,
          assertionKind: cl.assertionKind,
          termKey: cl.cycleTermKey ?? null,
        },
        {
          sourceId: page.sourceId,
          sourceType,
          snapshotId: page.snapshotId,
          ingestionRunId: input.runId,
          observedAt: page.fetchedAt,
          quote: cl.quote ?? null,
          locator: cl.locator ?? null,
          extractionMethod: cl.extractionMethod,
          extractorName: cl.extractor?.name ?? (llm ? LLM_EXTRACTOR.name : DETERMINISTIC_EXTRACTOR.name),
          extractorVersion: cl.extractor?.version ?? (llm ? LLM_EXTRACTOR.version : DETERMINISTIC_EXTRACTOR.version),
          ...(llm && input.llmModel ? { llmModel: input.llmModel, promptVersion: PROMPT_VERSION } : {}),
          isDirect: cl.isDirect,
          confidence: Math.min(
            0.99,
            computeConfidence({ sourceType, extractionMethod: cl.extractionMethod, isDirect: cl.isDirect }) *
              (cl.confidenceFactor ?? 1),
          ),
        },
      );
      c.claimsExtracted++;
      if (r.claimCreated) {
        c.claimsNew++;
        if (cl.fieldKey === "club.link") c.linksDiscovered++;
      }
    } catch (error) {
      c.claimsRejected++;
      input.log.debug({ field: cl.fieldKey, error: String(error) }, "claim rejected");
    }
  }
}

/** Register a new site-crawl source without fetching (used by tests/tools). */
export async function registerSite(db: Db, url: string, clubId: string, official: boolean): Promise<string> {
  return upsertSource(db, {
    url,
    sourceType: official ? "club_website" : "public_web",
    ownerClubId: official ? clubId : null,
    adapter: "site-crawler",
  });
}
