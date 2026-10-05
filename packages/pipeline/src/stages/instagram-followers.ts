import { readFileSync } from "node:fs";
import { and, eq, ne } from "drizzle-orm";
import { z } from "zod";
import { extractInstagramHandle, normalizeAcronym, normalizeUrl, type SourceType } from "@hci/core";
import {
  finishRun,
  recordSnapshot,
  rejectClaims,
  resolveClubs,
  schema,
  startRun,
  upsertClaim,
  upsertSource,
  type Db,
} from "@hci/db";
import { logoImageProblem, type ImageMeasure } from "../extract/logo";
import type { Logger } from "../logger";
import { MEASURE_VERSION, measureImage } from "../logo-measure";
import { distinctiveTokens } from "../name-only/identity";
import type { SnapshotStore } from "../snapshots/store";
import { looksLikeDefaultAvatar } from "./instagram-picture";
import { normalizeForQuote } from "./lifecycle";

/**
 * import-instagram-followers (ADR 0046): follower counts for clubs' Instagram accounts, read
 * from the public profile's own description (`instagram-followers` collector, owner exception
 * in CLAUDE.md §21) or an earlier search result's snippet, saved in
 * `data/imports/instagram-followers.json`. The importer itself never fetches anything. A count
 * is written only when the verbatim text it came from contains it, so a number is never taken
 * on the file's word; the claim is `stated`, evidenced by an immutable snapshot of that text,
 * and the newest observation of an account wins in the resolver. The count orders the
 * directory ("Popularity") and is never displayed.
 *
 * v2 adds the account check (`accountProblem`): the text must name the account, and the
 * account must be a confirmed link of the club or be named like it. A count that fails it is
 * skipped and any earlier claim that only that account supported is rejected (revivable: a
 * later entry that passes brings it back).
 */
