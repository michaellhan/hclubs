import { namedRoundOver, type LinkKind } from "@hci/core/browser";

/**
 * Which of a club's links go in the profile's icon bar, and which go in the short
 * "More links" list. Pure, browser-safe. Every non-rejected link is shown somewhere, except
 * an unverified social account beside a verified one of the same kind; status otherwise
 * only orders the choice (verified > probable > unverified, then confidence).
 */
export interface RankableLink {
  kind: LinkKind;
  url: string;
  handle: string | null;
  label: string | null;
  status: "verified" | "probable" | "unverified";
  confidence: number;
  /**
   * The term an application link's own words name (its label or the form's title, e.g. "Fall
   * 2026 Comp Interest Form" → "2026-fall"; `termNamedInText`), when they name one. Only the
   * term key is kept, never the title.
   */
  term?: string | null;
}

/** Icon-bar order. Harvard directory pages and "other" links stay in "More links". */
export const LINK_BAR_KINDS = [
  "website",
  "instagram",
  "linkedin",
  "facebook",
  "x",
  "youtube",
  "tiktok",
  "github",
  "discord",
  "link_in_bio",
  "email",
  "newsletter",
  "mailing_list",
] as const satisfies readonly LinkKind[];

const APPLY_KINDS: readonly LinkKind[] = ["application_form", "application_page"];
const SOCIAL_KINDS: readonly LinkKind[] = ["instagram", "linkedin", "facebook", "x", "youtube", "tiktok"];
const STATUS_RANK = { verified: 0, probable: 1, unverified: 2 } as const;
const GENERIC_MAILBOX = /^(info|contact|hello|board|team|admin)@/i;
const APPLY_WORDS = /\b(apply|applications?|comp|recruit\w*|join|interest|sign ?-?up|audition|tryouts?)\b/i;

function byStrength<T extends RankableLink>(extra: (l: T) => number = () => 0) {
  return (a: T, b: T): number =>
    STATUS_RANK[a.status] - STATUS_RANK[b.status] ||
    b.confidence - a.confidence ||
    extra(a) - extra(b) ||
    a.url.length - b.url.length ||
    a.url.localeCompare(b.url);
}

/** Host without `www.`, for "is this the same site?" checks; null for unparseable URLs. */
export function siteHost(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return null;
  }
}

/** The best link of each kind, ranked. Websites: up to two, only when they are different sites. */
function bestOfKind<T extends RankableLink>(links: readonly T[], kind: LinkKind): T[] {
  const ranked = links
    .filter((l) => l.kind === kind)
    .sort(
      byStrength<T>((l) =>
        kind === "email" && GENERIC_MAILBOX.test(l.handle ?? l.url.replace(/^mailto:/, "")) ? 0 : 1,
      ),
    );
  if (kind !== "website") return ranked.slice(0, 1);
  // A deep page (an article or subpage cited somewhere) stands for its site: link the
  // site's home page, and prefer links that already are one.
  const byRoot = [...ranked].sort((a, b) => Number(!isSiteRoot(a.url)) - Number(!isSiteRoot(b.url)));
  const out: T[] = [];
  const hosts = new Set<string | null>();
  for (const l of byRoot) {
    const host = siteHost(l.url);
    if (hosts.has(host)) continue;
    hosts.add(host);
    out.push(isSiteRoot(l.url) ? l : { ...l, url: siteRootOf(l.url) });
    if (out.length === 2) break;
  }
  return out;
}

/** Shared hosts where a club's site is a path, not the whole host. */
const PATH_SITES = /^(sites\.google\.com|github\.com|[^.]+\.github\.io|linktr\.ee|[^.]+\.wixsite\.com)$/i;
/**
 * Hosts many organizations share (Harvard servers, school directories): a page there stands
 * only for itself. Its host root is someone else's site — "sites.harvard.edu/stahr" must not
 * become "sites.harvard.edu" (ADR 0033).
 */
