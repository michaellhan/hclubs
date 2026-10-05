import sharp from "sharp";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { normalizeUrl } from "@hci/core";
import { createClub, recordSnapshot, rejectClaims, restoreClaims, schema, upsertSource, type Db } from "@hci/db";
import { createTestDb } from "@hci/db/testing";
import { silentLogger } from "../src/logger";
import { MemorySnapshotStore } from "../src/snapshots/store";
import { runLogos } from "../src/stages/logos";
import type { FetchResult, SourceCandidate, SourceFetcher } from "../src/types";

/**
 * The logos stage against a real database: what it writes, what it leaves alone (reviewer
 * decisions, hand restores, editorial claims) and what a failed image fetch does.
 */

const SITE = "https://fixture-logo-club.invalid/";
const HEADER = "https://fixture-logo-club.invalid/img/club-logo.png";
const ICON = "https://fixture-logo-club.invalid/apple-touch-icon.png";
const HTML = `<html><head><title>Fixture Logo Club</title><link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png"></head>
<body><header><a href="/"><img src="/img/club-logo.png" alt="Fixture Logo Club"></a></header><main><p>Hi</p></main></body></html>`;

/** A dark mark on transparency, like a real logo file. */
const png = (w: number, h: number) =>
  sharp(
    Buffer.from(
      `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><circle cx="${w / 2}" cy="${h / 2}" r="${w / 3}" fill="#142a5a"/></svg>`,
    ),
  )
    .png()
    .toBuffer();

/** Serves the two images; `down` makes a URL fail like a timed-out CDN. */
class FakeImages implements SourceFetcher {
  readonly down = new Set<string>();
  calls = 0;
  constructor(private readonly images: Map<string, Buffer>) {}
  async fetch(c: SourceCandidate): Promise<FetchResult> {
    this.calls++;
    const base = {
      requestedUrl: c.url,
      finalUrl: c.url,
      etag: null,
      lastModified: null,
      fetchedAt: new Date(),
      attempts: 1,
      durationMs: 1,
      method: "static" as const,
    };
    const body = this.images.get(c.url);
    if (this.down.has(c.url) || !body)
      return { ...base, status: "network_error", httpStatus: null, contentType: null, body: null, error: "timeout" };
    return { ...base, status: "ok", httpStatus: 200, contentType: "image/png", body, error: null };
  }
}

let db: Db;
let close: () => Promise<void>;
let clubId: string;
let fetcher: FakeImages;
const store = new MemorySnapshotStore();

/** The club's website link (a projection the resolver rebuilds, so set before each run). */
async function linkSite() {
  await db
    .insert(schema.clubLink)
    .values({ clubId, kind: "website", url: SITE, normalizedUrl: normalizeUrl(SITE) ?? SITE, status: "verified" })
    .onConflictDoNothing();
}

let today = new Date("2026-10-05T12:00:00Z");

async function run(opts: Parameters<typeof runLogos>[1] = {}) {
  await linkSite();
  return runLogos({ db, fetcher, store, logger: silentLogger, now: () => today }, opts);
}

async function logoClaims() {
  const rows = await db
    .select({ id: schema.claim.id, value: schema.claim.value, status: schema.claim.status })
    .from(schema.claim)
    .where(and(eq(schema.claim.clubId, clubId), eq(schema.claim.fieldKey, "club.logo")));
  return rows.map((r) => ({ ...r, value: String(r.value) }));
}

beforeAll(async () => {
  ({ db, close } = await createTestDb());
  ({ id: clubId } = await createClub(db, { name: "Fixture Logo Club", dataOrigin: "fixture" }));
  const sourceId = await upsertSource(db, {
    url: SITE,
    sourceType: "club_website",
    ownerClubId: clubId,
    isFixture: true,
  });
  const bytes = new TextEncoder().encode(HTML);
  const put = await store.put(bytes);
  await recordSnapshot(db, {
    sourceId,
    ingestionRunId: null,
    fetchedAt: new Date("2026-10-01T12:00:00Z"),
    finalUrl: SITE,
    httpStatus: 200,
    contentType: "text/html",
    contentSha256: put.sha256,
    byteSize: put.byteSize,
    storageKey: put.key,
    extractedText: null,
    fetchMethod: "fixture",
  });
  fetcher = new FakeImages(
    new Map([
      [HEADER, await png(300, 300)],
      [ICON, await png(180, 180)],
    ]),
  );
});
afterAll(async () => close());

