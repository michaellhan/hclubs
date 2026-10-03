import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import * as cheerio from "cheerio";
import { and, eq, ne } from "drizzle-orm";
import { extractInstagramHandle } from "@hci/core";
import { schema, type Db } from "@hci/db";
import type { PageRenderer } from "../fetch/browser-fetcher";
import type { Logger } from "../logger";
import { FollowerEntry, followerEntryProblem, parseProfileDescription } from "./instagram-followers";

/**
 * instagram-followers (ADR 0046 amendment): read each club's public Instagram profile page in
 * installed Chrome, one page at a time, and save the follower count its og:description states
 * ("12K Followers, 250 Following, 282 Posts - See Instagram photos and videos from …
 * (@handle)") into the importer's file. The owner's exception to §21: public follower counts
 * only, read slowly (≥ 10 s apart, jittered), never logged in, and the whole run stops at the
 * first sign of a block (a login or challenge redirect, a rate-limit flag, or pages that stop
 * carrying the description). Nothing else on the page is read or kept.
 */

/** Minimum gap between two profile loads; a random 0–5 s is added on top. */
export const MIN_GAP_MS = 10_000;
const JITTER_MS = 5_000;
/** This many profiles in a row without a description is treated as a block. */
const MAX_MISSING_IN_A_ROW = 3;

/** Why a loaded page means Instagram is refusing us, or null. PURE. */
export function blockSignal(finalUrl: string): string | null {
  let u: URL;
  try {
    u = new URL(finalUrl);
  } catch {
    return `unreadable final URL ${finalUrl}`;
  }
  const path = u.pathname.toLowerCase();
  if (u.searchParams.has("is_from_rle") || /is_from_rle/i.test(u.search)) return "rate limited (is_from_rle)";
  if (path.startsWith("/accounts/login")) return "redirected to the login page";
  if (path.startsWith("/challenge")) return "redirected to a challenge";
  if (path.startsWith("/accounts/suspended") || path.startsWith("/suspended")) return "redirected to a suspension page";
  if (!/(^|\.)instagram\.com$/i.test(u.hostname)) return `left Instagram (${u.hostname})`;
  return null;
}

/** The page's og:description, or null. PURE. */
export function ogDescription(html: string): string | null {
  const $ = cheerio.load(html);
  const v = $('meta[property="og:description"]').attr("content") ?? $('meta[name="description"]').attr("content");
  const t = v?.replace(/\s+/g, " ").trim();
  return t ? t : null;
}

export interface CollectTarget {
  slug: string;
  handle: string;
  url: string;
  linkStatus: string;
  lastObservedAt: string | null;
}

const STATUS_RANK: Record<string, number> = { verified: 0, probable: 1, unverified: 2 };

/**
 * One Instagram account per club: the best non-rejected link the profile shows (verified,
 * then probable, then unverified). Clubs never read, then those read longest ago, come first,
 * so a capped monthly run works through the list. PURE.
 */
export function pickTargets(
  links: readonly { slug: string; url: string; status: string }[],
  existing: readonly { slug: string; observedAt: string; source: string }[],
  opts: { clubs?: readonly string[]; limit?: number } = {},
): CollectTarget[] {
  const best = new Map<string, { slug: string; handle: string; status: string }>();
  for (const l of links) {
    const handle = extractInstagramHandle(l.url);
    if (!handle || l.status === "rejected") continue;
    if (opts.clubs && !opts.clubs.includes(l.slug)) continue;
    const cur = best.get(l.slug);
    const rank = STATUS_RANK[l.status] ?? 3;
    if (
      !cur ||
      rank < (STATUS_RANK[cur.status] ?? 3) ||
      (rank === (STATUS_RANK[cur.status] ?? 3) && handle < cur.handle)
    )
      best.set(l.slug, { slug: l.slug, handle, status: l.status });
  }
  // Only counts read from the profile page itself count as "read"; a search snippet is older news.
  const read = new Map<string, string>();
  for (const e of existing) if (e.source === "instagram") read.set(e.slug, e.observedAt);
  return [...best.values()]
    .map((b) => ({
      slug: b.slug,
      handle: b.handle,
      url: `https://www.instagram.com/${b.handle}/`,
      linkStatus: b.status,
      lastObservedAt: read.get(b.slug) ?? null,
    }))
    .sort((a, b) => (a.lastObservedAt ?? "").localeCompare(b.lastObservedAt ?? "") || a.slug.localeCompare(b.slug))
    .slice(0, opts.limit ?? Infinity);
}

/** `entries` with the one for `entry.slug` replaced (or added), sorted by slug. PURE. */
export function replaceBySlug<T extends { slug: string }>(entries: readonly T[], entry: T): T[] {
  return [...entries.filter((e) => e.slug !== entry.slug), entry].sort((a, b) => a.slug.localeCompare(b.slug));
}

