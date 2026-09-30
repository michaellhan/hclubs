import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { count, eq } from "drizzle-orm";
import {
  createClub,
  getClubProfile,
  rejectMergeCandidate,
  resolveClubs,
  schema,
  seedTaxonomy,
  undoMerge,
  upsertClaim,
  upsertSource,
  type Db,
} from "@hci/db";
import { createTestDb } from "@hci/db/testing";
import { ADAPTERS, OFFLINE_FIXTURES } from "../src/adapters";
import { FixtureFetcher } from "../src/fetch/fixture-fetcher";
import { silentLogger } from "../src/logger";
import { MemorySnapshotStore } from "../src/snapshots/store";
import { runDiscovery } from "../src/stages/discover";
import { runEnrichment } from "../src/stages/enrich";
import { runReconcile } from "../src/stages/reconcile";
import { coverageStats } from "../src/stats";

const fixtures = fileURLToPath(new URL("./fixtures/", import.meta.url));
const NOW = new Date("2026-09-30T16:00:00Z");
let db: Db;
let close: () => Promise<void>;

const site = (p: string) => `${fixtures}synthetic-club-site/${p}`;
const siteFetcher = new FixtureFetcher(
  {
    "https://example-robotics.test/": site("home.html"),
    "https://example-robotics.test/about": site("about.html"),
    "https://example-robotics.test/join": site("join.html"),
    "https://example-robotics.test/team": site("team.html"),
    "https://example-robotics.test/sponsors": site("sponsors.html"),
  },
  NOW,
);

beforeAll(async () => {
  ({ db, close } = await createTestDb());
  await seedTaxonomy(db);
});
afterAll(async () => close());

