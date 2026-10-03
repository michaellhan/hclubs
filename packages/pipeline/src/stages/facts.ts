import { and, eq } from "drizzle-orm";
import type { SourceType } from "@hci/core";
import { finishRun, resolveClubs, schema, startRun, upsertClaim, type Db } from "@hci/db";
import { crawlSite, emptyCrawlStats } from "../crawl/site";
import { CURATED_FACTS, CURATED_FACTS_VERSION, CuratedFactsEntry, type CuratedFact } from "../curated/facts";
import {
  duesProblem,
  eligibleClassesProblem,
  freshmenEligibleProblem,
  hoursProblem,
  joinModeProblem,
  memberCountProblem,
  numberAppears,
} from "../extract/evidence-rules";
import type { Logger } from "../logger";
import type { SnapshotStore } from "../snapshots/store";
import type { SourceFetcher } from "../types";
import { missingQuotes } from "./lifecycle";

/**
 * facts (ADR 0044): write the editor-read facts in `curated/facts.ts`. Each entry's page is
 * fetched; a fact is written only when its quote is on the page verbatim and passes the same
 * evidence rules the extractors use (numbers literal, join modes not negated or about a
 * role, first-year wording that actually opens membership). The page's tier is its own:
 * the club's website only when the host is the club's verified site.
 */
export const FACTS_EXTRACTOR = "curated-facts";

/** Why a fact's quote doesn't support its value, or null. PURE. */
export function factProblem(fact: CuratedFact, pageText: string): string | null {
  const p = (() => {
    switch (fact.field) {
      case "club.join_mode":
        return joinModeProblem(fact.value, fact.quote, pageText);
      case "club.freshmen_eligible":
        return freshmenEligibleProblem(fact.value, fact.quote);
      case "club.eligible_classes":
        return eligibleClassesProblem(fact.value, fact.quote);
      case "club.hours_per_week":
        return hoursProblem(
          fact.quote,
          [fact.value.min, fact.value.max].filter((n): n is number => n !== null),
        );
      case "club.member_count":
        return memberCountProblem(
          fact.quote,
          fact.value.kind === "exact"
            ? [fact.value.count]
            : [fact.value.min, fact.value.max].filter((n): n is number => n !== null),
        );
      case "club.dues":
        return duesProblem(fact.quote, fact.value.amountUsd);
      default:
        return null;
    }
  })();
  if (p) return p.why;
  if (fact.field === "club.mission" || fact.field === "club.long_description" || fact.field === "club.activity") {
    const flat = (t: string) => t.replace(/\s+/g, " ").trim().toLowerCase();
    if (!flat(fact.quote).includes(flat(fact.value))) return "the value is not in its quote verbatim";
  }
  // Any number in a free-text value must be on the page too.
  if (fact.field === "club.experience_required" || fact.field === "club.meeting_frequency") {
    const nums = (fact.value.match(/\d+(?:\.\d+)?/g) ?? []).map(Number);
    const missing = nums.filter((n) => !numberAppears(n, fact.quote));
    if (missing.length) return `${missing.join(", ")} does not appear in the quote`;
  }
  return null;
}

function hostOf(url: string): string {
  return new URL(url).hostname.toLowerCase().replace(/^www\./, "");
}

/** The page's source type: the club's own site only when its host is the verified website. PURE. */
export function factsSourceType(url: string, verifiedSites: readonly string[]): SourceType {
  const host = hostOf(url);
  const path = new URL(url).pathname;
  for (const site of verifiedSites) {
    const s = new URL(site);
    const sitePath = s.pathname.replace(/\/$/, "");
    if (hostOf(site) === host && (sitePath === "" || path.startsWith(sitePath))) return "club_website";
  }
  if (host === "thecrimson.com") return "harvard_crimson";
  if (host === "news.harvard.edu") return "harvard_related_other"; // the Harvard Gazette
  return "public_web";
}

export interface FactsOutcome {
  slug: string;
  url: string;
  result: string;
}

