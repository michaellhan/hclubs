import { desc, eq } from "drizzle-orm";
import { SOURCE_TYPE_TIER, computeConfidence, getField, normalizeUrl } from "@hci/core";
import {
  finishRun,
  recordFetchAttempt,
  recordSnapshot,
  recordSnapshotExtractions,
  resolveClubs,
  schema,
  startRun,
  upsertClaim,
  upsertSource,
  type Db,
} from "@hci/db";
import { loadKnownOrgs, resolveMention } from "../entity/resolve";
import type { Logger } from "../logger";
import { htmlToText } from "../parse/html";
import type { SnapshotStore } from "../snapshots/store";
import type { DiscoveryAdapter, FetchResult, ParsedPage, SourceCandidate, SourceFetcher } from "../types";

export interface DiscoveryDeps {
  db: Db;
  fetcher: SourceFetcher;
  store: SnapshotStore;
  logger: Logger;
  now?: () => Date;
}

export interface DiscoveryOptions {
  maxPages?: number;
  /** Limit organizations processed (debugging). */
  limit?: number;
  /**
   * Replay the latest stored snapshot of each page instead of fetching (`discover --stored`):
   * no request and no fetch-attempt row, and claims keep the snapshot's observation time, so a
   * parser change (a version bump) is re-applied for free. Pages never stored are skipped.
   */
  stored?: boolean;
}

export interface DiscoveryCounters {
  pagesFetched: number;
  pagesNotModified: number;
  pagesReplayed: number;
  pagesFailed: number;
  pagesSkippedRobots: number;
  snapshotsNew: number;
  parseWarnings: number;
  orgsSeen: number;
  orgsFailed: number;
  clubsCreated: number;
  clubsMatched: number;
  probableDuplicates: number;
  ambiguousMatches: number;
  mergeCandidates: number;
  claimsNew: number;
  claimsWritten: number;
  evidenceNew: number;
  claimsRejected: number;
  clubsResolved: number;
  resolveFailed: number;
  elapsedMs: number;
  [key: string]: number;
}

const decode = (bytes: Uint8Array) => new TextDecoder("utf-8").decode(bytes);

/**
 * Run a discovery adapter end-to-end. Idempotent: re-running with unchanged pages adds
 * no snapshots, mentions, clubs, claims or evidence (only refreshes observation times).
 * One failing page or organization never aborts the run (CLAUDE.md §11.4).
 */
