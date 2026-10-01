import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { and, desc, eq, ne, sql } from "drizzle-orm";
import { normalizeUrl, siteKey } from "@hci/core";
import {
  SITE_IDENTITY_EXTRACTOR,
  findRepoRoot,
  finishRun,
  resolveClubs,
  schema,
  startRun,
  upsertClaim,
  type Db,
} from "@hci/db";
import { crawlSite, emptyCrawlStats } from "../crawl/site";
import type { Logger } from "../logger";
import { htmlToDocument, type PageDocument } from "../parse/document";
import { excludedSiteHost, siteIdentity, siteKeyHasInitials, siteKeyMentionsClub } from "../sites/candidates";
import { anchorMatches, buildNameKeys, siteRootOf, type NamedClub } from "../sites/link-graph";
import type { SnapshotStore } from "../snapshots/store";
import type { SourceFetcher } from "../types";

/**
 * link-graph (ADR 0038): find club websites and accounts in pages we already stored, for
 * free. Two passes over the latest snapshot of every HTML source:
 *
 *  1. Anchors: a link whose text is exactly a club's name, alias or acronym.
 *  2. Orphans: a stored home page no club owns whose own title names a club.
 *
 * A website is attached (as "probable", like the finder's) only when its stored home page
 * passes `siteIdentity`; the referring page is kept as extra evidence, so a Harvard page
 * that links it by name verifies it. Without a stored home page the lead goes to the
 * review report, or is fetched politely with `--fetch=N`. Social accounts are attached only
 * from Harvard-affiliated pages (tier ≤ 7); they stay unverified unless the page is tier 1.
 */
export const LINK_GRAPH_EXTRACTOR = { name: "link-graph", version: "2" } as const;

interface Lead {
  clubId: string;
  slug: string;
  root: string;
  via: string;
  anchor: string;
  refSourceId: string | null;
  refSnapshotId: string | null;
  refTier: number;
  refType: string;
  refAt: Date;
}

export interface LinkGraphResult {
  runId: string;
  accepted: { slug: string; site: string; via: string; quote: string }[];
  socials: { slug: string; url: string; via: string }[];
  /** Pages linking a club's existing site by the club's name (ownership-v2 evidence). */
  referenced: { slug: string; site: string; via: string; tier: number }[];
  review: { slug: string; site: string; via: string; reason: string }[];
  reportPath: string;
  counters: Record<string, number>;
}

