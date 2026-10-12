import { and, eq, inArray, sql } from "drizzle-orm";
import { SOURCE_TYPE_TIER, computeConfidence, siteKey, type ExtractionMethod, type SourceType } from "@hci/core";
import type { Db } from "../client";
import { claim, claimEvidence, club, editorialDecision, snapshotExtraction, source } from "../schema";

/**
 * Record that `extractor@version` read these snapshots, whatever it found (ADR 0039).
 * Idempotent; `claims` is how many distinct claims the pass wrote evidence for on that page (for
 * a confirm-only re-read of a stored page, how many it confirmed), so a pass whose writes were
 * lost (claims above the evidence it left) can be told apart from one that found nothing.
 */
export async function recordSnapshotExtractions(
  db: Db,
  rows: { snapshotId: string; extractorName: string; extractorVersion: string; claims: number }[],
): Promise<void> {
  // One row per key: a page reached twice in one run (two site roots on one host) is one pass.
  const unique = new Map<string, (typeof rows)[number]>();
  for (const r of rows) {
    const k = `${r.snapshotId}|${r.extractorName}|${r.extractorVersion}`;
    const cur = unique.get(k);
    if (!cur || r.claims > cur.claims) unique.set(k, r);
  }
  if (unique.size === 0) return;
  await db
    .insert(snapshotExtraction)
    .values([...unique.values()])
    .onConflictDoUpdate({
      target: [snapshotExtraction.snapshotId, snapshotExtraction.extractorName, snapshotExtraction.extractorVersion],
      set: { claims: sql`excluded.claims`, extractedAt: sql`now()` },
    });
}

/**
 * After fixing an extractor and re-running it (current version) over the same pages,
 * claims supported ONLY by older versions of that extractor were not reproduced. They are marked
 * `rejected` (never deleted) with a reason and an audit entry, so the change is visible and
 * reversible (set status back to active).
 */
export async function retractUnreproducedClaims(
  db: Db,
  input: {
    extractorName: string;
    currentVersion: string;
    actor: string;
    reason: string;
    dryRun?: boolean;
    /** Limit to the fields the fix touched (other fields may differ for unrelated reasons, e.g. LLM wording). */
    fieldKeys?: string[];
  },
): Promise<{ claimIds: string[] }> {
  const rows = await db
    .select({ id: claim.id })
    .from(claim)
    .where(
      and(
        eq(claim.status, "active"),
        ...(input.fieldKeys?.length ? [inArray(claim.fieldKey, input.fieldKeys)] : []),
        // A former name stays true after a page stops mentioning it (and keeps old names searchable).
        sql`not (${claim.fieldKey} = 'club.alias' and ${claim.value}->>'kind' = 'former')`,
        // Only clubs the current extractor actually re-ran on (merged-away clubs aren't re-enriched).
        sql`exists (select 1 from ${club} k where k.id = ${claim.clubId} and k.record_state = 'active')`,
        sql`exists (select 1 from ${claimEvidence} e where e.claim_id = ${claim.id} and e.extractor_name = ${input.extractorName})`,
        // …the current version re-read every page that said it: the same snapshot, or a newer
        // snapshot of the same source (the page changed and no longer says it, e.g. a form the
        // club took down). A page never re-read says nothing about the fix, so one such page
        // keeps the claim. A pass that found nothing on the page counts too (ADR 0039).
        sql`not exists (select 1 from ${claimEvidence} e join source_snapshot s on s.id = e.snapshot_id
              where e.claim_id = ${claim.id} and e.extractor_name = ${input.extractorName}
                and not exists (select 1 from source_snapshot n
                  where n.source_id = s.source_id and n.fetched_at >= s.fetched_at
                    -- a much shorter newer copy (maintenance page, JS shell) says nothing about it
                    and coalesce(length(n.extracted_text), 0) >= coalesce(length(s.extracted_text), 0) / 2
                    and (exists (select 1 from ${claimEvidence} cur where cur.snapshot_id = n.id and cur.extractor_name = ${input.extractorName} and cur.extractor_version = ${input.currentVersion})
                      -- a recorded pass, unless it lost its writes (2026-10-12: a repaired database kept
                      -- the pass rows, not their evidence, and the page looked re-read with nothing found)
                      or exists (select 1 from ${snapshotExtraction} x where x.snapshot_id = n.id and x.extractor_name = ${input.extractorName} and x.extractor_version = ${input.currentVersion}
                        and x.claims <= (select count(*) from ${claimEvidence} v where v.snapshot_id = n.id and v.extractor_name = ${input.extractorName} and v.extractor_version = ${input.currentVersion})))))`,
        // …and nothing else supports it: no other extractor, and not the current version.
        sql`not exists (select 1 from ${claimEvidence} e where e.claim_id = ${claim.id} and (e.extractor_name <> ${input.extractorName} or e.extractor_version = ${input.currentVersion}))`,
      ),
    );
  const claimIds = rows.map((r) => r.id);
  if (input.dryRun || claimIds.length === 0) return { claimIds };
  await rejectClaims(db, {
    claimIds,
    actor: input.actor,
    reason: input.reason,
    statusReason: `${input.reason} (not reproduced by ${input.extractorName}@${input.currentVersion})`,
    payload: { extractor: input.extractorName, currentVersion: input.currentVersion },
  });
  return { claimIds };
}