function readEntries(file: string): FollowerEntry[] {
  if (!existsSync(file)) return [];
  const raw = JSON.parse(readFileSync(file, "utf8")) as unknown;
  if (!Array.isArray(raw)) throw new Error(`${file} is not a JSON array`);
  return raw as FollowerEntry[];
}

function saveEntries(file: string, entries: readonly FollowerEntry[]): void {
  const tmp = `${file}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(entries, null, 2)}\n`);
  renameSync(tmp, file);
}

export interface CollectOutcome {
  slug: string;
  handle: string;
  result: string;
}

export async function collectInstagramFollowers(
  deps: {
    db: Db;
    logger: Logger;
    /** Opened only when there is something to read (never on a dry run). */
    openReader: () => Promise<PageRenderer>;
    now?: () => Date;
    sleep?: (ms: number) => Promise<void>;
    random?: () => number;
  },
  opts: { file: string; limit?: number; clubs?: readonly string[]; dryRun?: boolean },
): Promise<{ targets: CollectTarget[]; outcomes: CollectOutcome[]; saved: number; stopped: string | null }> {
  const { db, logger } = deps;
  const now = deps.now ?? (() => new Date());
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const random = deps.random ?? Math.random;

  const links = await db
    .select({ slug: schema.club.slug, url: schema.clubLink.url, status: schema.clubLink.status })
    .from(schema.clubLink)
    .innerJoin(schema.club, eq(schema.club.id, schema.clubLink.clubId))
    .where(
      and(
        eq(schema.clubLink.kind, "instagram"),
        ne(schema.clubLink.status, "rejected"),
        eq(schema.club.recordState, "active"),
      ),
    );
  const targets = pickTargets(links, readEntries(opts.file), {
    ...(opts.clubs ? { clubs: opts.clubs } : {}),
    ...(opts.limit !== undefined ? { limit: opts.limit } : {}),
  });
  const outcomes: CollectOutcome[] = [];
  if (opts.dryRun || targets.length === 0) {
    for (const t of targets)
      outcomes.push({ slug: t.slug, handle: t.handle, result: `would read ${t.url} (${t.linkStatus})` });
    return { targets, outcomes, saved: 0, stopped: null };
  }

  const reader = await deps.openReader();
  let saved = 0;
  let stopped: string | null = null;
  let missingInARow = 0;
  try {
    for (const [i, t] of targets.entries()) {
      if (i > 0) await sleep(MIN_GAP_MS + Math.floor(random() * JITTER_MS));
      const out: CollectOutcome = { slug: t.slug, handle: t.handle, result: "" };
      outcomes.push(out);
      let page: { html: string; finalUrl: string; responseHtml?: string | null };
      try {
        page = await reader.render(t.url);
      } catch (error) {
        // A load failure isn't a block by itself, but don't push on through a string of them.
        out.result = `error: ${error instanceof Error ? error.message : String(error)}`;
        if (++missingInARow >= MAX_MISSING_IN_A_ROW) {
          stopped = `${MAX_MISSING_IN_A_ROW} profiles in a row failed to load`;
          break;
        }
        continue;
      }
      const block = blockSignal(page.finalUrl);
      if (block) {
        out.result = `stopped: ${block}`;
        stopped = block;
        break;
      }
      // The served HTML first: the app's scripts may rewrite the head once they run.
      const og = (page.responseHtml ? ogDescription(page.responseHtml) : null) ?? ogDescription(page.html);
      const parsed = og ? parseProfileDescription(og) : null;
      if (!og || !parsed) {
        out.result = og
          ? `skipped: no follower count in "${og.slice(0, 80)}"`
          : `skipped: no profile description (${page.finalUrl})`;
        if (++missingInARow >= MAX_MISSING_IN_A_ROW) {
          stopped = `${MAX_MISSING_IN_A_ROW} profiles in a row without a follower count (treated as a block)`;
          break;
        }
        continue;
      }
      missingInARow = 0;
      if (parsed.handle !== t.handle) {
        out.result = `skipped: the page is @${parsed.handle ?? "?"}, not @${t.handle}`;
        continue;
      }
      const entry: FollowerEntry = {
        slug: t.slug,
        handle: t.handle,
        url: t.url,
        followers: parsed.followers,
        followersText: parsed.followersText,
        evidence: og,
        source: "instagram",
        evidenceUrl: t.url,
        observedAt: now().toISOString(),
      };
      const valid = FollowerEntry.safeParse(entry);
      const problem = valid.success ? followerEntryProblem(valid.data, now()) : "invalid entry";
      if (problem) {
        out.result = `skipped: ${problem}`;
        continue;
      }
      // Saved after every profile, so a stopped run keeps what it read.
      saveEntries(opts.file, replaceBySlug(readEntries(opts.file), entry));
      saved++;
      out.result = `saved ${parsed.followers} (${parsed.followersText})`;
    }
  } finally {
    await reader.close();
  }
  if (stopped) logger.warn({ reason: stopped }, "instagram-followers stopped: Instagram is refusing requests");
  return { targets, outcomes, saved, stopped };
}
