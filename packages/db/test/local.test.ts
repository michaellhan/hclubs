import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import {
  ClubFilters,
  buildRecruitingBoard,
  buildUsuallyRecruiting,
  getClubProfile,
  getRecruitingBoard,
  recruitingSeasonForDate,
  recruitingSeasonsOf,
  getStaticIndex,
  listClubs,
  searchLocal,
  seedFixtures,
  seedTaxonomy,
  type Db,
  type StaticIndex,
} from "../src";
import { isSparseClub } from "../src/local/filters";
import { createTestDb } from "../src/testing";

/**
 * The static site filters in the browser. These tests pin it to the Postgres provider:
 * same filters ⇒ same set of clubs; same recruiting board.
 */
const NOW = new Date("2026-09-30T16:00:00Z");
let db: Db;
let close: () => Promise<void>;
let index: StaticIndex;

beforeAll(async () => {
  ({ db, close } = await createTestDb());
  await seedTaxonomy(db);
  await seedFixtures(db, NOW);
  index = JSON.parse(JSON.stringify(await getStaticIndex(db, NOW))) as StaticIndex; // as shipped
});
afterAll(async () => close());

const CASES: [string, string | null, Partial<ClubFilters>][] = [
  ["everything", null, {}],
  ["with inactive + graduate", null, { includeInactive: true, includeGraduate: true }],
  ["recruiting now", null, { recruitingNow: true }],
  ["first-years", null, { freshmenEligible: true }],
  ["comp", null, { joinModes: ["comp"] }],
  ["constraint phrase", "no comp finance", {}],
  ["constraint phrases only", "first years no dues", {}],
  ["hours range", "3-5 hours a week", {}],
  ["hours range after a lead", "under 3-5 hours", {}],
  ["process word alone", "comp", {}],
  ["process words alone", "auditions or tryouts", {}],
  ["deadline alone", "deadline", {}],
  ["application + due", "applications due", {}],
  ["deadline window", "deadline this week", {}],
  ["parent category", null, { categories: ["pre-professional"] }],
];

describe("static index + local search", () => {
  it("ships every active club with search fields", () => {
    expect(index.clubs.length).toBeGreaterThan(10);
    for (const c of index.clubs) {
      expect(c.searchNames.length).toBeGreaterThan(0);
      expect(c.categorySlugs).toEqual(expect.arrayContaining(c.categories.map((x) => x.slug)));
    }
  });

  it.each(CASES)("filters match Postgres: %s", async (_label, text, f) => {
    const filters = ClubFilters.parse(f);
    const pg = await listClubs(db, { text, filters, sort: "name", page: 1, pageSize: 500, now: NOW });
    const local = searchLocal(index.clubs, { text, filters, sort: "name", offset: 0, limit: 500, now: NOW });
    expect(local.clubs.map((c) => c.slug).sort()).toEqual(pg.clubs.map((c) => c.slug).sort());
  });

  it("process words alone select a real subset in both paths (not every club)", async () => {
    const filters = ClubFilters.parse({});
    for (const text of ["comp", "deadline"]) {
      const pg = await listClubs(db, { text, filters, sort: "name", page: 1, pageSize: 500, now: NOW });
      const all = await listClubs(db, { text: null, filters, sort: "name", page: 1, pageSize: 500, now: NOW });
      expect(pg.clubs.length).toBeGreaterThan(0);
      expect(pg.clubs.length).toBeLessThan(all.clubs.length);
    }
  });

  it("ranks an exact acronym / name first, like Postgres", async () => {
    const target = index.clubs.find((c) => c.acronym && c.acronym.length >= 2)!;
    for (const q of [target.acronym!, target.name]) {
      const local = searchLocal(index.clubs, {
        text: q,
        filters: ClubFilters.parse({}),
        sort: "relevance",
        offset: 0,
        limit: 5,
        now: NOW,
      });
      expect(local.clubs[0]?.slug).toBe(target.slug);
    }
  });

  it("tolerates typos and word prefixes", () => {
    const target = index.clubs.find((c) => c.name.split(" ").length >= 3)!;
    const word = target.name.split(" ").find((w) => w.length >= 6) ?? target.name;
    const typo = word.slice(0, -2) + word.slice(-1) + word.slice(-2, -1); // swap last two letters
    for (const q of [word.slice(0, 4), typo]) {
      const r = searchLocal(index.clubs, {
        text: q,
        filters: ClubFilters.parse({ includeInactive: true, includeGraduate: true }),
        sort: "relevance",
        offset: 0,
        limit: 50,
        now: NOW,
      });
      expect(r.clubs.map((c) => c.slug)).toContain(target.slug);
    }
  });

  it("recomputes cycle status at view time (a page built earlier stays correct)", async () => {
    const later = new Date(NOW.getTime() + 120 * 86_400_000);
    const nowRecruiting = searchLocal(index.clubs, {
      text: null,
      filters: ClubFilters.parse({ recruitingNow: true }),
      sort: "name",
      offset: 0,
      limit: 500,
      now: NOW,
    });
    expect(nowRecruiting.total).toBeGreaterThan(0);
    const pgLater = await listClubs(db, {
      text: null,
      filters: ClubFilters.parse({ recruitingNow: true }),
      sort: "name",
      page: 1,
      pageSize: 500,
      now: later,
    });
    const localLater = searchLocal(index.clubs, {
      text: null,
      filters: ClubFilters.parse({ recruitingNow: true }),
      sort: "name",
      offset: 0,
      limit: 500,
      now: later,
    });
    expect(localLater.clubs.map((c) => c.slug).sort()).toEqual(pgLater.clubs.map((c) => c.slug).sort());
  });

  it("recruiting board matches the database board", async () => {
    const pg = await getRecruitingBoard(db, { now: NOW });
    const local = buildRecruitingBoard(index.clubs, { now: NOW });
    const ids = (b: typeof pg) => ({
      open: b.open.map((e) => e.cycle.id),
      upcoming: b.upcoming.map((e) => e.cycle.id),
      closed: b.recentlyClosed.map((e) => e.cycle.id),
    });
    expect(ids(local)).toEqual(ids(pg));
    expect(pg.open.length + pg.upcoming.length).toBeGreaterThan(0);
  });

  it("ships each club's recruiting pattern exactly as the profile resolves it", async () => {
    for (const c of index.clubs.slice(0, 40)) {
      const r = await getClubProfile(db, c.slug, NOW);
      if (r.kind !== "found") throw new Error(`missing profile ${c.slug}`);
      expect(c.recruitingSeasons).toEqual(recruitingSeasonsOf(r.profile.fields["club.recruiting_seasons"]));
    }
  });
});

