/**
 * URL normalization and identity. CLAUDE.md §11.1.
 *
 * `normalizeUrl` produces a canonical string for storage/dedup:
 *   - https scheme, lowercase host, no "www.", no default port, no fragment
 *   - tracking parameters removed, remaining query params sorted
 *   - trailing slash removed (except root), duplicate slashes collapsed
 * Path case is preserved (paths are case-sensitive in general); social handles are
 * lowercased separately by `classifyLink`.
 */

const TRACKING_PARAM_PATTERNS: readonly RegExp[] = [
  /^utm_/i,
  /^fbclid$/i,
  /^gclid$/i,
  /^dclid$/i,
  /^msclkid$/i,
  /^igshid$/i,
  /^igsh$/i,
  /^ouid$/i, // Google Forms share links: the form owner's account id
  /^mc_cid$/i,
  /^mc_eid$/i,
  /^_ga$/i,
  /^_gl$/i,
  /^mkt_tok$/i,
  /^ref$/i,
  /^ref_src$/i,
  /^ref_url$/i,
  /^si$/i,
  /^s$/i, // x.com share param
  /^trk$/i,
  /^trackingid$/i,
  /^lipi$/i,
  /^hsctatracking$/i,
  /^__hs/i,
  /^_hs/i,
  /^vero_/i,
  /^oly_/i,
];

export function isTrackingParam(name: string): boolean {
  return TRACKING_PARAM_PATTERNS.some((re) => re.test(name));
}

/** Parse a possibly scheme-less URL. Returns null for garbage or non-http(s)/mailto. */
export function parseUrl(input: string, base?: string): URL | null {
  const trimmed = input.trim();
  if (trimmed === "") return null;
  try {
    const url = base ? new URL(trimmed, base) : new URL(trimmed);
    if (!["http:", "https:", "mailto:"].includes(url.protocol)) return null;
    return url;
  } catch {
    if (!base && /^[a-z0-9.-]+\.[a-z]{2,}(\/|$)/i.test(trimmed)) {
      return parseUrl(`https://${trimmed}`);
    }
    return null;
  }
}

export function stripTrackingParams(url: URL): URL {
  const out = new URL(url.toString());
  for (const key of [...out.searchParams.keys()]) {
    if (isTrackingParam(key)) out.searchParams.delete(key);
  }
  return out;
}

/**
 * Google's "where was this shared from" marker on Docs and Forms links (usp=sharing, sf_link,
 * header, dialog, publish-editor; never pp_url, which marks a prefilled link). Display only: `normalizeUrl` keeps it, so stored link and
 * source identities don't change.
 */
const GOOGLE_SHARE_HOSTS = /^(?:docs|drive)\.google\.com$|^forms\.gle$/i;
const displayOnlyParam = (url: URL, name: string): boolean =>
  // usp=pp_url marks a prefilled form link; it stays with its answers.
  name.toLowerCase() === "usp" && GOOGLE_SHARE_HOSTS.test(url.hostname) && url.searchParams.get(name) !== "pp_url";

/**
 * The URL as given, minus tracking parameters (utm_*, fbclid, a form owner's ouid…) and a Google
 * share marker (usp=…, 2026-10-12). For display. PURE.
 */
export function withoutTrackingParams(input: string): string {
  const parsed = parseUrl(input);
  if (!parsed || parsed.protocol === "mailto:") return input;
  const keys = [...parsed.searchParams.keys()];
  if (!keys.some((k) => isTrackingParam(k) || displayOnlyParam(parsed, k))) return input;
  const out = stripTrackingParams(parsed);
  for (const key of [...out.searchParams.keys()]) if (displayOnlyParam(out, key)) out.searchParams.delete(key);
  return out.toString();
}

export function normalizeUrl(input: string, base?: string): string | null {
  const parsed = parseUrl(input, base);
  if (!parsed) return null;
  if (parsed.protocol === "mailto:") {
    return `mailto:${decodeURIComponent(parsed.pathname).trim().toLowerCase()}`;
  }
  const url = stripTrackingParams(parsed);
  url.protocol = "https:";
  url.hostname = url.hostname
    .toLowerCase()
    .replace(/^www\./, "")
    .replace(/\.$/, "");
  url.port = "";
  url.hash = "";
  url.username = "";
  url.password = "";
  const params = [...url.searchParams.entries()].sort(([a, av], [b, bv]) =>
    a === b ? (av < bv ? -1 : 1) : a < b ? -1 : 1,
  );
  url.search = "";
  for (const [k, v] of params) url.searchParams.append(k, v);
  let path = url.pathname.replace(/\/{2,}/g, "/");
  if (path.length > 1) path = path.replace(/\/+$/, "");
  url.pathname = path;
  let out = url.toString();
  if (url.pathname === "/" && url.search === "") out = out.replace(/\/$/, "");
  return out;
}

/** Lowercased host without "www.". */
export function extractDomain(input: string): string | null {
  const parsed = parseUrl(input);
  if (!parsed || parsed.protocol === "mailto:") return null;
  return parsed.hostname
    .toLowerCase()
    .replace(/^www\./, "")
    .replace(/\.$/, "");
}