export const INSTAGRAM_FOLLOWERS_EXTRACTOR = "instagram-followers";
export const INSTAGRAM_FOLLOWERS_VERSION = "2";

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
  /**
   * The profile picture from the same page load (ADR 0050): its address without the signed
   * query, and our copy in the snapshot store.
   */
  picture: z
    .object({
      url: z.string().url(),
      storageKey: z.string().regex(/^sha256\/[0-9a-f]{2}\/[0-9a-f]{2}\/[0-9a-f]{64}\.gz$/),
      sha256: z.string().regex(/^[0-9a-f]{64}$/),
      contentType: z.string().regex(/^image\//),
    })
    .optional(),
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

/**
 * The account a profile description or search snippet is about: the handle in "(@handle)"
 * and the display name before it. Two forms are read:
 *   og:description  "12K Followers, 250 Following, 282 Posts - See Instagram photos and videos from The Veritones (@veritones)"
 *   search snippet  "4,356 followers, 232 following, 269 posts – The Veritones (@veritones) on Instagram: “…”"
 * The first "(@handle)" is the account's own (a bio quoted after it may mention others).
 * PURE.
 */
export function profileTextIdentity(text: string): { handle: string | null; displayName: string | null } {
  const m = /\(@([A-Za-z0-9._]{1,30})\)/.exec(text);
  if (!m) {
    // A profile without a display name: "… - See Instagram photos and videos from @handle".
    const bare = /from\s+@([A-Za-z0-9._]{1,30})\s*$/.exec(text.trim());
    return { handle: bare?.[1]?.toLowerCase() ?? null, displayName: null };
  }
  const before = text.slice(0, m.index);
  // The counts come first, then a dash; the display name runs from there to "(@handle)".
  const dash = /\s[-–—]\s/.exec(before);
  let name = dash ? before.slice(dash.index + dash[0].length) : before;
  name = name.replace(/^\s*see instagram photos and videos from\s+/i, "").trim();
  return { handle: m[1]!.toLowerCase(), displayName: name || null };
}

/** og:description of a public profile → the count it states and the account it names. PURE. */
export function parseProfileDescription(og: string): {
  followers: number;
  followersText: string;
  handle: string | null;
  displayName: string | null;
} | null {
  const m = /^\s*([\d][\d,]*(?:\.\d+)?\s*[KkMm]?)\s+followers?\b/i.exec(og);
  if (!m) return null;
  const followersText = m[0].trim();
  const range = followersTextRange(followersText);
  if (!range) return null;
  // "12K" → 12,000: the printed figure, which is inside the range the text allows.
  const n = Number(m[1]!.replace(/[,\sKkMm]/g, ""));
  const mult = /k/i.test(m[1]!) ? 1_000 : /m/i.test(m[1]!) ? 1_000_000 : 1;
  const followers = Math.min(range.max, Math.max(range.min, Math.round(n * mult)));
  return { followers, followersText, ...profileTextIdentity(og) };
}

/** Shortened boilerplate on Instagram display names ("Harvard Undergrad Assoc."). */
const SHORT_BOILERPLATE = new Set(["undergrad", "assoc", "soc", "org", "hu", "hc"]);
const DIVISION = new Set(["men", "mens", "women", "womens", "coed", "jv", "varsity"]);
const tokenSet = (s: string) => new Set(distinctiveTokens(s).filter((t) => !SHORT_BOILERPLATE.has(t)));
/** Same word, or one a shortening of the other ("microbio" / "microbiology"; 5+ letters). */
const sameWord = (a: string, b: string) =>
  a === b || (Math.min(a.length, b.length) >= 5 && (a.startsWith(b) || b.startsWith(a)));
const within = (words: Set<string>, pool: Set<string>) =>
  [...words].every((w) => [...pool].some((p) => sameWord(w, p)));

/** Words that open many Harvard names and are often left out of the short form. */
const NAME_PREFIX = /^(?:(?:the|harvard|radcliffe|harvard-radcliffe|undergraduate|college)\s+)+/i;
/**
 * Short forms a name plainly abbreviates to: its initials, and its initials without the
 * leading "Harvard (Undergraduate)" ("Harvard Undergraduate Nepali Student Association" →
 * HUNSA, NSA). "of/and/the/for/at" are skipped, as in `initialsOf`.
 */
function nameInitials(name: string): string[] {
  const initials = (n: string) =>
    n
      .replace(/\([^)]*\)/g, " ")
      .split(/[^A-Za-z0-9]+/)
      .filter((w) => w && !["of", "and", "the", "for", "at", "s"].includes(w.toLowerCase()))
      .map((w) => w[0]!.toUpperCase())
      .join("");
  // …and without a closing generic word ("Harvard ROTC Association" → ROTC).
  const bare = name.replace(NAME_PREFIX, "").replace(/\s+(association|society|club|organization|group)\s*$/i, "");
  return [...new Set([initials(name), initials(name.replace(NAME_PREFIX, "")), initials(bare)])].filter(
    (i) => i.length >= 3,
  );
}

/**
 * Does an account's display name plainly name this club? Every distinctive word of one of
 * the club's names appears in it ("Active Minds @ Harvard/CAMHS" names "Active Minds Student
 * Chapter at CAMHS"), or every distinctive word of the display name (two or more) appears in
 * a club name that has no men's/women's word the display name lacks, or a word of it is the club's acronym or the initials of its name ("Harvard
 * CSSA" → Harvard Chinese Students and Scholars Association). Boilerplate ("Harvard", "Club",
 * "Society"…) never counts. The bio is not read: it can name other groups. PURE.
 */
const wholeName = (n: string) =>
  n
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/^the /, "")
    .trim();

