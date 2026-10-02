import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FieldKey } from "@hci/core";
import {
  createClub,
  ensureRecruitingCycle,
  getClubProfile,
  getStaticIndex,
  listClubs,
  publicProfile,
  resolveClubs,
  seedTaxonomy,
  upsertClaim,
  upsertSource,
  type Db,
  type StaticIndex,
} from "../src";
import { ClubFilters, facetCounts, searchLocal } from "../src/local";
import { createTestDb } from "../src/testing";

/**
 * Filter quality end to end (ADR 0041): fictional clubs with page-style quotes go through
 * the claims path, the resolver's joining derivation, the static index and both filter
 * implementations. Each club is one case from the filter audit.
 */
const NOW = new Date("2026-10-02T16:00:00Z");
let db: Db;
let close: () => Promise<void>;
let index: StaticIndex;

type Fact = { field: FieldKey; value: unknown; quote?: string; ageDays?: number; from?: "site" | "directory" };
interface Case {
  slug: string;
  facts: Fact[];
  cycle?: { term: string; facts: Fact[] };
}

const CASES: Case[] = [
  { slug: "first-years-welcome", facts: [{ field: "club.freshmen_eligible", value: true, quote: "First-years welcome!" }] },
  {
    slug: "open-to-college",
    facts: [
      {
        field: "club.join_mode",
        value: "open",
        quote: "Joining is easy: membership is open to all Harvard College students.",
      },
    ],
  },
  {
    slug: "upperclass-only",
    facts: [
      {
        field: "club.eligible_classes",
        value: ["sophomore", "junior", "senior"],
        quote: "Membership is open to sophomores, juniors, and seniors.",
      },
    ],
  },
  { slug: "says-nothing", facts: [{ field: "club.category", value: "public-service" }] },
  {
    slug: "first-years-may-apply",
    facts: [
      { field: "club.join_mode", value: "application", quote: "First-years may apply through our fall application." },
    ],
  },
  {
    slug: "no-application",
    facts: [
      { field: "club.join_mode", value: "open", quote: "All students welcome, no application necessary." },
      { field: "club.category", value: "public-service" },
    ],
  },
  {
    slug: "applications-required",
    facts: [{ field: "club.join_mode", value: "application", quote: "Applications are required for all new members." }],
  },
  {
    slug: "directory-listing-only",
    facts: [
      { field: "club.tag", value: "Public Service", quote: "Public Service", from: "directory" },
      { field: "club.recognition_status", value: "recognized", from: "directory" },
    ],
  },
  {
    slug: "performers-audition",
    facts: [
      { field: "club.join_mode", value: "open", quote: "Crew positions are open to anyone: just come to a meeting." },
      { field: "club.join_mode", value: "audition", quote: "Acting roles are cast by audition for each show." },
    ],
  },
  {
    slug: "board-applies",
    facts: [
      { field: "club.join_mode", value: "open", quote: "Everyone is welcome to join us at any meeting." },
      { field: "club.join_mode", value: "application", quote: "Apply to join our executive board!" },
    ],
  },
  {
    slug: "directory-no-comp",
    facts: [
      { field: "club.tag", value: "no comping requirement", quote: "No Comping Requirement", from: "directory" },
      { field: "club.dues", value: { hasDues: false }, quote: "No Dues Required", from: "directory" },
      { field: "club.eligible_classes", value: ["first_year", "sophomore", "junior", "senior"], quote: "Open to all Harvard undergraduates." },
    ],
  },
  {
    slug: "old-recruiting-page",
    facts: [{ field: "club.join_mode", value: "application", quote: "Applications are due September 12." }],
    cycle: { term: "2025-fall", facts: [{ field: "cycle.deadline", value: { at: "2025-09-12", precision: "date" } }] },
  },
  {
    slug: "recruiting-open-no-comp",
    facts: [
      { field: "club.join_mode", value: "open", quote: "Anyone can join: just show up to a practice." },
      { field: "club.dues", value: { hasDues: false }, quote: "No Dues Required", from: "directory" },
    ],
    cycle: { term: "2026-fall", facts: [{ field: "cycle.deadline", value: { at: "2026-10-09", precision: "date" } }] },
  },
  {
    slug: "conflicting-years",
    facts: [
      { field: "club.freshmen_eligible", value: true, quote: "First-years are welcome to comp.", ageDays: 400 },
      { field: "club.freshmen_eligible", value: false, quote: "First-years are not eligible to comp." },
    ],
  },
  {
    slug: "dues-charged",
    facts: [{ field: "club.dues", value: { hasDues: true, amountUsd: 40 }, quote: "Dues are $40 per semester." }],
  },
];

