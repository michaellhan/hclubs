import { and, eq, inArray, ne } from "drizzle-orm";
import { matchOrganization, normalizeUrl, siteKey, type FieldKey } from "@hci/core";
import {
  createClub,
  finishRun,
  resolveClubs,
  schema,
  startRun,
  upsertClaim,
  upsertSource,
  type Db,
  type Queryable,
} from "@hci/db";
import { crawlSite, emptyCrawlStats } from "../crawl/site";
import { CURATED_CLUBS, CURATED_LIST_VERSION, CuratedEntry } from "../curated/list";
import { loadKnownOrgs } from "../entity/resolve";
import { pageNamesClub } from "../extract/deterministic";
import type { Logger } from "../logger";
import type { PageDocument } from "../parse/document";
import { siteIdentity, type ClubNames } from "../sites/candidates";
import type { SnapshotStore } from "../snapshots/store";
import type { SourceFetcher } from "../types";

/**
 * curate (ADR 0024): apply the owner-curated club list. For each entry, find its club
 * (explicit slug, else a definite match), or create one when nothing similar exists.
 * Websites are fetched (home page only, polite fetcher) and recorded as editorially
 * confirmed only when the page names the club; social links are recorded as supplied
 * and never fetched (§21). Enrichment then crawls the confirmed sites as official.
 */

export const CURATE_EXTRACTOR = "curated-list";
const ACTOR = "curated-list";
const HARVARD = /\b(harvard|radcliffe)\b/i;

export interface CurateOutcome {
  entry: string;
  club: string | null;
  action: string;
  website: string;
  instagram: string;
}

/**
 * Does the fetched page belong to the listed club? PURE. The URL came from the editor,
 * so this is a sanity check against typos, dead and parked domains rather than the
 * finder's full identity test: the finder's rule, a heading that contains the club's full
 * name, or a heading with its acronym on a page that mentions Harvard.
 */
export function curatedPageMatch(doc: PageDocument, names: ClubNames): string | null {
  const strict = siteIdentity(doc, names);
  if (strict) return strict;
  // A heading with the club's full name identifies the page; the Harvard link is the editor's call.
  const byName = pageNamesClub(doc, [names.name, ...names.aliases], []);
  if (byName) return byName;
  if (!names.acronym) return null;
  if (!HARVARD.test(`${doc.title ?? ""} ${doc.h1 ?? ""} ${doc.ogTitle ?? ""} ${doc.text.slice(0, 5000)}`)) return null;
  return pageNamesClub(doc, [], [names.acronym]);
}

async function logDecision(db: Queryable, clubId: string, action: string, reason: string, payload: object) {
  await db.insert(schema.editorialDecision).values({
    actor: ACTOR,
    action,
    targetType: "club",
    targetId: clubId,
    reason,
    payload: { ...payload, listVersion: CURATED_LIST_VERSION },
  });
}

