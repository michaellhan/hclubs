import { eq } from "drizzle-orm";
import type { Db } from "../client";
import { club, editorialDecision } from "../schema";

/**
 * Hide a club that isn't a student organization in scope (e.g. a wrongly discovered
 * site). Reversible and audited in editorial_decision; its claims and mentions stay, and
 * its links keep the site from being rediscovered as a new club.
 */
export async function setClubHidden(
  db: Db,
  input: { clubId: string; hidden: boolean; actor: string; reason: string },
): Promise<void> {
  await db.transaction(async (tx) => {
    const [row] = await tx.select({ state: club.recordState }).from(club).where(eq(club.id, input.clubId));
    if (!row) throw new Error("club not found");
    if (row.state === "merged") throw new Error("club is merged; unmerge it first");
    await tx
      .update(club)
      .set({ recordState: input.hidden ? "hidden" : "active" })
      .where(eq(club.id, input.clubId));
    await tx.insert(editorialDecision).values({
      actor: input.actor,
      action: input.hidden ? "hide_club" : "unhide_club",
      targetType: "club",
      targetId: input.clubId,
      reason: input.reason,
    });
  });
}
