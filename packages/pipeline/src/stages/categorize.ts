import { createHash } from "node:crypto";
import { and, desc, eq, inArray, isNull, ne } from "drizzle-orm";
import { finishRun, resolveClubs, schema, startRun, upsertClaim, type Db } from "@hci/db";
import { z } from "zod";
import { normalizeForMatch, type CacheKey } from "../extract/llm/extractor";
import type { LlmProvider } from "../extract/llm/provider";
import type { Logger } from "../logger";
import { DbExtractionCache } from "./enrich";

/**
 * categorize (ADR 0026): assign topical categories to clubs that have none, or that
 * have a top-level category with subcategories but no subcategory. The model picks from
 * the taxonomy and must quote the sentence of a stored snapshot that supports each pick;
 * unquoted or ungrounded picks are dropped. Categories are an interpretation, so the
 * claims are `inferred` and show with the Estimate badge (registry: allowInferred).
 */

export const CATEGORIZE_EXTRACTOR = "llm-categorize";
export const CATEGORIZE_PROMPT_VERSION = "categorize-v1";

const Output = z.object({
  categories: z.array(z.object({ slug: z.string(), quote: z.string().min(3).max(400) })).max(3),
});
type Output = z.infer<typeof Output>;

const SYSTEM = `You classify a student organization into topical categories.

Rules:
- Choose 1-3 category slugs ONLY from the list given. Prefer the most specific subcategory when one fits; a subcategory implies its parent.
- Base the choice ONLY on the provided text. Do not use outside knowledge about the organization.
- For each slug, "quote" must be an exact, verbatim, contiguous excerpt from the text that shows what the organization does.
- If the text doesn't say what the organization does, return {"categories": []}.
- Reply with JSON only.`;

export interface CategorizeCounters {
  clubsConsidered: number;
  clubsWithoutText: number;
  calls: number;
  cacheHits: number;
  failures: number;
  categoriesAdded: number;
  rejected: number;
  costUsd: number;
  [key: string]: number;
}