export async function runCurate(
  deps: { db: Db; fetcher: SourceFetcher; store: SnapshotStore; logger: Logger; now?: () => Date },
  opts: { dryRun?: boolean; entries?: CuratedEntry[] } = {},
): Promise<{ runId: string; outcomes: CurateOutcome[]; touchedSlugs: string[]; errors: string[] }> {
  const { db, logger, store } = deps;
  const now = deps.now ?? (() => new Date());
  const entries = (opts.entries ?? CURATED_CLUBS).map((e) => CuratedEntry.parse(e));
  const runId = await startRun(db, {
    job: "curate",
    adapter: CURATE_EXTRACTOR,
    adapterVersion: CURATED_LIST_VERSION,
    options: { dryRun: opts.dryRun ?? false, entries: entries.length },
  });
  const crawl = emptyCrawlStats();
  const known = await loadKnownOrgs(db);
  const outcomes: CurateOutcome[] = [];
  const errors: string[] = [];
  const touched = new Map<string, string>();

  // A website already attached to a different (visible) club is never re-attached from the list.
  const existing = await db
    .select({ clubId: schema.clubLink.clubId, url: schema.clubLink.url })
    .from(schema.clubLink)
    .innerJoin(schema.club, eq(schema.club.id, schema.clubLink.clubId))
    .where(
      and(
        eq(schema.clubLink.kind, "website"),
        ne(schema.clubLink.status, "rejected"),
        eq(schema.club.recordState, "active"),
      ),
    );
  const siteOwner = new Map<string, string>();
  for (const e of existing) {
    const k = siteKey(e.url);
    if (k && !siteOwner.has(k)) siteOwner.set(k, e.clubId);
  }

  for (const entry of entries) {
    const out: CurateOutcome = { entry: entry.name, club: null, action: "", website: "-", instagram: "-" };
    outcomes.push(out);
    const names: ClubNames = { name: entry.name, acronym: entry.acronym ?? null, aliases: entry.aliases ?? [] };
    try {
      // 1. Which club?
      let target: { id: string; slug: string } | null = null;
      if (entry.slug) {
        const [row] = await db
          .select({ id: schema.club.id, slug: schema.club.slug, state: schema.club.recordState })
          .from(schema.club)
          .where(eq(schema.club.slug, entry.slug));
        if (!row || row.state !== "active") {
          out.action = `slug ${entry.slug} not found or not active`;
          continue;
        }
        target = row;
        out.action = "existing";
      } else {
        const match = matchOrganization(
          {
            names: [entry.name, ...(entry.aliases ?? [])],
            acronyms: entry.acronym ? [entry.acronym] : [],
            urls: [entry.website, entry.instagram].flatMap((u) => (u ? [normalizeUrl(u) ?? u] : [])),
            externalIds: [],
            descriptions: [],
          },
          known,
        );
        if (match.decision === "definite" && match.clubId) {
          const [row] = await db
            .select({ id: schema.club.id, slug: schema.club.slug })
            .from(schema.club)
            .where(eq(schema.club.id, match.clubId));
          target = row ?? null;
          out.action = "matched";
        } else if (match.decision !== "new" && !entry.isNew) {
          // Similar to something already indexed: an editor picks the slug instead of guessing.
          const similar = match.candidates.slice(0, 2).map((c) => c.clubId);
          const slugs = similar.length
            ? await db.select({ slug: schema.club.slug }).from(schema.club).where(inArray(schema.club.id, similar))
            : [];
          out.action = `needs review: similar to ${slugs.map((s) => s.slug).join(", ")}`;
          continue;
        }
      }

      // 2. Check the website before creating anything.
      let site: { url: string; sourceId: string; snapshotId: string; fetchedAt: Date; quote: string } | null = null;
      if (entry.website) {
        const root = normalizeUrl(entry.website) ?? entry.website;
        const key = siteKey(root);
        const owner = key ? siteOwner.get(key) : undefined;
        if (owner && owner !== target?.id) {
          out.website = "attached to another club";
        } else {
          const [home] = await crawlSite({
            rootUrl: root,
            clubId: target?.id ?? "00000000-0000-0000-0000-000000000000",
            officialSite: false,
            db,
            fetcher: deps.fetcher,
            store,
            runId,
            logger: logger.child({ entry: entry.name }),
            now,
            maxPages: 1,
            maxDepth: 0,
            freshnessMs: 7 * 86_400_000,
            force: false,
            stats: crawl,
          });
          if (!home) out.website = "fetch failed";
          else {
            const quote = curatedPageMatch(home.doc, names);
            if (!quote) out.website = `page doesn't name the club (title: ${(home.doc.title ?? "").slice(0, 60)})`;
            else {
              site = {
                url: root,
                sourceId: home.sourceId,
                snapshotId: home.snapshotId,
                fetchedAt: home.fetchedAt,
                quote,
              };
              out.website = `ok: "${quote.slice(0, 60)}"`;
            }
          }
        }
      }

      if (!target) {
        // Nothing similar is indexed. Create the club only with something to show for it.
        if (!site && !entry.instagram) {
          out.action = "skipped: no confirmed link";
          continue;
        }
        if (opts.dryRun) {
          out.action = "would create";
          continue;
        }
        target = await createClub(db, { name: entry.name, dataOrigin: "editorial" });
        out.action = "created";
        await logDecision(db, target.id, "add_club", "Listed in the owner-curated club list", {
          name: entry.name,
          website: site?.url ?? null,
          instagram: entry.instagram ?? null,
        });
        known.push({
          clubId: target.id,
          names: [entry.name, ...(entry.aliases ?? [])],
          acronyms: entry.acronym ? [entry.acronym] : [],
          urls: site ? [site.url] : [],
          externalIds: [],
          descriptions: [],
        });
      }
      out.club = target.slug;
      if (opts.dryRun) continue;
      const clubId = target.id;
      const created = out.action === "created";

      // 3. Claims. Name and acronym only for clubs this list created: never override resolved names.
      if (created) {
        const origin = site ?? (await editorialSource(db, entry.instagram ?? ""));
        const identity: [FieldKey, string][] = [["club.name", entry.name]];
        if (entry.acronym) identity.push(["club.acronym", entry.acronym]);
        for (const [fieldKey, value] of identity) {
          await upsertClaim(
            db,
            { clubId, fieldKey, value, assertionKind: "editorial" },
            evidence(origin, runId, now(), site ? site.quote : null, { field: fieldKey }),
          );
        }
      }
      if (site) {
        await upsertClaim(
          db,
          { clubId, fieldKey: "club.link", value: { kind: "website", url: site.url }, assertionKind: "editorial" },
          evidence(site, runId, now(), site.quote, { url: site.url, signal: "editor-listed; page names the club" }),
        );
        await logDecision(db, clubId, "confirm_link", "Website listed by the editor; its home page names the club", {
          url: site.url,
          quote: site.quote,
        });
        const key = siteKey(site.url);
        if (key) siteOwner.set(key, clubId);
      }
      if (entry.instagram) {
        const src = await editorialSource(db, entry.instagram);
        const url = normalizeUrl(entry.instagram) ?? entry.instagram;
        const handle = new URL(url).pathname.split("/").filter(Boolean)[0];
        await upsertClaim(
          db,
          {
            clubId,
            fieldKey: "club.link",
            value: { kind: "instagram", url, ...(handle ? { handle } : {}) },
            assertionKind: "editorial",
          },
          evidence(src, runId, now(), null, { url, signal: "editor-listed; not fetched (§21)" }),
        );
        await logDecision(db, clubId, "confirm_link", "Instagram account listed by the editor (not fetched)", { url });
        out.instagram = "recorded";
      }
      touched.set(clubId, target.slug);
    } catch (error) {
      out.action = `error: ${String(error)}`;
      errors.push(`${entry.name}: ${String(error)}`);
      logger.error({ entry: entry.name, error: String(error) }, "curate failed for entry");
    }
  }

  const stats = await resolveClubs(db, { clubIds: [...touched.keys()], now: now() });
  errors.push(...stats.errors.map((e) => `resolve ${e.clubId}: ${e.error}`));
  await finishRun(db, runId, {
    status: errors.length ? "partial" : "succeeded",
    counters: {
      ...crawl,
      entries: entries.length,
      created: outcomes.filter((o) => o.action === "created").length,
      websitesConfirmed: outcomes.filter((o) => o.website.startsWith("ok")).length,
      needsReview: outcomes.filter((o) => o.action.startsWith("needs review")).length,
    },
    errorSummary: errors.slice(0, 50).join("\n") || null,
  });
  return { runId, outcomes, touchedSlugs: [...touched.values()], errors };
}

/** Source row for a link supplied by the editor that we never fetch (e.g. an Instagram profile). */
async function editorialSource(db: Queryable, url: string): Promise<{ sourceId: string; snapshotId: null }> {
  const sourceId = await upsertSource(db, {
    url,
    sourceType: "editorial",
    adapter: CURATE_EXTRACTOR,
    title: "Link supplied by the index editor",
  });
  return { sourceId, snapshotId: null };
}

function evidence(
  origin: { sourceId: string; snapshotId: string | null },
  runId: string,
  observedAt: Date,
  quote: string | null,
  locator: Record<string, unknown>,
) {
  return {
    sourceId: origin.sourceId,
    sourceType: "editorial" as const,
    snapshotId: origin.snapshotId,
    ingestionRunId: runId,
    observedAt,
    quote,
    locator,
    extractionMethod: "manual" as const,
    extractorName: CURATE_EXTRACTOR,
    extractorVersion: CURATED_LIST_VERSION,
    isDirect: true,
  };
}
