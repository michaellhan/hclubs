import { eq } from "drizzle-orm";
import type { SourceType } from "@hci/core";
import { finishRun, resolveClubs, schema, startRun, upsertClaim, type Db } from "@hci/db";
import { crawlSite, emptyCrawlStats } from "../crawl/site";
import { LIFECYCLE_ENTRIES, LIFECYCLE_LIST_VERSION, LifecycleEntry } from "../curated/lifecycle";
import type { Logger } from "../logger";
import type { SnapshotStore } from "../snapshots/store";
import type { SourceFetcher } from "../types";

/**
 * lifecycle (ADR 0038): record organizations that ended, from the editor's list in
 * `curated/lifecycle.ts`. Each ending needs a public page whose text contains every listed
 * quote verbatim; without that nothing is written. The claims carry the page as evidence
 * (its own tier), so `explain` shows exactly what says the club ended.
 */
export const LIFECYCLE_EXTRACTOR = "lifecycle-list";

/** Whitespace, quote and dash differences don't make a quote "missing". PURE. */
export function normalizeForQuote(text: string): string {
  return text
    .normalize("NFKC")
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[‐-―]/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

/** Which listed quotes the page text lacks. PURE. */
export function missingQuotes(text: string, quotes: readonly string[]): string[] {
  const hay = normalizeForQuote(text);
  return quotes.filter((q) => !hay.includes(normalizeForQuote(q)));
}

function evidenceSourceType(url: string): SourceType {
  const host = new URL(url).hostname.replace(/^www\./, "");
  if (host === "thecrimson.com") return "harvard_crimson";
  return "public_web";
}

export interface LifecycleOutcome {
  slug: string;
  result: string;
}

export async function runLifecycle(
  deps: { db: Db; fetcher: SourceFetcher; store: SnapshotStore; logger: Logger; now?: () => Date },
  opts: { dryRun?: boolean; entries?: LifecycleEntry[] } = {},
): Promise<{ runId: string; outcomes: LifecycleOutcome[]; errors: string[] }> {
  const { db, logger } = deps;
  const now = deps.now ?? (() => new Date());
  const entries = (opts.entries ?? LIFECYCLE_ENTRIES).map((e) => LifecycleEntry.parse(e));
  const runId = await startRun(db, {
    job: "lifecycle",
    adapter: LIFECYCLE_EXTRACTOR,
    adapterVersion: LIFECYCLE_LIST_VERSION,
    options: { dryRun: opts.dryRun ?? false, entries: entries.length },
  });
  const crawl = emptyCrawlStats();
  const outcomes: LifecycleOutcome[] = [];
  const errors: string[] = [];
  const touched: string[] = [];
  const clubBySlug = async (slug: string) =>
    (
      await db
        .select({ id: schema.club.id, name: schema.club.canonicalName, state: schema.club.recordState })
        .from(schema.club)
        .where(eq(schema.club.slug, slug))
    )[0];

  for (const entry of entries) {
    const out: LifecycleOutcome = { slug: entry.slug, result: "" };
    outcomes.push(out);
    try {
      const ended = await clubBySlug(entry.slug);
      if (!ended || ended.state !== "active") throw new Error(`club ${entry.slug} not found or not active`);
      const successor = entry.successorSlug ? await clubBySlug(entry.successorSlug) : null;
      if (entry.successorSlug && !successor) throw new Error(`successor ${entry.successorSlug} not found`);
      if (entry.event === "replaced" && !successor) throw new Error("a replacement needs its successor's slug");

      const sourceType = evidenceSourceType(entry.evidence.url);
      const [page] = await crawlSite({
        rootUrl: entry.evidence.url,
        clubId: ended.id,
        officialSite: false,
        sourceTypeOverride: sourceType,
        db,
        fetcher: deps.fetcher,
        store: deps.store,
        runId,
        logger: logger.child({ slug: entry.slug }),
        now,
        maxPages: 1,
        maxDepth: 0,
        freshnessMs: 30 * 86_400_000,
        force: false,
        stats: crawl,
      });
      if (!page) throw new Error(`could not fetch ${entry.evidence.url}`);
      const missing = missingQuotes(page.doc.text, entry.evidence.quotes);
      if (missing.length) throw new Error(`page doesn't contain: ${missing.map((q) => `"${q}"`).join(", ")}`);
      if (opts.dryRun) {
        out.result = "would record (quotes found)";
        continue;
      }

      const quote = entry.evidence.quotes.join(" … ");
      const evidence = {
        sourceId: page.sourceId,
        sourceType,
        snapshotId: page.snapshotId,
        ingestionRunId: runId,
        observedAt: page.fetchedAt,
        quote,
        locator: { url: page.url, signal: "editor-listed ending; quotes verified in the page text" },
        extractionMethod: "manual" as const,
        extractorName: LIFECYCLE_EXTRACTOR,
        extractorVersion: LIFECYCLE_LIST_VERSION,
        isDirect: true,
      };
      await upsertClaim(
        db,
        { clubId: ended.id, fieldKey: "club.activity_status", value: "defunct", assertionKind: "stated" },
        evidence,
      );
      await upsertClaim(
        db,
        {
          clubId: ended.id,
          fieldKey: "club.lifecycle",
          value: {
            event: entry.event,
            year: entry.year,
            successorClubId: successor?.id ?? null,
            successorName: successor?.name ?? null,
          },
          assertionKind: "stated",
        },
        evidence,
      );
      await db.insert(schema.editorialDecision).values({
        actor: LIFECYCLE_EXTRACTOR,
        action: "record_ending",
        targetType: "club",
        targetId: ended.id,
        reason: `${entry.event}${entry.year ? ` in ${entry.year}` : ""}${successor ? ` by ${entry.successorSlug}` : ""}`,
        payload: { evidenceUrl: entry.evidence.url, listVersion: LIFECYCLE_LIST_VERSION },
      });
      touched.push(ended.id);
      out.result = successor ? `defunct; replaced by ${entry.successorSlug}` : "defunct";
    } catch (error) {
      out.result = `error: ${error instanceof Error ? error.message : String(error)}`;
      errors.push(`${entry.slug}: ${out.result}`);
    }
  }

  const stats = await resolveClubs(db, { clubIds: touched, now: now() });
  errors.push(...stats.errors.map((e) => `resolve ${e.clubId}: ${e.error}`));
  await finishRun(db, runId, {
    status: errors.length ? "partial" : "succeeded",
    counters: { ...crawl, entries: entries.length, recorded: touched.length },
    errorSummary: errors.slice(0, 50).join("\n") || null,
  });
  return { runId, outcomes, errors };
}