export async function runCategorize(
  deps: { db: Db; provider: LlmProvider; logger: Logger; now?: () => Date },
  opts: { budgetUsd: number; clubSlug?: string; limit?: number },
): Promise<{ runId: string; counters: CategorizeCounters; errors: string[] }> {
  const { db, provider, logger } = deps;
  const now = deps.now ?? (() => new Date());
  const runId = await startRun(db, {
    job: "categorize",
    adapter: CATEGORIZE_EXTRACTOR,
    adapterVersion: CATEGORIZE_PROMPT_VERSION,
    options: { budgetUsd: opts.budgetUsd, model: provider.model },
  });
  const c: CategorizeCounters = {
    clubsConsidered: 0,
    clubsWithoutText: 0,
    calls: 0,
    cacheHits: 0,
    failures: 0,
    categoriesAdded: 0,
    rejected: 0,
    costUsd: 0,
  };
  const errors: string[] = [];
  const touched: string[] = [];
  const cache = new DbExtractionCache(db);

  try {
    const cats = await db
      .select({
        id: schema.category.id,
        slug: schema.category.slug,
        name: schema.category.name,
        parent: schema.category.parentId,
      })
      .from(schema.category);
    const bySlug = new Map(cats.map((x) => [x.slug, x]));
    const parentsWithChildren = new Set(cats.filter((x) => x.parent).map((x) => x.parent));
    const taxonomy = cats
      .filter((x) => !x.parent)
      .map((p) => {
        const kids = cats.filter((k) => k.parent === p.id);
        return `- ${p.slug} (${p.name})${kids.length ? `\n${kids.map((k) => `  - ${k.slug} (${k.name})`).join("\n")}` : ""}`;
      })
      .join("\n");

    const conds = [eq(schema.club.recordState, "active"), ne(schema.club.dataOrigin, "fixture")];
    if (opts.clubSlug) conds.push(inArray(schema.club.slug, opts.clubSlug.split(",")));
    const clubs = await db
      .select({ id: schema.club.id, slug: schema.club.slug, name: schema.club.canonicalName })
      .from(schema.club)
      .where(and(...conds))
      .orderBy(schema.club.slug);
    const assigned = await db
      .select({ clubId: schema.clubCategory.clubId, categoryId: schema.clubCategory.categoryId })
      .from(schema.clubCategory);
    const targets = clubs.filter((club) => {
      const mine = assigned.filter((a) => a.clubId === club.id).map((a) => a.categoryId);
      if (mine.length === 0) return true;
      // A top-level category that has subcategories, but none of them assigned.
      const hasSub = mine.some((id) => cats.find((x) => x.id === id)?.parent);
      return !hasSub && mine.some((id) => parentsWithChildren.has(id));
    });
    const queue = opts.limit !== undefined ? targets.slice(0, opts.limit) : targets;

    for (const club of queue) {
      c.clubsConsidered++;
      // The page(s) a description of this club came from: that's what the quote must match.
      const snaps = await db
        .selectDistinct({
          snapshotId: schema.sourceSnapshot.id,
          sourceId: schema.sourceSnapshot.sourceId,
          sourceType: schema.source.sourceType,
          text: schema.sourceSnapshot.extractedText,
          fetchedAt: schema.sourceSnapshot.fetchedAt,
        })
        .from(schema.claim)
        .innerJoin(schema.claimEvidence, eq(schema.claimEvidence.claimId, schema.claim.id))
        .innerJoin(schema.sourceSnapshot, eq(schema.sourceSnapshot.id, schema.claimEvidence.snapshotId))
        .innerJoin(schema.source, eq(schema.source.id, schema.sourceSnapshot.sourceId))
        .where(
          and(
            eq(schema.claim.clubId, club.id),
            eq(schema.claim.status, "active"),
            inArray(schema.claim.fieldKey, ["club.short_description", "club.long_description", "club.mission"]),
            isNull(schema.claimEvidence.submissionId),
          ),
        )
        .orderBy(desc(schema.sourceSnapshot.fetchedAt))
        .limit(2);
      const pages = snaps.filter((s) => (s.text ?? "").length > 80);
      if (pages.length === 0) {
        c.clubsWithoutText++;
        continue;
      }
      const user = `Organization: ${club.name}\n\nCategories:\n${taxonomy}\n\nText:\n${pages
        .map((p, i) => `<text id="${i}">\n${(p.text ?? "").slice(0, 6000)}\n</text>`)
        .join("\n\n")}\n\nReply as {"categories": [{"slug": string, "quote": string}]}`;
      const key: CacheKey = {
        textSha256: createHash("sha256")
          .update(SYSTEM + user)
          .digest("hex"),
        extractor: CATEGORIZE_EXTRACTOR,
        promptVersion: CATEGORIZE_PROMPT_VERSION,
        provider: provider.name,
        model: provider.model,
      };
      let output: Output | null = null;
      const cached = await cache.get(key);
      if (cached?.status === "ok" && cached.output) {
        c.cacheHits++;
        output = cached.output as unknown as Output;
      } else {
        if (c.costUsd >= opts.budgetUsd) break;
        c.calls++;
        const res = await provider.complete({
          system: SYSTEM,
          user,
          schema: Output,
          jsonShape: '{"categories": [{"slug": string, "quote": string}]}',
          maxTokens: 800,
        });
        c.costUsd += res.usage?.costUsd ?? 0;
        if (!res.ok) {
          c.failures++;
          errors.push(`${club.slug}: ${res.error}`);
          continue;
        }
        output = res.output;
        await cache.put(key, {
          status: "ok",
          output: output as never,
          usage: res.usage,
          error: null,
          attempts: 1,
          snapshotId: pages[0]?.snapshotId ?? null,
        });
      }
      let added = 0;
      for (const pick of output.categories) {
        const cat = bySlug.get(pick.slug);
        const q = normalizeForMatch(pick.quote);
        const page = pages.find((p) => normalizeForMatch(p.text ?? "").includes(q));
        if (!cat || !page) {
          c.rejected++;
          continue;
        }
        // A subcategory implies its parent; write both so browsing by either works.
        const parent = cat.parent ? cats.find((x) => x.id === cat.parent) : null;
        for (const slug of [cat.slug, ...(parent ? [parent.slug] : [])]) {
          const r = await upsertClaim(
            db,
            { clubId: club.id, fieldKey: "club.category", value: slug, assertionKind: "inferred" },
            {
              sourceId: page.sourceId,
              sourceType: page.sourceType as never,
              snapshotId: page.snapshotId,
              ingestionRunId: runId,
              observedAt: page.fetchedAt,
              quote: pick.quote,
              locator: { signal: "LLM category from the club's description" },
              extractionMethod: "llm",
              extractorName: CATEGORIZE_EXTRACTOR,
              extractorVersion: CATEGORIZE_PROMPT_VERSION,
              llmModel: provider.model,
              promptVersion: CATEGORIZE_PROMPT_VERSION,
              isDirect: false,
            },
          );
          if (r.claimCreated) added++;
        }
      }
      c.categoriesAdded += added;
      if (added) touched.push(club.id);
      logger.debug({ club: club.slug, picks: output.categories.map((p) => p.slug) }, "categorized");
    }

    const stats = await resolveClubs(db, { clubIds: touched, now: now() });
    errors.push(...stats.errors.map((e) => `resolve ${e.clubId}: ${e.error}`));
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
