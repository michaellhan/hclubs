import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { and, eq, inArray, ne, sql } from "drizzle-orm";
import { normalizeUrl, siteKey } from "@hci/core";
import {
  SITE_IDENTITY_EXTRACTOR,
  finishRun,
  getStaticIndex,
  resolveClubs,
  schema,
  startRun,
  upsertClaim,
  type Db,
} from "@hci/db";
import { completenessTier, isSparseClub, type CompletenessTier } from "@hci/db/local";
import { MATCHER_VERSION } from "@hci/core";
import { crawlSite, emptyCrawlStats } from "../crawl/site";
import { pageNamesClub } from "../extract/deterministic";
import type { Logger } from "../logger";
import {
  bucketFor,
  findDuplicatePairs,
  scoreCandidate,
  type Bucket,
  type CandidateLink,
  type DupPair,
  type ScoredCandidate,
} from "../name-only/identity";
import { htmlToDocument } from "../parse/document";
import { searchQuery } from "../sites/candidates";
import { BraveSearchProvider, SearchCreditError, type WebSearchProvider } from "../sites/search";
import type { SnapshotStore } from "../snapshots/store";
import type { SourceFetcher } from "../types";
import { FINDER_VERSION, SEARCH_EXTRACTOR } from "./find-sites";
import { recruitingQuery } from "./recruiting";
import { cachedSearch } from "./web-discovery";

/**
 * Name-only campaign (ADR 0032): for clubs we know only by name, find duplicates first, then
 * free evidence (cached search results, links on pages already stored), and only then capped
 * paid searches that stop at the first strong match. Websites are accepted only when the
 * fetched page names the club; social profiles only when they score as the club's. Every
 * decision lands in a review report; uncertain matches are never written.
 */

export interface NameOnlyOptions {
  searchBudget?: number;
  search?: WebSearchProvider | null;
  limit?: number;
  dryRun?: boolean;
  reportPath?: string;
}

export interface NameOnlyCandidate extends ScoredCandidate {
  via: "cached_search" | "stored_page" | "paid_search";
  sourceUrl: string;
  outcome: "written" | "rejected" | "ambiguous" | "unverified_site" | "not_written";
}

export interface NameOnlyEntry {
  slug: string;
  name: string;
  bucket: Bucket;
  tierBefore: CompletenessTier;
  candidates: NameOnlyCandidate[];
  duplicates: { slug: string; reasons: string[] }[];
  dormancySignals: string[];
  queriesUsed: string[];
  resolved: boolean;
  manualReview: boolean;
  reason: string;
}

export interface NameOnlyCounters {
  targets: number;
  nameOnlyBefore: number;
  sparseRuleBefore: number;
  duplicatePairs: number;
  mergeCandidatesProposed: number;
  cachedSearchesRescored: number;
  storedPagesMatched: number;
  paidSearches: number;
  paidSearchCacheHits: number;
  websitesWritten: number;
  instagramWritten: number;
  otherSocialWritten: number;
  directoryLinksWritten: number;
  candidatesRejected: number;
  candidatesAmbiguous: number;
  sitesFailedVerification: number;
  [key: string]: number;
}

/** Hosts whose page about a club is a directory entry for it (read later by enrichment). */
const DIRECTORY_HOST =
  /(^|\.)(pbha\.org|iop\.harvard\.edu|hillel\.harvard\.edu|seas\.harvard\.edu|careerservices\.fas\.harvard\.edu|innovationlabs\.harvard\.edu)$/i;

const hostOf = (url: string) => {
  try {
    return new URL(url).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return "";
  }
};