export function displayNameMatchesClub(
  displayName: string,
  club: { names: readonly string[]; acronyms: readonly string[] },
): boolean {
  // The same name, word for word: the only match for a name made of boilerplate alone
  // ("Harvard Undergraduate Association").
  if (club.names.some((n) => wholeName(n) === wholeName(displayName))) return true;
  const shown = tokenSet(displayName);
  if (shown.size > 0)
    for (const name of club.names) {
      const own = tokenSet(name);
      if (own.size === 0) continue;
      if (within(own, shown)) return true;
      // A shorter display name may leave words out, but not the division: "Fixture Club
      // Soccer" doesn't name the women's team any more than the men's.
      const division = [...own].some((t) => DIVISION.has(t) && !shown.has(t));
      if (shown.size >= 2 && !division && within(shown, own)) return true;
    }
  const words = new Set(
    displayName
      .split(/[^A-Za-z0-9]+/)
      .filter(Boolean)
      .map((w) => normalizeAcronym(w)),
  );
  const shortForms = [
    ...club.acronyms.map((a) => normalizeAcronym(a)).filter((a) => a.length >= 2),
    ...club.names.flatMap(nameInitials),
  ];
  return shortForms.some((a) => words.has(a));
}

/**
 * Why a count can't be credited to this club's account, or null (the account check, v2):
 *  - the text must name the entry's handle ("(@handle)");
 *  - an account linked to another club too is settled only by a verified link to this one;
 *  - otherwise the account must be a verified or probable link of the club, or its display
 *    name must plainly name the club (`displayNameMatchesClub`).
 * A rejected link means the account was judged not to be the club's. PURE.
 */
export function accountProblem(input: {
  entry: Pick<FollowerEntry, "handle" | "evidence">;
  club: { names: readonly string[]; acronyms: readonly string[] };
  linkStatus: string | null;
  sharedWith: readonly string[];
}): { why: string; scope: "text" | "account" } | null {
  const handle = input.entry.handle.replace(/^@/, "").toLowerCase();
  const named = profileTextIdentity(input.entry.evidence);
  // About this saved text only: the account may still be the club's.
  if (named.handle !== handle) return { why: `the text doesn't name @${handle}`, scope: "text" };
  const account = (why: string) => ({ why, scope: "account" as const });
  if (input.linkStatus === "rejected") return account(`@${handle} is a rejected link of this club`);
  if (input.sharedWith.length > 0 && input.linkStatus !== "verified")
    return account(
      `@${handle} is also linked to ${input.sharedWith.join(", ")}; only a verified link settles whose it is`,
    );
  if (input.linkStatus === "verified" || input.linkStatus === "probable") return null;
  if (named.displayName && displayNameMatchesClub(named.displayName, input.club)) return null;
  return account(
    `@${handle} isn't a confirmed link of this club and its name${named.displayName ? ` "${named.displayName}"` : ""} doesn't name the club`,
  );
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
  /** Earlier claims rejected (or, on a dry run, that would be) because the account check failed. */
  rejected?: number;
}

/** Reason prefix on claims the account check rejects; "(not reproduced by …@v)" makes them revivable. */
const accountRejectReason = (why: string) =>
  `instagram account check: ${why} (not reproduced by ${INSTAGRAM_FOLLOWERS_EXTRACTOR}@${INSTAGRAM_FOLLOWERS_VERSION})`;