beforeAll(async () => {
  ({ db, close } = await createTestDb());
  await seedTaxonomy(db);
  const ids: string[] = [];
  for (const c of CASES) {
    const { id } = await createClub(db, { name: `Joining Case ${c.slug}`, slug: `fixture-${c.slug}`, dataOrigin: "fixture" });
    ids.push(id);
    const site = await upsertSource(db, {
      url: `https://${c.slug}.fixture.invalid/`,
      sourceType: "club_website",
      isFixture: true,
      ownerClubId: id,
    });
    const directory = await upsertSource(db, {
      url: `https://directory.fixture.invalid/${c.slug}`,
      sourceType: "harvard_official",
      isFixture: true,
    });
    const write = async (f: Fact, cycleId: string | null, term: string | null) =>
      upsertClaim(
        db,
        { clubId: id, recruitingCycleId: cycleId, fieldKey: f.field, value: f.value, assertionKind: "stated", termKey: term },
        {
          sourceId: f.from === "directory" ? directory : site,
          sourceType: f.from === "directory" ? "harvard_official" : "club_website",
          snapshotId: null,
          ingestionRunId: null,
          observedAt: new Date(NOW.getTime() - (f.ageDays ?? 3) * 86_400_000),
          quote: f.quote ?? null,
          extractionMethod: "fixture",
          extractorName: "joining-test",
          extractorVersion: "1",
          isDirect: true,
        },
      );
    await write({ field: "club.name", value: `Joining Case ${c.slug}` }, null, null);
    await write({ field: "club.short_description", value: `Fictional test club: ${c.slug}.` }, null, null);
    for (const f of c.facts) await write(f, null, null);
    if (c.cycle) {
      const cycleId = await ensureRecruitingCycle(db, { clubId: id, termKey: c.cycle.term });
      for (const f of c.cycle.facts) await write(f, cycleId, c.cycle.term);
    }
  }
  await resolveClubs(db, { clubIds: ids, now: NOW });
  index = JSON.parse(JSON.stringify(await getStaticIndex(db, NOW))) as StaticIndex;
});
afterAll(async () => close());

const pick = (f: Partial<ClubFilters>) =>
  searchLocal(index.clubs, { text: null, filters: ClubFilters.parse(f), sort: "name", offset: 0, limit: 100, now: NOW })
    .clubs.map((c) => c.slug.replace("fixture-", ""))
    .sort();
const joining = (slug: string) => index.clubs.find((c) => c.slug === `fixture-${slug}`)!.joining;

describe("derived joining facts from the claims path", () => {
  it("first-years: named, implied by 'all College students', refused by a class list, unknown otherwise", () => {
    expect(joining("first-years-welcome").firstYears).toBe(true);
    expect(joining("open-to-college").firstYears).toBe(true);
    expect(joining("upperclass-only").firstYears).toBe(false);
    expect(joining("says-nothing").firstYears).toBe(null);
  });

  it("'first-years may apply' establishes eligibility, not open membership", () => {
    expect(joining("first-years-may-apply")).toMatchObject({ firstYears: true, access: "process" });
  });

  it("open, process and unknown access", () => {
    expect(joining("no-application").access).toBe("open");
    expect(joining("applications-required").access).toBe("process");
    expect(joining("directory-listing-only")).toMatchObject({ access: null, comp: null });
  });

  it("a performer audition or a board application leaves general membership open", () => {
    expect(joining("performers-audition")).toMatchObject({
      access: "open",
      general: ["open"],
      roles: [{ mode: "audition", role: "ensemble" }],
    });
    expect(joining("board-applies")).toMatchObject({ access: "open", roles: [{ mode: "application", role: "leadership" }] });
    // The directory filters on general membership: the board's application doesn't count.
    expect(index.clubs.find((c) => c.slug === "fixture-board-applies")!.joinModes).toEqual(["open"]);
  });

  it("equally specific old and new statements that disagree stay unknown, with the conflict recorded", () => {
    expect(joining("conflicting-years")).toMatchObject({ firstYears: null, conflicts: ["firstYears"] });
  });

  it("dues: none, charged, unknown", () => {
    expect(joining("directory-no-comp").dues).toBe(false);
    expect(joining("dues-charged").dues).toBe(true);
    expect(joining("says-nothing").dues).toBe(null);
  });
});

