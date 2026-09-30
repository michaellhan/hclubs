import { createHash } from "node:crypto";
import { and, desc, eq, inArray, isNull, ne } from "drizzle-orm";
import { finishRun, resolveClubs, schema, startRun, upsertClaim, type Db } from "@hci/db";
import { z } from "zod";
import { normalizeForMatch, type CacheKey } from "../extract/llm/extractor";
import type { LlmProvider } from "../extract/llm/provider";
import type { Logger } from "../logger";
import { DbExtractionCache } from "./enrich";

/**
 * summarize (ADR 0029): a clean one-line summary of what each club does, for the directory
 * and profile header, written from the club's own stored pages. The model must name the
 * sentence it relied on (verified verbatim), may not introduce numbers the text doesn't
 * contain, and can decline. Stored as an `inferred` `club.summary` claim; the sourced
 * descriptions stay as they are.
 */

export const SUMMARIZE_EXTRACTOR = "llm-summary";
export const SUMMARIZE_PROMPT_VERSION = "summary-v1";

const Output = z.object({
  summary: z.string().max(200).nullable(),
  basis_quote: z.string().max(600).nullable(),
});
type Output = z.infer<typeof Output>;

const SYSTEM = `You write one-line summaries of Harvard student organizations for a club directory.

Rules:
- One sentence, 60–140 characters, plain and specific: what the group does and for whom. No hype ("premier", "leading"), no "Harvard's", no emojis.
- Start with a verb or noun phrase, not the club's name (e.g. "Student-run investment fund managing a long-short equity portfolio.").
- Use ONLY the provided text. Don't add facts, dates, numbers, rankings or claims it doesn't state.
- "basis_quote": copy verbatim the sentence from the text your summary mainly relies on.
- If the text doesn't say what the organization does, return {"summary": null, "basis_quote": null}.
- Reply with JSON only.`;

export interface SummarizeCounters {
  clubsConsidered: number;
  clubsWithoutText: number;
  calls: number;
  cacheHits: number;
  failures: number;
  summariesWritten: number;
  declined: number;
  rejected: number;
  costUsd: number;
  [key: string]: number;
}

const digits = (s: string) => new Set(s.match(/\d+/g) ?? []);

/** A summary is usable only if it's grounded and adds no numbers. PURE. */
export function checkSummary(
  out: Output,
  sourceText: string,
): { ok: true; summary: string; quote: string } | { ok: false; why: string } {
  if (!out.summary || !out.basis_quote) return { ok: false, why: "declined" };
  const summary = out.summary.replace(/\s+/g, " ").trim();
  if (summary.length < 20 || summary.length > 200) return { ok: false, why: "length" };
  if (!normalizeForMatch(sourceText).includes(normalizeForMatch(out.basis_quote)))
    return { ok: false, why: "basis quote not in text" };
  const allowed = digits(sourceText);
  for (const d of digits(summary)) if (!allowed.has(d)) return { ok: false, why: `number ${d} not in text` };
  return { ok: true, summary, quote: out.basis_quote };
}

export async function runSummarize(
  deps: { db: Db; provider: LlmProvider; logger: Logger; now?: () => Date },
  opts: { budgetUsd: number; clubSlug?: string; limit?: number; refresh?: boolean },
): Promise<{ runId: string; counters: SummarizeCounters; errors: string[] }> {
  const { db, provider, logger } = deps;
  const now = deps.now ?? (() => new Date());
  const runId = await startRun(db, {
    job: "summarize",
    adapter: SUMMARIZE_EXTRACTOR,
    adapterVersion: SUMMARIZE_PROMPT_VERSION,
    options: { budgetUsd: opts.budgetUsd, model: provider.model },
  });
  const c: SummarizeCounters = {
    clubsConsidered: 0,
    clubsWithoutText: 0,
    calls: 0,
    cacheHits: 0,
    failures: 0,
    summariesWritten: 0,
    declined: 0,
    rejected: 0,
    costUsd: 0,
  };
  const errors: string[] = [];
  const touched: string[] = [];
  const cache = new DbExtractionCache(db);

  try {
    const conds = [eq(schema.club.recordState, "active"), ne(schema.club.dataOrigin, "fixture")];
    if (opts.clubSlug) conds.push(inArray(schema.club.slug, opts.clubSlug.split(",")));
    let clubs = await db
      .select({
        id: schema.club.id,
        slug: schema.club.slug,
        name: schema.club.canonicalName,
        fields: schema.club.fields,
      })
      .from(schema.club)
      .where(and(...conds))
      .orderBy(schema.club.slug);
    // Clubs that already have a summary keep it unless asked to refresh.
    if (!opts.refresh) clubs = clubs.filter((x) => !(x.fields as Record<string, unknown>)["club.summary"]);
    if (opts.limit !== undefined) clubs = clubs.slice(0, opts.limit);

    for (const club of clubs) {
      c.clubsConsidered++;
      // Text the club's descriptions came from: own site pages first, then directory pages.
      const snaps = await db
        .selectDistinct({
          snapshotId: schema.sourceSnapshot.id,
          sourceId: schema.sourceSnapshot.sourceId,
          sourceType: schema.source.sourceType,
          tier: schema.source.trustTier,
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
        .limit(3);
      const pages = snaps
        .filter((s) => (s.text ?? "").length > 80)
        .sort((a, b) => a.tier - b.tier)
        .slice(0, 2);
      if (pages.length === 0) {
        c.clubsWithoutText++;
        continue;
      }
      const text = pages.map((p) => (p.text ?? "").slice(0, 5000)).join("\n\n");
      const user = `Organization: ${club.name}\n\nText:\n${text}\n\nReply as {"summary": string | null, "basis_quote": string | null}`;
      const key: CacheKey = {
        textSha256: createHash("sha256")
          .update(SYSTEM + user)
          .digest("hex"),
        extractor: SUMMARIZE_EXTRACTOR,
        promptVersion: SUMMARIZE_PROMPT_VERSION,
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
          jsonShape: '{"summary": string | null, "basis_quote": string | null}',
          maxTokens: 600,
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
      const checked = checkSummary(output, text);
      if (!checked.ok) {
        if (checked.why === "declined") c.declined++;
        else c.rejected++;
        logger.debug({ club: club.slug, why: checked.why }, "summary not used");
        continue;
      }
      const page =
        pages.find((p) => normalizeForMatch(p.text ?? "").includes(normalizeForMatch(checked.quote))) ?? pages[0];
      if (!page) continue;
      await upsertClaim(
        db,
        { clubId: club.id, fieldKey: "club.summary", value: checked.summary, assertionKind: "inferred" },
        {
          sourceId: page.sourceId,
          sourceType: page.sourceType as never,
          snapshotId: page.snapshotId,
          ingestionRunId: runId,
          observedAt: page.fetchedAt,
          quote: checked.quote,
          locator: { signal: "one-line summary of the club's own text" },
          extractionMethod: "llm",
          extractorName: SUMMARIZE_EXTRACTOR,
          extractorVersion: SUMMARIZE_PROMPT_VERSION,
          llmModel: provider.model,
          promptVersion: SUMMARIZE_PROMPT_VERSION,
          isDirect: false,
        },
      );
      c.summariesWritten++;
      touched.push(club.id);
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
