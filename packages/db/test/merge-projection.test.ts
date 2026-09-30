import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { createClub, mergeClubs, resolveClubs, schema, seedTaxonomy, upsertClaim, upsertSource, type Db } from "../src";
import { createTestDb } from "../src/testing";

const NOW = new Date("2026-09-30T16:00:00Z");
let db: Db;
let close: () => Promise<void>;

beforeAll(async () => {
  ({ db, close } = await createTestDb());
  await seedTaxonomy(db);
});
afterAll(async () => close());

async function clubWithMembers(name: string, count: number): Promise<string> {
  const { id } = await createClub(db, { name });
  const src = await upsertSource(db, { url: `https://directory.harvard.test/${id}`, sourceType: "harvard_official" });
  for (const [fieldKey, value] of [
    ["club.name", name],
    ["club.member_count", { kind: "exact", count }],
  ] as const) {
    await upsertClaim(
      db,
      { clubId: id, fieldKey, value, assertionKind: "stated" },
      {
        sourceId: src,
        sourceType: "harvard_official",
        snapshotId: null,
        ingestionRunId: null,
        observedAt: NOW,
        extractionMethod: "manual",
        extractorName: "test",
        extractorVersion: "1",
        isDirect: true,
      },
    );
  }
  return id;
}

describe("projection after a merge", () => {
  it("re-resolving the survivor takes over the absorbed club's membership rows", async () => {
    const survivor = await clubWithMembers("Harvard Quantum Test Association", 20);
    const absorbed = await clubWithMembers("Harvard College Quantum Test Association", 25);
    await resolveClubs(db, { clubIds: [survivor, absorbed], now: NOW });
    await mergeClubs(db, { absorbedId: absorbed, survivorId: survivor, actor: "test" });

    const errors: unknown[] = [];
    await resolveClubs(db, { clubIds: [survivor], now: NOW, onError: (_id, e) => errors.push(e) });
    expect(errors).toEqual([]);
    const rows = await db.select().from(schema.membershipEstimate);
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.clubId === survivor)).toBe(true);
    expect(rows.filter((r) => r.isCurrent)).toHaveLength(1);
    const absorbedRows = await db
      .select()
      .from(schema.membershipEstimate)
      .where(eq(schema.membershipEstimate.clubId, absorbed));
    expect(absorbedRows).toEqual([]);
  });
});
