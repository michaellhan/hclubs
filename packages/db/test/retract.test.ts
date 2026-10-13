import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { inArray } from "drizzle-orm";
import { computeConfidence, type FieldKey } from "@hci/core";
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
    // site-llm counts a page as re-read only through a recorded pass (2026-10-13): evidence alone
    // can come from one replayed request while another covering the page missed.
    await claim("Version 2 read the about page partly", changedSince, "v2");
    await recordSnapshotExtractions(db, [
      { snapshotId: reExtracted.snapshotId, extractorName: "site-llm", extractorVersion: "v2", claims: 1 },
    ]);

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

  it("with onlyRestated, retires only reworded values another kept value says (2026-10-12)", async () => {
    const { id: clubId } = await createClub(db, { name: "Harvard Paraphrase Test Club" });
    const sourceId = await upsertSource(db, { url: "https://paraphrase.example.test/", sourceType: "club_website" });
    const { snapshotId } = await recordSnapshot(db, {
      sourceId,
      ingestionRunId: null,
      fetchedAt: NOW,
      finalUrl: "https://paraphrase.example.test/",
      httpStatus: 200,
      contentType: "text/html",
      contentSha256: "d".repeat(64),
      byteSize: 1,
      storageKey: "paraphrase",
      extractedText: "",
      fetchMethod: "static",
    });
    const page = { sourceId, snapshotId };
    const claim = async (value: string, version: string) =>
      (
        await upsertClaim(
          db,
          { clubId, fieldKey: "club.activity", value, assertionKind: "stated" },
          {
            ...page,
            sourceType: "club_website",
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
        )
      ).claimId;
    const reworded = await claim("Yearly UN trip", "p1");
    const fuller = await claim("Black Legacy Ball, a February celebration of Black History Month", "p1");
    const onlyStatement = await claim("Low-cost stethoscope", "p1");
    await claim("Yearly trip to the UN", "p2");
    await claim("Black Legacy Ball", "p2");
    await recordSnapshotExtractions(db, [{ snapshotId, extractorName: "site-llm", extractorVersion: "p2", claims: 2 }]);
    const run = (onlyRestated: boolean) =>
      retractUnreproducedClaims(db, {
        extractorName: "site-llm",
        currentVersion: "p2",
        actor: "t",
        reason: "t",
        dryRun: true,
        fieldKeys: ["club.activity"],
        onlyRestated,
      });
    expect(new Set((await run(false)).claimIds)).toEqual(new Set([reworded, fuller, onlyStatement]));
    expect((await run(true)).claimIds).toEqual([reworded]);
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

  it("ignores a pass that lost its writes: it claimed values it left no evidence for (2026-10-12)", async () => {
    const { id: clubId } = await createClub(db, { name: "Harvard Lost Writes Test Club" });
    const sourceId = await upsertSource(db, { url: "https://lost-writes.example.test/", sourceType: "public_web" });
    const { snapshotId } = await recordSnapshot(db, {
      sourceId,
      ingestionRunId: null,
      fetchedAt: NOW,
      finalUrl: "https://lost-writes.example.test/",
      httpStatus: 200,
      contentType: "text/html",
      contentSha256: "f".repeat(64),
      byteSize: 1,
      storageKey: "lost",
      extractedText: "",
      fetchMethod: "static",
    });
    const { claimId } = await upsertClaim(
      db,
      {
        clubId,
        fieldKey: "club.link",
        value: { kind: "instagram", url: "https://www.instagram.com/lostwritesclub" },
        assertionKind: "stated",
      },
      {
        sourceId,
        sourceType: "public_web",
        snapshotId,
        ingestionRunId: null,
        observedAt: NOW,
        quote: "instagram",
        extractionMethod: "html_parse",
        extractorName: "site-deterministic",
        extractorVersion: "1.0.0",
        isDirect: true,
      },
    );
    const run = async () =>
      (
        await retractUnreproducedClaims(db, {
          extractorName: "site-deterministic",
          currentVersion: "2.0.0",
          actor: "t",
          reason: "t",
          dryRun: true,
        })
      ).claimIds;
    // The 2.0.0 pass says it wrote 3 claims on the page, but no 2.0.0 evidence survives.
    await recordSnapshotExtractions(db, [
      { snapshotId, extractorName: "site-deterministic", extractorVersion: "2.0.0", claims: 3 },
    ]);
    expect(await run()).not.toContain(claimId);
    // Re-read for real: it wrote nothing (the page dropped the link), so the claim goes.
    await recordSnapshotExtractions(db, [
      { snapshotId, extractorName: "site-deterministic", extractorVersion: "2.0.0", claims: 0 },
    ]);
    expect(await run()).toContain(claimId);
  });

  it("retracts what a page no longer says once its newer copy is re-read; keeps former names", async () => {
    const { id: clubId } = await createClub(db, { name: "Harvard Removed Form Test Club" });
    const page = async (path: string, sha: string, fetchedAt: Date, existing?: string) => {
      const sourceId =
        existing ??
        (await upsertSource(db, { url: `https://removed-form.example.test/${path}`, sourceType: "club_website" }));
      const { snapshotId } = await recordSnapshot(db, {
        sourceId,
        ingestionRunId: null,
        fetchedAt,
        finalUrl: `https://removed-form.example.test/${path}`,
        httpStatus: 200,
        contentType: "text/html",
        contentSha256: sha.repeat(64),
        byteSize: 1,
        storageKey: `${path}-${sha}`,
        extractedText: "",
        fetchMethod: "static",
      });
      return { sourceId, snapshotId };
    };
    const claim = async (fieldKey: FieldKey, value: unknown, p: { sourceId: string; snapshotId: string }) =>
      (
        await upsertClaim(
          db,
          { clubId, fieldKey, value, assertionKind: "stated" },
          {
            sourceId: p.sourceId,
            sourceType: "club_website",
            snapshotId: p.snapshotId,
            ingestionRunId: null,
            observedAt: NOW,
            quote: "x",
            extractionMethod: "html_parse",
            extractorName: "site-deterministic",
            extractorVersion: "1",
            isDirect: true,
          },
        )
      ).claimId;
    const old = await page("join", "a", new Date("2026-09-01T00:00:00Z"));
    const other = await page("about", "b", new Date("2026-09-01T00:00:00Z"));
    const form = { url: "https://forms.gle/oldForm123", kind: "application_form", label: "Apply" };
    const removed = await claim("club.link", form, old);
    const twoPages = await claim("club.activity", "Weekly meetings", old);
    await claim("club.activity", "Weekly meetings", other); // the about page was never re-read
    const former = await claim("club.alias", { kind: "former", name: "Harvard Old Name Society" }, old);

    // The join page changed; version 2 read the new copy and found none of it.
    const fresh = await page("join", "c", NOW, old.sourceId);
    await recordSnapshotExtractions(db, [
      { snapshotId: fresh.snapshotId, extractorName: "site-deterministic", extractorVersion: "2", claims: 0 },
    ]);
    const { claimIds } = await retractUnreproducedClaims(db, {
      extractorName: "site-deterministic",
      currentVersion: "2",
      actor: "test",
      reason: "test",
      dryRun: true,
    });
    expect(claimIds).toContain(removed);
    expect(claimIds).not.toContain(twoPages);
    expect(claimIds).not.toContain(former);
  });

  it("splits candidates by the club's own pages; a shared page's evidence for another club is no re-read (2026-10-13)", async () => {
    const { id: clubId } = await createClub(db, { name: "Harvard Own Pages Test Club" });
    const { id: otherClub } = await createClub(db, { name: "Harvard Neighbor Test Club" });
    const page = async (url: string, sourceType: "club_website" | "public_web" | "harvard_official", sha: string) => {
      const sourceId = await upsertSource(db, { url, sourceType });
      const { snapshotId } = await recordSnapshot(db, {
        sourceId,
        ingestionRunId: null,
        fetchedAt: NOW,
        finalUrl: url,
        httpStatus: 200,
        contentType: "text/html",
        contentSha256: sha.repeat(64),
        byteSize: 1,
        storageKey: `own-${sha}`,
        extractedText: "",
        fetchMethod: "static",
      });
      return { sourceId, snapshotId, sourceType };
    };
    const claim = async (
      club: string,
      value: string,
      p: { sourceId: string; snapshotId: string; sourceType: "club_website" | "public_web" | "harvard_official" },
      version: string,
    ) =>
      (
        await upsertClaim(
          db,
          { clubId: club, fieldKey: "club.activity", value, assertionKind: "stated" },
          {
            sourceId: p.sourceId,
            sourceType: p.sourceType,
            snapshotId: p.snapshotId,
            ingestionRunId: null,
            observedAt: NOW,
            quote: value,
            extractionMethod: "llm",
            extractorName: "site-llm",
            extractorVersion: version,
            llmModel: "m",
            promptVersion: version,
            isDirect: true,
          },
        )
      ).claimId;
    const established = await page("https://own-pages.example.test/", "club_website", "1");
    // The club's linked website whose ownership isn't established yet: still the club's own page.
    const linkedSite = await page("https://own-pages-site.example.test/about", "public_web", "2");
    await upsertClaim(
      db,
      {
        clubId,
        fieldKey: "club.link",
        value: { url: "https://www.own-pages-site.example.test/", kind: "website" },
        assertionKind: "stated",
      },
      {
        sourceId: established.sourceId,
        sourceType: "club_website",
        snapshotId: established.snapshotId,
        ingestionRunId: null,
        observedAt: NOW,
        quote: "x",
        extractionMethod: "html_parse",
        extractorName: "site-deterministic",
        extractorVersion: "1",
        isDirect: true,
      },
    );
    const directory = await page("https://directory.example.test/programs/own", "harvard_official", "3");
    const shared = await page("https://directory.example.test/all", "harvard_official", "4");

    const onSite = await claim(clubId, "Weekly rehearsals", established, "a");
    const onLinkedSite = await claim(clubId, "Spring concert", linkedSite, "a");
    const onDirectory = await claim(clubId, "Tutoring at a school", directory, "a");
    const onShared = await claim(clubId, "Annual gala", shared, "a");
    // The new version re-read each page for this club, except the shared page (only for a neighbor).
    await claim(clubId, "Rehearsals", established, "b");
    await claim(clubId, "Concerts", linkedSite, "b");
    await claim(clubId, "Tutoring", directory, "b");
    await claim(otherClub, "Neighbor's activity", shared, "b");

    const run = (clubSources?: "only" | "exclude") =>
      retractUnreproducedClaims(db, {
        extractorName: "site-llm",
        currentVersion: "b",
        actor: "t",
        reason: "t",
        dryRun: true,
        // The evidence branch (deterministic extractors); site-llm defaults to requiring a pass.
        requirePass: false,
        ...(clubSources ? { clubSources } : {}),
      }).then((r) => new Set(r.claimIds));
    const all = await run();
    expect(all).toEqual(new Set([onSite, onLinkedSite, onDirectory]));
    expect(all.has(onShared)).toBe(false);
    expect(await run("only")).toEqual(new Set([onSite, onLinkedSite]));
    expect(await run("exclude")).toEqual(new Set([onDirectory]));
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
    // Its evidence now carries public-web confidence, not the club website's.
    const ev = await db
      .select({ confidence: schema.claimEvidence.confidence })
      .from(schema.claimEvidence)
      .where(inArray(schema.claimEvidence.sourceId, [national.sourceId]));
    const expected = computeConfidence({ sourceType: "public_web", extractionMethod: "html_parse", isDirect: true });
    for (const e of ev) expect(e.confidence).toBeCloseTo(expected, 3);
  });
});
