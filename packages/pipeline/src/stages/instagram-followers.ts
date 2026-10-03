import { readFileSync } from "node:fs";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { extractInstagramHandle, normalizeUrl, type SourceType } from "@hci/core";
import { finishRun, recordSnapshot, resolveClubs, schema, startRun, upsertClaim, upsertSource, type Db } from "@hci/db";
import type { Logger } from "../logger";
import type { SnapshotStore } from "../snapshots/store";
import { normalizeForQuote } from "./lifecycle";

/**
 * import-instagram-followers (ADR 0046): follower counts for clubs' Instagram accounts, read
 * from a search result's snippet or the public profile's own description ("1,234 Followers")
 * and saved by hand or by a collector script into `data/imports/instagram-followers.json`.
 * Instagram itself is never fetched here (§21). A count is written only when the verbatim
 * text it came from contains it, so a number is never taken on the file's word; the claim is
 * `stated`, evidenced by an immutable snapshot of that text, and the newest observation of an
 * account wins in the resolver. The count orders the directory ("Popularity") and is never
 * displayed.
 */
export const INSTAGRAM_FOLLOWERS_EXTRACTOR = "instagram-followers";
export const INSTAGRAM_FOLLOWERS_VERSION = "1";

export const FollowerEntry = z.object({
  slug: z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/),
  handle: z.string().min(1).max(60),
  url: z.string().url(),
  followers: z.number().int().nonnegative().max(100_000_000),
  followersText: z.string().trim().min(3).max(60),
  evidence: z.string().trim().min(3).max(4000),
  source: z.enum(["brave", "instagram"]),
  evidenceUrl: z.string().url(),
  observedAt: z.string().datetime({ offset: true }),
});
export type FollowerEntry = z.infer<typeof FollowerEntry>;

const COUNT_TEXT = /^([\d][\d,]*(?:\.\d+)?)\s*([km])?\+?\s*followers?$/i;

/**
 * The range of whole follower counts a printed "1,234 Followers" / "1.2K followers" allows,
 * or null when the text isn't a follower count. "1.2K" says 1,150–1,249 (rounded to a tenth
 * of a thousand), not exactly 1,200. PURE.
 */
export function followersTextRange(text: string): { min: number; max: number } | null {
  const m = COUNT_TEXT.exec(text.trim());
  if (!m) return null;
  const digits = m[1]!.replace(/,/g, "");
  const n = Number(digits);
  if (!Number.isFinite(n)) return null;
  const mult = m[2] ? (m[2].toLowerCase() === "k" ? 1_000 : 1_000_000) : 1;
  if (mult === 1) return Number.isInteger(n) ? { min: n, max: n } : null;
  const decimals = digits.includes(".") ? digits.length - digits.indexOf(".") - 1 : 0;
  const half = mult / 10 ** decimals / 2;
  return { min: Math.ceil(n * mult - half), max: Math.floor(n * mult + half - 0.000001) };
}

/** Why an entry's count isn't supported by its own text, or null. PURE. */
export function followerEntryProblem(e: FollowerEntry, now: Date): string | null {
  const handle = extractInstagramHandle(e.url);
  if (!handle) return `not an Instagram profile URL: ${e.url}`;
  if (handle !== e.handle.replace(/^@/, "").toLowerCase()) return `handle ${e.handle} is not the URL's (${handle})`;
  const range = followersTextRange(e.followersText);
  if (!range) return `"${e.followersText}" is not a follower count`;
  if (e.followers < range.min || e.followers > range.max) return `${e.followers} does not match "${e.followersText}"`;
  if (!normalizeForQuote(e.evidence).includes(normalizeForQuote(e.followersText)))
    return `"${e.followersText}" is not in the evidence text`;
  const at = Date.parse(e.observedAt);
  if (Number.isNaN(at) || at > now.getTime() + 86_400_000) return `observedAt ${e.observedAt} is not a past time`;
  return null;
}

/** ≤ 400 characters of the evidence that contain the count, verbatim. PURE. */
export function followerQuote(e: FollowerEntry): string {
  if (e.evidence.length <= 400) return e.evidence;
  const i = normalizeForQuote(e.evidence).includes(normalizeForQuote(e.followersText))
    ? Math.max(0, e.evidence.toLowerCase().indexOf(e.followersText.toLowerCase()))
    : 0;
  const start = Math.max(0, Math.min(i - 150, e.evidence.length - 400));
  return e.evidence.slice(start, start + 400);
}

export interface FollowersOutcome {
  slug: string;
  handle: string;
  result: string;
}

