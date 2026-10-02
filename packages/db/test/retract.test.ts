import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { inArray } from "drizzle-orm";
import {
  createClub,
  disownSite,
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

describe("disownSite (ADR 0040)", () => {
  it("releases a wrong site's pages and rejects only claims nothing else supports", async () => {
    const { id: clubId } = await createClub(db, { name: "Harvard Chapter Of A Fictional Society" });
    const page = async (url: string, sourceType: "club_website" | "harvard_official", owner: string | null) => {
      const sourceId = await upsertSource(db, { url, sourceType, ownerClubId: owner });
      const { snapshotId } = await recordSnapshot(db, {
        sourceId,
        ingestionRunId: null,
        fetchedAt: NOW,
        finalUrl: url,
        httpStatus: 200,
        contentType: "text/html",
        contentSha256: url.replace(/\W/g, "").padEnd(64, "0").slice(0, 64),
        byteSize: 1,
        storageKey: url,
        extractedText: "",
        fetchMethod: "static",
      });
      return { sourceId, snapshotId };
    };
    const national = await page("https://national.example.test/about", "club_website", clubId);
    const nationalPage2 = await page("https://national.example.test/join", "club_website", clubId);
    const harvard = await page("https://directory.example.test/chapter", "harvard_official", null);
    const say = async (value: string, p: { sourceId: string; snapshotId: string }) =>
      (
        await upsertClaim(
          db,
          { clubId, fieldKey: "club.activity", value, assertionKind: "stated" },
          {
            sourceId: p.sourceId,
            sourceType: "club_website",
            snapshotId: p.snapshotId,
            ingestionRunId: null,
            observedAt: NOW,
            quote: value,
            extractionMethod: "html_parse",
            extractorName: "site-deterministic",
            extractorVersion: "1",
            isDirect: true,
          },
        )
      ).claimId;
    const onlyNational = await say("Unites 45,000 engineers worldwide", national);
    const alsoHarvard = await say("Hosts engineering workshops", nationalPage2);
    await say("Hosts engineering workshops", harvard);
    const outsideFolder = await say("Runs an outreach day", nationalPage2);

    const r = await disownSite(db, {
      clubIds: [clubId],
      site: "national.example.test",
      actor: "test",
      reason: "the national organization's site",
      only: (u) => !u.endsWith("/join"),
    });
    expect(r).toEqual({ sources: 1, claimsRejected: 1 });
    const status = new Map(
      (
        await db
          .select({ id: schema.claim.id, status: schema.claim.status })
          .from(schema.claim)
          .where(inArray(schema.claim.id, [onlyNational, alsoHarvard, outsideFolder]))
      ).map((c) => [c.id, c.status]),
    );
    expect(status.get(onlyNational)).toBe("rejected");
    expect(status.get(alsoHarvard)).toBe("active");
    expect(status.get(outsideFolder)).toBe("active");
    const [src] = await db
      .select({ owner: schema.source.ownerClubId, tier: schema.source.trustTier })
      .from(schema.source)
      .where(inArray(schema.source.id, [national.sourceId]));
    expect(src).toEqual({ owner: null, tier: 8 });
  });
});