const SHARED_HOSTS = /(^|\.)(harvard\.edu|hbs\.edu|campuslabs\.com|campusgroups\.com|igem\.org)$/i;

export function isSiteRoot(url: string): boolean {
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^www\./, "");
    if (SHARED_HOSTS.test(host)) return true;
    const depth = u.pathname.split("/").filter(Boolean).length;
    return !u.search && (depth === 0 || (PATH_SITES.test(host) && depth <= 2));
  } catch {
    return false;
  }
}

/** https://host/ for a page URL (keeping the site path on shared hosts). */
export function siteRootOf(url: string): string {
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^www\./, "");
    if (SHARED_HOSTS.test(host)) return url;
    if (PATH_SITES.test(host)) {
      const segs = u.pathname
        .split("/")
        .filter(Boolean)
        .slice(0, host === "sites.google.com" ? 2 : 1);
      return `https://${u.hostname}/${segs.join("/")}${segs.length ? "/" : ""}`;
    }
    return `https://${u.hostname}/`;
  } catch {
    return url;
  }
}

/**
 * A website's display label: its host, plus the path on a shared host, where the host alone
 * names someone else's site ("sites.harvard.edu/stahr", not "sites.harvard.edu"). PURE.
 */
export function siteLabel(url: string): string | null {
  const host = siteHost(url);
  if (!host || !SHARED_HOSTS.test(host)) return host;
  try {
    const path = new URL(url).pathname.replace(/\/+$/, "");
    const label = `${host}${path}`;
    return label.length > 48 ? `${label.slice(0, 47)}…` : label;
  } catch {
    return host;
  }
}

export interface LinkBar<T extends RankableLink> {
  /** The one application link to feature as an "Apply" button, if any. */
  apply: T | null;
  /** One icon per kind, in LINK_BAR_KINDS order (websites may appear twice). */
  icons: T[];
  /** Everything else (directory listings, extra emails, other application pages, …). */
  rest: T[];
}

/**
 * A link whose own words name a round that is over on `now` ("Fall 2026 Comp Interest Form"
 * on Oct 12, 2026; `namedRoundOver`): last round's form, never today's "How to apply". PURE.
 */
export function namesPastRound(link: Pick<RankableLink, "term">, now: Date): boolean {
  return Boolean(link.term && namedRoundOver(link.term, now));
}

/**
 * Picks the featured application link and the icon bar. With `now`, an application link that
 * names a round already over (`namesPastRound`) is never featured unless it is the current
 * round's own link (`preferredApplyUrl`): it stays in "More links", and the profile points at
 * the club's own channel instead (ADR 0051 amendment, 2026-10-12).
 */
export function pickLinkBar<T extends RankableLink>(
  links: readonly T[],
  preferredApplyUrl?: string | null,
  now?: Date,
): LinkBar<T> {
  const icons = LINK_BAR_KINDS.flatMap((k) => bestOfKind(links, k));
  const applyCandidates = links
    .filter((l) => APPLY_KINDS.includes(l.kind))
    .filter((l) => !now || l.url === preferredApplyUrl || !namesPastRound(l, now))
    .sort(
      byStrength<T>(
        (l) =>
          (preferredApplyUrl && l.url === preferredApplyUrl ? 0 : 4) +
          (APPLY_WORDS.test(l.label ?? "") || APPLY_WORDS.test(l.url) ? 0 : 2) +
          (l.kind === "application_form" ? 0 : 1),
      ),
    );
  const apply = applyCandidates[0] ?? null;
  const featured = new Set<T>([...icons, ...(apply ? [apply] : [])]);
  // Other pages of a site already shown as an icon add nothing.
  const shownHosts = new Set(icons.filter((l) => l.kind === "website").map((l) => siteHost(l.url)));
  // A search-matched account beside one the club itself links (or an editor confirmed) is
  // almost always a wrong guess (@harvardpoker beside the club's @harvardundergradpoker).
  const confirmedSocial = new Set(
    icons.filter((l) => SOCIAL_KINDS.includes(l.kind) && l.status === "verified").map((l) => l.kind),
  );
  // One Facebook page has several addresses (/p/<Name>-<id>, /people/<Name>/<id>, /<id>, and
  // the page's renamed /p/ slug): the same numeric id is the same page.
  const shownFacebookIds = new Set(
    icons
      .filter((l) => l.kind === "facebook")
      .map((l) => facebookPageId(l.url))
      .filter(Boolean),
  );
  return {
    apply,
    icons,
    rest: links.filter(
      (l) =>
        !featured.has(l) &&
        !icons.some((i) => i.kind === l.kind && i.url === l.url) &&
        !(l.kind === "website" && shownHosts.has(siteHost(l.url))) &&
        !(l.status === "unverified" && confirmedSocial.has(l.kind)) &&
        !(l.kind === "facebook" && shownFacebookIds.has(facebookPageId(l.url))),
    ),
  };
}