export async function runDiscovery(
  deps: DiscoveryDeps,
  adapter: DiscoveryAdapter,
  options: DiscoveryOptions = {},
): Promise<{
  runId: string;
  status: "succeeded" | "partial" | "failed";
  counters: DiscoveryCounters;
  errors: string[];
}> {
  const { db, fetcher, store, logger } = deps;
  const now = deps.now ?? (() => new Date());
  const log = logger.child({ adapter: adapter.name });
  const runId = await startRun(db, {
    job: "discover",
    adapter: adapter.name,
    adapterVersion: adapter.version,
    options: { ...options },
  });
  const counters: DiscoveryCounters = {
    pagesFetched: 0,
    pagesNotModified: 0,
    pagesReplayed: 0,
    pagesFailed: 0,
    pagesSkippedRobots: 0,
    snapshotsNew: 0,
    parseWarnings: 0,
    orgsSeen: 0,
    orgsFailed: 0,
    clubsCreated: 0,
    clubsMatched: 0,
    probableDuplicates: 0,
    ambiguousMatches: 0,
    mergeCandidates: 0,
    claimsNew: 0,
    claimsWritten: 0,
    evidenceNew: 0,
    claimsRejected: 0,
    clubsResolved: 0,
    resolveFailed: 0,
    elapsedMs: 0,
  };
  const started = Date.now();
  const errors: string[] = [];
  const touched = new Set<string>();
  const known = await loadKnownOrgs(db);
  const maxPages = Math.min(options.maxPages ?? adapter.maxPages, adapter.maxPages);
  const queue: SourceCandidate[] = adapter.seeds();
  const visited = new Set<string>();
  let processedOrgs = 0;
  /** Parse one page's content and write what it lists (shared by fetched and replayed pages). */
  const parseAndRecord = async (
    candidate: SourceCandidate,
    sourceId: string,
    snapshotId: string | null,
    body: string,
    finalUrl: string,
    observedAt: Date,
  ): Promise<void> => {
    let parsed: ParsedPage;
    try {
      parsed = adapter.parse({ url: candidate.url, finalUrl, body, fetchedAt: observedAt });
    } catch (error) {
      counters.pagesFailed++;
      errors.push(`${candidate.url}: parse failed (${String(error)})`);
      log.error({ url: candidate.url, error: String(error) }, "parse failed");
      return;
    }
    counters.parseWarnings += parsed.warnings.length;
    for (const w of parsed.warnings) log.warn({ url: candidate.url }, w);
    for (const next of parsed.nextUrls) {
      if (!visited.has(next))
        queue.push({ ...candidate, url: next, title: `${candidate.title ?? adapter.name} (page)` });
    }

    // Extractors that read listing text (scope statements) record a pass per page, even an
    // empty one, with the claims they wrote, so `retract-unreproduced` knows the page was re-read.
    const passes = new Map<string, Set<string>>();
    for (const org of parsed.organizations)
      for (const x of org.scannedBy ?? [])
        if (!passes.has(`${x.name}|${x.version}`)) passes.set(`${x.name}|${x.version}`, new Set());
    for (const org of parsed.organizations) {
      if (options.limit !== undefined && processedOrgs >= options.limit) break;
      processedOrgs++;
      counters.orgsSeen++;
      try {
        await db.transaction(async (tx) => {
          const res = await resolveMention(tx, { sourceId, snapshotId, runId, org, known });
          if (res.decision === "definite" || res.decision === "existing_mention") counters.clubsMatched++;
          else counters.clubsCreated++;
          if (res.decision === "probable") counters.probableDuplicates++;
          if (res.decision === "ambiguous") counters.ambiguousMatches++;
          counters.mergeCandidates += res.mergeCandidates;
          for (const c of org.claims) {
            const field = getField(c.fieldKey);
            if (field.subjectType !== "club") {
              counters.claimsRejected++;
              continue;
            }
            try {
              const r = await upsertClaim(
                tx,
                { clubId: res.subjectClubId, fieldKey: c.fieldKey, value: c.value, assertionKind: c.assertionKind },
                {
                  sourceId,
                  sourceType: candidate.sourceType,
                  trustTier: SOURCE_TYPE_TIER[candidate.sourceType],
                  snapshotId,
                  ingestionRunId: runId,
                  observedAt,
                  quote: c.quote ?? null,
                  locator: c.locator ?? null,
                  extractionMethod: c.extractionMethod,
                  // Claims an extractor other than the adapter made (listing scope) carry its identity.
                  extractorName: c.extractor?.name ?? adapter.name,
                  extractorVersion: c.extractor?.version ?? adapter.version,
                  isDirect: c.isDirect,
                  confidence: Math.min(
                    0.99,
                    computeConfidence({
                      sourceType: candidate.sourceType,
                      extractionMethod: c.extractionMethod,
                      isDirect: c.isDirect,
                    }) * (c.confidenceFactor ?? 1),
                  ),
                },
              );
              counters.claimsWritten++;
              if (c.extractor) {
                const k = `${c.extractor.name}|${c.extractor.version}`;
                passes.set(k, (passes.get(k) ?? new Set()).add(r.claimId));
              }
              if (r.claimCreated) counters.claimsNew++;
              if (r.evidenceCreated) counters.evidenceNew++;
            } catch (error) {
              counters.claimsRejected++;
              log.warn({ org: org.externalKey, field: c.fieldKey, error: String(error) }, "claim rejected");
            }
          }
          touched.add(res.clubId);
        });
      } catch (error) {
        counters.orgsFailed++;
        errors.push(`${org.externalKey}: ${String(error)}`);
        log.error({ org: org.externalKey, error: String(error) }, "organization failed");
      }
    }
    // A run capped by --limit read only part of the page: no pass.
    if (snapshotId && options.limit === undefined && passes.size > 0)
      await recordSnapshotExtractions(
        db,
        [...passes].map(([k, ids]) => {
          const [extractorName = "", extractorVersion = ""] = k.split("|");
          return { snapshotId, extractorName, extractorVersion, claims: ids.size };
        }),
      );
  };

  try {
    while (queue.length > 0 && visited.size < maxPages) {
      const candidate = queue.shift();
      if (!candidate || visited.has(candidate.url)) continue;
      visited.add(candidate.url);

      if (options.stored) {
        // Only pages already stored: never create a source row for one that isn't.
        const url = normalizeUrl(candidate.url);
        const [stored] = url
          ? await db
              .select({ sourceId: schema.sourceSnapshot.sourceId, snap: schema.sourceSnapshot })
              .from(schema.sourceSnapshot)
              .innerJoin(schema.source, eq(schema.source.id, schema.sourceSnapshot.sourceId))
              .where(eq(schema.source.normalizedUrl, url))
              .orderBy(desc(schema.sourceSnapshot.fetchedAt))
              .limit(1)
          : [];
        if (!stored) continue;
        const body = decode(await store.get(stored.snap.storageKey));
        counters.pagesReplayed++;
        await parseAndRecord(
          candidate,
          stored.sourceId,
          stored.snap.id,
          body,
          stored.snap.finalUrl,
          stored.snap.fetchedAt,
        );
        continue;
      }

      const sourceId = await upsertSource(db, {
        url: candidate.url,
        sourceType: candidate.sourceType,
        title: candidate.title ?? null,
        publisher: candidate.publisher ?? adapter.publisher,
        adapter: adapter.name,
      });
      const [previous] = await db
        .select()
        .from(schema.sourceSnapshot)
        .where(eq(schema.sourceSnapshot.sourceId, sourceId))
        .orderBy(desc(schema.sourceSnapshot.fetchedAt))
        .limit(1);

      let result: FetchResult;
      try {
        result = await fetcher.fetch(candidate, {
          etag: previous?.etag ?? null,
          lastModified: previous?.lastModified ?? null,
        });
      } catch (error) {
        result = {
          status: "network_error",
          requestedUrl: candidate.url,
          finalUrl: candidate.url,
          httpStatus: null,
          contentType: null,
          etag: null,
          lastModified: null,
          body: null,
          fetchedAt: now(),
          attempts: 1,
          durationMs: 0,
          error: String(error),
          method: "static",
        };
      }

      // Obtain page content + the snapshot it lives in.
      let body: string | null = null;
      let snapshotId: string | null = null;
      let observedAt = result.fetchedAt;
      if (result.status === "ok" && result.body) {
        const put = await store.put(result.body);
        body = decode(result.body);
        const snap = await recordSnapshot(db, {
          sourceId,
          ingestionRunId: runId,
          fetchedAt: result.fetchedAt,
          finalUrl: result.finalUrl,
          httpStatus: result.httpStatus,
          contentType: result.contentType,
          etag: result.etag,
          lastModified: result.lastModified,
          contentSha256: put.sha256,
          byteSize: put.byteSize,
          storageKey: put.key,
          extractedText: htmlToText(body).slice(0, 200_000),
          fetchMethod: result.method,
        });
        snapshotId = snap.snapshotId;
        counters.pagesFetched++;
        if (snap.isNew) counters.snapshotsNew++;
      } else if (result.status === "not_modified" && previous) {
        body = decode(await store.get(previous.storageKey));
        snapshotId = previous.id;
        observedAt = now();
        counters.pagesNotModified++;
      } else {
        if (result.status === "robots_disallowed") counters.pagesSkippedRobots++;
        else counters.pagesFailed++;
        errors.push(`${candidate.url}: ${result.status}${result.error ? ` (${result.error})` : ""}`);
      }
      await recordFetchAttempt(db, {
        sourceId,
        ingestionRunId: runId,
        url: candidate.url,
        status: result.status,
        httpStatus: result.httpStatus,
        errorMessage: result.error,
        attempts: result.attempts,
        durationMs: result.durationMs,
        snapshotId,
      });
      log.info({ url: candidate.url, status: result.status, http: result.httpStatus }, "fetched");
      if (body === null) continue;

      await parseAndRecord(candidate, sourceId, snapshotId, body, result.finalUrl, observedAt);
    }

    const stats = await resolveClubs(db, { clubIds: [...touched], now: now() });
    counters.clubsResolved = stats.clubs;
    counters.resolveFailed = stats.failed;
    errors.push(...stats.errors.map((e) => `resolve ${e.clubId}: ${e.error}`));

    counters.elapsedMs = Date.now() - started;
    const anyContent = counters.pagesFetched + counters.pagesNotModified + counters.pagesReplayed > 0;
    const status = !anyContent ? "failed" : errors.length > 0 ? "partial" : "succeeded";
    await finishRun(db, runId, { status, counters, errorSummary: errors.slice(0, 50).join("\n") || null });
    log.info({ runId, status, ...counters }, "discovery finished");
    return { runId, status, counters, errors };
  } catch (error) {
    await finishRun(db, runId, { status: "failed", counters, errorSummary: String(error) });
    throw error;
  }
}
