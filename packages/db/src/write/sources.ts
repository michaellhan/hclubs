import { and, eq, sql } from "drizzle-orm";
import { SOURCE_TYPE_TIER, extractDomain, normalizeUrl, type SourceType } from "@hci/core";
import type { Queryable } from "../client";
import { fetchAttempt, source, sourceSnapshot } from "../schema";

export interface SourceInput {
  url: string;
  sourceType: SourceType;
  title?: string | null;
  publisher?: string | null;
  adapter?: string | null;
  isFixture?: boolean;
  ownerClubId?: string | null;
  trustTier?: number;
  recheckIntervalHours?: number | null;
}

/** Idempotent on normalized URL. Returns the source id. */
export async function upsertSource(db: Queryable, input: SourceInput): Promise<string> {
  const normalizedUrl = normalizeUrl(input.url);
  if (!normalizedUrl) throw new Error(`Invalid source URL: ${input.url}`);
  const domain = extractDomain(normalizedUrl) ?? "unknown";
  const [row] = await db
    .insert(source)
    .values({
      url: input.url,
      normalizedUrl,
      domain,
      sourceType: input.sourceType,
      trustTier: input.trustTier ?? SOURCE_TYPE_TIER[input.sourceType],
      title: input.title ?? null,
      publisher: input.publisher ?? null,
      adapter: input.adapter ?? null,
      isFixture: input.isFixture ?? false,
      ownerClubId: input.ownerClubId ?? null,
      recheckIntervalHours: input.recheckIntervalHours ?? null,
    })
    .onConflictDoUpdate({
      target: source.normalizedUrl,
      set: {
        title: sql`coalesce(excluded.title, ${source.title})`,
        publisher: sql`coalesce(excluded.publisher, ${source.publisher})`,
        ownerClubId: sql`coalesce(${source.ownerClubId}, excluded.owner_club_id)`,
        updatedAt: new Date(),
      },
    })
    .returning({ id: source.id });
  if (!row) throw new Error("failed to upsert source");
  return row.id;
}

export interface SnapshotInput {
  sourceId: string;
  ingestionRunId: string | null;
  fetchedAt: Date;
  finalUrl: string;
  httpStatus: number | null;
  contentType: string | null;
  etag?: string | null;
  lastModified?: string | null;
  contentSha256: string;
  byteSize: number;
  storageKey: string;
  extractedText: string | null;
  fetchMethod: "static" | "browser" | "api" | "manual_upload" | "fixture";
}

/**
 * Record an immutable snapshot. Identical content for the same source reuses the existing
 * row (snapshots are never updated), so re-running ingestion does not duplicate snapshots.
 */
export async function recordSnapshot(
  db: Queryable,
  input: SnapshotInput,
): Promise<{ snapshotId: string; isNew: boolean }> {
  const inserted = await db
    .insert(sourceSnapshot)
    .values({ ...input, etag: input.etag ?? null, lastModified: input.lastModified ?? null })
    .onConflictDoNothing({ target: [sourceSnapshot.sourceId, sourceSnapshot.contentSha256] })
    .returning({ id: sourceSnapshot.id });
  await db.update(source).set({ lastFetchedAt: input.fetchedAt }).where(eq(source.id, input.sourceId));
  if (inserted[0]) return { snapshotId: inserted[0].id, isNew: true };
  const [existing] = await db
    .select({ id: sourceSnapshot.id })
    .from(sourceSnapshot)
    .where(and(eq(sourceSnapshot.sourceId, input.sourceId), eq(sourceSnapshot.contentSha256, input.contentSha256)));
  if (!existing) throw new Error("snapshot conflict without existing row");
  return { snapshotId: existing.id, isNew: false };
}

export async function recordFetchAttempt(
  db: Queryable,
  input: {
    sourceId: string | null;
    ingestionRunId: string | null;
    url: string;
    status: "ok" | "not_modified" | "http_error" | "network_error" | "robots_disallowed" | "skipped";
    httpStatus?: number | null;
    errorMessage?: string | null;
    attempts?: number;
    durationMs?: number | null;
    snapshotId?: string | null;
  },
): Promise<void> {
  await db.insert(fetchAttempt).values({
    sourceId: input.sourceId,
    ingestionRunId: input.ingestionRunId,
    url: input.url,
    status: input.status,
    httpStatus: input.httpStatus ?? null,
    errorMessage: input.errorMessage?.slice(0, 2000) ?? null,
    attempts: input.attempts ?? 1,
    durationMs: input.durationMs ?? null,
    snapshotId: input.snapshotId ?? null,
  });
}
