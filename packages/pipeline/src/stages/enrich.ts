import { and, eq, inArray, ne, sql } from "drizzle-orm";
import {
  SOURCE_TYPE_TIER,
  classifyLink,
  computeConfidence,
  getField,
  normalizeUrl,
  parseFieldValue,
  siteKey,
  type SourceType,
} from "@hci/core";
import {
  SITE_IDENTITY_EXTRACTOR,
  ensureRecruitingCycle,
  finishRun,
  hashValue,
  recordSnapshotExtractions,
  resolveClubs,
  schema,
  startRun,
  upsertClaim,
  upsertSource,
  type Db,
} from "@hci/db";
import { sitemapHints } from "../crawl/sitemap";
import { formDescriptionDoc, isFormUrl } from "../parse/forms";
import { scoreRecruitingLink } from "../recruiting/signals";
import {
  classifyPageRole,
  crawlSite,
  emptyCrawlStats,
  inRecruitingSeason,
  pathScopedRoot,
  sameSite,
  type CrawledPage,
  type CrawlStats,
} from "../crawl/site";
import {
  DETERMINISTIC_EXTRACTOR,
  extractCommitmentAndSize,
  extractDescriptions,
  extractDeterministic,
  extractLinks,
  hostSpellsClubName,
  linkedSiteNameVariants,
  pageNamesClub,
} from "../extract/deterministic";
import { SCOPE_EXTRACTOR, extractScope } from "../extract/scope";
import {
  LLM_EXTRACTOR,
  emptyLlmCoverage,
  llmPagesFullyRead,
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
import type { PageRole } from "../extract/deterministic";

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
  /** Stored pages the crawl no longer reaches, re-read so their old claims are re-checked. */
  storedPagesReread: number;
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
  /** The club's own site when it is a directory host's home (PBHA: pbha.org; `directoryHostedSite`). */
  hostSite: { url: string; sourceType: SourceType } | null;
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
/**
 * A club whose own verified website is the home of a directory host: PBHA is pbha.org, the
 * Institute of Politics is iop.harvard.edu. The general crawl skips such hosts (their other
 * pages are the directory's pages about *other* clubs, e.g. ~65 PBHA program pages), so the
 * club's own joining pages ("pbha.org/apply") were never read. Such a site gets a narrow
 * joining-focused read instead (`hostSiteJoiningPages`), at the directory's tier. PURE.
 */
export function directoryHostedSite(url: string, status: string): SourceType | null {
  if (status !== "verified" || crawlableClubSite(url, status)) return null;
  try {
    const path = new URL(url).pathname.replace(/\/+$/, "").replace(/\/(index|default)\.\w+$/i, "");
    if (path !== "") return null;
  } catch {
    return null;
  }
  return directorySourceType(url);
}
/** On a directory-hosted club site: the home page (for its links) and its single best joining page. */
const HOST_SITE_MAX_PAGES = 2;

/**
 * The joining/recruiting pages of a club's directory-hosted site (`directoryHostedSite`): a
 * recruiting-focused crawl from the home page, seeded with the club's own stored pages on that
 * host that look like joining pages (so `--offline` replays reach them). Only those pages are
 * returned, never the home page, whose forms and links can belong to the directory's programs.
 */
export async function hostSiteJoiningPages(
  input: Omit<Parameters<typeof crawlSite>[0], "maxPages" | "maxDepth" | "focus" | "extraSeeds" | "officialSite"> & {
    sourceTypeOverride: SourceType;
  },
): Promise<CrawledPage[]> {
  const root = normalizeUrl(input.rootUrl);
  if (!root) return [];
  const owned = await input.db
    .select({ url: schema.source.url })
    .from(schema.source)
    .where(and(eq(schema.source.ownerClubId, input.clubId), eq(schema.source.domain, hostOf(root))));
  const seeds = owned
    .map((o) => o.url)
    .filter((u) => scoreRecruitingLink(u) > 0 && sameSite(root, u))
    .sort((a, b) => scoreRecruitingLink(b) - scoreRecruitingLink(a) || a.localeCompare(b));
  const got = await crawlSite({
    ...input,
    rootUrl: root,
    officialSite: true,
    focus: "recruiting",
    extraSeeds: seeds,
    maxPages: HOST_SITE_MAX_PAGES,
    maxDepth: 1,
  });
  return got.filter((p) => p.depth > 0);
}

/** The career center's page about one club (Mignone listing): a directory page, though the host is a portal. */
const CAREER_CENTER_ORG_PAGE = /^https?:\/\/careerservices\.fas\.harvard\.edu\/organizations\/[\w-]+\/?$/i;

export function directorySourceType(url: string): SourceType | null {
  try {
    const host = new URL(url).hostname.replace(/^www\./, "");
    // ADR 0032's portal exclusion also dropped these per-club pages (read until 1.5.7); ADR 0042 restores them.
    if (CAREER_CENTER_ORG_PAGE.test(url)) return "harvard_official";
    if (HARVARD_PORTAL.test(host) || /^(thehub|engage|calendar)\./.test(host)) return null;
    return DIRECTORY_PAGE_HOSTS.find(([re]) => re.test(host))?.[1] ?? null;
  } catch {
    return null;
  }
}

/** `db.execute` rows: an array from postgres-js, `{ rows }` from PGlite (tests). */
function rowsOf<T>(r: unknown): T[] {
  return (Array.isArray(r) ? r : ((r as { rows?: T[] }).rows ?? [])) as T[];
}

const PAGE_ROLES = new Set<string>([
  "home",
  "about",
  "join",
  "recruiting",
  "faq",
  "team",
  "events",
  "projects",
  "sponsors",
  "contact",
  "other",
]);
const asPageRole = (role: string | null): PageRole => (role && PAGE_ROLES.has(role) ? (role as PageRole) : "other");

/** `like` pattern of a claim `retract-unreproduced` rejected for `extractor` (the reason `upsertClaim` revives). */
const notReproducedBy = (extractor: string) => `%(not reproduced by ${extractor.replace(/[%_]/g, "")}@%`;

/**
 * The club's pages (latest stored copy) that back an active claim from the deterministic
 * extractor, or one rejected only as "not reproduced" by it, but that its current version never
 * read. Without a re-read, what such a page once said (a form since closed, a link since removed)
 * would stay on the profile forever, and a claim wrongly retracted would never come back.
 * A recorded pass counts only when the evidence it left covers the claims it recorded: one that
 * lost its writes (a database repaired from a partial copy, 2026-10-12) is read again, or
 * `retract-unreproduced` would reject everything the page still says.
 */
async function pagesNotReread(
  db: Db,
  clubId: string,
): Promise<{ url: string; pageRole: string | null; sourceType: SourceType }[]> {
  const name = DETERMINISTIC_EXTRACTOR.name;
  const version = DETERMINISTIC_EXTRACTOR.version;
  return rowsOf<{ url: string; pageRole: string | null; sourceType: SourceType }>(
    await db.execute(sql`
    select distinct s.url, s.page_role as "pageRole", s.source_type as "sourceType"
    from ${schema.claim} c
    join ${schema.claimEvidence} e on e.claim_id = c.id and e.extractor_name = ${name}
    join ${schema.source} s on s.id = e.source_id
    join lateral (select x.id from ${schema.sourceSnapshot} x where x.source_id = s.id
                  order by x.fetched_at desc limit 1) latest on true
    where c.club_id = ${clubId}
      and (c.status = 'active' or (c.status = 'rejected' and c.status_reason like ${notReproducedBy(name)}))
      and not exists (select 1 from ${schema.snapshotExtraction} r
                      where r.snapshot_id = latest.id and r.extractor_name = ${name} and r.extractor_version = ${version}
                        and r.claims <= (select count(*) from ${schema.claimEvidence} v
                                         where v.snapshot_id = latest.id and v.extractor_name = ${name} and v.extractor_version = ${version}))
    order by s.url`),
  );
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
    hostSite:
      links
        .filter((l) => l.clubId === c.id)
        .map((l) => ({ url: l.url, sourceType: directoryHostedSite(l.url, l.status) }))
        .find((l): l is { url: string; sourceType: SourceType } => l.sourceType !== null) ?? null,
  }));
  targets = targets.filter((t) => t.sites.length > 0 || t.directoryPages.length > 0 || t.hostSite !== null);

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
    storedPagesReread: 0,
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
        // LLM passes (directory + site): a page is recorded as read by the LLM extractor only when
        // every request covering it ran or replayed (`retract-unreproduced` requires that pass).
        const llmCoverage = emptyLlmCoverage();
        const llmWritten = new Map<string, number>();
        const addLlmWritten = (written: Map<string, number>) => {
          for (const [k, n] of written)
            if (k.endsWith(`|${LLM_EXTRACTOR.name}`)) llmWritten.set(k, (llmWritten.get(k) ?? 0) + n);
        };
        const recordLlmPasses = () =>
          recordSnapshotExtractions(
            db,
            llmPagesFullyRead(llmCoverage).map((snapshotId) => ({
              snapshotId,
              extractorName: LLM_EXTRACTOR.name,
              extractorVersion: LLM_EXTRACTOR.version,
              claims: llmWritten.get(`${snapshotId}|${LLM_EXTRACTOR.name}`) ?? 0,
            })),
          );

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
              ...extractScope({ doc: page.doc, ownSite: false, clubNames: [...names, ...acronyms] }),
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
                {
                  provider: opts.llm.provider,
                  cache,
                  budget,
                  stats: llmStats,
                  dryRun: opts.llm.dryRun,
                  logger: log,
                  coverage: llmCoverage,
                },
              );
              for (const cl of llmClaims) {
                const page = bySnapshot.get(cl.snapshotId);
                if (page) dirClaims.push({ claim: cl, page });
              }
            }
          }
          addLlmWritten(await writeClaims(dirClaims));
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
          const scopeToPath = pathScopedRoot(siteRoot, {
            name: club.name,
            acronym: club.acronym,
            aliases: club.aliases,
          });
          if (!official) {
            // Candidate site: confirm identity on its home page before trusting it at all.
            const probe = await crawlSite({
              rootUrl: siteRoot,
              clubId: club.id,
              officialSite: false,
              scopeToPath,
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
            // The site is already linked to the club, so its own spellings of the name count too.
            const matched = home
              ? (pageNamesClub(home.doc, [...names, ...linkedSiteNameVariants(names)], acronyms) ??
                hostSpellsClubName(siteRoot, names))
              : null;
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
              extraSeeds: scopeToPath ? hints.filter((h) => sameSite(siteRoot, h, true)) : hints,
              officialSite: official,
              scopeToPath,
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
        // 2b) A club whose own site is a directory host's home (PBHA → pbha.org): only its
        //     joining pages, never the directory's pages about other clubs.
        if (club.hostSite) {
          c.sitesChecked++;
          pages = pages.concat(
            await hostSiteJoiningPages({
              rootUrl: club.hostSite.url,
              clubId: club.id,
              sourceTypeOverride: club.hostSite.sourceType,
              db,
              fetcher: deps.fetcher,
              store: deps.store,
              runId,
              logger: log,
              now,
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
        // The most recruiting-like links first (verified, then by URL/label score), so the cap
        // keeps "comp-portal" over a case study; offline replays read them all (stored, free).
        const appLinks = (
          await db
            .select({ url: schema.clubLink.url, status: schema.clubLink.status, label: schema.clubLink.label })
            .from(schema.clubLink)
            .where(
              and(
                eq(schema.clubLink.clubId, club.id),
                inArray(schema.clubLink.kind, ["application_form", "application_page"]),
                inArray(schema.clubLink.status, ["verified", "probable"]),
              ),
            )
        )
          .sort(
            (a, b) =>
              Number(a.status !== "verified") - Number(b.status !== "verified") ||
              scoreRecruitingLink(b.url, b.label ?? "") - scoreRecruitingLink(a.url, a.label ?? "") ||
              a.url.localeCompare(b.url),
          )
          .slice(0, opts.offline ? undefined : MAX_APPLICATION_LINKS);
        for (const link of appLinks) {
          // "Apply to Lead", board/staff applications: a role, not how members join (ADR 0044).
          if (classifyPageRole(link.url, link.label ?? "") === "team") continue;
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
        // 4) Stored pages this crawl no longer reaches (the capped crawl picked others, or the
        //    site stopped linking them) whose claims only older extractor versions back. They
        //    are re-read from storage, never fetched, so the current extractor confirms what
        //    they said or `retract-unreproduced` can drop it (an old hiring page's closed form).
        for (const o of await pagesNotReread(db, club.id)) {
          const norm = normalizeUrl(o.url);
          if (!norm || pages.some((p) => p.url === norm) || dirPages.some((p) => p.url === norm)) continue;
          const form = isFormUrl(o.url);
          if (!form && !crawlableClubSite(o.url, "verified")) continue; // directory pages have their own pass
          const got = await crawlSite({
            rootUrl: o.url,
            rootRole: form ? "recruiting" : asPageRole(o.pageRole),
            clubId: club.id,
            officialSite: o.sourceType === "club_website",
            sourceTypeOverride: o.sourceType,
            db,
            fetcher: deps.fetcher,
            store: deps.store,
            runId,
            logger: log,
            now,
            maxPages: 1,
            maxDepth: 0,
            freshnessMs: 0,
            force: false,
            offline: true,
            stats: crawl,
          });
          for (const p of got) {
            c.storedPagesReread++;
            pages.push({ ...p, confirmOnly: true, ...(form ? { doc: formDescriptionDoc(p.doc) } : {}) });
          }
        }

        if (pages.length === 0) {
          await recordLlmPasses();
          if (dirPages.length > 0) {
            c.clubsEnriched++;
            touched.push(club.id);
          }
          return;
        }

        // Deterministic extraction per page; every pass is recorded, even an empty one (ADR 0039).
        const extracted: { claim: ExtractedClaim; page: CrawledPage }[] = [];
        const passes: Parameters<typeof recordSnapshotExtractions>[1] = [];
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
                : [
                    ...extractDeterministic(ctx),
                    ...extractScope({ doc: page.doc, ownSite: true, clubNames: [...names, ...acronyms] }),
                  ];
          for (const cl of claims) extracted.push({ claim: cl, page });
          passes.push({
            snapshotId: page.snapshotId,
            extractorName: DETERMINISTIC_EXTRACTOR.name,
            extractorVersion: DETERMINISTIC_EXTRACTOR.version,
            claims: 0, // set from what was written
          });
          if (page.role !== "team" && !page.doc.looksJsRendered)
            passes.push({
              snapshotId: page.snapshotId,
              extractorName: SCOPE_EXTRACTOR.name,
              extractorVersion: SCOPE_EXTRACTOR.version,
              claims: 0,
            });
        }

        // Optional LLM pass over the most informative pages (never whole sites).
        if (opts.llm) {
          // Joining/recruiting pages first; team pages never (people), contact/sponsor pages
          // rarely say anything the extractor wants.
          const llmPages: LlmPage[] = pages
            // Re-read stored pages only confirm what they said; never spend on them.
            .filter(
              (p) => !p.confirmOnly && !LLM_SKIP_ROLES.has(p.role) && !p.doc.looksJsRendered && p.doc.text.length > 200,
            )
            .sort((a, b) => llmRolePriority(a.role) - llmRolePriority(b.role))
            .slice(0, LLM_PAGES_PER_CLUB)
            .map((p) => ({ url: p.url, role: p.role, text: p.doc.text.slice(0, 15_000), snapshotId: p.snapshotId }));
          if (llmPages.length > 0) {
            const bySnapshot = new Map(pages.map((p) => [p.snapshotId, p]));
            const llmClaims = await extractWithLlm(
              { clubName: club.name, pages: llmPages, fetchedAt: pages[0]?.fetchedAt ?? now() },
              {
                provider: opts.llm.provider,
                cache,
                budget,
                stats: llmStats,
                dryRun: opts.llm.dryRun,
                logger: log,
                coverage: llmCoverage,
              },
            );
            for (const cl of llmClaims) {
              const page = bySnapshot.get(cl.snapshotId);
              if (page) extracted.push({ claim: cl, page });
            }
          }
        }

        // Each pass records the claims it wrote (a confirm-only re-read: what it confirmed), so a
        // pass that claims values always has evidence of them (`pagesNotReread` and
        // `retract-unreproduced` rely on it).
        const written = await writeClaims(extracted);
        for (const pass of passes) pass.claims = written.get(`${pass.snapshotId}|${pass.extractorName}`) ?? 0;
        await recordSnapshotExtractions(db, passes);
        addLlmWritten(written);
        await recordLlmPasses();
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
 * "website" adds nothing. Shared by enrichment and the recruiting pass. Returns how many
 * distinct claims were written per `snapshotId|extractorName`.
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
): Promise<Map<string, number>> {
  const c = input.counters;
  const written = new Map<string, Set<string>>();
  const confirmable = await claimsBySource(
    db,
    input.clubId,
    input.items.filter((i) => i.page.confirmOnly).map((i) => i.page.sourceId),
  );
  for (const item of input.items) {
    let cl = item.claim;
    const { page } = item;
    const ownSite = siteKey(page.url);
    try {
      if (page.confirmOnly) {
        const parsed = parseFieldValue(cl.fieldKey, cl.value);
        if (!parsed.ok) continue;
        const key = `${page.sourceId}|${cl.fieldKey}|${hashValue(parsed.normalized)}|${cl.cycleTermKey ?? ""}|${cl.assertionKind}`;
        if (!confirmable.exact.has(key)) {
          // Free text whose only difference is spacing ("2024the" read again as "2024 the"):
          // confirm the claim this page already backs, keeping its value (never a new one).
          const loose = looseTextKey(page.sourceId, cl);
          const existing = loose === null ? undefined : confirmable.loose.get(loose);
          if (existing === undefined) continue;
          cl = { ...cl, value: existing };
        }
      }
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
      // Distinct claims: two links with one normalized value are one claim and one evidence row.
      const wk = `${page.snapshotId}|${cl.extractor?.name ?? (llm ? LLM_EXTRACTOR.name : DETERMINISTIC_EXTRACTOR.name)}`;
      written.set(wk, (written.get(wk) ?? new Set()).add(r.claimId));
      if (r.claimCreated) {
        c.claimsNew++;
        if (cl.fieldKey === "club.link") c.linksDiscovered++;
      }
    } catch (error) {
      c.claimsRejected++;
      input.log.debug({ field: cl.fieldKey, error: String(error) }, "claim rejected");
    }
  }
  return new Map([...written].map(([k, ids]) => [k, ids.size]));
}

/**
 * `source|field|valueHash|term|assertionKind` of the club's claims each of these sources supports:
 * active ones, and ones rejected only because a newer version of the extractors that read stored
 * pages (deterministic, scope) didn't reproduce them: a re-read that reproduces them revives
 * them, as `upsertClaim` does.
 */
/** Free-text fields a confirm-only re-read may match ignoring spacing (`looseTextKey`). */
const SPACING_TOLERANT_FIELDS = new Set([
  "club.short_description",
  "club.long_description",
  "club.mission",
  "club.activity",
  "club.eligibility_note",
  "club.experience_required",
  "club.meeting_frequency",
  "club.self_described_selectivity",
]);

/**
 * A free-text value with all whitespace and zero-width spaces removed, so a page read again with
 * `<br>` or U+200B now read as a space (extractor 1.16.24) still confirms what it said. PURE.
 * Extractor 1.16.25 re-reads stored pages so this matching applies to them.
 * Null for every other field and value shape: those match by their exact normalized hash.
 */
export function looseTextKey(
  sourceId: string,
  c: { fieldKey: string; value: unknown; cycleTermKey?: string | null; termKey?: string | null; assertionKind: string },
): string | null {
  if (!SPACING_TOLERANT_FIELDS.has(c.fieldKey) || typeof c.value !== "string") return null;
  const squeezed = c.value.replace(/[\s\u200b\ufeff]+/g, "");
  if (!squeezed) return null;
  return `${sourceId}|${c.fieldKey}|${squeezed}|${c.cycleTermKey ?? c.termKey ?? ""}|${c.assertionKind}`;
}

async function claimsBySource(
  db: Db,
  clubId: string,
  sourceIds: string[],
): Promise<{ exact: Set<string>; loose: Map<string, unknown> }> {
  if (sourceIds.length === 0) return { exact: new Set(), loose: new Map() };
  const rows = rowsOf<{
    sourceId: string;
    fieldKey: string;
    valueHash: string;
    value: unknown;
    status: string;
    termKey: string;
    assertionKind: string;
  }>(
    await db.execute(sql`
    select distinct e.source_id as "sourceId", c.field_key as "fieldKey", c.value_hash as "valueHash", c.value as "value", c.status as "status", coalesce(c.term_key, '') as "termKey", c.assertion_kind as "assertionKind"
    from ${schema.claim} c join ${schema.claimEvidence} e on e.claim_id = c.id
    where c.club_id = ${clubId}
      and (c.status = 'active' or (c.status = 'rejected' and (c.status_reason like ${notReproducedBy(DETERMINISTIC_EXTRACTOR.name)}
                                                           or c.status_reason like ${notReproducedBy(SCOPE_EXTRACTOR.name)})))
      and e.source_id in (${sql.join(
        [...new Set(sourceIds)].map((id) => sql`${id}`),
        sql`, `,
      )})`),
  );
  const exact = new Set(rows.map((r) => `${r.sourceId}|${r.fieldKey}|${r.valueHash}|${r.termKey}|${r.assertionKind}`));
  const loose = new Map<string, unknown>();
  // The active claim when there is one; otherwise the revivable one this page backed.
  for (const r of [...rows].sort((a, b) => Number(b.status === "active") - Number(a.status === "active"))) {
    const k = looseTextKey(r.sourceId, r);
    if (k !== null && !loose.has(k)) loose.set(k, r.value);
  }
  return { exact, loose };
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
