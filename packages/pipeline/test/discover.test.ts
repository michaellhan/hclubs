import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { count, eq } from "drizzle-orm";
import { getClubProfile, schema, seedTaxonomy, type Db } from "@hci/db";
import { createTestDb } from "@hci/db/testing";
import { OFFLINE_FIXTURES, pbhaProgramsAdapter } from "../src/adapters";
import { FixtureFetcher } from "../src/fetch/fixture-fetcher";
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
    expect(runs.length).toBe(2);
    expect(runs.every((r) => r.finishedAt !== null && r.adapter === "pbha-programs")).toBe(true);
  });
});