/**
 * Hosts where many unrelated organizations share one domain; identity is host + first
 * path segment(s) rather than the host alone.
 */
const SHARED_HOST_PATH_DEPTH: Record<string, number> = {
  "sites.google.com": 2, // sites.google.com/view/<site>
  "sites.harvard.edu": 1,
  "scholar.harvard.edu": 1,
  "hcs.harvard.edu": 1, // hcs.harvard.edu/~club
  "harvard.edu": 1,
  "college.harvard.edu": 2,
  "pbha.org": 2, // pbha.org/programs/<slug>
  "github.com": 1,
  "medium.com": 1,
  "substack.com": 0,
  "wixsite.com": 1,
  "notion.site": 1,
  "linktr.ee": 1,
  "instagram.com": 1,
  "linkedin.com": 2,
  "facebook.com": 1,
  "x.com": 1,
  "twitter.com": 1,
  "tiktok.com": 1,
  "youtube.com": 1,
};

/** Hosts that are never meaningful as an organization's identity by themselves. */
const GENERIC_HOSTS = new Set([
  "docs.google.com",
  "forms.gle",
  "drive.google.com",
  "bit.ly",
  "tinyurl.com",
  "forms.office.com",
  "calendly.com",
  "eventbrite.com",
  "google.com",
]);

/**
 * A key identifying "the site" a URL belongs to, used for entity-resolution matching.
 * Returns null for generic hosts (forms, shorteners) that carry no identity.
 */
export function siteKey(input: string): string | null {
  const normalized = normalizeUrl(input);
  if (!normalized || normalized.startsWith("mailto:")) return null;
  const url = new URL(normalized);
  const host = url.hostname;
  if (GENERIC_HOSTS.has(host)) return null;
  const segments = url.pathname.split("/").filter(Boolean);
  const exact = SHARED_HOST_PATH_DEPTH[host];
  if (exact !== undefined) {
    if (exact === 0) return host;
    if (segments.length < exact) return null; // bare shared host: no identity
    return `${host}/${segments.slice(0, exact).join("/").toLowerCase()}`;
  }
  // Subdomains of shared platforms (foo.github.io, foo.wixsite.com/bar) keep the subdomain.
  if (host.endsWith(".wixsite.com")) {
    return segments[0] ? `${host}/${segments[0].toLowerCase()}` : host;
  }
  return host;
}

/**
 * A subdomain of a club's own site is the club's too (comp.thecrimson.com from
 * thecrimson.com), given the own site's `siteKey`. Never under a path-scoped site
 * (hbs.edu/foundation) or a school's shared host (hbs.edu, hcs.harvard.edu), whose
 * subdomains are other groups' or the school's own: apply.hbs.edu is MBA admissions. PURE.
 */
export function isOwnSubdomain(url: string, ownSiteKey: string): boolean {
  if (ownSiteKey.includes("/")) return false;
  if (ownSiteKey.endsWith(".edu") && ownSiteKey.split(".").length <= 3) return false;
  const key = siteKey(url);
  return key !== null && !key.includes("/") && key.endsWith(`.${ownSiteKey}`);
}

/**
 * Key for duplicate-URL detection: social URLs collapse to platform:handle, other URLs to
 * their normalized form without scheme.
 */
export function urlIdentityKey(input: string, socialKey?: (url: string) => string | null): string | null {
  const social = socialKey?.(input);
  if (social) return social;
  const normalized = normalizeUrl(input);
  if (!normalized) return null;
  return normalized.replace(/^https:\/\//, "");
}

/**
 * A blog post, news item or archived article rather than a page about the club: dated paths
 * ("/2019/10/…", "/blog/2025/1/9/…"), post archives, case studies. Its title or lede is
 * about its own topic ("What if EA has more in common with deontology…"), never the club's
 * description. PURE.
 */
export function isArticleUrl(url: string): boolean {
  let path = "";
  try {
    path = new URL(url).pathname.toLowerCase();
  } catch {
    return false;
  }
  return (
    /\/(?:19|20)\d{2}\/\d{1,2}\//.test(path) ||
    /\/(?:blog|blogs|posts?|articles?|stories|pubarchives|case-stud(?:y|ies))(?:\/|-|$)/.test(path) ||
    /\/news\/[^/]+/.test(path)
  );
}

/**
 * A site's legal or policy page (privacy, terms, reprint permissions, cookies…): never about
 * the club, so nothing on it is evidence of anything (ADR 0044 follow-up). PURE.
 */
export function isLegalPageUrl(url: string): boolean {
  let path = "";
  try {
    path = new URL(url).pathname.toLowerCase();
  } catch {
    return false;
  }
  return /\/(?:privacy(?:-policy|-notice|-choices)?|terms(?:-of-(?:use|service))?|terms-and-conditions|tos|ccpa|permissions|copyright|cookies?(?:-policy)?|accessibility|legal|disclaimer|dmca)(?:\/|\.html?$|$)/.test(
    path,
  );
}
