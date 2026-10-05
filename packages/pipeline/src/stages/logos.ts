import { inArray, sql, type SQL } from "drizzle-orm";
import { computeConfidence, normalizeUrl, type SourceType } from "@hci/core";
import { finishRun, rejectClaims, resolveClubs, restoreClaims, schema, startRun, upsertClaim, type Db } from "@hci/db";
import { DETERMINISTIC_EXTRACTOR } from "../extract/deterministic";
import {
  candidateProblem,
  clubNameTokens,
  LOGO_PICKER,
  logoUrlProblem,
  pickLogo,
  type ImageMeasure,
  type ImageStats,
  type LogoPick,
  type ProbeLookup,
} from "../extract/logo";
import { MEASURE_VERSION, measureImage } from "../logo-measure";
import type { Logger } from "../logger";
import { htmlToDocument } from "../parse/document";
import { canonicalImageUrl, type LogoCandidate } from "../parse/logo-candidates";
import type { SnapshotStore } from "../snapshots/store";
import type { SourceFetcher } from "../types";

/**
 * logos: each club's logo, chosen from its website's own root page (not whichever crawled
 * page was labelled "home"). The page's candidate images (parse/logo-candidates.ts) are
 * measured once each and kept in `image_probe`, so a rerun or `--offline` replay decides
 * the same way without fetching; `pickLogo` then takes the best one that will read on a
 * small light tile. The claim's evidence is the root page snapshot, like any extracted fact.
 *
 * Logo claims an earlier pass took from a club site (this stage or the deterministic
 * extractor before 1.16.16) and that the current rules don't pick are rejected with a
 * reason; editorial or other claims are left alone.
 */

/**
 * Candidates measured per page, by kind: a page can carry dozens of "logo" images (sponsor
 * grids), which must not crowd out its icons.
 */
const PROBES_PER_KIND: Record<LogoCandidate["kind"], number> = {
  jsonld: 2,
  header_img: 4,
  apple_touch_icon: 2,
  og_image: 1,
  icon: 3,
  img: 3,
};

function probeWorthy(candidates: readonly LogoCandidate[]): LogoCandidate[] {
  const used = new Map<LogoCandidate["kind"], number>();
  return candidates.filter((c) => {
    const n = used.get(c.kind) ?? 0;
    used.set(c.kind, n + 1);
    return n < PROBES_PER_KIND[c.kind];
  });
}
/** Probes older than this are measured again (sites replace their logo files). */
const PROBE_MAX_AGE_MS = 60 * 86_400_000;
const ACTOR = "logos";
const FAVICON_FILE = /favicon|apple-touch-icon|icon-\d+x\d+|android-chrome/i;
/** Claims are keyed by the normalized URL ("www." dropped), so compare that way. */
const key = (url: string): string => normalizeUrl(url) ?? url;
/** A reviewer's "no" covers every rendition of the image (Wix originals and their resizes). */
const vetoKey = (url: string): string => key(canonicalImageUrl(url));
/** A failed image fetch that may succeed later (network, timeout, 429, 5xx); retried daily. */
const TRANSIENT_RETRY_MS = 20 * 3_600_000;
function transientFailure(r: { status: string; httpStatus: number | null; error: string | null }): boolean {
  if (r.status !== "fetch_error" || /robots_disallowed|exceeds|unsafe|content-type/.test(r.error ?? "")) return false;
  return r.httpStatus === null || r.httpStatus >= 500 || r.httpStatus === 429 || r.httpStatus === 408;
}
const CLUB_CONCURRENCY = 6;

export const IMAGE_CONTENT_TYPES = [
  "image/png",
  "image/jpeg",
  "image/jpg",
  "image/webp",
  "image/gif",
  "image/svg+xml",
  "image/avif",
  "image/x-icon",
  "image/vnd.microsoft.icon",
  "application/octet-stream",
] as const;

/**
 * Whether a logo claim's rejection was automatic, so a measured pick of the same image
 * restores it: this stage's own, a re-extraction that no longer found it, or an audit
 * file-name heuristic the measurement now decides (white, favicon, blurred). A reviewer's
 * rejection ("audit review: …", a reason given by hand) or an audit finding that the image
 * is another organization's mark stands. PURE.
 */
export function rejectionYields(actor: string | null, reason: string | null): boolean {
  const why = reason ?? "";
  if (actor === ACTOR) return true;
  if (actor === "cli" && why.startsWith("not reproduced after re-running")) return true;
  if (actor === "audit" && /^audit logo\.(favicon_when_logo_exists|white_only|blurred_placeholder|tiny):/.test(why))
    return true;
  return false;
}