describe("filters over the derived facts", () => {
  it("each filter keeps exactly the confirmed clubs; unknown is in neither bucket", () => {
    // Unrestricted open membership ("Anyone can join", "Everyone is welcome") includes first-years.
    expect(pick({ freshmenEligible: true })).toEqual([
      "board-applies",
      "directory-no-comp",
      "first-years-may-apply",
      "first-years-welcome",
      "no-application",
      "open-to-college",
      "performers-audition",
      "recruiting-open-no-comp",
    ]);
    expect(pick({ openJoin: true })).toEqual([
      "board-applies",
      "no-application",
      "open-to-college",
      "performers-audition",
      "recruiting-open-no-comp",
    ]);
    expect(pick({ noComp: true })).toEqual([
      "board-applies",
      "directory-no-comp",
      "no-application",
      "open-to-college",
      "performers-audition",
      "recruiting-open-no-comp",
    ]);
    expect(pick({ noDues: true })).toEqual(["directory-no-comp", "recruiting-open-no-comp"]);
  });

  it("combinations intersect the confirmed sets", () => {
    expect(pick({ freshmenEligible: true, noComp: true })).toEqual([
      "board-applies",
      "directory-no-comp",
      "no-application",
      "open-to-college",
      "performers-audition",
      "recruiting-open-no-comp",
    ]);
    expect(pick({ freshmenEligible: true, openJoin: true })).toEqual([
      "board-applies",
      "no-application",
      "open-to-college",
      "performers-audition",
      "recruiting-open-no-comp",
    ]);
    expect(pick({ openJoin: true, noDues: true })).toEqual(["recruiting-open-no-comp"]);
    expect(pick({ openJoin: true, categories: ["public-service"] })).toEqual(["no-application"]);
    expect(pick({ recruitingNow: true, openJoin: true })).toEqual(["recruiting-open-no-comp"]);
  });

  it("a last-year deadline is not recruiting now", () => {
    expect(pick({ recruitingNow: true })).toEqual(["recruiting-open-no-comp"]);
  });

  it("counts say how many confirm, refuse, or don't say", () => {
    const f = facetCounts(index.clubs, { text: null, filters: ClubFilters.parse({}), now: NOW });
    expect(f.freshmenEligible).toBe(8);
    expect(f.known.freshmenEligible).toEqual({ yes: 8, no: 1, unknown: CASES.length - 9 });
    // Selecting another filter narrows the counts to that view.
    const g = facetCounts(index.clubs, { text: null, filters: ClubFilters.parse({ openJoin: true }), now: NOW });
    expect(g.freshmenEligible).toBe(5);
    expect(g.noDues).toBe(1);
  });

  it.each([
    ["first-years", { freshmenEligible: true }],
    ["open", { openJoin: true }],
    ["no comp", { noComp: true }],
    ["no dues", { noDues: true }],
    ["first-years + no comp", { freshmenEligible: true, noComp: true }],
    ["application", { joinModes: ["application"] }],
  ] as [string, Partial<ClubFilters>][])("Postgres agrees: %s", async (_label, f) => {
    const filters = ClubFilters.parse(f);
    const pg = await listClubs(db, { text: null, filters, sort: "name", page: 1, pageSize: 100, now: NOW });
    expect(pg.clubs.map((c) => c.slug.replace("fixture-", "")).sort()).toEqual(pick(f));
  });
});

describe("published profile", () => {
  it("carries each derived fact's rule and pages, never a quote", async () => {
    const r = await getClubProfile(db, "fixture-open-to-college", NOW);
    if (r.kind !== "found") throw new Error("missing profile");
    const p = publicProfile(r.profile);
    expect(p.joiningBasis.firstYears?.rule).toBe("open_population");
    expect(p.joiningBasis.firstYears?.sources[0]?.url).toBe("https://open-to-college.fixture.invalid/");
    expect(JSON.stringify(p.joiningBasis)).not.toContain("Joining is easy");
  });
});
