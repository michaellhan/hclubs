import { and, desc, eq } from "drizzle-orm";
import { normalizeName, normalizeUrl, siteKey, type SourceType } from "@hci/core";
import { recordFetchAttempt, recordSnapshot, schema, upsertSource, type Db } from "@hci/db";
import type { Logger } from "../logger";
import type { PageRole } from "../extract/deterministic";
import { isLegalPageUrl } from "../extract/evidence-rules";
import { htmlToDocument, type PageDocument } from "../parse/document";
import { scoreRecruitingLink } from "../recruiting/signals";
import type { SnapshotStore } from "../snapshots/store";
import { siteKeyMentionsClub, type ClubNames } from "../sites/candidates";
import type { SourceFetcher } from "../types";

/**
 * Shallow, prioritized crawler for a club's own website (M2 §5). Never recursive beyond
 * `maxDepth`, never leaves the site boundary, skips binaries, dedupes by content hash,
 * honors per-page freshness windows, and records every attempt.
 */

export interface CrawledPage {
  url: string;
  role: PageRole;
  depth: number;
  sourceId: string;
  sourceType: SourceType;
  snapshotId: string;
  fetchedAt: Date;
  doc: PageDocument;
  /** New content since the last snapshot (false for 304 / identical hash / fresh reuse). */
  changed: boolean;
  /**
   * A stored page re-read only to re-check what it already said (enrich step 4): claims from
   * it are written only when they repeat an active claim this page already supports.
   */
  confirmOnly?: boolean;
}

export interface CrawlStats {
  pagesFetched: number;
  pagesUnchanged: number;
  pagesSkippedFresh: number;
  pagesFailed: number;
  pagesNeedBrowser: number;
  pagesRobotsBlocked: number;
}

export const emptyCrawlStats = (): CrawlStats => ({
  pagesFetched: 0,
  pagesUnchanged: 0,
  pagesSkippedFresh: 0,
  pagesFailed: 0,
  pagesNeedBrowser: 0,
  pagesRobotsBlocked: 0,
});

const BINARY =
  /\.(pdf|jpe?g|png|gif|webp|svg|ico|zip|gz|docx?|xlsx?|pptx?|mp[34]|m4a|mov|avi|wav|ics|dmg|exe|css|js|json|xml|rss)(\?|$)/i;

/** Shop/account chrome on hosted builders (Squarespace /cart etc.): never club content. */
const JUNK_PATH = /\/(cart|checkout|account|login|log-in|signin|sign-in|search|tag|category|feed)(\/|\?|$)/i;

const ROLE_PATTERNS: [PageRole, RegExp, number][] = [
  ["recruiting", /\b(apply|applications?|recruit(?:ing|ment)?|comp(?:ing)?|auditions?|tryouts?|join-?us-?now)\b/i, 10],
  ["join", /\b(join|get-?involved|membership|become-a-member|how-to-join)\b/i, 9],
  ["about", /\b(about|mission|who-?we-?are|our-?story|history)\b/i, 8],
  ["faq", /\b(faq|frequently-asked|questions)\b/i, 7],
  ["projects", /\b(projects?|our-?work|portfolio|clients|publications?|performances?|competitions?|programs?)\b/i, 5],
  ["sponsors", /\b(sponsors?|partners?|supporters|donors)\b/i, 5],
  ["events", /\b(events?|calendar|speakers?)\b/i, 4],
  ["team", /\b(team|board|leadership|officers|people|staff|members|executive)\b/i, 3],
  ["contact", /\b(contact|connect)\b/i, 2],
];

const ROLE_APPLICATION_PAGE =
  /\b(?:lead-with-us|become-an?-leader|apply-to-lead|leader-?(?:training|applications?|program)|trip-?leaders?|(?:board|exec(?:utive)?(?:-board)?|staff|officer)-?applications?)\b/i;

const RECRUITING_ROLES = new Set<PageRole>(["recruiting", "join", "faq"]);

/**
 * Recruiting season at Harvard (America/New_York): mid-August through October, and
 * mid-January through February. Joining pages are rechecked daily then. PURE.
 */
