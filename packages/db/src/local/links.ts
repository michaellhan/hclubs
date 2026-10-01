import type { LinkKind } from "@hci/core/browser";

/**
 * Which of a club's links go in the profile's icon bar, and which go in the short
 * "More links" list. Pure, browser-safe. Every non-rejected link is shown somewhere;
 * status only orders the choice (verified > probable > unverified, then confidence).
 */
export interface RankableLink {
  kind: LinkKind;
  url: string;
  handle: string | null;
  label: string | null;
  status: "verified" | "probable" | "unverified";
  confidence: number;
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

export function pickLinkBar<T extends RankableLink>(
  links: readonly T[],
  preferredApplyUrl?: string | null,
): LinkBar<T> {
  const icons = LINK_BAR_KINDS.flatMap((k) => bestOfKind(links, k));
  const applyCandidates = links
    .filter((l) => APPLY_KINDS.includes(l.kind))
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
  return {
    apply,
    icons,
    rest: links.filter(
      (l) =>
        !featured.has(l) &&
        !icons.some((i) => i.kind === l.kind && i.url === l.url) &&
        !(l.kind === "website" && shownHosts.has(siteHost(l.url))),
    ),
  };
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
