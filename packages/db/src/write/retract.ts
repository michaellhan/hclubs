import { and, eq, inArray, sql } from "drizzle-orm";
import {
  SOURCE_TYPE_TIER,
  computeConfidence,
  restates,
  siteKey,
  type ExtractionMethod,
  type SourceType,
} from "@hci/core";
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

/** Extractors whose recorded pass is the only proof a page was re-read (see `requirePass`). */
const PASS_REQUIRED_EXTRACTORS = new Set(["site-llm"]);

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
    /**
     * Only claims whose value restates another active value of the same club and field that
     * stays (`restates`): for free-text list fields such as activities, where an LLM rewords
     * the same thing across runs and a value it didn't repeat may still be the only statement
     * of a real activity (2026-10-12).
     */
    onlyRestated?: boolean;
    /**
     * Split by where the extractor read it (owner, 2026-10-13: what clubs say about themselves is
     * trusted): `only` = claims with evidence from the club's own pages (club website, social,
     * recruiting material, publication; tiers 2–5), `exclude` = claims with none.
     */
    clubSources?: "only" | "exclude";
    /**
     * Count a page as re-read only through a recorded pass, never through evidence the current
     * version left on it. Default for extractors whose read of a page can be partial (`site-llm`:
     * a page whose request missed the cache under `HCI_PAID_APIS=off` while another club page's
     * replayed); their passes are recorded only for pages every request covering them read
     * (2026-10-13, ADR 0039 amendment).
     */
    requirePass?: boolean;
  },
): Promise<{ claimIds: string[] }> {
  const requirePass = input.requirePass ?? PASS_REQUIRED_EXTRACTORS.has(input.extractorName);
  // A recorded pass of the current version on this copy, unless it lost its writes (2026-10-12: a
  // repaired database kept the pass rows, not their evidence, and the page looked re-read with
  // nothing found).
  const recordedPass = sql`exists (select 1 from ${snapshotExtraction} x where x.snapshot_id = n.id and x.extractor_name = ${input.extractorName} and x.extractor_version = ${input.currentVersion}
    and x.claims <= (select count(*) from ${claimEvidence} v where v.snapshot_id = n.id and v.extractor_name = ${input.extractorName} and v.extractor_version = ${input.currentVersion}))`;
  // Evidence the current version left on the page for this same club: a shared page's evidence for
  // another club says nothing about whether this club's read (LLM: its cached chunk) happened
  // (2026-10-13).
  const evidenceLeft = sql`exists (select 1 from ${claimEvidence} cur join ${claim} cc on cc.id = cur.claim_id
    where cur.snapshot_id = n.id and cur.extractor_name = ${input.extractorName} and cur.extractor_version = ${input.currentVersion}
      and cc.club_id = ${claim.clubId})`;
  const reread = requirePass ? recordedPass : sql`(${evidenceLeft} or ${recordedPass})`;
  // The club's own page: an established club channel, or a page on the host of the club's linked
  // website whose ownership isn't established yet (still the club speaking about itself).
  const fromClubPage = sql`exists (select 1 from ${claimEvidence} e join ${source} s on s.id = e.source_id
    where e.claim_id = ${claim.id} and e.extractor_name = ${input.extractorName}
      and (s.source_type in ('club_website', 'club_social', 'club_recruiting_material', 'club_publication')
        or s.owner_club_id = ${claim.clubId}
        or exists (select 1 from ${claim} l where l.club_id = ${claim.clubId} and l.field_key = 'club.link'
          and l.status = 'active' and l.value->>'kind' = 'website'
          and regexp_replace(lower(l.value->>'url'), '^https?://(www\\.)?([^/:]+).*$', '\\2') = regexp_replace(lower(s.domain), '^www\\.', ''))))`;
  const rows = await db
    .select({ id: claim.id })
    .from(claim)
    .where(
      and(
        eq(claim.status, "active"),
        ...(input.fieldKeys?.length ? [inArray(claim.fieldKey, input.fieldKeys)] : []),
        ...(input.clubSources === "only" ? [fromClubPage] : []),
        ...(input.clubSources === "exclude" ? [sql`not ${fromClubPage}`] : []),
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
                    and ${reread}))`,
        // …and nothing else supports it: no other extractor, and not the current version.
        sql`not exists (select 1 from ${claimEvidence} e where e.claim_id = ${claim.id} and (e.extractor_name <> ${input.extractorName} or e.extractor_version = ${input.currentVersion}))`,
      ),
    );
  let claimIds = rows.map((r) => r.id);
  if (input.onlyRestated && claimIds.length) claimIds = await restatedOnly(db, claimIds);
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

/** Of these candidate claims, the ones whose value restates an active non-candidate value of the same club and field. */
async function restatedOnly(db: Db, candidateIds: string[]): Promise<string[]> {
  const candidates = new Set(candidateIds);
  const mine = await db
    .select({ id: claim.id, clubId: claim.clubId, fieldKey: claim.fieldKey, value: claim.value })
    .from(claim)
    .where(inArray(claim.id, candidateIds));
  const clubIds = [...new Set(mine.map((c) => c.clubId).filter((id): id is string => id !== null))];
  const fieldKeys = [...new Set(mine.map((c) => c.fieldKey))];
  if (!clubIds.length) return [];
  const others = await db
    .select({ id: claim.id, clubId: claim.clubId, fieldKey: claim.fieldKey, value: claim.value })
    .from(claim)
    .where(and(eq(claim.status, "active"), inArray(claim.clubId, clubIds), inArray(claim.fieldKey, fieldKeys)));
  const staying = new Map<string, string[]>();
  for (const o of others) {
    if (candidates.has(o.id) || typeof o.value !== "string") continue;
    const k = `${o.clubId}|${o.fieldKey}`;
    staying.set(k, [...(staying.get(k) ?? []), o.value]);
  }
  return mine
    .filter(
      (c) =>
        typeof c.value === "string" &&
        (staying.get(`${c.clubId}|${c.fieldKey}`) ?? []).some((o) => restates(c.value as string, o)),
    )
    .map((c) => c.id);
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
