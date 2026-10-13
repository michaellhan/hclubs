import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createClub,
  recordSnapshot,
  recordSnapshotExtractions,
  retractUnreproducedClaims,
  seedTaxonomy,
  upsertClaim,
  upsertSource,
  type Db,
} from "@hci/db";
import { createTestDb } from "@hci/db/testing";
import {
  LLM_EXTRACTOR,
  emptyLlmCoverage,
  emptyLlmStats,
  extractWithLlm,
  llmPagesFullyRead,
  type CachedExtraction,
  type CacheKey,
  type ExtractionCacheStore,
  type LlmCoverage,
  type LlmPage,
} from "../src/extract/llm/extractor";
import {
  costFor,
  type LlmProvider,
  type StructuredRequest,
  type StructuredResponse,
} from "../src/extract/llm/provider";
import type { LlmExtraction } from "../src/extract/llm/schema";
import { silentLogger } from "../src/logger";

/**
 * A page counts as re-read by the LLM extractor only when every request covering it ran or
 * replayed from the cache (2026-10-13): after a grounding bump, an offline replay with paid APIs
 * off misses some chunks, and `retract-unreproduced` must keep what those pages said.
 */
const NOW = new Date("2026-10-13T16:00:00Z");
const OLD = "club-extract-v4+g0";
// ~25k characters: each page fills its own chunk.
const filler = (word: string) => ` ${word} filler text for chunking.`.repeat(900);

const empty = (): LlmExtraction => ({
  short_description: null,
  mission: null,
  join_modes: [],
  eligible_classes: null,
  prior_experience: null,
  hours_per_week: null,
  member_count: null,
  dues: null,
  recruiting: [],
  recruiting_seasons: null,
  selectivity: [],
  activities: [],
  sponsors: [],
});

class FakeProvider implements LlmProvider {
  readonly name = "fake";
  readonly model = "claude-opus-5-5";
  calls: StructuredRequest<unknown>[] = [];
  constructor(private readonly queue: StructuredResponse<LlmExtraction>[]) {}
  async complete<T>(req: StructuredRequest<T>): Promise<StructuredResponse<T>> {
    this.calls.push(req as StructuredRequest<unknown>);
    // Like the Anthropic provider under HCI_PAID_APIS=off once the queue is empty.
    const next = this.queue.shift() ?? {
      ok: false as const,
      error: "HCI_PAID_APIS=off: Anthropic API disabled for this run",
      retryable: false,
      usage: null,
    };
    return next as unknown as StructuredResponse<T>;
  }
}
const ok = (output: LlmExtraction): StructuredResponse<LlmExtraction> => ({
  ok: true,
  output,
  usage: { inputTokens: 1000, outputTokens: 200, costUsd: costFor("claude-opus-5-5", 1000, 200) },
});
class MemoryCache implements ExtractionCacheStore {
  store = new Map<string, CachedExtraction>();
  async get(k: CacheKey) {
    return this.store.get(JSON.stringify(k)) ?? null;
  }
  async put(k: CacheKey, v: CachedExtraction) {
    this.store.set(JSON.stringify(k), v);
  }
}

let db: Db;
let close: () => Promise<void>;
beforeAll(async () => {
  ({ db, close } = await createTestDb());
  await seedTaxonomy(db);
});
afterAll(async () => close());

const CLUB = "Harvard Coverage Test Club";
const run = (
  pages: LlmPage[],
  provider: LlmProvider,
  cache: ExtractionCacheStore | null,
  coverage: LlmCoverage,
  budget = { limitUsd: 1, spentUsd: 0 },
) =>
  extractWithLlm(
    { clubName: CLUB, pages, fetchedAt: NOW },
    { provider, cache, budget, stats: emptyLlmStats(), dryRun: false, logger: silentLogger, coverage },
  );

const pageA: LlmPage = {
  url: "https://coverage.example.test/",
  role: "home",
  snapshotId: "a",
  text: `We hold weekly robot builds.${filler("alpha")}`,
};
const pageB: LlmPage = {
  url: "https://coverage.example.test/join",
  role: "join",
  snapshotId: "b",
  text: `No experience needed; most members started from zero.${filler("beta")}`,
};
const outA = { ...empty(), activities: [{ value: "Weekly robot builds", quote: "We hold weekly robot builds." }] };

