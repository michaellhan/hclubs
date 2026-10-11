import { and, eq, inArray, ne, sql } from "drizzle-orm";
import { normalizeUrl } from "@hci/core";
import { finishRun, schema, startRun, type Db } from "@hci/db";
import { crawlSite, emptyCrawlStats } from "../crawl/site";
import { isFormUrl } from "../parse/forms";
import type { Logger } from "../logger";
import type { SnapshotStore } from "../snapshots/store";
import type { SourceFetcher } from "../types";

/**
 * Re-fetch the application forms profiles show (links and rounds' application links), so a form that stopped taking responses is
 * seen as closed (the audit's `application.form_closed` then rejects the link). Enrichment
 * reads only a club's top three verified forms, and a form linked from a page the crawl no
 * longer reaches was never fetched at all, so a closed one could stay on a profile for a
 * whole year (HSA's 2025 coffee-chat sign-up). One polite request per form; no claims.
 */

/** A form page that says it no longer takes responses (Google: redirects to /closedform). */
export const CLOSED_FORM_TEXT =
  /\b(?:is no longer accepting responses|no longer accepting responses|this form is (?:now )?closed|form has been closed)\b/i;

/** `db.execute` rows: an array from postgres-js, `{ rows }` from PGlite (tests). */
function rowsOf<T>(r: unknown): T[] {
  return (Array.isArray(r) ? r : ((r as { rows?: T[] }).rows ?? [])) as T[];
}

export interface CheckFormsOptions {
  /** One slug, or several separated by commas. */
  clubSlug?: string;
  /** Forms fetched more recently than this are not requested again (default 7 days). */
  staleDays?: number;
  limit?: number;
  dryRun?: boolean;
}

export interface CheckFormsResult {
  runId: string | null;
  considered: number;
  fetched: number;
  closed: { slug: string; url: string }[];
  failed: number;
}

export async function runCheckForms(
  deps: { db: Db; fetcher: SourceFetcher; store: SnapshotStore; logger: Logger; now?: () => Date },
  opts: CheckFormsOptions = {},
): Promise<CheckFormsResult> {
  const { db, logger } = deps;
  const now = deps.now ?? (() => new Date());
  const staleMs = (opts.staleDays ?? 7) * 86_400_000;
  const slugs = opts.clubSlug
    ?.split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  // Every form a profile shows (any status but rejected), on clubs the site shows…
  const shown = await db
    .select({
      url: schema.clubLink.url,
      status: schema.clubLink.status,
      slug: schema.club.slug,
      clubId: schema.club.id,
    })
    .from(schema.clubLink)
    .innerJoin(schema.club, eq(schema.club.id, schema.clubLink.clubId))
    .where(
      and(
        eq(schema.clubLink.kind, "application_form"),
        ne(schema.clubLink.status, "rejected"),
        eq(schema.club.recordState, "active"),
        ...(slugs?.length ? [inArray(schema.club.slug, slugs)] : []),
      ),
    );
  // …and forms a round links as its application (the "Form" row), shown even after the link is.
  const rounds = rowsOf<{ url: string; slug: string; clubId: string }>(
    await db.execute(sql`
      select distinct c.value #>> '{}' as "url", k.slug, k.id as "clubId"
      from ${schema.claim} c join ${schema.club} k on k.id = c.club_id and k.record_state = 'active'
      where c.field_key = 'cycle.application_url' and c.status = 'active' and jsonb_typeof(c.value) = 'string'`),
  ).filter((r) => isFormUrl(r.url) && (!slugs?.length || slugs.includes(r.slug)));
  const byKey = new Map<string, { url: string; status: string; slug: string; clubId: string }>();
  for (const l of [...shown, ...rounds.map((r) => ({ ...r, status: "unverified" }))])
    if (!byKey.has(`${l.clubId}|${normalizeUrl(l.url) ?? l.url}`))
      byKey.set(`${l.clubId}|${normalizeUrl(l.url) ?? l.url}`, l);
  const links = [...byKey.values()].sort((a, b) => a.slug.localeCompare(b.slug) || a.url.localeCompare(b.url));

  // Skip forms requested recently (a sign-in-only or deleted form has no stored copy, so the
  // last request counts, not the last snapshot).
  const lastFetched = new Map<string, Date>();
  for (const r of rowsOf<{ url: string; at: Date | string }>(
    await db.execute(sql`
      select s.normalized_url as "url", max(f.started_at) as "at"
      from ${schema.source} s join ${schema.fetchAttempt} f on f.source_id = s.id
      group by s.normalized_url`),
  ))
    lastFetched.set(r.url, new Date(r.at));
  const due = links
    .filter((l) => {
      const at = lastFetched.get(normalizeUrl(l.url) ?? l.url);
      return !at || now().getTime() - at.getTime() >= staleMs;
    })
    .slice(0, opts.limit);

  const result: CheckFormsResult = { runId: null, considered: links.length, fetched: 0, closed: [], failed: 0 };
  if (opts.dryRun) {
    for (const l of due) logger.info({ club: l.slug, url: l.url }, "would check form");
    result.fetched = due.length;
    return result;
  }

  const runId = await startRun(db, { job: "check-forms", adapter: "site-crawler", options: { ...opts } });
  result.runId = runId;
  const stats = emptyCrawlStats();
  try {
    for (const l of due) {
      const pages = await crawlSite({
        rootUrl: l.url,
        clubId: l.clubId,
        officialSite: false,
        sourceTypeOverride: l.status === "verified" ? "club_recruiting_material" : "public_web",
        roleOverride: "recruiting",
        db,
        fetcher: deps.fetcher,
        store: deps.store,
        runId,
        logger: logger.child({ club: l.slug }),
        now,
        maxPages: 1,
        maxDepth: 0,
        freshnessMs: staleMs,
        force: false,
        stats,
      });
      const page = pages[0];
      if (!page) {
        result.failed++;
        continue;
      }
      result.fetched++;
      if (CLOSED_FORM_TEXT.test(page.doc.text)) result.closed.push({ slug: l.slug, url: l.url });
    }
    await finishRun(db, runId, {
      status: "succeeded",
      counters: { considered: result.considered, due: due.length, ...stats, closed: result.closed.length },
      errorSummary: null,
    });
  } catch (error) {
    await finishRun(db, runId, { status: "failed", counters: { ...stats }, errorSummary: String(error) });
    throw error;
  }
  return result;
}