/** The name without "Harvard Undergraduate"/"PBHA's"/"The" boilerplate, for searching. */
export function searchableName(name: string): string {
  return name
    .replace(/\([^)]*\)/g, " ")
    .replace(/^(?:the\s+)?(?:pbha[’']?s?\s+|harvard(?:-radcliffe)?\s+(?:undergraduate|college)\s+|harvard\s+)/i, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Adaptive query plan: the cheapest query first, the acronym only if the first is inconclusive. */
export function paidQueries(club: { name: string; acronym: string | null }): string[] {
  const core = searchableName(club.name);
  const q = [`"${core}" Harvard instagram`];
  const acr = club.acronym?.replace(/[^A-Za-z0-9-]/g, "") ?? "";
  if (acr.length >= 3) q.push(`"${acr}" Harvard club`);
  return q;
}

/**
 * Re-score every link an earlier name-only run wrote, from the title/snippet it was written
 * on, and reject those the current rules don't accept (status → rejected with the reasons;
 * never deleted). Keeps reruns honest when the scorer gets stricter.
 */
export async function recheckCampaignLinks(
  db: Db,
  store: SnapshotStore,
  dryRun: boolean,
): Promise<{ checked: number; rejected: string[] }> {
  const rows = (await db.execute(sql`
    select distinct c.id, c.value, cl.canonical_name as name, cl.acronym, cl.affiliation_scope as affiliation,
      e.evidence_quote as quote, e.evidence_locator as locator, ss.storage_key as "storageKey", ss.content_type as "contentType"
    from claim c
    join claim_evidence e on e.claim_id = c.id
    join ingestion_run r on r.id = e.ingestion_run_id
    join club cl on cl.id = c.club_id
    left join source_snapshot ss on ss.id = e.snapshot_id
    where r.job = 'name-only' and c.field_key = 'club.link' and c.status = 'active'
      and e.extractor_name = ${SEARCH_EXTRACTOR}`)) as unknown as {
    id: string;
    value: { kind: string; url: string };
    name: string;
    acronym: string | null;
    affiliation: string;
    quote: string | null;
    locator: { resultUrl?: string; via?: string } | null;
    storageKey: string | null;
    contentType: string | null;
  }[];
  const rejected: string[] = [];
  for (const r of rows) {
    if (DIRECTORY_HOST.test(hostOf(r.value.url))) continue;
    // The full search result (title + snippet) the link was written on, when it came from search.
    let cand: CandidateLink = { url: r.locator?.resultUrl ?? r.value.url, title: r.quote ?? "" };
    if (r.storageKey && r.contentType === "application/json") {
      try {
        const raw = JSON.parse(new TextDecoder().decode(await store.get(r.storageKey))) as {
          results?: CandidateLink[];
        };
        const hit = raw.results?.find((x) => x.url === cand.url);
        if (hit) cand = hit;
      } catch {
        /* keep the stored quote */
      }
    }
    const scored = scoreCandidate(cand, {
      name: r.name,
      acronym: r.acronym,
      aliases: [],
      college: r.affiliation !== "graduate_school",
    });
    if (scored.verdict === "accept" && scored.kind === r.value.kind) continue;
    rejected.push(`${r.name}: ${r.value.url} (${scored.reasons.join(", ")})`);
    if (!dryRun)
      await db
        .update(schema.claim)
        .set({ status: "rejected", statusReason: `name-only recheck: ${scored.reasons.join(", ")}`.slice(0, 500) })
        .where(eq(schema.claim.id, r.id));
  }
  return { checked: rows.length, rejected };
}

export async function runNameOnly(
  deps: { db: Db; fetcher: SourceFetcher; store: SnapshotStore; logger: Logger; now?: () => Date },
  opts: NameOnlyOptions = {},
): Promise<{ runId: string | null; counters: NameOnlyCounters; entries: NameOnlyEntry[]; pairs: DupPair[] }> {
  const { db, store, logger } = deps;
  const now = deps.now ?? (() => new Date());
  // Earlier runs' links must still pass today's rules (re-resolve the clubs that change).
  const recheck = await recheckCampaignLinks(db, store, opts.dryRun ?? false);
  if (recheck.rejected.length && !opts.dryRun) {
    const ids = (await db.execute(sql`
      select distinct club_id as id from claim where status = 'rejected' and status_reason like 'name-only recheck:%'`)) as unknown as {
      id: string;
    }[];
    await resolveClubs(db, { clubIds: ids.map((x) => x.id), now: now() });
  }
  const index = await getStaticIndex(db, now());
  const real = index.clubs.filter((c) => !c.isFixture);
  const c: NameOnlyCounters = {
    targets: 0,
    nameOnlyBefore: real.filter((x) => completenessTier(x) === "name_only").length,
    sparseRuleBefore: real.filter(isSparseClub).length,
    duplicatePairs: 0,
    mergeCandidatesProposed: 0,
    cachedSearchesRescored: 0,
    storedPagesMatched: 0,
    paidSearches: 0,
    paidSearchCacheHits: 0,
    websitesWritten: 0,
    instagramWritten: 0,
    otherSocialWritten: 0,
    directoryLinksWritten: 0,
    candidatesRejected: 0,
    candidatesAmbiguous: 0,
    sitesFailedVerification: 0,
    earlierLinksRechecked: recheck.checked,
    earlierLinksRejected: recheck.rejected.length,
  };
  // The campaign covers every club with no description and no website/Instagram.
  let targets = real.filter((x) => isSparseClub(x)).sort((a, b) => a.name.localeCompare(b.name));
  if (opts.limit !== undefined) targets = targets.slice(0, opts.limit);
  c.targets = targets.length;
  const ids = real.map((x) => x.id);

  // Tags (index flags), aliases, links and press dates for buckets, scoring and dormancy.
  const tagRows = (await db.execute(sql`
    select club_id as "clubId", value #>> '{}' as tag from claim
    where field_key = 'club.tag' and status = 'active' and club_id in (${sql.join(
      targets.map((t) => sql`${t.id}`),
      sql`, `,
    )})`)) as unknown as { clubId: string; tag: string }[];
  const aliases = await db
    .select({ clubId: schema.clubAlias.clubId, alias: schema.clubAlias.alias })
    .from(schema.clubAlias)
    .where(inArray(schema.clubAlias.clubId, ids));
  const links = await db
    .select({ clubId: schema.clubLink.clubId, kind: schema.clubLink.kind, url: schema.clubLink.url })
    .from(schema.clubLink)
    .where(and(inArray(schema.clubLink.clubId, ids), ne(schema.clubLink.status, "rejected")));
  // Links a reviewer (or an audit) already rejected are never proposed again.
  const rejectedUrls = new Set(
    (
      (await db.execute(sql`
        select value ->> 'url' as url from claim
        where field_key = 'club.link' and status = 'rejected' and value ->> 'url' is not null`)) as unknown as {
        url: string;
      }[]
    ).map((r) => normalizeUrl(r.url) ?? r.url),
  );
  const clubRows = await db
    .select({
      id: schema.club.id,
      recognition: schema.club.recognitionStatus,
      affiliation: schema.club.affiliationScope,
      fields: schema.club.fields,
    })
    .from(schema.club)
    .where(inArray(schema.club.id, ids));
  const rowById = new Map(clubRows.map((r) => [r.id, r]));

  // 1) Duplicates and renames among all clubs, focused on the targets.
  const pairs = findDuplicatePairs(
    real.map((x) => ({
      id: x.id,
      slug: x.slug,
      name: x.name,
      acronym: x.acronym,
      websites: links.filter((l) => l.clubId === x.id && l.kind === "website").map((l) => l.url),
      instagrams: links.filter((l) => l.clubId === x.id && l.kind === "instagram").map((l) => l.url),
    })),
    new Set(targets.map((t) => t.id)),
  );
  // Pairs a reviewer already ruled "not a duplicate" don't count.
  const decided = (await db.execute(sql`
    select club_a_id as a, club_b_id as b from merge_candidate where status = 'rejected'`)) as unknown as {
    a: string;
    b: string;
  }[];
  const rejectedPair = new Set(decided.map((d) => `${d.a}|${d.b}`));
  for (let i = pairs.length - 1; i >= 0; i--) {
    const p = pairs[i];
    if (p && rejectedPair.has(`${p.aId}|${p.bId}`)) pairs.splice(i, 1);
  }
  // Withdraw this campaign's earlier proposals the current rules no longer make.
  if (!opts.dryRun) {
    const keep = new Set(pairs.map((p) => `${p.aId}|${p.bId}`));
    const mine = (await db.execute(sql`
      select id, club_a_id as a, club_b_id as b from merge_candidate
      where status = 'proposed' and explanation like 'name-only campaign:%'`)) as unknown as {
      id: string;
      a: string;
      b: string;
    }[];
    for (const m of mine)
      if (!keep.has(`${m.a}|${m.b}`))
        await db
          .update(schema.mergeCandidate)
          .set({ status: "rejected", decidedBy: "name-only-campaign", decidedAt: new Date() })
          .where(eq(schema.mergeCandidate.id, m.id));
  }
  c.duplicatePairs = pairs.length;

  const runId = opts.dryRun
    ? null
    : await startRun(db, {
        job: "name-only",
        adapter: "name-only-campaign",
        adapterVersion: "1",
        options: { searchBudget: opts.searchBudget ?? 0, limit: opts.limit ?? null },
      });
  if (!opts.dryRun) {
    for (const p of pairs) {
      const res = await db
        .insert(schema.mergeCandidate)
        .values({
          clubAId: p.aId,
          clubBId: p.bId,
          score: p.score,
          signals: { reasons: p.reasons },
          reason: "likely_duplicate",
          explanation: `name-only campaign: ${p.reasons.join("; ")}`,
          matcherVersion: MATCHER_VERSION,
        })
        .onConflictDoNothing()
        .returning({ id: schema.mergeCandidate.id });
      if (res.length) c.mergeCandidatesProposed++;
    }
  }

  // Cached-search lookup: the stored response for a query, if this provider ever asked it.
  const finder10 = new BraveSearchProvider("unused", logger, 0, 10);
  const finder20 = new BraveSearchProvider("unused", logger, 0, 20);
  const cachedResults = async (requestUrl: string) => {
    const rows = (await db.execute(sql`
      select ss.id, ss.storage_key as "storageKey", s.id as "sourceId", ss.fetched_at as "fetchedAt"
      from source s join source_snapshot ss on ss.source_id = s.id
      where s.url = ${requestUrl} order by ss.fetched_at desc limit 1`)) as unknown as {
      id: string;
      storageKey: string;
      sourceId: string;
      fetchedAt: Date;
    }[];
    const r = rows[0];
    if (!r) return null;
    const raw = JSON.parse(new TextDecoder().decode(await store.get(r.storageKey))) as {
      results: CandidateLink[];
    };
    return { results: raw.results, sourceId: r.sourceId, snapshotId: r.id, fetchedAt: new Date(r.fetchedAt) };
  };

  const crawl = emptyCrawlStats();
  let searchesLeft = opts.search ? (opts.searchBudget ?? 0) : 0;
  let searchStopped = false;
  const entries: NameOnlyEntry[] = [];
  const touched = new Set<string>();

  for (const club of targets) {
    const log = logger.child({ club: club.slug });
    const tags = tagRows.filter((t) => t.clubId === club.id).map((t) => t.tag);
    const clubAliases = aliases.filter((a) => a.clubId === club.id).map((a) => a.alias);
    const dups = pairs
      .filter((p) => p.aId === club.id || p.bId === club.id)
      .map((p) => ({ slug: p.aId === club.id ? p.bSlug : p.aSlug, reasons: p.reasons }));
    const bucket = bucketFor({ name: club.name, acronym: club.acronym, tags, duplicate: dups.length > 0 });
    const row = rowById.get(club.id);
    const identity = {
      name: club.name,
      acronym: club.acronym,
      aliases: clubAliases,
      college: row?.affiliation !== "graduate_school",
    };
    const entry: NameOnlyEntry = {
      slug: club.slug,
      name: club.name,
      bucket,
      tierBefore: completenessTier(club),
      candidates: [],
      duplicates: dups,
      dormancySignals: [],
      queriesUsed: [],
      resolved: false,
      manualReview: false,
      reason: "",
    };
    entries.push(entry);

    // Dormancy evidence (reported only; status is never inferred from a missing website).
    if (row?.recognition !== "recognized")
      entry.dormancySignals.push("not listed as registered in the College directory");
    const pressDates = (
      ((row?.fields as Record<string, { values?: { value?: { publishedOn?: string } }[] }> | null)?.[
        "club.press_mention"
      ]?.values ?? []) as { value?: { publishedOn?: string } }[]
    )
      .map((v) => v.value?.publishedOn)
      .filter((d): d is string => typeof d === "string")
      .sort();
    const lastPress = pressDates[pressDates.length - 1];
    if (lastPress && Number(lastPress.slice(0, 4)) < now().getFullYear() - 3)
      entry.dormancySignals.push(`latest news mention ${lastPress.slice(0, 10)}`);

    if (bucket === "likely_duplicate") {
      entry.reason = "probable duplicate: proposed for merge review";
      entry.manualReview = true;
      continue;
    }

    type Found = {
      cand: CandidateLink;
      via: NameOnlyCandidate["via"];
      source: { sourceId: string; snapshotId: string; fetchedAt: Date; url: string; sourceType: "public_web" };
    };
    const found: Found[] = [];

    // 2) Free: search responses already stored for this club (site finder, recruiting pass).
    const queries = [
      finder10.requestUrl(searchQuery({ name: club.name, acronym: club.acronym, aliases: clubAliases })),
      finder10.requestUrl(`Harvard ${club.name.replace(/\s*\([^)]*\)\s*/g, " ").trim()} student group`),
      finder20.requestUrl(recruitingQuery({ name: club.name, site: null })),
    ];
    for (const q of queries) {
      const cached = await cachedResults(q);
      if (!cached) continue;
      c.cachedSearchesRescored++;
      for (const r of cached.results)
        found.push({
          cand: r,
          via: "cached_search",
          source: {
            sourceId: cached.sourceId,
            snapshotId: cached.snapshotId,
            fetchedAt: cached.fetchedAt,
            url: q,
            sourceType: "public_web",
          },
        });
    }

    // 3) Free: pages we already stored that link to this club by name (directories, other clubs).
    const core = searchableName(club.name);
    if (core.length >= 10) {
      const pages = (await db.execute(sql`
        select ss.id, ss.storage_key as "storageKey", s.id as "sourceId", s.url, ss.fetched_at as "fetchedAt"
        from source_snapshot ss join source s on s.id = ss.source_id
        where s.adapter is distinct from ${SEARCH_EXTRACTOR} and s.adapter is distinct from 'recruiting-search'
          and s.adapter is distinct from 'web-discovery'
          and ss.extracted_text ilike ${`%${core.replace(/[%_]/g, "")}%`}
        order by ss.fetched_at desc limit 12`)) as unknown as {
        id: string;
        storageKey: string;
        sourceId: string;
        url: string;
        fetchedAt: Date;
      }[];
      for (const p of pages) {
        let doc;
        try {
          doc = htmlToDocument(new TextDecoder().decode(await store.get(p.storageKey)), p.url);
        } catch {
          continue;
        }
        c.storedPagesMatched++;
        for (const l of doc.links) {
          if (!l.text.toLowerCase().includes(core.toLowerCase())) continue;
          if (hostOf(l.url) === hostOf(p.url) && !DIRECTORY_HOST.test(hostOf(l.url))) continue;
          found.push({
            cand: { url: l.url, title: `${l.text} — ${doc.title ?? ""}` },
            via: "stored_page",
            source: {
              sourceId: p.sourceId,
              snapshotId: p.id,
              fetchedAt: new Date(p.fetchedAt),
              url: p.url,
              sourceType: "public_web",
            },
          });
        }
      }
    }

    // Score, dedupe by URL (best score wins), then try to write the strongest per kind.
    const decide = async (items: Found[]): Promise<boolean> => {
      const best = new Map<string, { f: Found; s: ScoredCandidate }>();
      for (const f of items) {
        const directory = DIRECTORY_HOST.test(hostOf(f.cand.url));
        const s = directory
          ? ({
              url: normalizeUrl(f.cand.url) ?? f.cand.url,
              kind: "harvard_directory",
              score: f.via === "stored_page" ? 70 : 0,
              verdict: f.via === "stored_page" ? "accept" : "reject",
              reasons: [
                f.via === "stored_page" ? "directory page linked under the club's name" : "directory host from search",
              ],
            } as ScoredCandidate)
          : scoreCandidate(f.cand, identity);
        if (rejectedUrls.has(normalizeUrl(s.url) ?? s.url)) {
          s.verdict = "reject";
          s.score = 0;
          s.reasons = [...s.reasons, "this link was rejected before"];
        }
        const prev = best.get(s.url);
        if (!prev || s.score > prev.s.score) best.set(s.url, { f, s });
      }
      let resolved = false;
      const doneKinds = new Set<string>();
      for (const { f, s } of [...best.values()].sort((a, b) => b.s.score - a.s.score)) {
        const record = (outcome: NameOnlyCandidate["outcome"], extra?: string) =>
          entry.candidates.push({
            ...s,
            reasons: extra ? [...s.reasons, extra] : s.reasons,
            via: f.via,
            sourceUrl: f.source.url,
            outcome,
          });
        if (s.verdict === "reject") {
          c.candidatesRejected++;
          if (s.score > 0 || entry.candidates.length < 8) record("rejected");
          continue;
        }
        if (s.verdict === "ambiguous") {
          c.candidatesAmbiguous++;
          record("ambiguous");
          continue;
        }
        if (doneKinds.has(s.kind)) {
          record("not_written", "a stronger candidate of this kind was taken");
          continue;
        }
        if (opts.dryRun) {
          record("not_written", "dry run");
          doneKinds.add(s.kind);
          resolved = true;
          continue;
        }
        if (s.kind === "website") {
          // A website must name the club on its own page (ADR 0023): fetch and check.
          const root = normalizeUrl(`https://${siteKey(s.url) ?? hostOf(s.url)}/`);
          const owned = links.some(
            (l) => l.kind === "website" && l.clubId !== club.id && siteKey(l.url) === siteKey(s.url),
          );
          if (!root || owned) {
            record("rejected", owned ? "site already belongs to another club" : "bad URL");
            continue;
          }
          const got = await crawlSite({
            rootUrl: root,
            clubId: club.id,
            officialSite: false,
            db,
            fetcher: deps.fetcher,
            store,
            runId: runId ?? "",
            logger: log,
            now,
            maxPages: 1,
            maxDepth: 0,
            freshnessMs: 30 * 86_400_000,
            force: false,
            stats: crawl,
          });
          const home = got[0];
          const matched = home
            ? pageNamesClub(home.doc, [club.name, ...clubAliases], club.acronym ? [club.acronym] : [])
            : null;
          if (!home || !matched) {
            c.sitesFailedVerification++;
            if (!home) entry.dormancySignals.push(`candidate site ${root} didn't load`);
            record("unverified_site", "fetched page doesn't name the club");
            continue;
          }
          await upsertClaim(
            db,
            { clubId: club.id, fieldKey: "club.link", value: { kind: "website", url: root }, assertionKind: "stated" },
            {
              sourceId: home.sourceId,
              sourceType: "public_web",
              snapshotId: home.snapshotId,
              ingestionRunId: runId,
              observedAt: home.fetchedAt,
              quote: matched,
              locator: { url: home.url, signal: "page title names the club", foundVia: f.via },
              extractionMethod: "html_parse",
              extractorName: SITE_IDENTITY_EXTRACTOR,
              extractorVersion: "1",
              isDirect: true,
            },
          );
          c.websitesWritten++;
        } else {
          const linkValue =
            s.kind === "harvard_directory"
              ? {
                  kind: "harvard_directory",
                  url: s.url,
                  label: f.cand.title.split(" — ")[0]?.slice(0, 120) ?? "Directory page",
                }
              : { kind: s.kind, url: s.url };
          await upsertClaim(
            db,
            { clubId: club.id, fieldKey: "club.link", value: linkValue, assertionKind: "stated" },
            {
              sourceId: f.source.sourceId,
              sourceType: "public_web",
              snapshotId: f.source.snapshotId,
              ingestionRunId: runId,
              observedAt: f.source.fetchedAt,
              quote: f.cand.title.slice(0, 300),
              locator: { resultUrl: f.cand.url, score: s.score, reasons: s.reasons, via: f.via },
              extractionMethod: "structured_data",
              extractorName: SEARCH_EXTRACTOR,
              extractorVersion: FINDER_VERSION,
              isDirect: true,
            },
          );
          if (s.kind === "instagram") c.instagramWritten++;
          else if (s.kind === "harvard_directory") c.directoryLinksWritten++;
          else c.otherSocialWritten++;
        }
        record("written");
        doneKinds.add(s.kind);
        touched.add(club.id);
        resolved = true;
      }
      return resolved;
    };

    entry.resolved = await decide(found);

    // 4) Paid search, adaptively: only for searchable buckets, stopping at the first strong match.
    const searchable: Bucket[] = [
      "distinctive_acronym",
      "distinctive_name",
      "generic_name",
      "college_program",
      "pbha_program",
    ];
    // Without a search budget, still replay paid searches an earlier run already bought.
    if (!entry.resolved && searchable.includes(bucket) && !opts.search) {
      const paid20 = new BraveSearchProvider("unused", logger, 0, 20);
      for (const query of paidQueries(club)) {
        const cached = await cachedResults(paid20.requestUrl(query));
        if (!cached) continue;
        entry.queriesUsed.push(`${query} (cached)`);
        c.paidSearchCacheHits++;
        const items: Found[] = cached.results.map((r) => ({
          cand: r,
          via: "paid_search" as const,
          source: { ...cached, url: query, sourceType: "public_web" as const },
        }));
        if (await decide(items)) {
          entry.resolved = true;
          break;
        }
      }
    }
    if (!entry.resolved && searchable.includes(bucket) && opts.search && !searchStopped) {
      for (const query of paidQueries(club)) {
        if (searchesLeft <= 0) break;
        try {
          const res = await cachedSearch({ db, store, now }, opts.search, query, runId ?? "", "name-only-search", 180);
          entry.queriesUsed.push(query);
          if (res.reused) c.paidSearchCacheHits++;
          else {
            c.paidSearches++;
            searchesLeft--;
          }
          const items: Found[] = res.results.map((r) => ({
            cand: r,
            via: "paid_search" as const,
            source: {
              sourceId: res.sourceId,
              snapshotId: res.snapshotId,
              fetchedAt: res.fetchedAt,
              url: query,
              sourceType: "public_web" as const,
            },
          }));
          if (await decide(items)) {
            entry.resolved = true;
            break;
          }
        } catch (error) {
          if (error instanceof SearchCreditError) {
            searchStopped = true;
            break;
          }
          throw error;
        }
      }
    }

    const ambiguous = entry.candidates.filter((x) => x.outcome === "ambiguous" || x.outcome === "unverified_site");
    entry.manualReview = !entry.resolved && ambiguous.length > 0;
    entry.reason = entry.resolved
      ? "resolved"
      : ambiguous.length > 0
        ? "only ambiguous candidates"
        : bucket === "invitation_only_social"
          ? "invitation-only organization; little public presence expected"
          : bucket === "college_program"
            ? "College program documented on Harvard pages we don't crawl"
            : entry.queriesUsed.length === 0 && !searchable.includes(bucket)
              ? "not searched (bucket)"
              : entry.queriesUsed.length === 0
                ? "no free evidence; not searched (budget)"
                : "searched; no matching candidate";
  }

  if (touched.size && !opts.dryRun) await resolveClubs(db, { clubIds: [...touched], now: now() });
  if (runId) await finishRun(db, runId, { status: "succeeded", counters: c, errorSummary: null });
  if (opts.reportPath) writeReport(opts.reportPath, c, entries, pairs);
  return { runId, counters: c, entries, pairs };
}

/** JSON (machine) and Markdown (human) review report. */
function writeReport(path: string, c: NameOnlyCounters, entries: NameOnlyEntry[], pairs: DupPair[]): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(`${path}.json`, JSON.stringify({ counters: c, entries, pairs }, null, 2));
  const lines: string[] = ["# Name-only review", "", "## Needs manual review", ""];
  for (const e of entries.filter((x) => x.manualReview)) {
    lines.push(`### ${e.name} (\`${e.slug}\`) — ${e.bucket}`, "", `Reason: ${e.reason}`, "");
    for (const d of e.duplicates) lines.push(`- possible duplicate of \`${d.slug}\`: ${d.reasons.join("; ")}`);
    for (const cand of e.candidates.filter((x) => x.outcome !== "rejected").slice(0, 5))
      lines.push(`- ${cand.outcome} ${cand.score} ${cand.kind} ${cand.url} — ${cand.reasons.join(", ")}`);
    lines.push("");
  }
  lines.push("## Unresolved, grouped by reason", "");
  const byReason = new Map<string, NameOnlyEntry[]>();
  for (const e of entries.filter((x) => !x.resolved)) byReason.set(e.reason, [...(byReason.get(e.reason) ?? []), e]);
  for (const [reason, es] of byReason) {
    lines.push(`### ${reason} (${es.length})`, "", es.map((e) => `\`${e.slug}\``).join(", "), "");
  }
  writeFileSync(`${path}.md`, lines.join("\n"));
}