describe("logos stage", () => {
  it("measures the candidates once and claims the header logo", async () => {
    const r = await run();
    expect(r.errors).toEqual([]);
    expect(r.outcomes[0]).toMatchObject({ logo: HEADER, kind: "header_img", changed: true });
    expect(r.probed).toBe(2);
    expect((await logoClaims()).filter((c) => c.status === "active").map((c) => c.value)).toEqual([
      normalizeUrl(HEADER),
    ]);
    // Rerun: nothing measured again, nothing changed.
    const again = await run();
    expect(again.probed).toBe(0);
    expect(again.outcomes[0]?.changed).toBe(false);
  });

  it("leaves everything alone when a deciding image failed to load (retried later)", async () => {
    fetcher.down.add(HEADER);
    const r = await run({ reprobe: true });
    expect(r.outcomes[0]?.changed).toBe(false);
    expect(r.outcomes[0]?.skipped.join(" ")).toMatch(/undecided/);
    expect((await logoClaims()).find((c) => c.value === normalizeUrl(HEADER))?.status).toBe("active");
    fetcher.down.clear();
    // Not retried the same day; the next day's run measures it again and the logo stays.
    expect((await run()).probed).toBe(0);
    today = new Date("2026-10-06T12:00:00Z");
    const back = await run();
    expect(back.probed).toBe(1);
    expect(back.outcomes[0]).toMatchObject({ logo: HEADER, changed: false });
  });

  it("keeps a reviewer's rejection: the next candidate is used instead", async () => {
    const header = (await logoClaims()).find((c) => c.value === normalizeUrl(HEADER));
    if (!header) throw new Error("no header claim");
    await rejectClaims(db, { claimIds: [header.id], actor: "audit-review", reason: "audit review: a sponsor's mark" });
    const r = await run();
    expect(r.outcomes[0]).toMatchObject({ logo: ICON, kind: "apple_touch_icon" });
    const claims = await logoClaims();
    expect(claims.find((c) => c.value === normalizeUrl(HEADER))?.status).toBe("rejected");
    expect(claims.find((c) => c.value === normalizeUrl(ICON))?.status).toBe("active");
  });

  it("keeps a logo restored by hand, and revives its own earlier rejections", async () => {
    const header = (await logoClaims()).find((c) => c.value === normalizeUrl(HEADER));
    if (!header) throw new Error("no header claim");
    await restoreClaims(db, { claimIds: [header.id], actor: "cli", reason: "it is the club's logo" });
    // Restored by hand, but it isn't the pick (the reviewer veto is history now: its latest
    // decision is the restore), so the header becomes the pick again and the icon is retired.
    await run();
    let claims = await logoClaims();
    expect(claims.find((c) => c.value === normalizeUrl(HEADER))?.status).toBe("active");
    expect(claims.find((c) => c.value === normalizeUrl(ICON))?.status).toBe("rejected");
    // The icon's rejection was this stage's own: when it is the pick again, it comes back.
    await rejectClaims(db, { claimIds: [header.id], actor: "logos", reason: "logo-picker: automatic" });
    await run();
    claims = await logoClaims();
    expect(claims.find((c) => c.value === normalizeUrl(HEADER))?.status).toBe("active");
  });

  it("changes nothing offline when images were never measured", async () => {
    const before = await logoClaims();
    await db.delete(schema.imageProbe);
    const calls = fetcher.calls;
    const r = await run({ offline: true });
    expect(fetcher.calls).toBe(calls);
    expect(r.outcomes[0]?.changed).toBe(false);
    expect(await logoClaims()).toEqual(before);
  });
});
