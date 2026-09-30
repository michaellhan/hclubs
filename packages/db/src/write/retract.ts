import { and, eq, inArray, sql } from "drizzle-orm";
import type { Db } from "../client";
import { claim, claimEvidence, club, editorialDecision } from "../schema";

/**
 * After fixing an extractor and re-running it (current version) over the same snapshots,
 * claims supported ONLY by older versions of that extractor were not reproduced. They are marked
 * `rejected` (never deleted) with a reason and an audit entry, so the change is visible and
 * reversible (set status back to active).
 */
export async function retractUnreproducedClaims(
  db: Db,
  input: { extractorName: string; currentVersion: string; actor: string; reason: string; dryRun?: boolean },
): Promise<{ claimIds: string[] }> {
  const rows = await db
    .select({ id: claim.id })
    .from(claim)
    .where(
      and(
        eq(claim.status, "active"),
        // Only clubs the current extractor actually re-ran on (merged-away clubs aren't re-enriched).
        sql`exists (select 1 from ${club} k where k.id = ${claim.clubId} and k.record_state = 'active')`,
        sql`exists (select 1 from ${claimEvidence} e where e.claim_id = ${claim.id} and e.extractor_name = ${input.extractorName})`,
        // …and nothing else supports it: no other extractor, and not the current version.
        sql`not exists (select 1 from ${claimEvidence} e where e.claim_id = ${claim.id} and (e.extractor_name <> ${input.extractorName} or e.extractor_version = ${input.currentVersion}))`,
      ),
    );
  const claimIds = rows.map((r) => r.id);
  if (input.dryRun || claimIds.length === 0) return { claimIds };
  await db.transaction(async (tx) => {
    await tx
      .update(claim)
      .set({
        status: "rejected",
        statusReason: `${input.reason} (not reproduced by ${input.extractorName}@${input.currentVersion})`,
      })
      .where(inArray(claim.id, claimIds));
    await tx.insert(editorialDecision).values(
      claimIds.map((id) => ({
        actor: input.actor,
        action: "reject_claim",
        targetType: "claim",
        targetId: id,
        reason: input.reason,
        payload: { extractor: input.extractorName, currentVersion: input.currentVersion },
      })),
    );
  });
  return { claimIds };
}
