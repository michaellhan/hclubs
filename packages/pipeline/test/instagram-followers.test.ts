import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { normalizeUrl } from "@hci/core";
import { createClub, mergeClubs, schema, type Db } from "@hci/db";
import { createTestDb } from "@hci/db/testing";
import { silentLogger } from "../src/logger";
import { MemorySnapshotStore } from "../src/snapshots/store";
import {
  FollowerEntry,
  followerEntryProblem,
  followersTextRange,
  runInstagramFollowers,
} from "../src/stages/instagram-followers";

const NOW = new Date("2026-10-04T12:00:00Z");
const entries = JSON.parse(
  readFileSync(new URL("./fixtures/instagram-followers/entries.json", import.meta.url), "utf8"),
) as unknown[];
const first = FollowerEntry.parse(entries[0]);

describe("followersTextRange", () => {
  it("reads exact counts and rounded K/M counts", () => {
    expect(followersTextRange("1,234 Followers")).toEqual({ min: 1234, max: 1234 });
    expect(followersTextRange("1 follower")).toEqual({ min: 1, max: 1 });
    expect(followersTextRange("1.2K followers")).toEqual({ min: 1150, max: 1249 });
    expect(followersTextRange("12K Followers")).toEqual({ min: 11500, max: 12499 });
    expect(followersTextRange("1.1M followers")).toEqual({ min: 1_050_000, max: 1_149_999 });
    expect(followersTextRange("210 Following")).toBeNull();
    expect(followersTextRange("lots of followers")).toBeNull();
  });
});

describe("followerEntryProblem", () => {
  it("accepts a count its own text states", () => {
    expect(followerEntryProblem(first, NOW)).toBeNull();
  });
  it("rejects counts the text doesn't support", () => {
    expect(followerEntryProblem({ ...first, followers: 9999 }, NOW)).toMatch(/does not match/);
    expect(followerEntryProblem({ ...first, evidence: "210 Following" }, NOW)).toMatch(/not in the evidence/);
    expect(followerEntryProblem({ ...first, handle: "someoneelse" }, NOW)).toMatch(/handle/);
    expect(followerEntryProblem({ ...first, url: "https://example.com/x" }, NOW)).toMatch(/Instagram/);
    expect(followerEntryProblem({ ...first, observedAt: "2027-01-01T00:00:00Z" }, NOW)).toMatch(/past/);
  });
});

describe("runInstagramFollowers", () => {
  let db: Db;
  let close: () => Promise<void>;
  const store = new MemorySnapshotStore();
  const run = (opts: { dryRun?: boolean; entries?: unknown[] } = {}) =>
    runInstagramFollowers({ db, store, logger: silentLogger, now: () => NOW }, { entries, ...opts });
  const stored = async (slug: string) => {
    const [c] = await db
      .select({ n: schema.club.instagramFollowers })
      .from(schema.club)
      .where(eq(schema.club.slug, slug));
    return c?.n ?? null;
  };

  beforeAll(async () => {
    ({ db, close } = await createTestDb());
    await createClub(db, { name: "The Fictional Gazette", slug: "fixture-gazette", dataOrigin: "fixture" });
  });
  afterAll(() => close());

  it("writes nothing on a dry run", async () => {
    const r = await run({ dryRun: true });
    expect(r.written).toBe(0);
    expect(await stored("fixture-gazette")).toBeNull();
  });

  it("writes stated claims, skips unknown slugs and unsupported counts, and the newest count wins", async () => {
    const r = await run();
    expect(r.written).toBe(2);
    expect(r.outcomes.map((o) => o.result)).toEqual([
      expect.stringMatching(/^wrote 1234 \(public_web\)/),
      expect.stringMatching(/^wrote 1300/),
      "skipped: no such club",
      expect.stringMatching(/^skipped: 9999 does not match/),
    ]);
    // 1.3K (2 Oct) is newer than 1,234 (1 Oct); 1300 is stated as "1.3K", i.e. inside its range.
    expect(await stored("fixture-gazette")).toBe(1300);
    const claims = await db.select().from(schema.claim).where(eq(schema.claim.fieldKey, "club.instagram_followers"));
    expect(claims).toHaveLength(2);
    expect(claims.every((c) => c.assertionKind === "stated")).toBe(true);
    const ev = await db.select().from(schema.claimEvidence);
    expect(ev.every((e) => e.evidenceQuote && e.snapshotId && e.extractionMethod === "manual")).toBe(true);
  });

  it("is idempotent", async () => {
    const count = async () => ({
      claims: (await db.select().from(schema.claim)).length,
      evidence: (await db.select().from(schema.claimEvidence)).length,
      snapshots: (await db.select().from(schema.sourceSnapshot)).length,
      sources: (await db.select().from(schema.source)).length,
    });
    const before = await count();
    await run();
    expect(await count()).toEqual(before);
    expect(await stored("fixture-gazette")).toBe(1300);
  });

  it("is club_social only when the account is a verified link of the club", async () => {
    const [c] = await db
      .select({ id: schema.club.id })
      .from(schema.club)
      .where(eq(schema.club.slug, "fixture-gazette"));
    const [src] = await db
      .select({ type: schema.source.sourceType })
      .from(schema.source)
      .where(eq(schema.source.domain, "instagram.com"));
    expect(src?.type).toBe("public_web");
    await db.insert(schema.clubLink).values({
      clubId: c!.id,
      kind: "instagram",
      url: "https://www.instagram.com/fixturegazette/",
      normalizedUrl: normalizeUrl("https://www.instagram.com/fixturegazette/")!,
      handle: "fixturegazette",
      status: "verified",
    });
    await run();
    const [after] = await db
      .select({ type: schema.source.sourceType })
      .from(schema.source)
      .where(eq(schema.source.domain, "instagram.com"));
    expect(after?.type).toBe("club_social");
  });

  it("follows a merge to the surviving club", async () => {
    const loser = await createClub(db, {
      name: "Fictional Gazette Duplicate",
      slug: "fixture-gazette-dup",
      dataOrigin: "fixture",
    });
    const [winner] = await db
      .select({ id: schema.club.id })
      .from(schema.club)
      .where(eq(schema.club.slug, "fixture-gazette"));
    await mergeClubs(db, { survivorId: winner!.id, absorbedId: loser.id, actor: "test", reason: "duplicate" });
    const r = await run({
      entries: [
        {
          ...(entries[0] as object),
          slug: "fixture-gazette-dup",
          observedAt: "2026-10-03T00:00:00.000Z",
          followers: 1240,
          followersText: "1,240 Followers",
          evidence: "1,240 Followers, 2 Following",
        },
      ],
    });
    expect(r.outcomes[0]?.result).toMatch(/^wrote 1240/);
    expect(await stored("fixture-gazette")).toBe(1240);
    expect(await stored("fixture-gazette-dup")).toBeNull();
  });
});
