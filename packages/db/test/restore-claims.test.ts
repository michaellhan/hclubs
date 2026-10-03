import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import {
  createClub,
  rejectClaims,
  resolveClubs,
  restoreClaims,
  schema,
  seedTaxonomy,
  upsertClaim,
  upsertSource,
  type Db,
} from "../src";
import { createTestDb } from "../src/testing";

const NOW = new Date("2026-10-03T16:00:00Z");
let db: Db;
let close: () => Promise<void>;

beforeAll(async () => {
  ({ db, close } = await createTestDb());
  await seedTaxonomy(db);
});
afterAll(async () => close());

describe("restoreClaims", () => {
  it("undoes a rejection: the value is shown again and the restore is on record", async () => {
    const { id: clubId } = await createClub(db, { name: "Harvard Restore Test Society" });
    const src = await upsertSource(db, { url: "https://www.instagram.com/restoretest/", sourceType: "public_web" });
    await upsertClaim(
      db,
      { clubId, fieldKey: "club.instagram_followers", value: 500, assertionKind: "stated" },
      {
        sourceId: src,
        sourceType: "public_web",
        snapshotId: null,
        ingestionRunId: null,
        observedAt: NOW,
        extractionMethod: "manual",
        extractorName: "test",
        extractorVersion: "1",
        isDirect: true,
      },
    );
    const [claim] = await db
      .select({ id: schema.claim.id })
      .from(schema.claim)
      .where(and(eq(schema.claim.clubId, clubId), eq(schema.claim.fieldKey, "club.instagram_followers")));
    const shown = async () => {
      await resolveClubs(db, { clubIds: [clubId], now: NOW });
      const [row] = await db
        .select({ f: schema.club.instagramFollowers })
        .from(schema.club)
        .where(eq(schema.club.id, clubId));
      return row?.f ?? null;
    };

    expect(await shown()).toBe(500);
    await rejectClaims(db, { claimIds: [claim!.id], actor: "test", reason: "stale" });
    expect(await shown()).toBeNull();
    await restoreClaims(db, { claimIds: [claim!.id], actor: "test", reason: "owner keeps it" });
    expect(await shown()).toBe(500);

    const decisions = await db
      .select({ action: schema.editorialDecision.action })
      .from(schema.editorialDecision)
      .where(eq(schema.editorialDecision.targetId, claim!.id));
    expect(decisions.map((d) => d.action).sort()).toEqual(["reject_claim", "restore_claim"]);
  });
});