describe("little-info clubs (hideSparse)", () => {
  const base = { shortDescription: null, quickLinks: { website: null, instagram: null } };

  it("is sparse only with no short description and no website or Instagram link", () => {
    expect(isSparseClub(base)).toBe(true);
    expect(isSparseClub({ ...base, shortDescription: "   " })).toBe(true);
    expect(isSparseClub({ ...base, quickLinks: null })).toBe(true);
    expect(isSparseClub({ ...base, shortDescription: "Debate team." })).toBe(false);
    expect(isSparseClub({ ...base, quickLinks: { website: "https://x.example/", instagram: null } })).toBe(false);
    expect(isSparseClub({ ...base, quickLinks: { website: null, instagram: "https://instagram.com/x" } })).toBe(false);
  });

  it("hides the same clubs as Postgres and counts them", async () => {
    // Strip two fixture clubs down: one to nothing, one to only a website link.
    // A club whose name search Postgres and the browser rank alike (not the row order's pick).
    const bare = index.clubs.find((c) => c.slug === "fixture-premed-mentorship-network");
    expect(bare?.quickLinks?.website ?? bare?.quickLinks?.instagram ?? null).toBe(null);
    const withSite = index.clubs.find((c) => c.quickLinks?.website);
    expect(bare && withSite).toBeTruthy();
    await db.execute(sql`update club set short_description = null where slug in (${bare!.slug}, ${withSite!.slug})`);
    const fresh = JSON.parse(JSON.stringify(await getStaticIndex(db, NOW))) as StaticIndex;

    for (const text of [null, bare!.name]) {
      const filters = ClubFilters.parse({ hideSparse: true });
      const pg = await listClubs(db, { text, filters, sort: "name", page: 1, pageSize: 500, now: NOW });
      const local = searchLocal(fresh.clubs, { text, filters, sort: "name", offset: 0, limit: 500, now: NOW });
      expect(local.clubs.map((c) => c.slug).sort()).toEqual(pg.clubs.map((c) => c.slug).sort());
      expect(local.clubs.map((c) => c.slug)).not.toContain(bare!.slug);
    }
    const all = searchLocal(fresh.clubs, {
      text: null,
      filters: ClubFilters.parse({}),
      sort: "name",
      offset: 0,
      limit: 500,
      now: NOW,
    });
    const hidden = searchLocal(fresh.clubs, {
      text: null,
      filters: ClubFilters.parse({ hideSparse: true }),
      sort: "name",
      offset: 0,
      limit: 500,
      now: NOW,
    });
    expect(hidden.hiddenSparse).toBeGreaterThan(0);
    expect(hidden.total + hidden.hiddenSparse).toBe(all.total);
    expect(hidden.clubs.map((c) => c.slug)).toContain(withSite!.slug);
    expect(all.hiddenSparse).toBe(0);
  });
});