export async function runFacts(
  deps: { db: Db; fetcher: SourceFetcher; store: SnapshotStore; logger: Logger; now?: () => Date },
  opts: { dryRun?: boolean; entries?: CuratedFactsEntry[]; slugs?: string[] } = {},
): Promise<{ runId: string; outcomes: FactsOutcome[]; errors: string[] }> {
  const { db, logger } = deps;
  const now = deps.now ?? (() => new Date());
  const entries = (opts.entries ?? CURATED_FACTS)
    .map((e) => CuratedFactsEntry.parse(e))
    .filter((e) => !opts.slugs?.length || opts.slugs.includes(e.slug));
  const runId = await startRun(db, {
    job: "facts",
    adapter: FACTS_EXTRACTOR,
    adapterVersion: CURATED_FACTS_VERSION,
    options: { dryRun: opts.dryRun ?? false, entries: entries.length },
  });
  const crawl = emptyCrawlStats();
  const outcomes: FactsOutcome[] = [];
  const errors: string[] = [];
  const touched = new Set<string>();
  let written = 0;

  for (const entry of entries) {
    const out: FactsOutcome = { slug: entry.slug, url: entry.url, result: "" };
    outcomes.push(out);
    try {
      const [club] = await db
        .select({ id: schema.club.id, state: schema.club.recordState })
        .from(schema.club)
        .where(eq(schema.club.slug, entry.slug));
      if (!club || club.state !== "active") throw new Error(`club ${entry.slug} not found or not active`);
      const sites = await db
        .select({ url: schema.clubLink.url })
        .from(schema.clubLink)
        .where(
          and(
            eq(schema.clubLink.clubId, club.id),
            eq(schema.clubLink.kind, "website"),
            eq(schema.clubLink.status, "verified"),
          ),
        );
      const sourceType = factsSourceType(
        entry.url,
        sites.map((s) => s.url),
      );
      const [page] = await crawlSite({
        rootUrl: entry.url,
        clubId: club.id,
        officialSite: sourceType === "club_website",
        sourceTypeOverride: sourceType,
        db,
        fetcher: deps.fetcher,
        store: deps.store,
        runId,
        logger: logger.child({ slug: entry.slug }),
        now,
        maxPages: 1,
        maxDepth: 0,
        freshnessMs: 7 * 86_400_000,
        force: false,
        stats: crawl,
      });
      if (!page) throw new Error(`could not fetch ${entry.url}`);

      const problems: string[] = [];
      const good: CuratedFact[] = [];
      for (const fact of entry.facts) {
        const missing = missingQuotes(page.doc.text, [fact.quote]);
        const why = missing.length
          ? `quote not on the page: "${fact.quote.slice(0, 80)}"`
          : factProblem(fact, page.doc.text);
        if (why) problems.push(`${fact.field}: ${why}`);
        else good.push(fact);
      }
      if (!opts.dryRun) {
        for (const fact of good) {
          await upsertClaim(
            db,
            { clubId: club.id, fieldKey: fact.field, value: fact.value, assertionKind: "stated" },
            {
              sourceId: page.sourceId,
              sourceType,
              snapshotId: page.snapshotId,
              ingestionRunId: runId,
              observedAt: page.fetchedAt,
              quote: fact.quote,
              locator: { url: page.url, signal: "editor-read fact; quote verified in the page text" },
              extractionMethod: "manual",
              extractorName: FACTS_EXTRACTOR,
              extractorVersion: CURATED_FACTS_VERSION,
              isDirect: true,
            },
          );
          written++;
        }
        if (good.length) {
          await db.insert(schema.editorialDecision).values({
            actor: FACTS_EXTRACTOR,
            action: "record_facts",
            targetType: "club",
            targetId: club.id,
            reason: good.map((f) => f.field).join(", "),
            payload: { url: entry.url, listVersion: CURATED_FACTS_VERSION, sourceType },
          });
          touched.add(club.id);
        }
      }
      out.result = `${opts.dryRun ? "would write" : "wrote"} ${good.length}/${entry.facts.length} (${sourceType})`;
      if (problems.length) {
        out.result += `; rejected: ${problems.join(" | ")}`;
        errors.push(`${entry.slug}: ${problems.join(" | ")}`);
      }
    } catch (error) {
      out.result = `error: ${error instanceof Error ? error.message : String(error)}`;
      errors.push(`${entry.slug}: ${out.result}`);
    }
  }

  const stats = await resolveClubs(db, { clubIds: [...touched], now: now() });
  errors.push(...stats.errors.map((e) => `resolve ${e.clubId}: ${e.error}`));
  await finishRun(db, runId, {
    status: errors.length ? "partial" : "succeeded",
    counters: { ...crawl, entries: entries.length, written },
    errorSummary: errors.slice(0, 50).join("\n") || null,
  });
  return { runId, outcomes, errors };
}