export async function runInstagramFollowers(
  deps: { db: Db; store: SnapshotStore; logger: Logger; now?: () => Date },
  opts: { file?: string; entries?: unknown[]; dryRun?: boolean },
): Promise<{ runId: string; outcomes: FollowersOutcome[]; written: number; skipped: number; rejected: number }> {
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
  let rejected = 0;
  // Slugs each handle is filed under: one account entered for two clubs is ambiguous.
  const slugsByHandle = new Map<string, Set<string>>();
  for (const item of raw) {
    const p = FollowerEntry.safeParse(item);
    if (!p.success) continue;
    const h = p.data.handle.replace(/^@/, "").toLowerCase();
    slugsByHandle.set(h, (slugsByHandle.get(h) ?? new Set()).add(p.data.slug));
  }
  // Per club and account: the counts that passed the account check and those that failed.
  const verdicts = new Map<
    string,
    {
      clubId: string;
      slug: string;
      handle: string;
      passed: number[];
      failed: { value: number; why: string; scope: "text" | "account"; out: FollowersOutcome }[];
    }
  >();
  const clubCols = {
    id: schema.club.id,
    slug: schema.club.slug,
    name: schema.club.canonicalName,
    acronym: schema.club.acronym,
    state: schema.club.recordState,
    into: schema.club.mergedIntoClubId,
  };

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
      let [c] = await db.select(clubCols).from(schema.club).where(eq(schema.club.slug, e.slug));
      if (!c) {
        const [old] = await db
          .select({ clubId: schema.clubSlugHistory.clubId })
          .from(schema.clubSlugHistory)
          .where(eq(schema.clubSlugHistory.slug, e.slug));
        if (old) [c] = await db.select(clubCols).from(schema.club).where(eq(schema.club.id, old.clubId));
      }
      for (let hops = 0; c && c.state === "merged" && c.into && hops < 10; hops++)
        [c] = await db.select(clubCols).from(schema.club).where(eq(schema.club.id, c.into));
      if (!c) throw new Skip("no such club");
      if (c.state !== "active") throw new Skip(`club is ${c.state}`);
      const club = c;

      // club_social only when this account is established as the club's (a verified link);
      // a search-matched account that merely looks right stays public_web (§7.1).
      const handle = extractInstagramHandle(e.url) ?? "";
      const url = `https://www.instagram.com/${handle}/`;
      const normalized = normalizeUrl(url) ?? url;
      const links = await db
        .select({ status: schema.clubLink.status })
        .from(schema.clubLink)
        .where(and(eq(schema.clubLink.clubId, club.id), eq(schema.clubLink.normalizedUrl, normalized)));
      const owned = links.some((l) => l.status === "verified");
      const sourceType: SourceType = owned ? "club_social" : "public_web";

      // The account check: is this account the club's?
      const others = await db
        .select({ slug: schema.club.slug })
        .from(schema.clubLink)
        .innerJoin(schema.club, eq(schema.club.id, schema.clubLink.clubId))
        .where(
          and(
            eq(schema.clubLink.normalizedUrl, normalized),
            ne(schema.clubLink.clubId, club.id),
            ne(schema.clubLink.status, "rejected"),
            eq(schema.club.recordState, "active"),
          ),
        );
      const sharedWith = [
        ...new Set([
          ...others.map((o) => o.slug),
          ...[...(slugsByHandle.get(handle) ?? [])].filter((sl) => sl !== e.slug && sl !== club.slug),
        ]),
      ].sort();
      const aliases = await db
        .select({ alias: schema.clubAlias.alias, kind: schema.clubAlias.kind })
        .from(schema.clubAlias)
        .where(eq(schema.clubAlias.clubId, club.id));
      const isAcronym = (k: string) => k === "acronym" || k === "abbreviation";
      const acct = accountProblem({
        entry: e,
        club: {
          names: [club.name, ...aliases.filter((a) => !isAcronym(a.kind)).map((a) => a.alias)],
          acronyms: [
            ...(club.acronym ? [club.acronym] : []),
            ...aliases.filter((a) => isAcronym(a.kind)).map((a) => a.alias),
          ],
        },
        linkStatus: links[0]?.status ?? null,
        sharedWith,
      });
      const key = `${club.id} ${handle}`;
      const verdict = verdicts.get(key) ?? { clubId: club.id, slug: club.slug, handle, passed: [], failed: [] };
      verdicts.set(key, verdict);
      if (acct) {
        verdict.failed.push({ value: e.followers, ...acct, out });
        throw new Skip(acct.why);
      }
      verdict.passed.push(e.followers);

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
        ...(owned ? { ownerClubId: club.id } : {}),
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
        { clubId: club.id, fieldKey: "club.instagram_followers", value: e.followers, assertionKind: "stated" },
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
      touched.add(club.id);
      written++;
      out.result = `${r.claimCreated ? "wrote" : r.evidenceCreated ? "added evidence for" : "unchanged:"} ${e.followers} (${sourceType})`;
      if (e.picture) {
        const pic = await importPicture(db, store, {
          clubId: club.id,
          sourceId,
          sourceType,
          runId,
          observedAt,
          handle,
          picture: e.picture,
          now: now(),
        });
        out.result += `; picture ${pic}`;
      }
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

  // Earlier claims the account check no longer supports. When the account itself failed for
  // this club (and no count of it passed), every claim only that account supported is
  // rejected; when only a saved text failed (it doesn't name the account), only that value.
  for (const v of verdicts.values()) {
    const first = v.failed[0];
    if (!first) continue;
    const wholeAccount = v.passed.length === 0 && v.failed.some((f) => f.scope === "account");
    const failing = new Set(v.failed.map((f) => f.value));
    const ids = (await claimsOnlyFrom(db, v.clubId, v.handle))
      .filter((c) => wholeAccount || (failing.has(c.value) && !v.passed.includes(c.value)))
      .map((c) => c.id);
    // An account that isn't the club's can't give it a logo either.
    if (wholeAccount) ids.push(...(await pictureClaimsFrom(db, v.clubId, v.handle)));
    if (!ids.length) continue;
    if (!opts.dryRun)
      await rejectClaims(db, {
        claimIds: ids,
        actor: `pipeline:${INSTAGRAM_FOLLOWERS_EXTRACTOR}`,
        reason: accountRejectReason(first.why),
        payload: { slug: v.slug, handle: v.handle },
      });
    if (!opts.dryRun) touched.add(v.clubId);
    first.out.rejected = ids.length;
    first.out.result += `; ${opts.dryRun ? "would reject" : "rejected"} ${ids.length} earlier claim(s)`;
    rejected += ids.length;
  }

  const stats = await resolveClubs(db, { clubIds: [...touched], now: now() });
  const errors = [
    ...outcomes.filter((o) => o.result.startsWith("error:")).map((o) => `${o.slug}: ${o.result}`),
    ...stats.errors.map((e) => `resolve ${e.clubId}: ${e.error}`),
  ];
  await finishRun(db, runId, {
    status: errors.length ? "partial" : "succeeded",
    counters: { entries: raw.length, written, skipped, rejected, clubs: touched.size },
    errorSummary: errors.slice(0, 50).join("\n") || null,
  });
  return { runId, outcomes, written, skipped, rejected };
}