describe("LLM page coverage", () => {
  it("a page is read only when its chunk ran or replayed; refused or budget-skipped chunks leave it unread", async () => {
    const cache = new MemoryCache();
    await run([pageA], new FakeProvider([ok(outA)]), cache, emptyLlmCoverage()); // caches chunk A alone
    const coverage = emptyLlmCoverage();
    const provider = new FakeProvider([]);
    const claims = await run([pageA, pageB], provider, cache, coverage);
    expect(provider.calls).toHaveLength(1); // chunk B asked, refused
    expect(claims.map((c) => c.value)).toEqual(["Weekly robot builds"]);
    expect(llmPagesFullyRead(coverage)).toEqual(["a"]);

    // Another request covering page A missed (a second call sharing the coverage): A isn't read.
    await run([pageA], new FakeProvider([]), null, coverage);
    expect(llmPagesFullyRead(coverage)).toEqual([]);

    // Out of budget reads nothing either.
    const broke = emptyLlmCoverage();
    await run([pageB], new FakeProvider([ok(empty())]), null, broke, { limitUsd: 1, spentUsd: 1 });
    expect(llmPagesFullyRead(broke)).toEqual([]);
    expect([...broke.missed]).toEqual(["b"]);
  });

  it("retract-unreproduced keeps claims on a page whose chunk was refused, retracts on a fully replayed page", async () => {
    const { id: clubId } = await createClub(db, { name: CLUB });
    const snap = async (url: string, sha: string) => {
      const sourceId = await upsertSource(db, { url, sourceType: "club_website" });
      const { snapshotId } = await recordSnapshot(db, {
        sourceId,
        ingestionRunId: null,
        fetchedAt: NOW,
        finalUrl: url,
        httpStatus: 200,
        contentType: "text/html",
        contentSha256: sha.repeat(64),
        byteSize: 1,
        storageKey: sha,
        extractedText: "",
        fetchMethod: "static",
      });
      return { sourceId, snapshotId };
    };
    const a = await snap(pageA.url, "a");
    const b = await snap(pageB.url, "b");
    const say = async (
      fieldKey: "club.activity" | "club.mission",
      value: string,
      p: { sourceId: string; snapshotId: string },
      version: string,
    ) =>
      (
        await upsertClaim(
          db,
          { clubId, fieldKey, value, assertionKind: "stated" },
          {
            sourceId: p.sourceId,
            sourceType: "club_website",
            snapshotId: p.snapshotId,
            ingestionRunId: null,
            observedAt: NOW,
            quote: value,
            extractionMethod: "llm",
            extractorName: LLM_EXTRACTOR.name,
            extractorVersion: version,
            llmModel: "claude-opus-5-5",
            promptVersion: version,
            isDirect: true,
          },
        )
      ).claimId;
    // What the previous grounding revision said on each page.
    const goneFromA = await say("club.activity", "Monthly robot showcase", a, OLD);
    await say("club.activity", "Weekly robot builds", a, OLD);
    const onB = await say("club.mission", "No experience needed; most members started from zero.", b, OLD);
    // Another request of the current version left evidence on page B for this club (the old rule
    // took any such evidence for a full re-read of the page).
    await say("club.activity", "Robot builds", b, LLM_EXTRACTOR.version);

    // The replay: chunk A from the cache, chunk B refused (paid APIs off).
    const cache = new MemoryCache();
    const atA = { ...pageA, snapshotId: a.snapshotId };
    const atB = { ...pageB, snapshotId: b.snapshotId };
    await run([atA], new FakeProvider([ok(outA)]), cache, emptyLlmCoverage());
    const coverage = emptyLlmCoverage();
    const claims = await run([atA, atB], new FakeProvider([]), cache, coverage);
    for (const c of claims) await say("club.activity", c.value as string, a, LLM_EXTRACTOR.version);
    // As enrich does: a pass only for fully read pages, with the claims written there.
    await recordSnapshotExtractions(
      db,
      llmPagesFullyRead(coverage).map((snapshotId) => ({
        snapshotId,
        extractorName: LLM_EXTRACTOR.name,
        extractorVersion: LLM_EXTRACTOR.version,
        claims: claims.filter((c) => c.snapshotId === snapshotId).length,
      })),
    );

    const { claimIds } = await retractUnreproducedClaims(db, {
      extractorName: LLM_EXTRACTOR.name,
      currentVersion: LLM_EXTRACTOR.version,
      actor: "t",
      reason: "t",
      dryRun: true,
    });
    expect(claimIds).toEqual([goneFromA]);
    expect(claimIds).not.toContain(onB);
  });
});
