import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, count, desc, eq, like, ne } from "drizzle-orm";
import { getClubProfile, resolveClubs, schema, seedTaxonomy, type Db } from "@hci/db";
import { createTestDb } from "@hci/db/testing";
import { ADAPTERS, OFFLINE_FIXTURES, pbhaProgramsAdapter } from "../src/adapters";
import { SCOPE_EXTRACTOR } from "../src/extract/scope";
import { FixtureFetcher } from "../src/fetch/fixture-fetcher";
import { NoNetworkFetcher } from "../src/fetch/no-network-fetcher";
import { silentLogger } from "../src/logger";
import { MemorySnapshotStore } from "../src/snapshots/store";
import { runDiscovery } from "../src/stages/discover";

const root = fileURLToPath(new URL("./fixtures/", import.meta.url));
const NOW = new Date("2026-09-30T12:00:00Z");
let db: Db;
let close: () => Promise<void>;
const store = new MemorySnapshotStore();
const fetcher = new FixtureFetcher(
  Object.fromEntries(Object.entries(OFFLINE_FIXTURES["pbha-programs"]!).map(([u, f]) => [u, root + f])),
  NOW,
);
const deps = () => ({ db, fetcher, store, logger: silentLogger, now: () => NOW });

async function tableCounts() {
  const tables = {
    clubs: schema.club,
    claims: schema.claim,
    evidence: schema.claimEvidence,
    snapshots: schema.sourceSnapshot,
    mentions: schema.entityMention,
    merges: schema.mergeCandidate,
  };
  const out: Record<string, number> = {};
  for (const [k, t] of Object.entries(tables)) out[k] = (await db.select({ n: count() }).from(t))[0]?.n ?? -1;
  return out;
}

beforeAll(async () => {
  ({ db, close } = await createTestDb());
  await seedTaxonomy(db);
});
afterAll(async () => close());

