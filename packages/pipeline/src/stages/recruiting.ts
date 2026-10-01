import { and, eq, inArray, ne, sql } from "drizzle-orm";
import { normalizeName, normalizeUrl, termForDate, termKey } from "@hci/core";
import { finishRun, resolveClubs, schema, startRun, type Db } from "@hci/db";
import { crawlSite, emptyCrawlStats, type CrawledPage } from "../crawl/site";
import { sitemapHints } from "../crawl/sitemap";
import { extractDeterministic, pageNamesClub } from "../extract/deterministic";
import { emptyLlmStats, extractWithLlm, type LlmPage, type LlmRunStats } from "../extract/llm/extractor";
import type { LlmProvider } from "../extract/llm/provider";
import type { Logger } from "../logger";
import { formDescriptionDoc, isFormUrl } from "../parse/forms";
import { auditRecruiting, type RecruitingIssue } from "../recruiting/audit";
import {
  applicationFormLinks,
  classifyRecruitingPage,
  isApplicationSystemUrl,
  scoreRecruitingLink,
  type RecruitingPageKind,
} from "../recruiting/signals";
import { SearchCreditError, type WebSearchProvider } from "../sites/search";
import type { SnapshotStore } from "../snapshots/store";
import type { ExtractedClaim, SourceFetcher } from "../types";
import { DbExtractionCache, crawlableClubSite, writeExtractedClaims } from "./enrich";
import { cachedSearch } from "./web-discovery";

/**
 * Targeted recruiting pass (ADR 0031): for each club, find the pages that say how and when
 * to join (scored links on the club's own site, its sitemap, the application forms it
 * links, and — when the site has none — a capped web search), classify them, and extract
 * recruiting facts with the same evidence rules as enrichment. Old recruiting pages are kept
 * as evidence but never produce current-cycle facts. Ends with the recruiting quality audit.
 */

export interface RecruitingOptions {
  clubSlug?: string;
  /** Only clubs without a dated current/upcoming recruiting cycle. */
  missingOnly?: boolean;
  /** Only clubs whose recruiting pages weren't checked in the last `staleHours` (default 72). */
  staleOnly?: boolean;
  staleHours?: number;
  limit?: number;
  /** Paid search queries this run may spend (0 = no search fallback). */
  searchBudget?: number;
  search?: WebSearchProvider | null;
  llm?: { provider: LlmProvider; budgetUsd: number; dryRun: boolean } | null;
  /** List targets and planned searches without fetching or writing. */
  dryRun?: boolean;
  concurrency?: number;
}

export interface RecruitingCounters {
  clubsExamined: number;
  websitesExamined: number;
  pagesRead: number;
  pagesFetched: number;
  pagesReused: number;
  pagesFailed: number;
  recruitingPagesFound: number;
  activeApplicationPages: number;
  recruitingInfoPages: number;
  membershipPages: number;
  historicalPagesSkipped: number;
  applicationFormsRead: number;
  searches: number;
  searchCacheHits: number;
  searchResultsFetched: number;
  searchPagesAccepted: number;
  claimsExtracted: number;
  claimsNew: number;
  claimsRejected: number;
  linksDiscovered: number;
  cyclesTouched: number;
  llmCalls: number;
  llmCacheHits: number;
  llmCostUsd: number;
  llmRejectedValues: number;
  qualityIssues: number;
  qualityRejected: number;
  errors: number;
  [key: string]: number;
}

interface Target {
  id: string;
  slug: string;
  name: string;
  acronym: string | null;
  joinModes: string[];
  aliases: string[];
  site: { url: string; status: string } | null;
}

/** Hosts whose pages are never a club's recruiting page (news, social, Harvard portals). */
const NOT_RECRUITING_HOST =
  /(^|\.)(thecrimson\.com|harvardindependent\.com|harvardpolitics\.com|instagram\.com|facebook\.com|linkedin\.com|x\.com|twitter\.com|tiktok\.com|youtube\.com|reddit\.com|wikipedia\.org|college\.harvard\.edu|harvard\.edu|glassdoor\.com|indeed\.com|handshake\.com|joinhandshake\.com)$/i;

const hostOf = (url: string) => {
  try {
    return new URL(url).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return "";
  }
};