export interface LogoOutcome {
  slug: string;
  page: string;
  logo: string | null;
  kind: string | null;
  /** Why candidates were passed over (for the report). */
  skipped: string[];
  changed: boolean;
}

interface RootPage {
  clubId: string;
  slug: string;
  sourceId: string;
  sourceType: SourceType;
  snapshotId: string;
  storageKey: string;
  pageUrl: string;
  fetchedAt: Date;
  /** The club's canonical name, acronym and aliases. */
  names: string[];
}

type ProbeRow = typeof schema.imageProbe.$inferSelect;

function lookupFrom(rows: Map<string, ProbeRow>): ProbeLookup {
  return (url) => {
    const r = rows.get(url);
    if (!r || r.measureVersion !== MEASURE_VERSION) return undefined;
    if (r.status !== "ok" || r.width === null || r.height === null || !r.stats)
      return { ok: false, error: r.error ?? r.status };
    const measure: ImageMeasure = {
      width: r.width,
      height: r.height,
      format: r.format ?? "unknown",
      stats: r.stats as ImageStats,
    };
    return { ok: true, measure };
  };
}

async function probeImage(fetcher: SourceFetcher, url: string, now: Date): Promise<ProbeRow> {
  const base = {
    url,
    fetchedAt: now,
    httpStatus: null as number | null,
    contentType: null as string | null,
    bytes: null as number | null,
    width: null as number | null,
    height: null as number | null,
    format: null as string | null,
    stats: null as unknown,
    error: null as string | null,
    measureVersion: MEASURE_VERSION,
    storageKey: null as string | null,
  };
  const res = await fetcher.fetch({ url, sourceType: "club_website" });
  if (res.status !== "ok" || !res.body)
    return {
      ...base,
      status: "fetch_error",
      httpStatus: res.httpStatus,
      contentType: res.contentType,
      error: res.error ?? res.status,
    };
  try {
    const m = await measureImage(res.body);
    return {
      ...base,
      status: "ok",
      httpStatus: res.httpStatus,
      contentType: res.contentType,
      bytes: res.body.byteLength,
      width: m.width,
      height: m.height,
      format: m.format,
      stats: m.stats,
    };
  } catch (error) {
    return {
      ...base,
      status: "decode_error",
      httpStatus: res.httpStatus,
      contentType: res.contentType,
      bytes: res.body.byteLength,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/** Rows from a raw query: an array with postgres-js, `{ rows }` with in-process PGlite. */
async function queryRows<T>(db: Db, q: SQL): Promise<T[]> {
  const r = (await db.execute(q)) as unknown;
  return (Array.isArray(r) ? r : ((r as { rows?: T[] }).rows ?? [])) as T[];
}

/** Each active club's website root page, newest successful snapshot (verified sites first). */
async function rootPages(db: Db, slugs: readonly string[] | undefined): Promise<RootPage[]> {
  const filter = slugs?.length ? sql`and c.slug in ${slugs}` : sql``;
  const rows = await queryRows<Record<string, unknown>>(
    db,
    sql`
    select distinct on (c.id) c.id as club_id, c.slug, s.id as source_id, s.source_type, ss.id as snapshot_id,
      ss.storage_key, coalesce(ss.final_url, s.url) as page_url, ss.fetched_at,
      array_remove(array[c.canonical_name, c.acronym] || coalesce((select array_agg(a.alias) from club_alias a where a.club_id = c.id), '{}'), null) as names
    from club c
    join club_link l on l.club_id = c.id and l.kind = 'website' and l.status in ('verified', 'probable')
    join source s on s.normalized_url = l.normalized_url
    join source_snapshot ss on ss.source_id = s.id and ss.http_status = 200
    where c.record_state = 'active' ${filter}
    order by c.id, (l.status = 'verified') desc, ss.fetched_at desc`,
  );
  return rows.map((r) => ({
    clubId: String(r.club_id),
    slug: String(r.slug),
    sourceId: String(r.source_id),
    sourceType: r.source_type as SourceType,
    snapshotId: String(r.snapshot_id),
    storageKey: String(r.storage_key),
    pageUrl: String(r.page_url),
    fetchedAt: new Date(String(r.fetched_at)),
    names: (r.names as string[] | null) ?? [],
  }));
}

export async function runLogos(
  deps: { db: Db; fetcher: SourceFetcher; store: SnapshotStore; logger: Logger; now?: () => Date },
  opts: { slugs?: string[]; offline?: boolean; dryRun?: boolean; reprobe?: boolean } = {},
): Promise<{ runId: string; outcomes: LogoOutcome[]; probed: number; errors: string[] }> {
  const { db, logger } = deps;
  const now = deps.now ?? (() => new Date());
  const runId = await startRun(db, {
    job: "logos",
    adapter: LOGO_PICKER.name,
    adapterVersion: LOGO_PICKER.version,
    options: { ...opts },
  });
  const pages = await rootPages(db, opts.slugs);
  const outcomes: LogoOutcome[] = [];
  const errors: string[] = [];
  const touched = new Set<string>();
  let probed = 0;

  // Clubs in parallel; the fetcher still sends one request at a time per host.
  const queue = [...pages];
  const worker = async () => {
    for (let page = queue.shift(); page; page = queue.shift()) {
      const log = logger.child({ slug: page.slug });
      try {
        const html = new TextDecoder().decode(await deps.store.get(page.storageKey));
        const doc = htmlToDocument(html, page.pageUrl);
        // This club's rejected logo claims: a reviewer's decision keeps that image out; an
        // automatic one (this stage, a re-extraction, a file-name heuristic) yields to the
        // measured pick.
        const rejected = await queryRows<{
          id: string;
          value: string;
          actor: string | null;
          reason: string | null;
        }>(
          db,
          sql`
          select distinct on (cl.id) cl.id, cl.value #>> '{}' as value, ed.actor, ed.reason
          from claim cl
          left join editorial_decision ed on ed.target_id = cl.id and ed.action = 'reject_claim'
          where cl.club_id = ${page.clubId} and cl.field_key = 'club.logo' and cl.status = 'rejected'
          order by cl.id, ed.created_at desc nulls last`,
        );
        const vetoed = new Map<string, string>();
        const revivable = new Map<string, string>();
        for (const r of rejected)
          if (rejectionYields(r.actor, r.reason)) revivable.set(key(r.value), r.id);
          else vetoed.set(vetoKey(r.value), r.reason ?? "rejected");
        // A reviewer who rejected the site's favicon rejected it at every size it comes in.
        const iconVetoed = [...vetoed.keys()].some((u) => FAVICON_FILE.test(u));
        const isVetoed = (c: LogoCandidate) =>
          vetoed.has(vetoKey(c.url)) || (iconVetoed && (c.kind === "icon" || c.kind === "apple_touch_icon"));
        const allowed = doc.logoCandidates.filter((c) => !isVetoed(c));

        // Only candidates the URL rules allow are worth measuring.
        const worth = probeWorthy(allowed.filter((c) => !logoUrlProblem(c.url, doc.url, c.kind)));
        const urls = worth.map((c) => c.url);
        const known = new Map<string, ProbeRow>();
        if (urls.length)
          for (const r of await db.select().from(schema.imageProbe).where(inArray(schema.imageProbe.url, urls)))
            known.set(r.url, r);
        if (!opts.offline)
          for (const url of urls) {
            const k = known.get(url);
            const age = k ? now().getTime() - k.fetchedAt.getTime() : Infinity;
            const fresh =
              k &&
              k.measureVersion === MEASURE_VERSION &&
              age < (transientFailure(k) ? TRANSIENT_RETRY_MS : PROBE_MAX_AGE_MS) &&
              !opts.reprobe;
            if (fresh) continue;
            const row = await probeImage(deps.fetcher, url, now());
            probed++;
            known.set(url, row);
            if (!opts.dryRun)
              await db
                .insert(schema.imageProbe)
                .values(row)
                .onConflictDoUpdate({ target: schema.imageProbe.url, set: row });
          }
        const lookup = lookupFrom(known);
        const tokens = clubNameTokens(page.names, page.pageUrl);
        const pick: LogoPick | null = pickLogo(allowed, doc.url, lookup, tokens);
        const skipped = worth
          .filter((c) => c.url !== pick?.candidate.url)
          .map(
            (c) =>
              `${c.kind}: ${isVetoed(c) ? `rejected after review (${vetoed.get(vetoKey(c.url)) ?? "the site's favicon"})` : (candidateProblem(c, doc.url, lookup, tokens) ?? "usable, ranked lower")}`,
          );

        // Active logo claims; those only club-site extraction supports are retired when no
        // longer picked.
        const active = await queryRows<{
          id: string;
          value: string;
          site_only: boolean;
          restored_by: string | null;
        }>(
          db,
          sql`
          select cl.id, cl.value #>> '{}' as value,
            not exists (select 1 from claim_evidence e where e.claim_id = cl.id
              and e.extractor_name not in (${DETERMINISTIC_EXTRACTOR.name}, ${LOGO_PICKER.name})) as site_only,
            (select ed.actor from editorial_decision ed where ed.target_id = cl.id and ed.action = 'restore_claim'
              order by ed.created_at desc limit 1) as restored_by
          from claim cl
          where cl.club_id = ${page.clubId} and cl.field_key = 'club.logo' and cl.status = 'active'`,
        );
        // Undecided: an image the choice depends on wasn't measured (offline, a new measure
        // version), or the current logo failed in a way that may pass tomorrow. Then nothing
        // is written: a CDN hiccup must not take a club's logo away.
        const current = new Set(active.map((e) => key(e.value)));
        const undecided = worth.filter((c) => {
          const k = known.get(c.url);
          return !k || k.measureVersion !== MEASURE_VERSION || (transientFailure(k) && current.has(key(c.url)));
        });
        // A logo someone restored by hand stays, whatever the rules now pick.
        const earlier = active.filter(
          (e) => e.site_only && (e.restored_by === null || e.restored_by === ACTOR || e.restored_by === "audit"),
        );
        const picked = pick ? key(pick.candidate.url) : null;
        const stale = earlier.filter((e) => key(e.value) !== picked).map((e) => e.id);
        const changed =
          stale.length > 0 ||
          (pick !== null &&
            !active.some((e) => key(e.value) === picked) &&
            (revivable.has(picked ?? "") || !rejected.some((r) => key(r.value) === picked)));

        if (undecided.length) {
          outcomes.push({
            slug: page.slug,
            page: doc.url,
            logo: null,
            kind: null,
            skipped: [...skipped, `undecided: ${undecided.length} image(s) not measured yet; nothing changed`],
            changed: false,
          });
          continue;
        }
        if (!opts.dryRun) {
          if (pick) {
            const kind = pick.candidate.kind;
            await upsertClaim(
              db,
              { clubId: page.clubId, fieldKey: "club.logo", value: pick.candidate.url, assertionKind: "stated" },
              {
                sourceId: page.sourceId,
                sourceType: page.sourceType,
                snapshotId: page.snapshotId,
                ingestionRunId: runId,
                observedAt: page.fetchedAt,
                quote: null,
                locator: {
                  url: doc.url,
                  logoKind: kind,
                  ...(pick.measure
                    ? { width: pick.measure.width, height: pick.measure.height, format: pick.measure.format }
                    : {}),
                },
                extractionMethod: "html_parse",
                extractorName: LOGO_PICKER.name,
                extractorVersion: LOGO_PICKER.version,
                isDirect: true,
                confidence: Math.min(
                  0.99,
                  computeConfidence({ sourceType: page.sourceType, extractionMethod: "html_parse", isDirect: true }) *
                    (kind === "jsonld" || kind === "header_img" ? 1 : 0.8),
                ),
              },
            );
            const revive = revivable.get(key(pick.candidate.url));
            if (revive)
              await restoreClaims(db, {
                claimIds: [revive],
                actor: ACTOR,
                reason: `${LOGO_PICKER.name} ${LOGO_PICKER.version}: the measured image passes; the earlier rejection was automatic`,
              });
          }
          if (stale.length)
            await rejectClaims(db, {
              claimIds: stale,
              actor: ACTOR,
              reason: `${LOGO_PICKER.name} ${LOGO_PICKER.version}: not the logo the site's root page offers under the current rules`,
            });
          if (changed) touched.add(page.clubId);
        }
        outcomes.push({
          slug: page.slug,
          page: doc.url,
          logo: pick?.candidate.url ?? null,
          kind: pick?.candidate.kind ?? null,
          skipped,
          changed,
        });
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        errors.push(`${page.slug}: ${msg}`);
        log.warn({ error: msg }, "logo pass failed for club");
      }
    }
  };
  await Promise.all(Array.from({ length: CLUB_CONCURRENCY }, worker));
  outcomes.sort((a, b) => a.slug.localeCompare(b.slug));

  const stats = await resolveClubs(db, { clubIds: [...touched], now: now() });
  errors.push(...stats.errors.map((e) => `resolve ${e.clubId}: ${e.error}`));
  await finishRun(db, runId, {
    status: errors.length ? "partial" : "succeeded",
    counters: {
      clubs: pages.length,
      withLogo: outcomes.filter((o) => o.logo).length,
      changed: outcomes.filter((o) => o.changed).length,
      probed,
    },
    errorSummary: errors.slice(0, 50).join("\n") || null,
  });
  return { runId, outcomes, probed, errors };
}