/** Active follower-count claims about a club whose only evidence is @handle's profile. */
async function claimsOnlyFrom(db: Db, clubId: string, handle: string): Promise<{ id: string; value: number }[]> {
  const rows = await db
    .select({ claimId: schema.claim.id, value: schema.claim.value, url: schema.source.url })
    .from(schema.claim)
    .innerJoin(schema.claimEvidence, eq(schema.claimEvidence.claimId, schema.claim.id))
    .innerJoin(schema.source, eq(schema.source.id, schema.claimEvidence.sourceId))
    .where(
      and(
        eq(schema.claim.clubId, clubId),
        eq(schema.claim.fieldKey, "club.instagram_followers"),
        eq(schema.claim.status, "active"),
      ),
    );
  const byClaim = new Map<string, { value: number; only: boolean }>();
  for (const r of rows) {
    const prev = byClaim.get(r.claimId);
    byClaim.set(r.claimId, {
      value: Number(r.value),
      only: (prev?.only ?? true) && extractInstagramHandle(r.url) === handle,
    });
  }
  return [...byClaim].filter(([, c]) => c.only).map(([id, c]) => ({ id, value: c.value }));
}

class Skip extends Error {}

export const INSTAGRAM_PICTURE_EXTRACTOR = { name: "instagram-picture", version: "1" } as const;

/**
 * An Instagram profile picture as the club's logo (ADR 0050): measured like site logos
 * (`logoImageProblem`), kept as an image snapshot of the profile source, and claimed with its
 * lasting address (`pictureKey`). A club's site logo still wins (tier 2 over 3); this fills the
 * gap for clubs whose site offers none. The club's earlier pictures are retired.
 */