describe("recruiting patterns (club.recruiting_seasons)", () => {
  const stored = (value: unknown) => ({ kind: "single", current: { value }, alternatives: [], conflict: false });

  it("reads only valid resolved values", () => {
    expect(recruitingSeasonsOf(stored(["fall", "spring"]))).toEqual(["fall", "spring"]);
    expect(recruitingSeasonsOf(stored(["autumn"]))).toEqual([]);
    expect(recruitingSeasonsOf({ kind: "multi", values: [] })).toEqual([]);
    expect(recruitingSeasonsOf(null)).toEqual([]);
  });

  it("maps dates to campus seasons (Aug–Dec fall, Jan–May spring, Jun–Jul summer)", () => {
    expect(recruitingSeasonForDate(new Date("2026-09-30T16:00:00Z"))).toBe("fall");
    expect(recruitingSeasonForDate(new Date("2026-08-01T16:00:00Z"))).toBe("fall");
    expect(recruitingSeasonForDate(new Date("2027-01-01T03:00:00Z"))).toBe("fall"); // still Dec 31 in Boston
    expect(recruitingSeasonForDate(new Date("2027-02-10T16:00:00Z"))).toBe("spring");
    expect(recruitingSeasonForDate(new Date("2027-07-10T16:00:00Z"))).toBe("summer");
  });

  it("filters the directory and lists usual recruiters without dated cycles", () => {
    const clubs = index.clubs.map((c, i) => ({
      ...c,
      recruitingSeasons: i % 2 === 0 ? (["fall"] as const).slice() : [],
    }));
    const fall = searchLocal(clubs, {
      text: null,
      filters: ClubFilters.parse({ recruitingSeasons: ["fall"], includeInactive: true, includeGraduate: true }),
      sort: "name",
      offset: 0,
      limit: 500,
      now: NOW,
    });
    expect(fall.total).toBe(clubs.filter((c) => c.recruitingSeasons.includes("fall")).length);
    expect(
      searchLocal(clubs, {
        text: null,
        filters: ClubFilters.parse({ recruitingSeasons: ["spring"] }),
        sort: "name",
        offset: 0,
        limit: 500,
        now: NOW,
      }).total,
    ).toBe(0);

    const usual = buildUsuallyRecruiting(clubs, { now: NOW });
    const board = buildRecruitingBoard(clubs, { now: NOW });
    const dated = new Set([...board.open, ...board.upcoming].map((e) => e.club.id));
    expect(usual.length).toBeGreaterThan(0);
    for (const c of usual) {
      expect(c.recruitingSeasons).toContain("fall");
      expect(dated.has(c.id)).toBe(false);
      expect(["inactive", "defunct"]).not.toContain(c.activityStatus);
    }
    expect(buildUsuallyRecruiting(clubs, { now: new Date("2027-02-10T16:00:00Z") })).toEqual([]);
  });
});

describe("popularity sort (ADR 0046)", () => {
  it("orders counted clubs by follower count, like Postgres, and ships the count in the index", async () => {
    const { schema } = await import("../src");
    const { eq } = await import("drizzle-orm");
    const slugs = index.clubs.slice(0, 3).map((c) => c.slug);
    const counts = [120, 4800, 950];
    for (const [i, slug] of slugs.entries())
      await db.update(schema.club).set({ instagramFollowers: counts[i]! }).where(eq(schema.club.slug, slug));
    const fresh = JSON.parse(JSON.stringify(await getStaticIndex(db, NOW))) as StaticIndex;
    expect(fresh.clubs.find((c) => c.slug === slugs[1])?.instagramFollowers).toBe(4800);
    expect(fresh.clubs.find((c) => !slugs.includes(c.slug))?.instagramFollowers).toBeNull();
    const filters = ClubFilters.parse({});
    const local = searchLocal(fresh.clubs, { text: null, filters, sort: "popularity", offset: 0, limit: 5, now: NOW });
    const pg = await listClubs(db, { text: null, filters, sort: "popularity", page: 1, pageSize: 5, now: NOW });
    const expected = [slugs[1], slugs[2], slugs[0]];
    expect(local.clubs.slice(0, 3).map((c) => c.slug)).toEqual(expected);
    expect(pg.clubs.slice(0, 3).map((c) => c.slug)).toEqual(expected);
  });
});