/**
 * Reject claims (never delete) with a reason and one audit entry each. Reversible by
 * setting the status back to active.
 */
export async function rejectClaims(
  db: Db,
  input: {
    claimIds: string[];
    actor: string;
    reason: string;
    statusReason?: string;
    payload?: Record<string, unknown>;
  },
): Promise<void> {
  if (input.claimIds.length === 0) return;
  await db.transaction(async (tx) => {
    await tx
      .update(claim)
      .set({ status: "rejected", statusReason: input.statusReason ?? input.reason })
      .where(inArray(claim.id, input.claimIds));
    await tx.insert(editorialDecision).values(
      input.claimIds.map((id) => ({
        actor: input.actor,
        action: "reject_claim",
        targetType: "claim",
        targetId: id,
        reason: input.reason,
        payload: input.payload ?? {},
      })),
    );
  });
}

/**
 * Undo `rejectClaims` for claims an editor wants shown again: back to `active`, with an
 * audited `restore_claim` decision per claim (the rejection's own decision stays on record).
 */
export async function restoreClaims(
  db: Db,
  input: { claimIds: string[]; actor: string; reason: string },
): Promise<void> {
  if (input.claimIds.length === 0) return;
  await db.transaction(async (tx) => {
    await tx.update(claim).set({ status: "active", statusReason: null }).where(inArray(claim.id, input.claimIds));
    await tx.insert(editorialDecision).values(
      input.claimIds.map((id) => ({
        actor: input.actor,
        action: "restore_claim",
        targetType: "claim",
        targetId: id,
        reason: input.reason,
        payload: {},
      })),
    );
  });
}

/**
 * A website turned out not to be the club's (a national parent organization, another group):
 * its pages stop counting as the club's own (owner cleared, public-web tier), and every active
 * claim about the club whose only evidence is those pages is rejected with `reason`. Claims
 * another source also supports stay. Reversible: claim statuses, and the source fields are
 * re-derived if the site is ever verified again. Returns the counts.
 */
export async function disownSite(
  db: Db,
  input: {
    clubIds: string[];
    site: string;
    actor: string;
    reason: string;
    /** Only these pages of the site (e.g. outside the club's folder on a shared host). */
    only?: (url: string) => boolean;
  },
): Promise<{ sources: number; claimsRejected: number }> {
  const owned = await db
    .select({ id: source.id, url: source.url })
    .from(source)
    .where(inArray(source.ownerClubId, input.clubIds));
  const ids = owned.filter((s) => siteKey(s.url) === input.site && (input.only?.(s.url) ?? true)).map((s) => s.id);
  if (!ids.length) return { sources: 0, claimsRejected: 0 };
  await db
    .update(source)
    .set({ ownerClubId: null, sourceType: "public_web", trustTier: SOURCE_TYPE_TIER.public_web })
    .where(inArray(source.id, ids));
  await recomputeEvidenceConfidence(db, ids);
  const rows = await db
    .select({ claimId: claim.id, sourceId: claimEvidence.sourceId })
    .from(claim)
    .innerJoin(claimEvidence, eq(claimEvidence.claimId, claim.id))
    .where(and(inArray(claim.clubId, input.clubIds), eq(claim.status, "active")));
  const site = new Set(ids);
  const bySource = new Map<string, boolean>();
  for (const r of rows) bySource.set(r.claimId, (bySource.get(r.claimId) ?? true) && site.has(r.sourceId));
  const only = [...bySource].filter(([, onlySite]) => onlySite).map(([id]) => id);
  await rejectClaims(db, { claimIds: only, actor: input.actor, reason: input.reason });
  return { sources: ids.length, claimsRejected: only.length };
}

/**
 * Re-derive the confidence of every evidence row from these sources after their type or tier
 * changed (the same versioned `computeConfidence` the extractors use). Editorial evidence is
 * left alone.
 */
export async function recomputeEvidenceConfidence(db: Db, sourceIds: string[]): Promise<number> {
  if (!sourceIds.length) return 0;
  const rows = await db
    .select({
      id: claimEvidence.id,
      method: claimEvidence.extractionMethod,
      isDirect: claimEvidence.isDirect,
      sourceType: source.sourceType,
      tier: source.trustTier,
    })
    .from(claimEvidence)
    .innerJoin(source, eq(source.id, claimEvidence.sourceId))
    .where(inArray(claimEvidence.sourceId, sourceIds));
  const groups = new Map<number, string[]>();
  for (const r of rows) {
    if (r.method === "manual" || r.method === "user_submission") continue;
    const c = computeConfidence({
      sourceType: r.sourceType as SourceType,
      trustTier: r.tier,
      extractionMethod: r.method as ExtractionMethod,
      isDirect: r.isDirect,
    });
    const k = Math.round(c * 1000) / 1000;
    groups.set(k, [...(groups.get(k) ?? []), r.id]);
  }
  for (const [confidence, ids] of groups)
    for (let i = 0; i < ids.length; i += 1000)
      await db
        .update(claimEvidence)
        .set({ confidence })
        .where(inArray(claimEvidence.id, ids.slice(i, i + 1000)));
  return rows.length;
}
