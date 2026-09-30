import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { count, eq } from "drizzle-orm";
import {
  ClubFilters,
  getCategories,
  getClubProfile,
  getClubsForCompare,
  getRecruitingNow,
  listClubs,
  resolveClubs,
  schema,
  seedFixtures,
  seedTaxonomy,
  upsertClaim,
  upsertSource,
  createClub,
  type Db,
} from "../src";
import { createTestDb } from "../src/testing";

const NOW = new Date("2026-09-30T16:00:00Z");
let db: Db;
let close: () => Promise<void>;

async function counts() {
  const [clubs] = await db.select({ n: count() }).from(schema.club);
  const [claims] = await db.select({ n: count() }).from(schema.claim);
  const [evidence] = await db.select({ n: count() }).from(schema.claimEvidence);
  const [sources] = await db.select({ n: count() }).from(schema.source);
  return { clubs: clubs?.n, claims: claims?.n, evidence: evidence?.n, sources: sources?.n };
}

const search = (
  text: string | null,
  filters: Partial<ClubFilters> = {},
  sort: "relevance" | "name" | "deadline" = "relevance",
) => listClubs(db, { text, filters: ClubFilters.parse(filters), sort, page: 1, pageSize: 50, now: NOW });

beforeAll(async () => {
  ({ db, close } = await createTestDb());
  await seedTaxonomy(db);
  await seedFixtures(db, NOW);
});
afterAll(async () => close());

describe("seeding and idempotency", () => {
  it("re-running the seed creates no duplicates", async () => {
    const before = await counts();
    await seedTaxonomy(db);
    await seedFixtures(db, NOW);
    expect(await counts()).toEqual(before);
    expect(before.clubs).toBeGreaterThanOrEqual(15);
  });

  it("marks every fixture club as fixture data", async () => {
    const rows = await db.select({ slug: schema.club.slug, origin: schema.club.dataOrigin }).from(schema.club);
    for (const r of rows) {
      expect(r.origin).toBe("fixture");
      expect(r.slug.startsWith("fixture-")).toBe(true);
    }
  });

  it("enforces the claim/evidence consistency constraints", async () => {
    const clubId = (await createClub(db, { name: "Constraint Test Club" })).id;
    await expect(
      db.insert(schema.claim).values({
        subjectType: "recruiting_cycle",
        clubId,
        fieldKey: "cycle.deadline",
        value: {},
        normalizedValue: {},
        valueHash: "x",
        assertionKind: "stated",
        firstObservedAt: NOW,
        lastObservedAt: NOW,
      }),
    ).rejects.toThrow();
    await db.delete(schema.club).where(eq(schema.club.id, clubId));
  });
});

