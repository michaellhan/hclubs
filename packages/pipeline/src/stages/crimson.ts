import { and, eq, gt, inArray, ne } from "drizzle-orm";
import { normalizeName, blockingKey } from "@hci/core";
import { finishRun, resolveClubs, schema, startRun, upsertClaim, type Db } from "@hci/db";
import { crawlSite, emptyCrawlStats, type CrawlStats } from "../crawl/site";
import type { Logger } from "../logger";
import type { PageDocument } from "../parse/document";
import { identityNames } from "../sites/candidates";
import type { SearchResult } from "../sites/candidates";
import { SearchCreditError, type WebSearchProvider } from "../sites/search";
import type { SnapshotStore } from "../snapshots/store";
import type { SourceFetcher } from "../types";
import { cachedSearch } from "./web-discovery";

/**
 * crimson (ADR 0026): find Harvard Crimson articles about each club and record them as
 * `club.press_mention` claims (tier 6). Candidates come from one official-search-API query
 * per club (`site:thecrimson.com "<name>"`); an article counts only when its fetched text
 * contains the club's full name. We keep the headline, date and link, never the article
 * text (§21); a mention within the last year is an activity signal (ADR 0020).
 */

export const CRIMSON_VERSION = "2";
/** Clubs per paid search query ("A" OR "B" …); keeps queries short and credit use low. */
const PAID_BATCH_SIZE = 5;

const ARTICLE = /^https?:\/\/(?:www\.)?thecrimson\.com\/article\/(\d{4})\/(\d{1,2})\/(\d{1,2})\/[a-z0-9-]+\/?$/i;

/** Student publications we read for articles about clubs (all allow crawling; §21: link + headline only). */
export interface Publisher {
  key: string;
  name: string;
  site: string;
  sourceType: "harvard_crimson" | "harvard_related_other";
  extractorName: string;
  /** The publication's own WordPress search API base (no web-search credit needed), if any. */
  wordpressBase?: string;
  /** Article URL → normalized URL (+ date when the URL carries one), or null for non-articles. */
  article: (url: string) => { url: string; publishedOn: string | null } | null;
}