export function inRecruitingSeason(now: Date): boolean {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", month: "numeric", day: "numeric" })
    .formatToParts(now)
    .reduce<Record<string, number>>(
      (acc, p) => (p.type === "literal" ? acc : { ...acc, [p.type]: Number(p.value) }),
      {},
    );
  const md = (parts.month ?? 0) * 100 + (parts.day ?? 0);
  return (md >= 815 && md <= 1031) || (md >= 110 && md <= 228);
}

export function classifyPageRole(url: string, anchorText = "", title = ""): PageRole {
  let path = "";
  try {
    path = new URL(url).pathname.replace(/[_/]+/g, "-");
  } catch {
    return "other";
  }
  if (path === "" || path === "-" || /^-(index|home)(\.html?)?-?$/i.test(path)) return "home";
  const hay = `${path} ${anchorText} ${title}`;
  // Applications to lead (trip leaders, the board, staff) are roles, not membership: such a
  // page's "Apply here!!", deadline and stages aren't how members join (ADR 0044).
  // A policy page is never the club describing itself, whatever its path or link text.
  if (isLegalPageUrl(url)) return "other";
  if (ROLE_APPLICATION_PAGE.test(`${path} ${anchorText.replace(/\s+/g, "-")}`)) return "team";
  for (const [role, re] of ROLE_PATTERNS) if (re.test(hay)) return role;
  return "other";
}

/** In a recruiting-focused crawl every followed page is a joining or recruiting page. */
function focusRole(url: string, text: string): PageRole {
  const role = classifyPageRole(url, text);
  return role === "recruiting" || role === "join" || role === "faq" ? role : "join";
}

const rolePriority = (role: PageRole) => ROLE_PATTERNS.find(([r]) => r === role)?.[2] ?? (role === "home" ? 11 : 0);

/**
 * Whether a club's site is one page or folder on a host that isn't the club's (ADR 0040):
 * an HBS club page on hbs.edu, a chapter's "/harvard.html" on a national foundation's site.
 * Such a crawl stays under that path; otherwise MBA admissions dates and other chapters'
 * pages counted as the club's own. A deep link on the club's own domain
 * (harvardradcliffeorchestra.org/about-hro) still crawls the whole site. PURE.
 */
export function pathScopedRoot(rootUrl: string, club: ClubNames): boolean {
  let u: URL;
  try {
    u = new URL(rootUrl);
  } catch {
    return false;
  }
  // A sites.harvard.edu folder is one group's site among hundreds: crawl only that folder.
  if (isHarvardFolderHost(u.hostname)) return u.pathname.split("/").some(Boolean);
  const path = scopeBase(u.pathname);
  // "/about", "/home": a page of the club's own host, not a folder on someone else's.
  if (!path || /^\/(index|home|about|about-us|welcome|main|en)$/i.test(path)) return false;
  // Shared hosts already key on their path (sites.google.com/view/x, HCS "~name").
  if (siteKey(rootUrl) !== u.hostname.replace(/^www\./, "")) return false;
  // A page named for the club on a host it shares with sibling groups: the Institute of 1770's
  // hastypudding.org/hasty-pudding-club beside /hasty-pudding-theatricals and the Theatricals' /comp.
  const last = (path.split("/").pop() ?? "").toLowerCase();
  const asSlug = (n: string) => normalizeName(n).replace(/ /g, "-");
  if ([club.name, ...club.aliases].some((n) => asSlug(n).includes("-") && asSlug(n) === last)) return true;
  // A chapter's page on a national site: ".../harvard", "/harvard.html", "/harvard-chapter".
  if (/\/harvard([_-](chapter|university|college))?(\.\w+)?$/i.test(u.pathname.replace(/\/+$/, ""))) return true;
  return !siteKeyMentionsClub(u.hostname, club);
}

/** The folder a scoped crawl stays in: the root's path without a trailing "/index.php". PURE. */
function scopeBase(pathname: string): string {
  return pathname.replace(/\/+$/, "").replace(/\/(index|default)\.\w+$/i, "");
}

/** Harvard hosts whose first path segment is a site of its own (sites.harvard.edu/<club>). PURE. */
export function isHarvardFolderHost(hostname: string): boolean {
  return hostname.replace(/^www\./, "").toLowerCase() === "sites.harvard.edu";
}

/** A scoped crawl's folder: on a folder host the site's own folder, even from a deeper root page. PURE. */
function scopeFolder(root: URL): string {
  const first = root.pathname.split("/").find(Boolean);
  return isHarvardFolderHost(root.hostname) && first ? `/${first}` : scopeBase(root.pathname);
}