async function importPicture(
  db: Db,
  store: SnapshotStore,
  input: {
    clubId: string;
    sourceId: string;
    sourceType: SourceType;
    runId: string;
    observedAt: Date;
    handle: string;
    picture: NonNullable<FollowerEntry["picture"]>;
    now: Date;
  },
): Promise<string> {
  const { picture } = input;
  const bytes = await store.get(picture.storageKey);
  let measure: ImageMeasure;
  try {
    measure = await measureImage(bytes);
  } catch (error) {
    return `skipped (${error instanceof Error ? error.message : String(error)})`;
  }
  // The account has no picture: whatever picture it gave before no longer stands.
  if (await looksLikeDefaultAvatar(bytes)) {
    const old = await pictureClaimsFrom(db, input.clubId, null);
    if (old.length)
      await rejectClaims(db, {
        claimIds: old,
        actor: `pipeline:${INSTAGRAM_PICTURE_EXTRACTOR.name}`,
        reason: "the account shows Instagram's default picture",
      });
    return "skipped (Instagram's default picture)";
  }
  const problem = logoImageProblem(measure);
  const probe = {
    url: picture.url,
    fetchedAt: input.observedAt,
    status: "ok",
    httpStatus: 200,
    contentType: picture.contentType,
    bytes: bytes.byteLength,
    width: measure.width,
    height: measure.height,
    format: measure.format,
    stats: measure.stats,
    error: null,
    measureVersion: MEASURE_VERSION,
    storageKey: picture.storageKey,
  };
  await db.insert(schema.imageProbe).values(probe).onConflictDoUpdate({ target: schema.imageProbe.url, set: probe });
  if (problem) return `skipped (${problem})`;
  const snap = await recordSnapshot(db, {
    sourceId: input.sourceId,
    ingestionRunId: input.runId,
    fetchedAt: input.observedAt,
    finalUrl: picture.url,
    httpStatus: 200,
    contentType: picture.contentType,
    contentSha256: picture.sha256,
    byteSize: bytes.byteLength,
    storageKey: picture.storageKey,
    extractedText: null,
    fetchMethod: "browser",
  });
  const r = await upsertClaim(
    db,
    { clubId: input.clubId, fieldKey: "club.logo", value: picture.url, assertionKind: "stated" },
    {
      sourceId: input.sourceId,
      sourceType: input.sourceType,
      snapshotId: snap.snapshotId,
      ingestionRunId: input.runId,
      observedAt: input.observedAt,
      quote: null,
      locator: { profile: `@${input.handle}`, width: measure.width, height: measure.height, format: measure.format },
      extractionMethod: "html_parse",
      extractorName: INSTAGRAM_PICTURE_EXTRACTOR.name,
      extractorVersion: INSTAGRAM_PICTURE_EXTRACTOR.version,
      isDirect: true,
    },
  );
  const older = (await pictureClaimsFrom(db, input.clubId, null)).filter((id) => id !== r.claimId);
  if (older.length)
    await rejectClaims(db, {
      claimIds: older,
      actor: `pipeline:${INSTAGRAM_PICTURE_EXTRACTOR.name}`,
      reason: "replaced by the account's current profile picture",
    });
  return r.claimCreated ? "written" : "unchanged";
}

/** Active logo claims only Instagram pictures support (from @handle's profile, or any when null). */
async function pictureClaimsFrom(db: Db, clubId: string, handle: string | null): Promise<string[]> {
  const rows = await db
    .select({ claimId: schema.claim.id, extractor: schema.claimEvidence.extractorName, url: schema.source.url })
    .from(schema.claim)
    .innerJoin(schema.claimEvidence, eq(schema.claimEvidence.claimId, schema.claim.id))
    .innerJoin(schema.source, eq(schema.source.id, schema.claimEvidence.sourceId))
    .where(
      and(eq(schema.claim.clubId, clubId), eq(schema.claim.fieldKey, "club.logo"), eq(schema.claim.status, "active")),
    );
  const only = new Map<string, boolean>();
  for (const r of rows)
    only.set(
      r.claimId,
      (only.get(r.claimId) ?? true) &&
        r.extractor === INSTAGRAM_PICTURE_EXTRACTOR.name &&
        (handle === null || extractInstagramHandle(r.url) === handle),
    );
  return [...only].filter(([, ok]) => ok).map(([id]) => id);
}
