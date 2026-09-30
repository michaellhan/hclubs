import { and, eq, or } from "drizzle-orm";
import type { Db } from "../client";
import { resolveClubs } from "../resolve/project";
import { club, editorialDecision, mergeCandidate } from "../schema";

/**
 * Non-destructive merges (CLAUDE.md §12). Merging sets the absorbed club's record_state
 * to "merged" and points it at the survivor; its claims, mentions and history stay on
 * the original row, and the resolver folds them in via the merge chain. Undo restores
 * both clubs exactly. Every action is logged in editorial_decision.
 */

async function orderedCandidate(db: Db, a: string, b: string) {
  const [lo, hi] = a < b ? [a, b] : [b, a];
  const [row] = await db
    .select()
    .from(mergeCandidate)
    .where(and(eq(mergeCandidate.clubAId, lo), eq(mergeCandidate.clubBId, hi)));
  return row ?? null;
}

async function rootOf(db: Db, id: string): Promise<string> {
  let current = id;
  for (let i = 0; i < 20; i++) {
    const [row] = await db.select({ into: club.mergedIntoClubId }).from(club).where(eq(club.id, current));
    if (!row?.into) return current;
    current = row.into;
  }
  throw new Error(`merge chain too deep at ${id}`);
}

export async function mergeClubs(
  db: Db,
  input: { absorbedId: string; survivorId: string; actor: string; reason?: string },
): Promise<void> {
  const survivor = await rootOf(db, input.survivorId);
  if (survivor === input.absorbedId || (await rootOf(db, input.absorbedId)) === survivor) {
    throw new Error("clubs are already the same entity");
  }
  await db.transaction(async (tx) => {
    await tx
      .update(club)
      .set({ recordState: "merged", mergedIntoClubId: survivor })
      .where(eq(club.id, input.absorbedId));
    // Anything previously merged into the absorbed club now follows the new root.
    await tx.update(club).set({ mergedIntoClubId: survivor }).where(eq(club.mergedIntoClubId, input.absorbedId));
    const candidate = await orderedCandidate(tx as unknown as Db, input.absorbedId, input.survivorId);
    if (candidate) {
      await tx
        .update(mergeCandidate)
        .set({ status: "confirmed", decidedBy: input.actor, decidedAt: new Date() })
        .where(eq(mergeCandidate.id, candidate.id));
    }
    await tx.insert(editorialDecision).values({
      actor: input.actor,
      action: "merge_clubs",
      targetType: "club",
      targetId: input.absorbedId,
      reason: input.reason ?? null,
      payload: { survivorId: survivor, candidateId: candidate?.id ?? null },
    });
  });
  await resolveClubs(db, { clubIds: [survivor] });
}

export async function undoMerge(db: Db, input: { clubId: string; actor: string; reason?: string }): Promise<void> {
  const [row] = await db.select().from(club).where(eq(club.id, input.clubId));
  if (!row || row.recordState !== "merged" || !row.mergedIntoClubId) throw new Error("club is not merged");
  const survivor = row.mergedIntoClubId;
  await db.transaction(async (tx) => {
    await tx.update(club).set({ recordState: "active", mergedIntoClubId: null }).where(eq(club.id, input.clubId));
    const candidate = await orderedCandidate(tx as unknown as Db, input.clubId, survivor);
    if (candidate) {
      await tx
        .update(mergeCandidate)
        .set({ status: "undone", decidedBy: input.actor, decidedAt: new Date() })
        .where(eq(mergeCandidate.id, candidate.id));
    }
    await tx.insert(editorialDecision).values({
      actor: input.actor,
      action: "undo_merge",
      targetType: "club",
      targetId: input.clubId,
      reason: input.reason ?? null,
      payload: { formerSurvivorId: survivor },
    });
  });
  await resolveClubs(db, { clubIds: [input.clubId, survivor] });
}

export async function rejectMergeCandidate(
  db: Db,
  input: { candidateId: string; actor: string; reason?: string },
): Promise<void> {
  await db.transaction(async (tx) => {
    await tx
      .update(mergeCandidate)
      .set({ status: "rejected", decidedBy: input.actor, decidedAt: new Date() })
      .where(eq(mergeCandidate.id, input.candidateId));
    await tx.insert(editorialDecision).values({
      actor: input.actor,
      action: "reject_merge",
      targetType: "merge_candidate",
      targetId: input.candidateId,
      reason: input.reason ?? null,
    });
  });
}

/** Pairs a reviewer has already rejected must never be re-proposed or auto-merged. */
export async function isRejectedPair(db: Db, a: string, b: string): Promise<boolean> {
  const [lo, hi] = a < b ? [a, b] : [b, a];
  const [row] = await db
    .select({ id: mergeCandidate.id })
    .from(mergeCandidate)
    .where(
      and(
        eq(mergeCandidate.clubAId, lo),
        eq(mergeCandidate.clubBId, hi),
        or(eq(mergeCandidate.status, "rejected"), eq(mergeCandidate.status, "undone")),
      ),
    );
  return Boolean(row);
}