describe("claims + resolver", () => {
  it("keeps conflicting claims and flags the conflict", async () => {
    const r = await getClubProfile(db, "fixture-startup-studio", NOW);
    if (r.kind !== "found") throw new Error("missing");
    const members = r.profile.fields["club.member_count"];
    expect(members?.kind).toBe("single");
    if (members?.kind === "single") {
      expect(members.conflict).toBe(true);
      expect(members.alternatives).toHaveLength(1);
    }
    expect(r.profile.membership).toHaveLength(2);
    expect(r.profile.membership.filter((m) => m.isCurrent)).toHaveLength(1);
  });

  it("computes acceptance rate only from stated counts and labels it derived", async () => {
    const r = await getClubProfile(db, "fixture-northyard-consulting-group", NOW);
    if (r.kind !== "found") throw new Error("missing");
    expect(r.profile.selectivity?.acceptanceRate).toBeCloseTo(0.15);
    expect(r.profile.selectivity?.label).toBe("highly_selective");
    const quincy = await getClubProfile(db, "fixture-quincy-street-investment-fund", NOW);
    if (quincy.kind !== "found") throw new Error("missing");
    expect(quincy.profile.selectivity).toBeNull();
  });

  it("computes cycle status at read time", async () => {
    const r = await getClubProfile(db, "fixture-the-mossy-notes", NOW);
    if (r.kind !== "found") throw new Error("missing");
    expect(r.profile.cycles[0]?.status).toBe("closed");
    const later = await getClubProfile(
      db,
      "fixture-northyard-consulting-group",
      new Date(NOW.getTime() + 30 * 86_400_000),
    );
    if (later.kind !== "found") throw new Error("missing");
    expect(later.profile.cycles.find((c) => c.stages.length > 0)?.status).toBe("closed");
  });

  it("links are verified only when stated by an official channel", async () => {
    const r = await getClubProfile(db, "fixture-undergraduate-fintech-circle", NOW);
    if (r.kind !== "found") throw new Error("missing");
    expect(r.profile.links.every((l) => l.status === "verified")).toBe(true);
    const clubId = r.profile.id;
    const sourceId = await upsertSource(db, { url: "https://search.example.org/result", sourceType: "public_web" });
    await upsertClaim(
      db,
      {
        clubId,
        fieldKey: "club.link",
        value: { kind: "website", url: "https://maybe-fintech.example.org" },
        assertionKind: "stated",
      },
      {
        sourceId,
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
    await resolveClubs(db, { clubIds: [clubId], now: NOW });
    const after = await getClubProfile(db, "fixture-undergraduate-fintech-circle", NOW);
    if (after.kind !== "found") throw new Error("missing");
    expect(after.profile.links.find((l) => l.url.includes("maybe-fintech"))?.status).toBe("candidate");
  });

  it("stale values downgrade to reported", async () => {
    const r = await getClubProfile(db, "fixture-vintage-radio-society", NOW);
    if (r.kind !== "found") throw new Error("missing");
    const f = r.profile.fields["club.org_type"];
    expect(f?.kind === "single" && f.current.badge).toBe("reported");
  });

  it("returns redirect/not_found appropriately", async () => {
    expect((await getClubProfile(db, "no-such-club", NOW)).kind).toBe("not_found");
  });
});

describe("search and filters", () => {
  const slugs = async (...args: Parameters<typeof search>) => (await search(...args)).clubs.map((c) => c.slug);

  it("finds by exact acronym first", async () => {
    expect((await slugs("NCG"))[0]).toBe("fixture-northyard-consulting-group");
    expect((await slugs("qsif"))[0]).toBe("fixture-quincy-street-investment-fund");
  });
  it("finds by partial name, alias and description", async () => {
    expect(await slugs("northy")).toContain("fixture-northyard-consulting-group");
    expect((await slugs("Quad Review"))[0]).toBe("fixture-the-quad-review");
    expect(await slugs("stock pitches")).toContain("fixture-quincy-street-investment-fund");
    expect(await slugs("consulting")).toContain("fixture-northyard-consulting-group");
  });
  it("tolerates typos via trigram similarity", async () => {
    expect(await slugs("ironbark robotcs")).toContain("fixture-ironbark-robotics");
  });
  it("returns nothing for nonsense", async () => {
    expect(await slugs("zzqqxxj")).toEqual([]);
  });
  it("filters by category including child categories", async () => {
    const finance = await slugs(null, { categories: ["finance"] });
    expect(finance).toEqual(
      expect.arrayContaining(["fixture-quincy-street-investment-fund", "fixture-undergraduate-fintech-circle"]),
    );
    expect(finance).not.toContain("fixture-northyard-consulting-group");
    const preprof = await slugs(null, { categories: ["pre-professional"] });
    expect(preprof).toEqual(
      expect.arrayContaining(["fixture-northyard-consulting-group", "fixture-quincy-street-investment-fund"]),
    );
  });
  it("filters by join mode, recruiting now, freshmen, recognition", async () => {
    expect(await slugs(null, { joinModes: ["comp"] })).toEqual(
      expect.arrayContaining(["fixture-quincy-street-investment-fund", "fixture-the-quad-review"]),
    );
    const recruiting = await slugs(null, { recruitingNow: true });
    expect(recruiting).toEqual(
      expect.arrayContaining([
        "fixture-northyard-consulting-group",
        "fixture-stepline-dance-company",
        "fixture-beacon-street-tutors",
        "fixture-ironbark-robotics",
      ]),
    );
    expect(recruiting).not.toContain("fixture-the-mossy-notes"); // closed
    expect(recruiting).not.toContain("fixture-oxbow-software-collective"); // upcoming
    const fresh = await slugs(null, { freshmenEligible: true });
    expect(fresh).not.toContain("fixture-stepline-dance-company"); // unknown ≠ eligible
    expect(await slugs(null, { recognition: ["not_recognized"] })).toEqual(
      expect.arrayContaining(["fixture-undergraduate-fintech-circle", "fixture-evening-supper-society"]),
    );
  });
  it("sorts by soonest deadline", async () => {
    const r = await slugs(null, { recruitingNow: true }, "deadline");
    expect(r[0]).toBe("fixture-the-quad-review"); // +3 days
  });
  it("home page queries work", async () => {
    const rec = await getRecruitingNow(db, NOW, 3);
    expect(rec).toHaveLength(3);
    const cats = await getCategories(db);
    expect(cats.find((c) => c.slug === "pre-professional")?.clubCount).toBeGreaterThanOrEqual(5);
    const cmp = await getClubsForCompare(db, ["fixture-the-quad-review", "nope", "fixture-ironbark-robotics"], NOW);
    expect(cmp.map((c) => c.slug)).toEqual(["fixture-the-quad-review", "fixture-ironbark-robotics"]);
  });
});