/**
 * Whether a URL's site is one folder on a host many groups share, which `siteKey` keys by host
 * + path (Google Sites, sites.harvard.edu, HCS "~name", PBHA programs, Wix): such a site is
 * that folder and nothing beside it. PURE.
 */
export function isSharedHostFolder(url: string): boolean {
  const key = siteKey(url);
  return key !== null && key.includes("/");
}

/** Same-site test honoring shared hosts (sites.google.com/view/x etc.); `scoped`: stay under the root's path. */
export function sameSite(rootUrl: string, url: string, scoped = false): boolean {
  if (scoped) {
    try {
      const ra = new URL(rootUrl);
      const rb = new URL(url);
      const base = scopeFolder(ra);
      return (
        ra.hostname.replace(/^www\./, "") === rb.hostname.replace(/^www\./, "") &&
        (rb.pathname.replace(/\/+$/, "") === base || rb.pathname.startsWith(`${base}/`))
      );
    } catch {
      return false;
    }
  }
  const a = siteKey(rootUrl);
  const b = siteKey(url);
  if (a && b && a === b) return true;
  // A folder on a shared host (sites.google.com/view/x, sites.harvard.edu/x, hcs.harvard.edu/~x,
  // pbha.org/programs/x, x.wixsite.com/site) is the whole site: never a sibling folder
  // (/view/y), which the path-prefix fallback below let in whenever the root was the folder.
  if (isSharedHostFolder(rootUrl)) return false;
  try {
    const ra = new URL(rootUrl);
    const rb = new URL(url);
    // Unknown shared hosts: stay under the root path prefix.
    return (
      ra.hostname.replace(/^www\./, "") === rb.hostname.replace(/^www\./, "") &&
      rb.pathname.startsWith(ra.pathname.replace(/\/[^/]*$/, "/"))
    );
  } catch {
    return false;
  }
}