async function addClubWithOfficialSite(name: string, url: string): Promise<string> {
  const { id } = await createClub(db, { name });
  const src = await upsertSource(db, { url: "https://directory.harvard.test/orgs", sourceType: "harvard_official" });
  for (const [fieldKey, value] of [
    ["club.name", name],
    ["club.link", { kind: "website", url }],
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
  await resolveClubs(db, { clubIds: [id], now: NOW });
  return id;
}

describe("enrichment end-to-end (synthetic site, no network)", () => {
  let clubId: string;
  const store = new MemorySnapshotStore();
  const deps = () => ({ db, fetcher: siteFetcher, store, logger: silentLogger, now: () => NOW });

  it("crawls only the official site, within limits, and extracts claims with provenance", async () => {
    clubId = await addClubWithOfficialSite("Example Robotics Collective", "https://example-robotics.test/");
    const r = await runEnrichment(deps(), { maxPages: 5, maxDepth: 1 });
    expect(r.status).toBe("succeeded");
    expect(r.counters.clubsEnriched).toBe(1);
    expect(r.counters.pagesFetched).toBe(5);
    expect(r.counters.claimsNew).toBeGreaterThan(15);

    const found = await getClubProfile(
      db,
      (await db.select().from(schema.club).where(eq(schema.club.id, clubId)))[0]!.slug,
      NOW,
    );
    if (found.kind !== "found") throw new Error("missing");
    const p = found.profile;
    // Links discovered on the official site are verified; institutional/personal ones never appear.
    const ig = p.links.find((l) => l.kind === "instagram");
    expect(ig).toMatchObject({ status: "verified" });
    expect(ig?.signals.join(" ")).toMatch(/official website/);
    expect(p.links.some((l) => l.url.includes("instagram.com/harvard"))).toBe(false);
    // Recruiting: current cycle with a sourced deadline; selectivity from the explicitly dated Fall 2025 numbers.
    expect(p.currentCycle?.termKey).toBe("2026-fall");
    expect(p.currentCycle?.deadline?.at.startsWith("2026-10-03")).toBe(true);
    expect(p.currentCycle?.status).toBe("open");
    expect(p.selectivity).toMatchObject({ termKey: "2025-fall", acceptanceRate: 30 / 180 });
    expect(p.hoursPerWeek).toEqual({ min: 6, max: 8 });
    expect(p.freshmenEligible).toBe(true);
    expect(p.joinModes).toEqual(expect.arrayContaining(["application"]));
    // Evidence: every club-site fact is tier-2 and quoted.
    const desc = p.fields["club.short_description"];
    expect(desc?.kind === "single" && desc.current.sources[0]?.sourceType).toBe("club_website");
    expect(desc?.kind === "single" && desc.current.badge).toBe("verified");
    // Personal bios never become club data.
    expect(JSON.stringify(p.fields)).not.toMatch(/Dunster/);
    // Activity is derived (recruiting + current official listing) with reasons.
    expect(p.activityStatus).toBe("active");
    expect(p.activityReasons.length).toBeGreaterThan(0);
  });

  it("is incremental: a rerun within the freshness window refetches nothing and adds no claims", async () => {
    const before = (await db.select({ n: count() }).from(schema.claimEvidence))[0]?.n;
    const r = await runEnrichment(deps(), { maxPages: 5, maxDepth: 1 });
    expect(r.counters.pagesFetched).toBe(0);
    expect(r.counters.pagesSkippedFresh).toBe(5);
    expect(r.counters.claimsNew).toBe(0);
    expect((await db.select({ n: count() }).from(schema.claimEvidence))[0]?.n).toBe(before);
  });

  it("--force refetches; identical content produces no new snapshots", async () => {
    const snaps = (await db.select({ n: count() }).from(schema.sourceSnapshot))[0]?.n;
    const r = await runEnrichment(deps(), { maxPages: 5, maxDepth: 1, force: true });
    expect(r.counters.pagesUnchanged).toBe(5);
    expect((await db.select({ n: count() }).from(schema.sourceSnapshot))[0]?.n).toBe(snaps);
  });

  it("does not crawl an unconfirmed candidate site whose pages don't name the club", async () => {
    const { id } = await createClub(db, { name: "Totally Different Society" });
    const src = await upsertSource(db, { url: "https://some-blog.test/list", sourceType: "public_web" });
    await upsertClaim(
      db,
      {
        clubId: id,
        fieldKey: "club.link",
        value: { kind: "website", url: "https://example-robotics.test/" },
        assertionKind: "stated",
      },
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
    await resolveClubs(db, { clubIds: [id], now: NOW });
    const slug = (await db.select().from(schema.club).where(eq(schema.club.id, id)))[0]!.slug;
    const r = await runEnrichment(deps(), { clubSlug: slug });
    expect(r.counters.sitesSkippedUnconfirmed).toBe(1);
    expect(r.counters.clubsEnriched).toBe(0);
  });
});

describe("cross-source discovery, reconciliation, and reversible merges", () => {
  it("dedupes the same org across independent official directories", async () => {
    const store = new MemorySnapshotStore();
    for (const name of ["seas-student-orgs", "dept-computer-science", "innovation-labs-student-groups"]) {
      const files = Object.fromEntries(Object.entries(OFFLINE_FIXTURES[name]!).map(([u, f]) => [u, fixtures + f]));
      const r = await runDiscovery(
        { db, fetcher: new FixtureFetcher(files, NOW), store, logger: silentLogger, now: () => NOW },
        ADAPTERS[name]!,
      );
      expect(r.counters.orgsFailed).toBe(0);
    }
    const hcs = await db.select().from(schema.club).where(eq(schema.club.canonicalName, "Harvard Computer Society"));
    expect(hcs).toHaveLength(1);
    const mentions = await db
      .select()
      .from(schema.entityMention)
      .where(eq(schema.entityMention.resolvedClubId, hcs[0]!.id));
    expect(mentions.length).toBeGreaterThanOrEqual(2);
    expect(mentions.every((m) => m.matchExplanation)).toBe(true);
  });

  it("reconcile auto-merges only on a strong shared identifier, and the merge is undoable", async () => {
    const a = await addClubWithOfficialSite("Harvard Widget Club", "https://widgetclub.test/");
    const b = await addClubWithOfficialSite("Widget Society at Harvard", "https://widgetclub.test/");
    const c = await addClubWithOfficialSite("Harvard Widget Club", "https://another-widgets.test/"); // same name, different site
    const r = await runReconcile({ db, logger: silentLogger, now: () => NOW });
    expect(r.counters.autoMerged).toBeGreaterThanOrEqual(1);
    const states = await db
      .select({ id: schema.club.id, state: schema.club.recordState, into: schema.club.mergedIntoClubId })
      .from(schema.club);
    const merged = states.filter((s) => [a, b].includes(s.id) && s.state === "merged");
    expect(merged).toHaveLength(1);
    // The same-name club with a different official site was NOT merged — it's a review candidate.
    expect(states.find((s) => s.id === c)?.state).toBe("active");
    const candidates = await db
      .select()
      .from(schema.mergeCandidate)
      .where(eq(schema.mergeCandidate.status, "proposed"));
    expect(candidates.some((m) => [m.clubAId, m.clubBId].includes(c))).toBe(true);

    await undoMerge(db, { clubId: merged[0]!.id, actor: "test" });
    const after = await db.select().from(schema.club).where(eq(schema.club.id, merged[0]!.id));
    expect(after[0]?.recordState).toBe("active");
    const decisions = await db.select().from(schema.editorialDecision);
    expect(decisions.map((d) => d.action)).toEqual(expect.arrayContaining(["merge_clubs", "undo_merge"]));
    // Undone pairs are never re-proposed or re-merged.
    const again = await runReconcile({ db, logger: silentLogger, now: () => NOW });
    expect(again.counters.autoMerged).toBe(0);
  });

  it("auto-merges a pair left in review once enrichment finds a shared official account", async () => {
    const a = await addClubWithOfficialSite("Harvard Undergraduate Gadget Guild", "https://gadget-old.test/");
    const b = await addClubWithOfficialSite("Harvard College Gadget Guild", "https://gadget-new.test/");
    await runReconcile({ db, logger: silentLogger, now: () => NOW });
    const pair = async () =>
      (await db.select().from(schema.mergeCandidate)).find(
        (m) => [m.clubAId, m.clubBId].sort().join() === [a, b].sort().join(),
      );
    expect((await pair())?.status).toBe("proposed"); // different sites, similar names → review

    // Later, both clubs' official pages link the same Instagram account.
    const src = await upsertSource(db, { url: "https://directory.harvard.test/orgs", sourceType: "harvard_official" });
    for (const id of [a, b]) {
      await upsertClaim(
        db,
        {
          clubId: id,
          fieldKey: "club.link",
          value: { kind: "instagram", url: "https://instagram.com/gadgetguild" },
          assertionKind: "stated",
        },
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
    await resolveClubs(db, { clubIds: [a, b], now: NOW });
    const r = await runReconcile({ db, logger: silentLogger, now: () => NOW });
    expect(r.counters.autoMerged).toBe(1);
    expect((await pair())?.status).toBe("confirmed");
  });

  it("never revisits a rejected pair, even with a shared identifier", async () => {
    const a = await addClubWithOfficialSite("Harvard Undergraduate Sprocket Society", "https://sprocket-a.test/");
    const b = await addClubWithOfficialSite("Harvard College Sprocket Society", "https://sprocket-b.test/");
    await runReconcile({ db, logger: silentLogger, now: () => NOW });
    const cand = (await db.select().from(schema.mergeCandidate)).find(
      (m) => [m.clubAId, m.clubBId].sort().join() === [a, b].sort().join(),
    );
    await rejectMergeCandidate(db, { candidateId: cand!.id, actor: "test" });
    const src = await upsertSource(db, { url: "https://directory.harvard.test/orgs", sourceType: "harvard_official" });
    for (const id of [a, b])
      await upsertClaim(
        db,
        {
          clubId: id,
          fieldKey: "club.link",
          value: { kind: "instagram", url: "https://instagram.com/sprockets" },
          assertionKind: "stated",
        },
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
    await resolveClubs(db, { clubIds: [a, b], now: NOW });
    expect((await runReconcile({ db, logger: silentLogger, now: () => NOW })).counters.autoMerged).toBe(0);
  });

  it("a rejection survives when one of the clubs is later merged away", async () => {
    const x = await addClubWithOfficialSite("Harvard Undergraduate Lantern Society", "https://lantern-x.test/");
    const y = await addClubWithOfficialSite("Harvard College Lantern Society", "https://lantern-y.test/");
    await runReconcile({ db, logger: silentLogger, now: () => NOW });
    const cand = (await db.select().from(schema.mergeCandidate)).find(
      (m) => [m.clubAId, m.clubBId].sort().join() === [x, y].sort().join(),
    );
    await rejectMergeCandidate(db, { candidateId: cand!.id, actor: "test" });
    // x is merged into a third club z (a real duplicate of x); z must not be re-proposed against y.
    const z = await addClubWithOfficialSite("Lantern Society (Undergraduate)", "https://lantern-x.test/");
    // Give z more evidence so it survives the merge (the pair key then changes from x|y to z|y).
    const zsrc = await upsertSource(db, { url: "https://directory.harvard.test/orgs", sourceType: "harvard_official" });
    for (const url of ["https://instagram.com/lanternsoc", "https://linkedin.com/company/lanternsoc"])
      await upsertClaim(
        db,
        {
          clubId: z,
          fieldKey: "club.link",
          value: { kind: url.includes("instagram") ? "instagram" : "linkedin", url },
          assertionKind: "stated",
        },
        {
          sourceId: zsrc,
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
    await resolveClubs(db, { clubIds: [z], now: NOW });
    const r = await runReconcile({ db, logger: silentLogger, now: () => NOW });
    expect(r.counters.autoMerged).toBe(1);
    const open = (await db.select().from(schema.mergeCandidate)).filter(
      (m) => m.status === "proposed" && [m.clubAId, m.clubBId].includes(y),
    );
    const [xRow] = await db.select().from(schema.club).where(eq(schema.club.id, x));
    expect(xRow?.mergedIntoClubId).toBe(z);
    expect(open).toHaveLength(0);
  });

  it("reports coverage", async () => {
    const s = await coverageStats(db);
    expect(Number(s.canonicalClubs)).toBeGreaterThan(40);
    expect(String(s.withWebsiteVerifiedOrProbable)).toMatch(/%/);
  });
});