/** Clubs to examine, with their best crawlable website. */
async function selectTargets(db: Db, opts: RecruitingOptions, now: Date): Promise<Target[]> {
  const slugs =
    opts.clubSlug
      ?.split(",")
      .map((s) => s.trim())
      .filter(Boolean) ?? [];
  const clubs = await db
    .select({
      id: schema.club.id,
      slug: schema.club.slug,
      name: schema.club.canonicalName,
      acronym: schema.club.acronym,
      joinModes: schema.club.joinModes,
    })
    .from(schema.club)
    .where(
      and(
        eq(schema.club.recordState, "active"),
        ne(schema.club.dataOrigin, "fixture"),
        ...(slugs.length ? [inArray(schema.club.slug, slugs)] : []),
      ),
    )
    .orderBy(schema.club.slug);
  if (clubs.length === 0) return [];
  const ids = clubs.map((c) => c.id);
  const links = await db
    .select({ clubId: schema.clubLink.clubId, url: schema.clubLink.url, status: schema.clubLink.status })
    .from(schema.clubLink)
    .where(
      and(
        inArray(schema.clubLink.clubId, ids),
        eq(schema.clubLink.kind, "website"),
        inArray(schema.clubLink.status, ["verified", "probable"]),
      ),
    );
  const aliases = await db
    .select({ clubId: schema.clubAlias.clubId, alias: schema.clubAlias.alias })
    .from(schema.clubAlias)
    .where(inArray(schema.clubAlias.clubId, ids));
  let targets: Target[] = clubs.map((c) => {
    const site =
      links
        .filter((l) => l.clubId === c.id && crawlableClubSite(l.url, l.status))
        .sort((a, b) => (a.status === "verified" ? -1 : 0) - (b.status === "verified" ? -1 : 0))[0] ?? null;
    return {
      ...c,
      aliases: aliases.filter((a) => a.clubId === c.id).map((a) => a.alias),
      site: site ? { url: site.url, status: site.status } : null,
    };
  });

  if (opts.missingOnly) {
    const current = termKey(termForDate(now));
    const covered = await db
      .selectDistinct({ clubId: schema.recruitingCycle.clubId })
      .from(schema.recruitingCycle)
      .where(
        and(
          inArray(schema.recruitingCycle.clubId, ids),
          sql`${schema.recruitingCycle.termKey} >= ${current}`,
          sql`(${schema.recruitingCycle.deadlineAt} is not null or ${schema.recruitingCycle.opensAt} is not null)`,
        ),
      );
    const done = new Set(covered.map((r) => r.clubId));
    targets = targets.filter((t) => !done.has(t.id));
  }
  if (opts.staleOnly) {
    const windowMs = (opts.staleHours ?? 72) * 3_600_000;
    const checked = await db
      .select({ url: schema.source.url, last: schema.source.lastFetchedAt })
      .from(schema.source)
      .where(inArray(schema.source.pageRole, ["recruiting", "join"]));
    const lastByHost = new Map<string, number>();
    for (const r of checked) {
      const h = hostOf(r.url);
      const t = r.last ? new Date(r.last).getTime() : 0;
      if (t > (lastByHost.get(h) ?? 0)) lastByHost.set(h, t);
    }
    targets = targets.filter((t) => {
      if (!t.site) return true;
      const last = lastByHost.get(hostOf(t.site.url)) ?? 0;
      return now.getTime() - last > windowMs;
    });
  }
  // Clubs with a website first (cheapest, most reliable), then clubs known to select members
  // (application/comp/audition/tryout), whose recruiting pages are most worth a paid search.
  const selective = new Set(["application", "comp", "audition", "tryout"]);
  const priority = (t: Target) => (t.site ? 2 : 0) + (t.joinModes.some((m) => selective.has(m)) ? 1 : 0);
  targets.sort((a, b) => priority(b) - priority(a) || a.slug.localeCompare(b.slug));
  return opts.limit !== undefined ? targets.slice(0, opts.limit) : targets;
}

/** The search query for a club whose own site exposes no recruiting page. */
export function recruitingQuery(club: { name: string; site: { url: string } | null }): string {
  const terms = "(apply OR application OR comp OR audition OR tryout OR recruiting)";
  if (club.site) {
    try {
      const u = new URL(club.site.url);
      const path = u.pathname.replace(/\/$/, "");
      return `site:${u.hostname.replace(/^www\./, "")}${path} ${terms}`;
    } catch {
      /* fall through */
    }
  }
  return `"${club.name}" Harvard ${terms}`;
}