export async function crawlSite(input: {
  rootUrl: string;
  clubId: string;
  /** Pages of a verified official site are owned by the club (tier 2); others are public web. */
  officialSite: boolean;
  /** Follow only pages under the root's path (`pathScopedRoot`). */
  scopeToPath?: boolean;
  /** Override the source type (e.g. a Harvard directory's page about the club). */
  sourceTypeOverride?: SourceType;
  db: Db;
  fetcher: SourceFetcher;
  store: SnapshotStore;
  runId: string;
  logger: Logger;
  now: () => Date;
  maxPages: number;
  maxDepth: number;
  freshnessMs: number;
  /** Shorter window for joining/recruiting pages (deadlines move during recruiting season). */
  recruitingFreshnessMs?: number | undefined;
  force: boolean;
  stats: CrawlStats;
  /** A browser fallback is active: refetch pages flagged `needs_browser` instead of reusing them. */
  retryBrowserPages?: boolean;
  /** Same-site pages to consider as if linked from the home page (e.g. sitemap hints). */
  extraSeeds?: readonly string[];
  /** Treat every fetched page as this role (e.g. an application form is "recruiting"). */
  roleOverride?: PageRole;
  /** The root page's role when it is not the site's home page (default "home"). */
  rootRole?: PageRole;
  /**
   * Stored pages only (`enrich --offline`): a page with a stored snapshot is read from the
   * snapshot store whatever its age; anything else is skipped without a request or a
   * fetch-attempt row (so offline runs never look like dead links to the audit).
   */
  offline?: boolean;
  /**
   * "recruiting": follow only links that score as joining/recruiting pages (ADR 0031), best
   * first, instead of a general shallow crawl. The home page is always read for its links.
   */
  focus?: "recruiting";
  /**
   * Request the root exactly as given (trailing slash kept) instead of its normalized form.
   * Some hosts serve another page without the slash: soco.college.harvard.edu answers
   * "/clubsports/club-sport-organizations" with the CampusGroups portal shell (round 4).
   */
  fetchRootAsGiven?: boolean;
}): Promise<CrawledPage[]> {
  const { db, fetcher, store, stats, logger } = input;
  const root = normalizeUrl(input.rootUrl);
  if (!root) return [];
  const sourceType: SourceType = input.sourceTypeOverride ?? (input.officialSite ? "club_website" : "public_web");
  const queue: { url: string; depth: number; role: PageRole; priority: number }[] = [
    { url: root, depth: 0, role: input.rootRole ?? "home", priority: 100 },
  ];
  const seen = new Set<string>([root]);
  for (const seed of input.extraSeeds ?? []) {
    const u = normalizeUrl(seed);
    if (!u || seen.has(u) || BINARY.test(u) || JUNK_PATH.test(u) || !sameSite(root, u, input.scopeToPath)) continue;
    if (input.focus === "recruiting" && scoreRecruitingLink(u) === 0) continue;
    seen.add(u);
    const role = classifyPageRole(u);
    queue.push({
      url: u,
      depth: 1,
      role: input.focus === "recruiting" ? focusRole(u, "") : role,
      priority: input.focus === "recruiting" ? 20 + scoreRecruitingLink(u) : rolePriority(role) - 1,
    });
  }
  const hashes = new Set<string>();
  const pages: CrawledPage[] = [];

  // Failure budget is per site. (`stats` is shared by the whole run: using its counter here
  // meant a few dead sites early in a run stopped every later crawl.)
  let failures = 0;
  while (queue.length > 0 && pages.length + failures < input.maxPages * 2 && pages.length < input.maxPages) {
    queue.sort((a, b) => b.priority - a.priority || a.depth - b.depth);
    const next = queue.shift();
    if (!next) break;

    const sourceId = await upsertSource(db, {
      url: next.url,
      sourceType,
      ownerClubId: input.officialSite ? input.clubId : null,
      adapter: "site-crawler",
      title: null,
    });
    // An application form read as "recruiting" must not be stored as a "home" page (summaries
    // read home/about pages).
    await db
      .update(schema.source)
      .set({ pageRole: input.roleOverride ?? next.role })
      .where(eq(schema.source.id, sourceId));
    const [src] = await db.select().from(schema.source).where(eq(schema.source.id, sourceId));
    const [previous] = await db
      .select()
      .from(schema.sourceSnapshot)
      .where(eq(schema.sourceSnapshot.sourceId, sourceId))
      .orderBy(desc(schema.sourceSnapshot.fetchedAt))
      .limit(1);

    // A JS-only page whose newest copy is a static empty shell: read its stored browser render
    // when reusing a stored copy (offline replays, fresh pages, 304s), never the shell, which
    // says nothing and made the page's claims look unreproduced. A newer static copy with real
    // content (other jobs fetch statically without clearing the flag) wins over an old render,
    // and reading it clears the flag below.
    const shell =
      src?.needsBrowser === true &&
      previous !== undefined &&
      previous.fetchMethod !== "browser" &&
      htmlToDocument(new TextDecoder().decode(await store.get(previous.storageKey)), next.url).looksJsRendered;
    const [render] = shell
      ? await db
          .select()
          .from(schema.sourceSnapshot)
          .where(and(eq(schema.sourceSnapshot.sourceId, sourceId), eq(schema.sourceSnapshot.fetchMethod, "browser")))
          .orderBy(desc(schema.sourceSnapshot.fetchedAt))
          .limit(1)
      : [];
    const stored = render ?? previous;

    let body: string | null = null;
    let snapshotId: string | null = null;
    let fetchedAt = input.now();
    let changed = false;
    const retry = input.retryBrowserPages === true && src?.needsBrowser === true;
    const fresh =
      !input.force &&
      !retry &&
      previous &&
      src?.lastFetchedAt &&
      input.now().getTime() - src.lastFetchedAt.getTime() <
        (input.recruitingFreshnessMs !== undefined &&
        (RECRUITING_ROLES.has(next.role) || input.roleOverride === "recruiting")
          ? Math.min(input.freshnessMs, input.recruitingFreshnessMs)
          : input.freshnessMs);

    if ((fresh || input.offline) && stored) {
      body = new TextDecoder().decode(await store.get(stored.storageKey));
      snapshotId = stored.id;
      fetchedAt = stored.fetchedAt;
      stats.pagesSkippedFresh++;
    } else if (input.offline) {
      continue;
    } else {
      const res = await fetcher.fetch(
        { url: input.fetchRootAsGiven && next.depth === 0 ? input.rootUrl.trim() : next.url, sourceType },
        input.force || retry
          ? undefined
          : { etag: previous?.etag ?? null, lastModified: previous?.lastModified ?? null },
      );
      let snapIsNew = false;
      if (res.status === "ok" && res.body) {
        const put = await store.put(res.body);
        body = new TextDecoder().decode(res.body);
        const doc0 = htmlToDocument(body, res.finalUrl);
        const snap = await recordSnapshot(db, {
          sourceId,
          ingestionRunId: input.runId,
          fetchedAt: res.fetchedAt,
          finalUrl: res.finalUrl,
          httpStatus: res.httpStatus,
          contentType: res.contentType,
          etag: res.etag,
          lastModified: res.lastModified,
          contentSha256: put.sha256,
          byteSize: put.byteSize,
          storageKey: put.key,
          extractedText: doc0.text.slice(0, 200_000),
          fetchMethod: res.method,
        });
        snapshotId = snap.snapshotId;
        snapIsNew = snap.isNew;
        fetchedAt = res.fetchedAt;
        changed = snap.isNew;
        if (snap.isNew) stats.pagesFetched++;
        else stats.pagesUnchanged++;
      } else if (res.status === "not_modified" && stored) {
        body = new TextDecoder().decode(await store.get(stored.storageKey));
        snapshotId = stored.id;
        fetchedAt = render ? render.fetchedAt : res.fetchedAt; // a render is as old as it is
        stats.pagesUnchanged++;
        await db.update(schema.source).set({ lastFetchedAt: res.fetchedAt }).where(eq(schema.source.id, sourceId));
      } else if (res.status === "robots_disallowed") {
        stats.pagesRobotsBlocked++;
      } else {
        stats.pagesFailed++;
        failures++;
        logger.debug({ url: next.url, status: res.status, error: res.error }, "page fetch failed");
      }
      await recordFetchAttempt(db, {
        sourceId,
        ingestionRunId: input.runId,
        url: next.url,
        status: res.status,
        httpStatus: res.httpStatus,
        errorMessage: res.error,
        attempts: res.attempts,
        durationMs: res.durationMs,
        snapshotId: snapIsNew || res.status === "ok" ? snapshotId : null,
      });
    }
    if (body === null || snapshotId === null) continue;

    const doc = htmlToDocument(body, next.url);
    if (doc.looksJsRendered) {
      stats.pagesNeedBrowser++;
      await db.update(schema.source).set({ needsBrowser: true }).where(eq(schema.source.id, sourceId));
      // Still keep outbound links (footer socials are often server-rendered).
    } else if (src?.needsBrowser && snapshotId !== render?.id) {
      // (A stored browser render reads fine; the static page still needs the browser.)
      await db.update(schema.source).set({ needsBrowser: false }).where(eq(schema.source.id, sourceId));
    }
    const [snapRow] = await db
      .select({ sha: schema.sourceSnapshot.contentSha256 })
      .from(schema.sourceSnapshot)
      .where(eq(schema.sourceSnapshot.id, snapshotId));
    if (snapRow && hashes.has(snapRow.sha)) continue; // identical content under another URL
    if (snapRow) hashes.add(snapRow.sha);
    if (doc.title)
      await db
        .update(schema.source)
        .set({ title: doc.title.slice(0, 300) })
        .where(eq(schema.source.id, sourceId));
    pages.push({
      url: next.url,
      role: input.roleOverride ?? next.role,
      depth: next.depth,
      sourceId,
      sourceType,
      snapshotId,
      fetchedAt,
      doc,
      changed,
    });

    if (next.depth >= input.maxDepth) continue;
    for (const link of doc.links) {
      const u = normalizeUrl(link.url);
      if (!u || seen.has(u) || BINARY.test(u) || JUNK_PATH.test(u) || u.startsWith("mailto:")) continue;
      if (!sameSite(root, u, input.scopeToPath)) continue;
      if (input.focus === "recruiting") {
        const score = scoreRecruitingLink(u, link.text);
        if (score === 0) continue;
        seen.add(u);
        queue.push({ url: u, depth: next.depth + 1, role: focusRole(u, link.text), priority: 20 + score - next.depth });
        continue;
      }
      seen.add(u);
      const role = classifyPageRole(u, link.text);
      if (role === "other" && next.depth >= 1) continue;
      queue.push({ url: u, depth: next.depth + 1, role, priority: rolePriority(role) - next.depth });
    }
  }
  return pages;
}