/** The numeric page id in a Facebook page URL (`/p/Name-123…`, `/people/Name/123…`, `/123…`), or null. PURE. */
export function facebookPageId(url: string): string | null {
  try {
    const u = new URL(url);
    if (!/(^|\.)(facebook|fb)\.com$/i.test(u.hostname)) return null;
    const id = u.searchParams.get("id") ?? /(?:^|[/-])(\d{9,})\/?$/.exec(u.pathname)?.[1] ?? null;
    return id && /^\d{9,}$/.test(id) ? id : null;
  } catch {
    return null;
  }
}

const JOIN_PAGE_WORDS = /\b(comp|join|recruit\w*|apply|applications?|audition|tryouts?|get-?involved)\b/i;

/**
 * The club's own page about joining, among the pages we read: a page on the same site as
 * `siteUrl` whose path or title says comp/join/recruiting/apply. Newest read first; a page
 * whose path or title carries a year more than a year back (a 2008 /join) is passed over.
 * Null when none. PURE.
 */
export function pickJoinPage(
  siteUrl: string,
  sources: readonly { url: string; title: string | null; lastObservedAt: string }[],
  now: Date,
): string | null {
  const host = siteHost(siteUrl);
  if (!host) return null;
  const stale = (text: string) =>
    (text.match(/\b(?:19|20)\d{2}\b/g) ?? []).some((y) => Number(y) < now.getFullYear() - 1);
  const paths = new Map<string, string>();
  for (const s of sources) {
    if (siteHost(s.url) !== host) continue;
    try {
      paths.set(s.url, new URL(s.url).pathname);
    } catch {
      /* unparseable: skipped */
    }
  }
  const ok = sources
    .filter((s) => {
      const path = paths.get(s.url);
      if (path === undefined || path.replace(/\//g, "") === "") return false;
      const text = `${path} ${s.title ?? ""}`;
      return (JOIN_PAGE_WORDS.test(path.replace(/[_/-]/g, " ")) || JOIN_PAGE_WORDS.test(s.title ?? "")) && !stale(text);
    })
    .sort((a, b) => b.lastObservedAt.localeCompare(a.lastObservedAt) || a.url.length - b.url.length);
  return ok[0]?.url ?? null;
}

/** Just the website + Instagram, for the compact directory index. */
export function pickQuickLinks(links: readonly RankableLink[]): { website: string | null; instagram: string | null } {
  return {
    website: bestOfKind(links, "website")[0]?.url ?? null,
    instagram: bestOfKind(links, "instagram")[0]?.url ?? null,
  };
}

/** "@handle" for a social profile URL (last path segment), or null. */
export function socialHandle(url: string, handle?: string | null): string | null {
  if (handle) return handle.startsWith("@") ? handle : `@${handle}`;
  try {
    const seg = new URL(url).pathname
      .split("/")
      .filter((s) => s.length > 0)
      .pop();
    return seg ? `@${seg.replace(/^@/, "")}` : null;
  } catch {
    return null;
  }
}