const WP_NON_ARTICLE = /^\/(category|tag|author|page|wp-|feed|about|contact|masthead|staff|subscribe|donate|search)\b/i;
const wordpressArticle = (host: RegExp) => (url: string) => {
  try {
    const u = new URL(url.split(/[?#]/)[0] ?? url);
    if (!host.test(u.hostname)) return null;
    if (!/^\/[a-z0-9-]+\/?$/i.test(u.pathname) || WP_NON_ARTICLE.test(u.pathname) || u.pathname === "/") return null;
    return { url: `https://${u.hostname.replace(/^www\./, "")}${u.pathname.replace(/\/?$/, "/")}`, publishedOn: null };
  } catch {
    return null;
  }
};

export const PUBLISHERS: Publisher[] = [
  {
    key: "crimson",
    name: "The Harvard Crimson",
    site: "thecrimson.com",
    sourceType: "harvard_crimson",
    extractorName: "crimson-mentions",
    article: (url) => crimsonArticle(url),
  },
  {
    key: "independent",
    name: "The Harvard Independent",
    site: "harvardindependent.com",
    sourceType: "harvard_related_other",
    extractorName: "independent-mentions",
    wordpressBase: "https://harvardindependent.com",
    article: wordpressArticle(/^(www\.)?harvardindependent\.com$/i),
  },
  {
    key: "hpr",
    name: "Harvard Political Review",
    site: "harvardpolitics.com",
    sourceType: "harvard_related_other",
    extractorName: "hpr-mentions",
    wordpressBase: "https://theharvardpoliticalreview.com",
    article: wordpressArticle(/^(www\.)?(harvardpolitics|theharvardpoliticalreview)\.com$/i),
  },
];

/** Publication date from the page's JSON-LD (`datePublished`), as YYYY-MM-DD. PURE. */
export function jsonLdPublished(doc: PageDocument): string | null {
  const stack: unknown[] = [...doc.jsonLd];
  while (stack.length) {
    const node = stack.pop();
    if (!node || typeof node !== "object") continue;
    if (Array.isArray(node)) {
      stack.push(...node);
      continue;
    }
    const rec = node as Record<string, unknown>;
    const d = rec.datePublished;
    if (typeof d === "string" && /^\d{4}-\d{2}-\d{2}/.test(d)) return d.slice(0, 10);
    for (const v of Object.values(rec)) if (v && typeof v === "object") stack.push(v);
  }
  return null;
}

/** A Crimson article URL and its publication date (from the URL), or null. PURE. */
export function crimsonArticle(url: string): { url: string; publishedOn: string } | null {
  const clean = url.split(/[?#]/)[0] ?? url;
  const m = ARTICLE.exec(clean);
  if (!m) return null;
  const [, y, mo, d] = m;
  const publishedOn = `${y}-${mo?.padStart(2, "0")}-${d?.padStart(2, "0")}`;
  return { url: clean.replace(/^http:/, "https:").replace(/\/?$/, "/"), publishedOn };
}

/**
 * Names specific enough to find in article text: 2+ words with something distinctive
 * left after generic words ("Harvard College" alone never counts). PURE.
 */
export function searchableNames(club: { name: string; acronym: string | null; aliases: string[] }): string[] {
  return identityNames(club).filter((n) => {
    const norm = normalizeName(n);
    return norm.split(" ").length >= 2 && blockingKey(n).length >= 4 && !/\bcrimson\b/.test(norm);
  });
}

/** "Chen ’22" / "Jane Q. Doe '25": a student named with their class year. */
const PERSON_WITH_YEAR = /(?:\b[A-Z][\w.’'-]*\s+){1,3}[’']\d{2}\b/g;

/** Drop individual students' names from an evidence sentence (no rosters or officer names, §4). PURE. */
export function redactPeople(sentence: string): string {
  return sentence.replace(PERSON_WITH_YEAR, "[a student]");
}

/**
 * The sentence of the article that names the club (evidence), or null. Prefers a
 * sentence that names no individual student; otherwise redacts them. PURE.
 */
export function articleMention(doc: PageDocument, names: string[]): string | null {
  const targets = names.map((n) => ` ${normalizeName(n)} `);
  let fallback: string | null = null;
  for (const block of doc.blocks) {
    for (const sentence of block.text.split(/(?<=[.!?”"])\s+/)) {
      const norm = ` ${normalizeName(sentence)} `;
      if (!targets.some((t) => norm.includes(t))) continue;
      const trimmed = sentence.trim().slice(0, 240);
      PERSON_WITH_YEAR.lastIndex = 0;
      if (!PERSON_WITH_YEAR.test(trimmed)) return trimmed;
      fallback ??= redactPeople(trimmed);
    }
  }
  return fallback;
}

/** "Harvard Poker Club Wins … | News | The Harvard Crimson" → "Harvard Poker Club Wins …". PURE. */
export function articleHeadline(doc: PageDocument): string | null {
  const raw = doc.ogTitle ?? doc.title ?? doc.h1;
  if (!raw) return null;
  const t = raw.replace(
    /\s*[|–-]\s*((News|Opinion|Arts|Sports|Magazine|Multimedia|Metro|Editorial|Blog)\s*\|\s*)?(The Harvard Crimson|The Harvard Independent|Harvard Independent|Harvard Political Review)\s*$/i,
    "",
  );
  return t.trim().length >= 3 ? t.trim().slice(0, 300) : null;
}

export interface CrimsonCounters extends CrawlStats {
  clubsConsidered: number;
  searches: number;
  searchesReused: number;
  searchFailures: number;
  articlesProbed: number;
  articlesNotNamingClub: number;
  mentionsRecorded: number;
  clubsWithMentions: number;
  clubsAlreadySearched: number;
  stoppedForCredit: number;
  [key: string]: number;
}

export async function runCrimson(
  deps: { db: Db; fetcher: SourceFetcher; store: SnapshotStore; logger: Logger; now?: () => Date },
  opts: {
    search: WebSearchProvider;
    clubSlug?: string;
    limit?: number;
    articlesPerClub?: number;
    concurrency?: number;
    /** Which publication to read (default The Harvard Crimson). */
    publisher?: Publisher;
    /** Search again for clubs already searched within a year. */
    refresh?: boolean;
  },
): Promise<{ runId: string; counters: CrimsonCounters; errors: string[] }> {
  const pub = opts.publisher ?? PUBLISHERS[0]!; // PUBLISHERS is a non-empty literal

  const { db, store, logger } = deps;
  const now = deps.now ?? (() => new Date());
  const runId = await startRun(db, {
    job: "crimson",
    adapter: pub.extractorName,
    adapterVersion: CRIMSON_VERSION,
    options: { clubSlug: opts.clubSlug ?? null, limit: opts.limit ?? null },
  });
  const crawl = emptyCrawlStats();
  const c: CrimsonCounters = {
    ...crawl,
    clubsConsidered: 0,
    searches: 0,
    searchesReused: 0,
    searchFailures: 0,
    articlesProbed: 0,
    articlesNotNamingClub: 0,
    mentionsRecorded: 0,
    clubsWithMentions: 0,
    clubsAlreadySearched: 0,
    stoppedForCredit: 0,
  };
  const errors: string[] = [];
  const touched = new Set<string>();

  try {
    const conds = [eq(schema.club.recordState, "active"), ne(schema.club.dataOrigin, "fixture")];
    if (opts.clubSlug) conds.push(inArray(schema.club.slug, opts.clubSlug.split(",")));
    let clubs = await db
      .select({
        id: schema.club.id,
        slug: schema.club.slug,
        name: schema.club.canonicalName,
        acronym: schema.club.acronym,
      })
      .from(schema.club)
      .where(and(...conds))
      .orderBy(schema.club.slug);
    if (opts.limit !== undefined) clubs = clubs.slice(0, opts.limit);
    const aliases = clubs.length
      ? await db
          .select({ clubId: schema.clubAlias.clubId, alias: schema.clubAlias.alias })
          .from(schema.clubAlias)
          .where(
            inArray(
              schema.clubAlias.clubId,
              clubs.map((x) => x.id),
            ),
          )
      : [];

    // Names already searched for this publication within a year: re-searching costs credit
    // and finds the same articles, so those clubs are skipped (search queries are stored
    // as sources titled "Search (<provider>): <query>").
    const since = new Date(now().getTime() - 365 * 86_400_000);
    const searched = new Set<string>();
    for (const row of await db
      .select({ title: schema.source.title })
      .from(schema.source)
      .where(and(eq(schema.source.adapter, pub.extractorName), gt(schema.source.lastFetchedAt, since)))) {
      for (const m of (row.title ?? "").matchAll(/"([^"]+)"/g)) searched.add(normalizeName(m[1] ?? ""));
    }

    type Target = { id: string; slug: string; names: string[] };
    const targets: Target[] = [];
    for (const club of clubs) {
      const names = searchableNames({
        name: club.name,
        acronym: club.acronym,
        aliases: aliases.filter((a) => a.clubId === club.id).map((a) => a.alias),
      });
      const primary = names[0];
      if (!primary) continue;
      c.clubsConsidered++;
      // Only paid search skips; a publication's own free search is simply asked again.
      if (opts.search.paid && !opts.refresh && searched.has(normalizeName(primary))) {
        c.clubsAlreadySearched++;
        continue;
      }
      targets.push({ id: club.id, slug: club.slug, names });
    }

    // Paid search: several clubs per query ("A" OR "B" …), each article checked against all
    // of them. A publication's own (free) search API: one club per query.
    const batchSize = opts.search.paid ? PAID_BATCH_SIZE : 1;
    const batches: Target[][] = [];
    for (let k = 0; k < targets.length; k += batchSize) batches.push(targets.slice(k, k + batchSize));

    let stop = false;
    let next = 0;
    const worker = async () => {
      while (next < batches.length && !stop) {
        const batch = batches[next++];
        if (!batch) continue;
        const quoted = batch.map((t) => `"${(t.names[0] ?? "").replace(/"/g, "")}"`);
        const query = `site:${pub.site} ${quoted.length > 1 ? `(${quoted.join(" OR ")})` : quoted[0]}`;
        let results: SearchResult[];
        try {
          // Paid results are kept a year; a free site search is asked again after 6 days.
          const r = await cachedSearch(
            { db, store, now },
            opts.search,
            query,
            runId,
            pub.extractorName,
            opts.search.paid ? 365 : 6,
          );
          if (r.reused) c.searchesReused++;
          else c.searches++;
          results = r.results;
        } catch (error) {
          if (error instanceof SearchCreditError) {
            // Out of credit (or at this run's cap): stop searching, keep what we have.
            stop = true;
            c.stoppedForCredit = 1;
            errors.push(`stopped: ${error.message}`);
            return;
          }
          c.searchFailures++;
          errors.push(`${batch.map((t) => t.slug).join(",")}: ${String(error)}`);
          continue;
        }
        const articles = results
          .map((x) => pub.article(x.url))
          .filter((x): x is { url: string; publishedOn: string | null } => x !== null)
          .filter((x, idx, all) => all.findIndex((y) => y.url === x.url) === idx)
          .slice(0, (opts.articlesPerClub ?? 4) * batch.length);
        for (const a of articles) {
          c.articlesProbed++;
          const [page] = await crawlSite({
            rootUrl: a.url,
            clubId: batch[0]?.id ?? "",
            officialSite: false,
            sourceTypeOverride: pub.sourceType,
            db,
            fetcher: deps.fetcher,
            store,
            runId,
            logger: logger.child({ publisher: pub.key }),
            now,
            maxPages: 1,
            maxDepth: 0,
            // Articles don't change: reuse a stored copy for a year.
            freshnessMs: 365 * 86_400_000,
            force: false,
            stats: crawl,
          });
          if (!page) continue;
          const title = articleHeadline(page.doc);
          const publishedOn = a.publishedOn ?? jsonLdPublished(page.doc);
          let named = false;
          for (const t of batch) {
            const quote = articleMention(page.doc, t.names);
            if (!quote || !title || !publishedOn) continue;
            named = true;
            const res = await upsertClaim(
              db,
              {
                clubId: t.id,
                fieldKey: "club.press_mention",
                value: { url: a.url, title, publishedOn, publisher: pub.name },
                assertionKind: "stated",
              },
              {
                sourceId: page.sourceId,
                sourceType: pub.sourceType,
                snapshotId: page.snapshotId,
                ingestionRunId: runId,
                observedAt: page.fetchedAt,
                quote,
                locator: { url: a.url, signal: "article text names the club" },
                extractionMethod: "html_parse",
                extractorName: pub.extractorName,
                extractorVersion: CRIMSON_VERSION,
                isDirect: true,
              },
            );
            if (res.claimCreated) c.mentionsRecorded++;
            if (!touched.has(t.id)) c.clubsWithMentions++;
            touched.add(t.id);
          }
          if (!named) c.articlesNotNamingClub++;
        }
      }
    };
    await Promise.all(Array.from({ length: Math.max(1, opts.concurrency ?? 3) }, worker));

    const stats = await resolveClubs(db, { clubIds: [...touched], now: now() });
    errors.push(...stats.errors.map((e) => `resolve ${e.clubId}: ${e.error}`));
    Object.assign(c, crawl);
    await finishRun(db, runId, {
      status: errors.length ? "partial" : "succeeded",
      counters: c,
      errorSummary: errors.slice(0, 50).join("\n") || null,
    });
    return { runId, counters: c, errors };
  } catch (error) {
    await finishRun(db, runId, { status: "failed", counters: c, errorSummary: String(error) });
    throw error;
  }
}