export async function runInstagramFollowers(
  deps: { db: Db; store: SnapshotStore; logger: Logger; now?: () => Date },
  opts: { file?: string; entries?: unknown[]; dryRun?: boolean },
): Promise<{ runId: string; outcomes: FollowersOutcome[]; written: number; skipped: number }> {
  const { db, store, logger } = deps;
  const now = deps.now ?? (() => new Date());
  const raw: unknown[] = opts.entries ?? (JSON.parse(readFileSync(opts.file ?? "", "utf8")) as unknown[]);
  if (!Array.isArray(raw)) throw new Error("expected a JSON array of entries");
  const runId = await startRun(db, {
    job: "import-instagram-followers",
    adapter: INSTAGRAM_FOLLOWERS_EXTRACTOR,
    adapterVersion: INSTAGRAM_FOLLOWERS_VERSION,
    options: { dryRun: opts.dryRun ?? false, entries: raw.length },
  });
  const outcomes: FollowersOutcome[] = [];
  const touched = new Set<string>();
  let written = 0;
  let skipped = 0;

  for (const item of raw) {
    const parsed = FollowerEntry.safeParse(item);
    const label = parsed.success
      ? { slug: parsed.data.slug, handle: parsed.data.handle }
      : { slug: String((item as { slug?: unknown })?.slug ?? "?"), handle: "?" };
    const out: FollowersOutcome = { ...label, result: "" };
    outcomes.push(out);
    try {
      if (!parsed.success) throw new Skip(`invalid entry: ${parsed.error.issues[0]?.message ?? "bad shape"}`);
      const e = parsed.data;
      const problem = followerEntryProblem(e, now());
      if (problem) throw new Skip(problem);

      // Follow the merge chain: a merged club's count belongs to the club it became.
      let [c] = await db
        .select({ id: schema.club.id, state: schema.club.recordState, into: schema.club.mergedIntoClubId })
        .from(schema.club)
        .where(eq(schema.club.slug, e.slug));
      if (!c) {
        const [old] = await db
          .select({ clubId: schema.clubSlugHistory.clubId })
          .from(schema.clubSlugHistory)
          .where(eq(schema.clubSlugHistory.slug, e.slug));
        if (old)
          [c] = await db
            .select({ id: schema.club.id, state: schema.club.recordState, into: schema.club.mergedIntoClubId })
            .from(schema.club)
            .where(eq(schema.club.id, old.clubId));
      }
      for (let hops = 0; c && c.state === "merged" && c.into && hops < 10; hops++)
        [c] = await db
          .select({ id: schema.club.id, state: schema.club.recordState, into: schema.club.mergedIntoClubId })
          .from(schema.club)
          .where(eq(schema.club.id, c.into));
      if (!c) throw new Skip("no such club");
      if (c.state !== "active") throw new Skip(`club is ${c.state}`);

      // club_social only when this account is established as the club's (a verified link);
      // a search-matched account that merely looks right stays public_web (§7.1).
      const url = `https://www.instagram.com/${extractInstagramHandle(e.url)}/`;
      const links = await db
        .select({ status: schema.clubLink.status })
        .from(schema.clubLink)
        .where(and(eq(schema.clubLink.clubId, c.id), eq(schema.clubLink.normalizedUrl, normalizeUrl(url) ?? url)));
      const owned = links.some((l) => l.status === "verified");
      const sourceType: SourceType = owned ? "club_social" : "public_web";

      if (opts.dryRun) {
        out.result = `would write ${e.followers} (${sourceType})`;
        continue;
      }
      const observedAt = new Date(e.observedAt);
      const sourceId = await upsertSource(db, {
        url,
        sourceType,
        title: `Instagram: @${e.handle.replace(/^@/, "")}`,
        adapter: INSTAGRAM_FOLLOWERS_EXTRACTOR,
        ...(owned ? { ownerClubId: c.id } : {}),
      });
      // The snapshot is the saved text the count was read from, not the Instagram page.
      const body = Buffer.from(
        JSON.stringify({ evidenceUrl: e.evidenceUrl, via: e.source, followersText: e.followersText, text: e.evidence }),
      );
      const put = await store.put(body);
      const snap = await recordSnapshot(db, {
        sourceId,
        ingestionRunId: runId,
        fetchedAt: observedAt,
        finalUrl: e.evidenceUrl,
        httpStatus: null,
        contentType: "application/json",
        contentSha256: put.sha256,
        byteSize: put.byteSize,
        storageKey: put.key,
        extractedText: e.evidence,
        fetchMethod: "manual_upload",
      });
      const r = await upsertClaim(
        db,
        { clubId: c.id, fieldKey: "club.instagram_followers", value: e.followers, assertionKind: "stated" },
        {
          sourceId,
          sourceType,
          snapshotId: snap.snapshotId,
          ingestionRunId: runId,
          observedAt,
          quote: followerQuote(e),
          locator: { evidenceUrl: e.evidenceUrl, via: e.source, followersText: e.followersText },
          extractionMethod: "manual",
          extractorName: INSTAGRAM_FOLLOWERS_EXTRACTOR,
          extractorVersion: INSTAGRAM_FOLLOWERS_VERSION,
          isDirect: true,
        },
      );
      touched.add(c.id);
      written++;
      out.result = `${r.claimCreated ? "wrote" : r.evidenceCreated ? "added evidence for" : "unchanged:"} ${e.followers} (${sourceType})`;
    } catch (error) {
      if (error instanceof Skip) {
        skipped++;
        out.result = `skipped: ${error.message}`;
        logger.warn({ slug: out.slug, handle: out.handle, reason: error.message }, "instagram followers entry skipped");
      } else {
        skipped++;
        out.result = `error: ${error instanceof Error ? error.message : String(error)}`;
      }
    }
  }

  const stats = await resolveClubs(db, { clubIds: [...touched], now: now() });
  const errors = [
    ...outcomes.filter((o) => o.result.startsWith("error:")).map((o) => `${o.slug}: ${o.result}`),
    ...stats.errors.map((e) => `resolve ${e.clubId}: ${e.error}`),
  ];
  await finishRun(db, runId, {
    status: errors.length ? "partial" : "succeeded",
    counters: { entries: raw.length, written, skipped, clubs: touched.size },
    errorSummary: errors.slice(0, 50).join("\n") || null,
  });
  return { runId, outcomes, written, skipped };
}

class Skip extends Error {}
