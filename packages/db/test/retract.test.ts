import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { inArray } from "drizzle-orm";
import {
  createClub,
  recordSnapshot,
  recordSnapshotExtractions,
  retractUnreproducedClaims,
  schema,
  seedTaxonomy,
  upsertClaim,
  upsertSource,
  type Db,
} from "../src";
import { createTestDb } from "../src/testing";

const NOW = new Date("2026-09-30T16:00:00Z");
let db: Db;
let close: () => Promise<void>;

beforeAll(async () => {
  ({ db, close } = await createTestDb());
  await seedTaxonomy(db);
});
afterAll(async () => close());

describe("retractUnreproducedClaims", () => {
  it("retracts only claims whose own snapshot the current version re-extracted", async () => {
    const { id: clubId } = await createClub(db, { name: "Harvard Retraction Test Club" });
    const snap = async (path: string) => {
      const sourceId = await upsertSource(db, {
        url: `https://retract.example.test/${path}`,
        sourceType: "club_website",
      });
      const { snapshotId } = await recordSnapshot(db, {
        sourceId,
        ingestionRunId: null,
        fetchedAt: NOW,
        finalUrl: `https://retract.example.test/${path}`,
        httpStatus: 200,
        contentType: "text/html",
        contentSha256: path.padEnd(64, "0"),
        byteSize: 1,
        storageKey: path,
        extractedText: "",
        fetchMethod: "static",
      });
      return { sourceId, snapshotId };
    };
    const reExtracted = await snap("join");
    const changedSince = await snap("about");
    const claim = async (value: string, page: { sourceId: string; snapshotId: string }, version: string) => {
      const r = await upsertClaim(
        db,
        { clubId, fieldKey: "club.activity", value, assertionKind: "stated" },
        {
          sourceId: page.sourceId,
          sourceType: "club_website",
          snapshotId: page.snapshotId,
          ingestionRunId: null,
          observedAt: NOW,
          quote: value,
          extractionMethod: "llm",
          extractorName: "site-llm",
          extractorVersion: version,
          llmModel: "test-model",
          promptVersion: version,
          isDirect: true,
        },
      );
      return r.claimId;
    };
    const dropped = await claim("Dropped by the fix", reExtracted, "v1");
    const kept = await claim("Reproduced", reExtracted, "v1");
    await claim("Reproduced", reExtracted, "v2");
    const untouched = await claim("On a page not re-extracted", changedSince, "v1");

    const dry = await retractUnreproducedClaims(db, {
      extractorName: "site-llm",
      currentVersion: "v2",
      actor: "test",
      reason: "test",
      dryRun: true,
    });
    expect(dry.claimIds).toEqual([dropped]);

    await retractUnreproducedClaims(db, {
      extractorName: "site-llm",
      currentVersion: "v2",
      actor: "test",
      reason: "test",
    });
    const rows = await db
      .select({ id: schema.claim.id, status: schema.claim.status })
      .from(schema.claim)
      .where(inArray(schema.claim.id, [dropped, kept, untouched]));
    const status = Object.fromEntries(rows.map((r) => [r.id, r.status]));
    expect(status[dropped]).toBe("rejected");
    expect(status[kept]).toBe("active");
    expect(status[untouched]).toBe("active");

    // A later version that produces it again revives it; an audit rejection never comes back.
    await claim("Dropped by the fix", reExtracted, "v3");
    await db
      .update(schema.claim)
      .set({ status: "rejected", statusReason: "audit content.x: wrong" })
      .where(inArray(schema.claim.id, [untouched]));
    await claim("On a page not re-extracted", changedSince, "v3");
    const after = await db
      .select({ id: schema.claim.id, status: schema.claim.status, reason: schema.claim.statusReason })
      .from(schema.claim)
      .where(inArray(schema.claim.id, [dropped, untouched]));
    const byId = Object.fromEntries(after.map((r) => [r.id, r]));
    expect(byId[dropped]).toMatchObject({ status: "active", reason: null });
    expect(byId[untouched]).toMatchObject({ status: "rejected" });
  });

  it("sees a newer version's pass that found nothing on the page (ADR 0039)", async () => {
    const { id: clubId } = await createClub(db, { name: "Harvard Empty Pass Test Club" });
    const sourceId = await upsertSource(db, {
      url: "https://empty-pass.example.test/schola",
      sourceType: "club_website",
    });
    const { snapshotId } = await recordSnapshot(db, {
      sourceId,
      ingestionRunId: null,
      fetchedAt: NOW,
      finalUrl: "https://empty-pass.example.test/schola",
      httpStatus: 200,
      contentType: "text/html",
      contentSha256: "e".repeat(64),
      byteSize: 1,
      storageKey: "empty",
      extractedText: "",
      fetchMethod: "static",
    });
    const { claimId } = await upsertClaim(
      db,
      { clubId, fieldKey: "club.affiliation_scope", value: "cross_school", assertionKind: "stated" },
      {
        sourceId,
        sourceType: "club_website",
        snapshotId,
        ingestionRunId: null,
        observedAt: NOW,
        quote: "Open to undergraduate and graduate students from Harvard and other area universities.",
        extractionMethod: "html_parse",
        extractorName: "scope-statements",
        extractorVersion: "2",
        isDirect: true,
      },
    );
    const run = () =>
      retractUnreproducedClaims(db, {
        extractorName: "scope-statements",
        currentVersion: "3",
        actor: "t",
        reason: "t",
        dryRun: true,
      });
    expect((await run()).claimIds).not.toContain(claimId);
    await recordSnapshotExtractions(db, [
      { snapshotId, extractorName: "scope-statements", extractorVersion: "3", claims: 0 },
    ]);
    expect((await run()).claimIds).toContain(claimId);
  });
});