/**
 * Score a search result as this club's recruiting page: recruiting words in the URL/title,
 * the club named in the title or snippet, its own site, or a public application form.
 * Results on news, social and Harvard portal hosts are never recruiting pages. PURE.
 */
export function scoreSearchResult(
  r: { url: string; title: string; description?: string },
  club: { name: string; acronym: string | null; siteHost: string | null },
): number {
  const host = hostOf(r.url);
  if (!host || NOT_RECRUITING_HOST.test(host)) return 0;
  const sameSite = club.siteHost !== null && (host === club.siteHost || host.endsWith(`.${club.siteHost}`));
  const text = normalizeName(`${r.title} ${r.description ?? ""}`);
  const named =
    text.includes(normalizeName(club.name).replace(/^harvard (undergraduate |college )?/, "")) ||
    (club.acronym !== null && club.acronym.length >= 3 && new RegExp(`\\b${club.acronym.toLowerCase()}\\b`).test(text));
  if (!sameSite && !named) return 0;
  let score = scoreRecruitingLink(r.url, r.title);
  if (/\b(apply|application|comp|audition|try-?out|recruit|join)/i.test(r.description ?? "")) score += 3;
  if (sameSite) score += 10;
  if (named) score += 6;
  if (isApplicationSystemUrl(r.url)) score += 5;
  return score;
}