export async function runLinkGraph(
  deps: { db: Db; fetcher: SourceFetcher; store: SnapshotStore; logger: Logger; now?: () => Date },
  opts: { dryRun?: boolean; fetch?: number } = {},
): Promise<LinkGraphResult> {
  const { db, store, logger } = deps;
  const now = deps.now ?? (() => new Date());
  const runId = await startRun(db, {
    job: "link-graph",
    adapter: LINK_GRAPH_EXTRACTOR.name,
    adapterVersion: LINK_GRAPH_EXTRACTOR.version,
    options: { dryRun: opts.dryRun ?? false, fetch: opts.fetch ?? 0 },
  });
  const counters: Record<string, number> = { snapshotsScanned: 0, anchorLeads: 0, orphanLeads: 0, fetched: 0 };
  const crawl = emptyCrawlStats();

  // Every live club's names; targets are those without any non-rejected website.
  const clubs = await db
    .select({
      id: schema.club.id,
      slug: schema.club.slug,
      name: schema.club.canonicalName,
      acronym: schema.club.acronym,
    })
    .from(schema.club)
    .where(and(eq(schema.club.recordState, "active"), ne(schema.club.dataOrigin, "fixture")));
  const aliases = await db
    .select({ clubId: schema.clubAlias.clubId, alias: schema.clubAlias.alias })
    .from(schema.clubAlias);
  const named: (NamedClub & { slug: string })[] = clubs.map((c) => ({
    ...c,
    aliases: aliases.filter((a) => a.clubId === c.id && a.alias !== c.acronym).map((a) => a.alias),
  }));
  const byId = new Map(named.map((c) => [c.id, c]));
  const links = await db
    .select({ clubId: schema.clubLink.clubId, kind: schema.clubLink.kind, url: schema.clubLink.url })
    .from(schema.clubLink)
    .where(ne(schema.clubLink.status, "rejected"));
  const rejected = await db
    .select({ clubId: schema.claim.clubId, value: schema.claim.value })
    .from(schema.claim)
    .where(and(eq(schema.claim.fieldKey, "club.link"), eq(schema.claim.status, "rejected")));
  const rejectedUrls = new Set(
    rejected.map((r) => `${r.clubId}|${siteKey((r.value as { url?: string }).url ?? "") ?? ""}`),
  );
  const siteOwner = new Map<string, string>();
  for (const l of links) if (l.kind === "website") siteOwner.set(siteKey(l.url) ?? l.url, l.clubId);
  const hasSite = new Set(links.filter((l) => l.kind === "website").map((l) => l.clubId));
  const hasKind = new Set(links.map((l) => `${l.clubId}|${l.kind}`));
  const keys = buildNameKeys(named);

  // Latest snapshot of every HTML source.
  const snaps = await db
    .selectDistinctOn([schema.sourceSnapshot.sourceId], {
      sourceId: schema.sourceSnapshot.sourceId,
      snapshotId: schema.sourceSnapshot.id,
      storageKey: schema.sourceSnapshot.storageKey,
      finalUrl: schema.sourceSnapshot.finalUrl,
      fetchedAt: schema.sourceSnapshot.fetchedAt,
      tier: schema.source.trustTier,
      type: schema.source.sourceType,
      owner: schema.source.ownerClubId,
      role: schema.source.pageRole,
      normalizedUrl: schema.source.normalizedUrl,
    })
    .from(schema.sourceSnapshot)
    .innerJoin(schema.source, eq(schema.source.id, schema.sourceSnapshot.sourceId))
    .where(
      and(
        eq(schema.source.isFixture, false),
        sql`${schema.sourceSnapshot.contentType} ilike '%html%'`,
        sql`${schema.source.domain} not like '%search.brave.com'`,
      ),
    )
    .orderBy(schema.sourceSnapshot.sourceId, desc(schema.sourceSnapshot.fetchedAt));
  const docs = new Map<string, PageDocument>();
  const docFor = async (s: (typeof snaps)[number]) => {
    const hit = docs.get(s.snapshotId);
    if (hit) return hit;
    const doc = htmlToDocument(new TextDecoder().decode(await store.get(s.storageKey)), s.finalUrl);
    docs.set(s.snapshotId, doc);
    return doc;
  };
  const snapByUrl = new Map(snaps.map((s) => [s.normalizedUrl, s]));

  const leads: Lead[] = [];
  const references: Lead[] = [];
  const socialLeads: (Lead & { url: string })[] = [];
  // Each club's active website claims by site, with the exact claimed URL (evidence must land
  // on that claim, not create a near-duplicate).
  const websiteClaims = new Map<string, string>();
  for (const w of await db
    .select({ clubId: schema.claim.clubId, value: schema.claim.value })
    .from(schema.claim)
    .where(and(eq(schema.claim.fieldKey, "club.link"), eq(schema.claim.status, "active")))) {
    const v = w.value as { kind?: string; url?: string };
    const k = v.kind === "website" && v.url ? siteKey(v.url) : null;
    if (k && v.url && !websiteClaims.has(`${w.clubId}|${k}`)) websiteClaims.set(`${w.clubId}|${k}`, v.url);
  }
  for (const s of snaps) {
    let doc: PageDocument;
    try {
      doc = await docFor(s);
    } catch {
      continue;
    }
    counters.snapshotsScanned = (counters.snapshotsScanned ?? 0) + 1;
    const ref = {
      refSourceId: s.sourceId,
      refSnapshotId: s.snapshotId,
      refTier: s.tier,
      refType: s.type,
      refAt: s.fetchedAt,
    };
    for (const m of anchorMatches(s.finalUrl, doc.links, keys)) {
      const club = byId.get(m.clubId);
      if (!club) continue;
      // A club's own pages naming itself say nothing new.
      if (s.owner === m.clubId) continue;
      if (m.kind === "social") {
        const kind = new URL(m.url).hostname.replace(/^www\./, "").split(".")[0] ?? "";
        // Accounts are shown on profiles even unverified, so only a Harvard listing or a
        // handle that carries the club's own name/acronym (not "harvardlacrosse" for a club team).
        const handle = new URL(m.url).pathname.split("/").filter(Boolean)[0] ?? "";
        const trusted =
          s.tier <= 1 ||
          (s.tier <= 7 && siteKeyMentionsClub(handle, { name: club.name, acronym: club.acronym, aliases: [] }));
        if (trusted && !hasKind.has(`${m.clubId}|${kind === "twitter" ? "x" : kind}`))
          socialLeads.push({
            ...ref,
            clubId: m.clubId,
            slug: club.slug,
            root: m.url,
            url: m.url,
            via: s.finalUrl,
            anchor: m.anchor,
          });
        continue;
      }
      if (hasSite.has(m.clubId)) {
        // ownership-v2 (ADR 0039): someone else's page linking the club's existing site by
        // the club's own name is evidence for that site (a second, independent signal).
        const site = siteKey(m.url);
        const claimValue = site ? websiteClaims.get(`${m.clubId}|${site}`) : undefined;
        if (claimValue && site !== siteKey(s.finalUrl))
          references.push({
            ...ref,
            clubId: m.clubId,
            slug: club.slug,
            root: claimValue,
            via: s.finalUrl,
            anchor: m.anchor,
          });
        continue;
      }
      const root = siteRootOf(m.url);
      if (!root) continue;
      leads.push({ ...ref, clubId: m.clubId, slug: club.slug, root, via: s.finalUrl, anchor: m.anchor });
      counters.anchorLeads = (counters.anchorLeads ?? 0) + 1;
    }
  }

  // Orphan home pages: stored, owned by no club, and titled with a site-less club's name.
  const siteless = named.filter((c) => !hasSite.has(c.id));
  for (const s of snaps) {
    if (s.owner || s.role !== "home" || siteOwner.has(siteKey(s.finalUrl) ?? "") || excludedSiteHost(s.finalUrl))
      continue;
    let doc: PageDocument;
    try {
      doc = await docFor(s);
    } catch {
      continue;
    }
    for (const c of siteless) {
      const names = { name: c.name, acronym: c.acronym, aliases: [...c.aliases] };
      // A title alone matched athletics pages and a shop to "Harvard Crimson": an orphan page
      // also needs its domain to carry the club's own name or acronym.
      const key = siteKey(s.finalUrl) ?? "";
      if (!(siteKeyMentionsClub(key, names) || siteKeyHasInitials(key, names)) || !siteIdentity(doc, names)) continue;
      const root = siteRootOf(s.finalUrl);
      if (!root) continue;
      leads.push({
        clubId: c.id,
        slug: c.slug,
        root,
        via: "stored home page with no owner",
        anchor: doc.title ?? "",
        refSourceId: null,
        refSnapshotId: null,
        refTier: 8,
        refType: "public_web",
        refAt: s.fetchedAt,
      });
      counters.orphanLeads = (counters.orphanLeads ?? 0) + 1;
    }
  }

  // Judge each lead on the site's own home page.
  const accepted: LinkGraphResult["accepted"] = [];
  const review: LinkGraphResult["review"] = [];
  const touched = new Set<string>();
  let fetchBudget = opts.fetch ?? 0;
  const seen = new Set<string>();
  for (const lead of leads.sort((a, b) => a.refTier - b.refTier)) {
    const key = siteKey(lead.root) ?? lead.root;
    if (seen.has(`${lead.clubId}|${key}`)) continue;
    seen.add(`${lead.clubId}|${key}`);
    if (rejectedUrls.has(`${lead.clubId}|${key}`)) {
      review.push({ slug: lead.slug, site: lead.root, via: lead.via, reason: "rejected for this club before" });
      continue;
    }
    const owner = siteOwner.get(key);
    if (owner && owner !== lead.clubId) {
      review.push({
        slug: lead.slug,
        site: lead.root,
        via: lead.via,
        reason: `already ${byId.get(owner)?.slug ?? "another club"}'s site`,
      });
      continue;
    }
    const club = byId.get(lead.clubId);
    if (!club) continue;
    const stored = snapByUrl.get(normalizeUrl(lead.root) ?? lead.root);
    let home: { doc: PageDocument; sourceId: string; snapshotId: string; fetchedAt: Date } | null = null;
    if (stored)
      home = {
        doc: await docFor(stored),
        sourceId: stored.sourceId,
        snapshotId: stored.snapshotId,
        fetchedAt: stored.fetchedAt,
      };
    else if (fetchBudget > 0 && !opts.dryRun) {
      fetchBudget--;
      counters.fetched = (counters.fetched ?? 0) + 1;
      const [page] = await crawlSite({
        rootUrl: lead.root,
        clubId: lead.clubId,
        officialSite: false,
        db,
        fetcher: deps.fetcher,
        store,
        runId,
        logger,
        now,
        maxPages: 1,
        maxDepth: 0,
        freshnessMs: 7 * 86_400_000,
        force: false,
        stats: crawl,
      });
      if (page) home = page;
    }
    if (!home) {
      review.push({
        slug: lead.slug,
        site: lead.root,
        via: `${lead.via} ("${lead.anchor}")`,
        reason: "home page not stored; rerun with --fetch=N",
      });
      continue;
    }
    const quote = siteIdentity(home.doc, { name: club.name, acronym: club.acronym, aliases: [...club.aliases] });
    if (!quote) {
      review.push({
        slug: lead.slug,
        site: lead.root,
        via: `${lead.via} ("${lead.anchor}")`,
        reason: `home page doesn't name the club (title: ${(home.doc.title ?? "").slice(0, 60)})`,
      });
      continue;
    }
    accepted.push({ slug: lead.slug, site: lead.root, via: lead.via, quote });
    siteOwner.set(key, lead.clubId);
    if (opts.dryRun) continue;
    const value = { kind: "website", url: lead.root };
    await upsertClaim(
      db,
      { clubId: lead.clubId, fieldKey: "club.link", value, assertionKind: "stated" },
      {
        sourceId: home.sourceId,
        sourceType: "public_web",
        snapshotId: home.snapshotId,
        ingestionRunId: runId,
        observedAt: home.fetchedAt,
        quote,
        locator: { url: home.doc.url, signal: "page title names the club", foundVia: "link-graph", referrer: lead.via },
        extractionMethod: "html_parse",
        extractorName: SITE_IDENTITY_EXTRACTOR,
        extractorVersion: `link-graph-${LINK_GRAPH_EXTRACTOR.version}`,
        isDirect: true,
      },
    );
    if (lead.refSourceId && lead.refSnapshotId)
      // The referring page names the club in the link itself: evidence at that page's tier.
      await upsertClaim(
        db,
        { clubId: lead.clubId, fieldKey: "club.link", value, assertionKind: "stated" },
        {
          sourceId: lead.refSourceId,
          sourceType: lead.refType as "public_web",
          snapshotId: lead.refSnapshotId,
          ingestionRunId: runId,
          observedAt: lead.refAt,
          quote: lead.anchor,
          locator: { url: lead.via, signal: "linked by the club's name" },
          extractionMethod: "html_parse",
          extractorName: LINK_GRAPH_EXTRACTOR.name,
          extractorVersion: LINK_GRAPH_EXTRACTOR.version,
          isDirect: true,
        },
      );
    touched.add(lead.clubId);
  }

  // References to sites clubs already have: one evidence row per referring page.
  const referenced: LinkGraphResult["referenced"] = [];
  const refSeen = new Set<string>();
  for (const r of references) {
    if (!r.refSourceId || !r.refSnapshotId) continue;
    const k = `${r.clubId}|${r.root}|${r.refSourceId}`;
    if (refSeen.has(k)) continue;
    refSeen.add(k);
    referenced.push({ slug: r.slug, site: r.root, via: r.via, tier: r.refTier });
    if (opts.dryRun) continue;
    await upsertClaim(
      db,
      { clubId: r.clubId, fieldKey: "club.link", value: { kind: "website", url: r.root }, assertionKind: "stated" },
      {
        sourceId: r.refSourceId,
        sourceType: r.refType as "public_web",
        snapshotId: r.refSnapshotId,
        ingestionRunId: runId,
        observedAt: r.refAt,
        quote: r.anchor,
        locator: { url: r.via, signal: "linked by the club's name" },
        extractionMethod: "html_parse",
        extractorName: LINK_GRAPH_EXTRACTOR.name,
        extractorVersion: LINK_GRAPH_EXTRACTOR.version,
        isDirect: true,
      },
    );
    touched.add(r.clubId);
  }

  const socials: LinkGraphResult["socials"] = [];
  const socialSeen = new Set<string>();
  for (const s of socialLeads) {
    if (socialSeen.has(`${s.clubId}|${s.url}`) || rejectedUrls.has(`${s.clubId}|${siteKey(s.url) ?? ""}`)) continue;
    socialSeen.add(`${s.clubId}|${s.url}`);
    socials.push({ slug: s.slug, url: s.url, via: s.via });
    if (opts.dryRun || !s.refSourceId || !s.refSnapshotId) continue;
    const handle = new URL(s.url).pathname.split("/").filter(Boolean)[0] ?? null;
    const kind = new URL(s.url).hostname.replace(/^www\./, "").split(".")[0] ?? "";
    await upsertClaim(
      db,
      {
        clubId: s.clubId,
        fieldKey: "club.link",
        value: { kind: kind === "twitter" ? "x" : kind, url: s.url, ...(handle ? { handle } : {}) },
        assertionKind: "stated",
      },
      {
        sourceId: s.refSourceId,
        sourceType: s.refType as "public_web",
        snapshotId: s.refSnapshotId,
        ingestionRunId: runId,
        observedAt: s.refAt,
        quote: s.anchor,
        locator: { url: s.via, signal: "linked by the club's name" },
        extractionMethod: "html_parse",
        extractorName: LINK_GRAPH_EXTRACTOR.name,
        extractorVersion: LINK_GRAPH_EXTRACTOR.version,
        isDirect: true,
      },
    );
    touched.add(s.clubId);
  }

  if (!opts.dryRun) await resolveClubs(db, { clubIds: [...touched], now: now() });
  const reportPath = join(findRepoRoot(), "data", "reports", "link-candidates.md");
  await mkdir(join(findRepoRoot(), "data", "reports"), { recursive: true });
  const md = [
    "# Link-graph candidates",
    "",
    `Generated ${now().toISOString()} by \`pnpm hci link-graph${opts.dryRun ? " --dry-run" : ""}\` (ADR 0038). Leads come from`,
    "links on stored pages whose text is a club's exact name, and from stored home pages no club owns.",
    "A website is attached only when its own home page names the club (`siteIdentity`).",
    "",
    `## ${opts.dryRun ? "Would attach" : "Attached"} (${accepted.length})`,
    "",
    "| Club | Site | Found via | Home page heading |",
    "|---|---|---|---|",
    ...accepted.map((a) => `| ${a.slug} | ${a.site} | ${a.via} | ${a.quote.replace(/\|/g, "/")} |`),
    "",
    `## Existing sites linked by the club's name elsewhere (${referenced.length})`,
    "",
    ...referenced.map((r) => `- ${r.slug}: ${r.site} (tier ${r.tier}: ${r.via})`),
    "",
    `## Social accounts from Harvard-affiliated pages (${socials.length})`,
    "",
    ...socials.map((s) => `- ${s.slug}: ${s.url} (on ${s.via})`),
    "",
    `## For review (${review.length})`,
    "",
    "| Club | Site | Found via | Why not attached |",
    "|---|---|---|---|",
    ...review.map((r) => `| ${r.slug} | ${r.site} | ${r.via.replace(/\|/g, "/")} | ${r.reason.replace(/\|/g, "/")} |`),
    "",
  ].join("\n");
  await writeFile(reportPath, md);
  Object.assign(counters, {
    accepted: accepted.length,
    socials: socials.length,
    referenced: referenced.length,
    review: review.length,
    ...crawl,
  });
  await finishRun(db, runId, { status: "succeeded", counters });
  return { runId, accepted, socials, referenced, review, reportPath, counters };
}