describe("PBHA discovery end-to-end (offline fixtures)", () => {
  it("ingests all pages, following pagination until fixtures run out", async () => {
    const result = await runDiscovery(deps(), pbhaProgramsAdapter);
    expect(result.counters.pagesFetched).toBe(3);
    expect(result.counters.orgsSeen).toBe(54);
    expect(result.counters.orgsFailed).toBe(0);
    expect(result.counters.clubsCreated).toBe(54);
    // Page 4 is not in the fixtures, so the run records one failed page ⇒ partial, not failed.
    expect(result.status).toBe("partial");
    expect(result.counters.pagesFailed).toBe(1);
  });

  it("is idempotent: a second run adds no rows", async () => {
    const before = await tableCounts();
    const result = await runDiscovery(deps(), pbhaProgramsAdapter);
    expect(result.counters.clubsMatched).toBe(54);
    expect(result.counters.evidenceNew).toBe(0);
    expect(await tableCounts()).toEqual(before);
  });

  it("--stored replays stored pages: no requests, no fetch attempts, no new rows", async () => {
    const before = await tableCounts();
    const attempts = (await db.select({ n: count() }).from(schema.fetchAttempt))[0]?.n;
    const later = new Date("2026-10-12T12:00:00Z");
    const result = await runDiscovery(
      { db, fetcher: new NoNetworkFetcher(), store, logger: silentLogger, now: () => later },
      pbhaProgramsAdapter,
      { stored: true },
    );
    expect(result.counters.pagesReplayed).toBe(3);
    expect(result.counters.pagesFetched + result.counters.pagesFailed).toBe(0);
    expect(result.counters.clubsMatched).toBe(54);
    expect(result.status).toBe("succeeded");
    expect(await tableCounts()).toEqual(before);
    expect((await db.select({ n: count() }).from(schema.fetchAttempt))[0]?.n).toBe(attempts);
    // Claims keep the stored page's observation time, not the replay's.
    const [latest] = await db
      .select({ at: schema.claim.lastObservedAt })
      .from(schema.claim)
      .orderBy(desc(schema.claim.lastObservedAt))
      .limit(1);
    expect(latest?.at.getTime()).toBe(NOW.getTime());
  });

  it("files a merged club's re-observed listing under its own record, keeping its rejections", async () => {
    const clubFor = async (key: string) =>
      (
        await db
          .select({ id: schema.entityMention.resolvedClubId })
          .from(schema.entityMention)
          .where(eq(schema.entityMention.externalKey, key))
      )[0]!.id!;
    const loser = await clubFor("alzheimersbuddies");
    const [other] = await db
      .select({ id: schema.club.id })
      .from(schema.club)
      .where(and(ne(schema.club.id, loser), eq(schema.club.recordState, "active")))
      .limit(1);
    const winner = other!.id;
    await db
      .update(schema.club)
      .set({ recordState: "merged", mergedIntoClubId: winner })
      .where(eq(schema.club.id, loser));
    const [desc0] = await db
      .select({ id: schema.claim.id, hash: schema.claim.valueHash })
      .from(schema.claim)
      .where(and(eq(schema.claim.clubId, loser), eq(schema.claim.fieldKey, "club.short_description")));
    await db
      .update(schema.claim)
      .set({ status: "rejected", statusReason: "test: wrong description" })
      .where(eq(schema.claim.id, desc0!.id));
    await runDiscovery(
      { db, fetcher: new NoNetworkFetcher(), store, logger: silentLogger, now: () => NOW },
      pbhaProgramsAdapter,
      { stored: true },
    );
    const onWinner = await db
      .select({ id: schema.claim.id })
      .from(schema.claim)
      .where(and(eq(schema.claim.clubId, winner), eq(schema.claim.valueHash, desc0!.hash)));
    expect(onWinner).toEqual([]);
    const [after] = await db
      .select({ status: schema.claim.status })
      .from(schema.claim)
      .where(eq(schema.claim.id, desc0!.id));
    expect(after?.status).toBe("rejected");
    // The survivor's profile still shows the merged record's other active claims, not the rejected one.
    await resolveClubs(db, { clubIds: [winner], now: NOW });
    const [w] = await db.select({ slug: schema.club.slug }).from(schema.club).where(eq(schema.club.id, winner));
    const r = await getClubProfile(db, w!.slug, NOW);
    if (r.kind !== "found") throw new Error("missing survivor profile");
    expect(r.profile.links.map((l) => l.url)).toContain("https://pbha.org/programs/alzheimersbuddies");
    const [rejectedDesc] = await db
      .select({ value: schema.claim.value })
      .from(schema.claim)
      .where(eq(schema.claim.id, desc0!.id));
    expect(r.profile.shortDescription).not.toBe(rejectedDesc?.value);
    // Undo for the tests below.
    await db.update(schema.claim).set({ status: "active", statusReason: null }).where(eq(schema.claim.id, desc0!.id));
    await db
      .update(schema.club)
      .set({ recordState: "active", mergedIntoClubId: null })
      .where(eq(schema.club.id, loser));
    await resolveClubs(db, { clubIds: [winner, loser], now: NOW });
  });

  it("produces a resolved, sourced profile", async () => {
    const [row] = await db
      .select({ slug: schema.club.slug })
      .from(schema.club)
      .innerJoin(schema.entityMention, eq(schema.entityMention.resolvedClubId, schema.club.id))
      .where(eq(schema.entityMention.externalKey, "alzheimersbuddies"));
    const r = await getClubProfile(db, row!.slug, NOW);
    if (r.kind !== "found") throw new Error("missing profile");
    const p = r.profile;
    expect(p.name).toBe("Alzheimer’s Buddies");
    expect(p.orgType).toBe("public_service_program");
    expect(p.categories.map((c) => c.slug)).toEqual(expect.arrayContaining(["public-service", "adult-services"]));
    expect(p.links[0]).toMatchObject({
      kind: "harvard_directory",
      status: "verified",
      url: "https://pbha.org/programs/alzheimersbuddies",
    });
    expect(p.sources).toHaveLength(1);
    expect(p.sources[0]).toMatchObject({ sourceType: "harvard_official", isFixture: false });
    expect(p.memberCount).toBeNull(); // never invented
    expect(p.isFixture).toBe(false);
    const desc = p.fields["club.short_description"];
    expect(desc?.kind === "single" && desc.current.badge).toBe("verified");
    expect(desc?.kind === "single" && desc.current.sources[0]?.quote).toMatch(/Alzheimer/);
    const org = p.fields["club.org_type"];
    expect(org?.kind === "single" && org.current.badge).toBe("estimate");
  });

  it("stores raw snapshots outside the database, deduplicated by content", async () => {
    expect(store.objects.size).toBe(3);
    const snaps = await db
      .select({ key: schema.sourceSnapshot.storageKey, text: schema.sourceSnapshot.extractedText })
      .from(schema.sourceSnapshot);
    expect(snaps).toHaveLength(3);
    expect(snaps.every((s) => store.objects.has(s.key))).toBe(true);
    expect(snaps.some((s) => s.text?.includes("Alzheimer"))).toBe(true);
  });

  it("records the run with counters", async () => {
    const runs = await db.select().from(schema.ingestionRun);
    expect(runs.length).toBe(4); // two fetched runs and two stored replays
    // (this describe runs before the listing-scope one below)
    expect(runs.every((r) => r.finishedAt !== null && r.adapter === "pbha-programs")).toBe(true);
  });
});

describe("listing scope statements (ADR 0038 amendment)", () => {
  it("carry scope-statements' own identity in evidence and record a pass per listing page", async () => {
    const url = Object.keys(OFFLINE_FIXTURES["innovation-labs-student-groups"]!)[0]!;
    const fx = new FixtureFetcher({ [url]: root + OFFLINE_FIXTURES["innovation-labs-student-groups"]![url]! }, NOW);
    await runDiscovery(
      { db, fetcher: fx, store, logger: silentLogger, now: () => NOW },
      ADAPTERS["innovation-labs-student-groups"]!,
    );
    const ev = await db
      .select({ name: schema.claimEvidence.extractorName, version: schema.claimEvidence.extractorVersion })
      .from(schema.claimEvidence)
      .innerJoin(schema.claim, eq(schema.claim.id, schema.claimEvidence.claimId))
      .where(
        and(eq(schema.claim.fieldKey, "club.affiliation_scope"), like(schema.claimEvidence.evidenceQuote, "HIVE %")),
      );
    expect(ev).toEqual([{ name: SCOPE_EXTRACTOR.name, version: SCOPE_EXTRACTOR.version }]);
    const pass = await db
      .select({ claims: schema.snapshotExtraction.claims })
      .from(schema.snapshotExtraction)
      .where(
        and(
          eq(schema.snapshotExtraction.extractorName, SCOPE_EXTRACTOR.name),
          eq(schema.snapshotExtraction.extractorVersion, SCOPE_EXTRACTOR.version),
        ),
      );
    expect(pass).toEqual([{ claims: 2 }]); // HIVE's scope and school
  });
});