export async function runRecruiting(
  deps: { db: Db; fetcher: SourceFetcher; store: SnapshotStore; logger: Logger; now?: () => Date },
  opts: RecruitingOptions = {},
): Promise<{
  runId: string | null;
  counters: RecruitingCounters;
  issues: RecruitingIssue[];
  planned: { slug: string; site: string | null; query: string | null }[];
  errors: string[];
}> {
  const { db, logger } = deps;
  const now = deps.now ?? (() => new Date());
  const c: RecruitingCounters = {
    clubsExamined: 0,
    websitesExamined: 0,
    pagesRead: 0,
    pagesFetched: 0,
    pagesReused: 0,
    pagesFailed: 0,
    recruitingPagesFound: 0,
    activeApplicationPages: 0,
    recruitingInfoPages: 0,
    membershipPages: 0,
    historicalPagesSkipped: 0,
    applicationFormsRead: 0,
    searches: 0,
    searchCacheHits: 0,
    searchResultsFetched: 0,
    searchPagesAccepted: 0,
    claimsExtracted: 0,
    claimsNew: 0,
    claimsRejected: 0,
    linksDiscovered: 0,
    cyclesTouched: 0,
    llmCalls: 0,
    llmCacheHits: 0,
    llmCostUsd: 0,
    llmRejectedValues: 0,
    qualityIssues: 0,
    qualityRejected: 0,
    errors: 0,
  };
  const errors: string[] = [];
  const targets = await selectTargets(db, opts, now());
  const searchBudget = opts.search ? (opts.searchBudget ?? 0) : 0;

  if (opts.dryRun) {
    const planned = targets.map((t) => ({ slug: t.slug, site: t.site?.url ?? null, query: null as string | null }));
    // Every club might fall back to search; show what the first `searchBudget` would ask.
    for (const p of planned.slice(0, searchBudget)) {
      const t = targets.find((x) => x.slug === p.slug);
      if (t) p.query = recruitingQuery(t);
    }
    c.clubsExamined = targets.length;
    const issues = await auditRecruiting(db, { now: now(), apply: false });
    c.qualityIssues = issues.length;
    return { runId: null, counters: c, issues, planned, errors };
  }

  const runId = await startRun(db, {
    job: "recruiting",
    adapter: "recruiting-pass",
    adapterVersion: "1",
    options: { ...opts, search: opts.search?.name ?? null, llm: opts.llm ? opts.llm.provider.model : null },
  });
  const crawl = emptyCrawlStats();
  const llmStats: LlmRunStats = emptyLlmStats();
  const budget = { limitUsd: opts.llm?.budgetUsd ?? 0, spentUsd: 0 };
  const cache = new DbExtractionCache(db);
  const touched: string[] = [];
  let searchesLeft = searchBudget;
  let searchStopped = false;
  const recruitingFreshnessMs = 20 * 3_600_000;

  const examine = async (club: Target) => {
    const log = logger.child({ club: club.slug });
    const names = [club.name, ...club.aliases];
    const acronyms = club.acronym ? [club.acronym] : [];
    c.clubsExamined++;
    const pages: { page: CrawledPage; kind: RecruitingPageKind }[] = [];
    const take = (page: CrawledPage) => {
      const cls = classifyRecruitingPage(page.doc, page.fetchedAt);
      pages.push({ page, kind: cls.kind });
      c.pagesRead++;
      if (cls.kind === "active_application") c.activeApplicationPages++;
      else if (cls.kind === "recruiting_info") c.recruitingInfoPages++;
      else if (cls.kind === "membership") c.membershipPages++;
      else if (cls.kind === "historical") c.historicalPagesSkipped++;
      if (cls.kind === "active_application" || cls.kind === "recruiting_info") c.recruitingPagesFound++;
    };
    const crawlOne = (rootUrl: string, extra: Partial<Parameters<typeof crawlSite>[0]> = {}) =>
      crawlSite({
        rootUrl,
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
        freshnessMs: 7 * 24 * 3_600_000,
        recruitingFreshnessMs,
        force: false,
        stats: crawl,
        roleOverride: "recruiting",
        ...extra,
      });

    // 1) The club's own site: home page + its best-scoring joining/recruiting links.
    if (club.site) {
      const root = normalizeUrl(club.site.url);
      if (root) {
        c.websitesExamined++;
        const hints = (await sitemapHints(deps.fetcher, root)).filter((u) => scoreRecruitingLink(u) > 0);
        const got = await crawlSite({
          rootUrl: root,
          clubId: club.id,
          officialSite: club.site.status === "verified",
          db,
          fetcher: deps.fetcher,
          store: deps.store,
          runId,
          logger: log,
          now,
          maxPages: 5,
          maxDepth: 2,
          freshnessMs: 7 * 24 * 3_600_000,
          recruitingFreshnessMs,
          force: false,
          stats: crawl,
          extraSeeds: hints,
          focus: "recruiting",
        });
        for (const p of got) take(p);
      }
    }

    // 2) Application forms those pages present as the club's application (title + public
    //    description only, §21).
    const formUrls = new Set<string>();
    for (const { page, kind } of pages) {
      if (kind === "historical" || kind === "irrelevant") continue;
      const recruitingPage = page.role === "recruiting" || page.role === "join";
      for (const l of applicationFormLinks(page.doc, recruitingPage)) {
        const u = normalizeUrl(l.url);
        if (u && formUrls.size < 2) formUrls.add(u);
      }
    }
    for (const url of formUrls) {
      const got = await crawlOne(url, {
        sourceTypeOverride: club.site?.status === "verified" ? "club_recruiting_material" : "public_web",
      });
      for (const p of got) {
        c.applicationFormsRead++;
        take(isFormUrl(p.url) ? { ...p, doc: formDescriptionDoc(p.doc) } : p);
      }
    }

    // 3) Search fallback: only when nothing on the club's own site is a recruiting page.
    const hasRecruitingPage = pages.some((p) => p.kind === "active_application" || p.kind === "recruiting_info");
    if (!hasRecruitingPage && opts.search && !searchStopped && searchesLeft > 0) {
      const query = recruitingQuery(club);
      try {
        const res = await cachedSearch(
          { db, store: deps.store, now },
          opts.search,
          query,
          runId,
          "recruiting-search",
          30,
        );
        if (res.reused) c.searchCacheHits++;
        else {
          c.searches++;
          searchesLeft--;
        }
        const siteHost = club.site ? hostOf(club.site.url) : null;
        const ranked = res.results
          .map((r) => ({ r, score: scoreSearchResult(r, { name: club.name, acronym: club.acronym, siteHost }) }))
          .filter((x) => x.score >= 15)
          .sort((a, b) => b.score - a.score)
          .slice(0, 2);
        for (const { r } of ranked) {
          const own = siteHost !== null && hostOf(r.url).endsWith(siteHost);
          const got = await crawlOne(r.url, {
            officialSite: own && club.site?.status === "verified",
            ...(own ? {} : { sourceTypeOverride: "public_web" as const }),
          });
          c.searchResultsFetched += got.length;
          for (const p of got) {
            const doc = isFormUrl(p.url) ? formDescriptionDoc(p.doc) : p.doc;
            // A page elsewhere on the web counts only if it names the club in its title.
            if (!own && !pageNamesClub(doc, names, acronyms)) continue;
            c.searchPagesAccepted++;
            take({ ...p, doc });
          }
        }
      } catch (error) {
        if (error instanceof SearchCreditError) {
          searchStopped = true;
          log.warn({ error: error.message }, "search stopped");
        } else throw error;
      }
    }

    // 4) Extraction. Historical pages keep their snapshots but give no cycle facts.
    const extracted: { claim: ExtractedClaim; page: CrawledPage }[] = [];
    const usable = pages.filter((p) => p.kind !== "irrelevant");
    for (const { page, kind } of usable) {
      const ctx = {
        doc: page.doc,
        role: page.role,
        fetchedAt: page.fetchedAt,
        clubNames: names,
        clubAcronyms: acronyms,
      };
      for (const cl of extractDeterministic(ctx)) {
        if (kind === "historical" && cl.fieldKey.startsWith("cycle.")) continue;
        extracted.push({ claim: cl, page });
      }
    }
    if (opts.llm) {
      const llmPages: LlmPage[] = usable
        .filter((p) => p.kind === "active_application" || p.kind === "recruiting_info")
        .filter((p) => !p.page.doc.looksJsRendered && p.page.doc.text.length > 120)
        .slice(0, 3)
        .map(({ page }) => ({
          url: page.url,
          role: page.role,
          text: page.doc.text.slice(0, 15_000),
          snapshotId: page.snapshotId,
        }));
      if (llmPages.length > 0) {
        const bySnapshot = new Map(usable.map((p) => [p.page.snapshotId, p.page]));
        const llmClaims = await extractWithLlm(
          {
            clubName: club.name,
            pages: llmPages,
            fetchedAt: llmPages.length ? (usable[0]?.page.fetchedAt ?? now()) : now(),
          },
          { provider: opts.llm.provider, cache, budget, stats: llmStats, dryRun: opts.llm.dryRun, logger: log },
        );
        for (const cl of llmClaims) {
          const page = bySnapshot.get(cl.snapshotId);
          if (page) extracted.push({ claim: cl, page });
        }
      }
    }
    await writeExtractedClaims(db, {
      clubId: club.id,
      runId,
      items: extracted,
      llmModel: opts.llm?.provider.model ?? null,
      counters: c,
      log,
    });
    if (pages.length) touched.push(club.id);
  };

  // Polite by construction: the fetcher keeps per-host intervals; clubs run a few at a time.
  let i = 0;
  const workers = Array.from({ length: Math.max(1, opts.concurrency ?? 4) }, async () => {
    while (i < targets.length) {
      const club = targets[i++];
      if (!club) continue;
      try {
        await examine(club);
      } catch (error) {
        c.errors++;
        errors.push(`${club.slug}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  });
  await Promise.all(workers);

  await resolveClubs(db, { clubIds: touched, now: now() });
  // Quality audit over all recruiting facts (not just this run's), then re-resolve what changed.
  const issues = await auditRecruiting(db, { now: now(), apply: true });
  c.qualityIssues = issues.length;
  c.qualityRejected = issues.filter((x) => x.rejectedClaimIds.length > 0).length;
  const affected = [...new Set(issues.map((x) => x.clubId))];
  if (affected.length) await resolveClubs(db, { clubIds: affected, now: now() });

  c.pagesFetched = crawl.pagesFetched;
  c.pagesReused = crawl.pagesSkippedFresh + crawl.pagesUnchanged;
  c.pagesFailed = crawl.pagesFailed + crawl.pagesRobotsBlocked;
  c.llmCalls = llmStats.calls;
  c.llmCacheHits = llmStats.cacheHits;
  c.llmCostUsd = Math.round(llmStats.costUsd * 10_000) / 10_000;
  c.llmRejectedValues = llmStats.rejectedValues;
  await finishRun(db, runId, {
    status: errors.length ? "partial" : "succeeded",
    counters: c,
    errorSummary: errors.slice(0, 50).join("\n") || null,
  });
  return { runId, counters: c, issues, planned: [], errors };
}
