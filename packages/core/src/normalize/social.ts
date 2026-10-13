import type { LinkKind } from "../enums";
import { isLegalPageUrl, normalizeUrl, parseUrl, urlIdentityKey } from "./urls";

/**
 * Classify a URL into a link kind, extracting a canonical URL and handle where possible.
 * Only URL *shape* is inspected — classification never implies that the account is
 * official. Officialness is a separate, evidence-backed status (CLAUDE.md §7.1).
 */
export interface ClassifiedLink {
  kind: LinkKind;
  url: string; // canonical URL
  handle: string | null;
  /** true for URLs that point at a person (e.g. linkedin.com/in/…), which we must not store. */
  isPersonal: boolean;
  /** true for URLs that point at a single post/video rather than an account. */
  isContentItem: boolean;
}

const INSTAGRAM_RESERVED = new Set([
  "p",
  "reel",
  "reels",
  "tv",
  "explore",
  "popular",
  "locations",
  "web",
  "stories",
  "accounts",
  "direct",
  "about",
  "developer",
  "legal",
]);
const X_RESERVED = new Set(["intent", "share", "home", "i", "hashtag", "search", "explore", "settings", "login"]);
const FACEBOOK_RESERVED = new Set([
  "sharer",
  "sharer.php",
  "share",
  "dialog",
  "login",
  "watch",
  "events",
  "profile.php",
  "hashtag",
  "share.php",
  "plugins",
  "tr",
  "photo.php",
  "photo",
  "photos",
  "story.php",
  "permalink.php",
  "media",
  "notes",
  "help",
  "policies",
  "privacy",
  "people",
  "pages",
  "p",
  "recover",
  "story.php",
  "reel",
  "reels",
  "watch",
  "marketplace",
  "gaming",
]);
const LINK_IN_BIO_HOSTS = new Set([
  "linktr.ee",
  "beacons.ai",
  "bio.link",
  "lnk.bio",
  "campsite.bio",
  "linkin.bio",
  "tap.bio",
  "solo.to",
]);

const INSTAGRAM_HANDLE = /^[a-z0-9._]{1,30}$/;
const GENERIC_HANDLE = /^[a-z0-9._-]{1,100}$/;

function segmentsOf(url: URL): string[] {
  return url.pathname
    .split("/")
    .filter(Boolean)
    .map((s) => decodeURIComponent(s));
}

export function isLinkInBioUrl(input: string): boolean {
  const url = parseUrl(input);
  if (!url) return false;
  const host = url.hostname.toLowerCase().replace(/^www\./, "");
  return LINK_IN_BIO_HOSTS.has(host) || host.endsWith(".carrd.co");
}

export function isLinktreeUrl(input: string): boolean {
  const url = parseUrl(input);
  return !!url && url.hostname.toLowerCase().replace(/^www\./, "") === "linktr.ee";
}

export function extractInstagramHandle(input: string): string | null {
  const url = parseUrl(input);
  if (!url) {
    const bare = input.trim().replace(/^@/, "").toLowerCase();
    return INSTAGRAM_HANDLE.test(bare) && !bare.includes("..") ? bare : null;
  }
  const host = url.hostname.toLowerCase().replace(/^www\./, "");
  if (host !== "instagram.com" && host !== "instagr.am" && host !== "m.instagram.com") return null;
  const first = segmentsOf(url)[0]?.toLowerCase();
  if (!first || INSTAGRAM_RESERVED.has(first)) return null;
  const handle = first.replace(/^@/, "");
  return INSTAGRAM_HANDLE.test(handle) ? handle : null;
}

export interface LinkedInRef {
  type: "company" | "school" | "showcase" | "group" | "person";
  slug: string;
  url: string;
}

export function normalizeLinkedInUrl(input: string): LinkedInRef | null {
  const url = parseUrl(input);
  if (!url) return null;
  const host = url.hostname.toLowerCase();
  if (!(host === "linkedin.com" || host.endsWith(".linkedin.com"))) return null;
  const [kind, slug] = segmentsOf(url);
  if (!kind || !slug) return null;
  const typeMap: Record<string, LinkedInRef["type"]> = {
    company: "company",
    school: "school",
    showcase: "showcase",
    groups: "group",
    in: "person",
  };
  const type = typeMap[kind.toLowerCase()];
  if (!type) return null;
  const s = slug.toLowerCase();
  const pathKind = type === "group" ? "groups" : type === "person" ? "in" : type;
  return { type, slug: s, url: `https://www.linkedin.com/${pathKind}/${s}` };
}

export function classifyLink(input: string, base?: string): ClassifiedLink | null {
  const url = parseUrl(input, base);
  if (!url) return null;

  if (url.protocol === "mailto:") {
    const address = decodeURIComponent(url.pathname).trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(address)) return null;
    return { kind: "email", url: `mailto:${address}`, handle: address, isPersonal: false, isContentItem: false };
  }

  // A platform's own terms/privacy/CCPA page (substack.com/tos read as a club's newsletter)
  // is never a club's link, whatever host it is on.
  if (isLegalPageUrl(url.toString())) return null;
  const canonical = normalizeUrl(url.toString());
  if (!canonical) return null;
  const host = url.hostname
    .toLowerCase()
    .replace(/^www\./, "")
    .replace(/^m\./, "");
  const segs = segmentsOf(url);
  const first = segs[0]?.toLowerCase();
  const base_ = { isPersonal: false, isContentItem: false };

  if (host === "instagram.com" || host === "instagr.am") {
    const handle = extractInstagramHandle(url.toString());
    if (handle) {
      return { ...base_, kind: "instagram", url: `https://www.instagram.com/${handle}`, handle };
    }
    return { ...base_, kind: "instagram", url: canonical, handle: null, isContentItem: true };
  }

  if (host === "linkedin.com" || host.endsWith(".linkedin.com")) {
    const ref = normalizeLinkedInUrl(url.toString());
    if (ref) {
      return { ...base_, kind: "linkedin", url: ref.url, handle: ref.slug, isPersonal: ref.type === "person" };
    }
    return { ...base_, kind: "linkedin", url: canonical, handle: null, isContentItem: true };
  }

  if (host === "x.com" || host === "twitter.com" || host === "mobile.twitter.com") {
    if (first && !X_RESERVED.has(first) && /^[a-z0-9_]{1,15}$/.test(first)) {
      const isContentItem = segs[1] === "status";
      return { ...base_, kind: "x", url: `https://x.com/${first}`, handle: first, isContentItem };
    }
    return { ...base_, kind: "x", url: canonical, handle: null, isContentItem: true };
  }

  if (host === "facebook.com" || host === "fb.com") {
    if (first === "groups" && segs[1]) {
      const g = segs[1].toLowerCase();
      return { ...base_, kind: "facebook", url: `https://www.facebook.com/groups/${g}`, handle: `groups/${g}` };
    }
    // facebook.com/people/<Name>/<id> and the older /pages/<Name>/<id>: the whole path is the
    // page; cutting it to "/people" leaves a link to nowhere.
    // facebook.com/p/<Name>-<id>: the newer page URL; the slug is the page.
    if (first === "p" && segs[1] && /-\d{6,}$/.test(segs[1])) {
      return {
        ...base_,
        kind: "facebook",
        url: `https://www.facebook.com/p/${segs[1]}`,
        handle: segs[1].toLowerCase(),
      };
    }
    if ((first === "people" || first === "pages") && segs[1] && segs[2] && /^\d+$/.test(segs[2])) {
      return {
        ...base_,
        kind: "facebook",
        url: `https://www.facebook.com/${first}/${segs[1]}/${segs[2]}`,
        handle: segs[1].toLowerCase(),
      };
    }
    if (first && !FACEBOOK_RESERVED.has(first) && GENERIC_HANDLE.test(first)) {
      return { ...base_, kind: "facebook", url: `https://www.facebook.com/${first}`, handle: first };
    }
    return { ...base_, kind: "facebook", url: canonical, handle: null, isContentItem: true };
  }

  if (host === "youtube.com" || host === "youtu.be") {
    if (host === "youtu.be" || first === "watch" || first === "shorts") {
      return { ...base_, kind: "youtube", url: canonical, handle: null, isContentItem: true };
    }
    if (first?.startsWith("@")) {
      return { ...base_, kind: "youtube", url: `https://www.youtube.com/${first}`, handle: first.slice(1) };
    }
    if ((first === "channel" || first === "c" || first === "user") && segs[1]) {
      const id = first === "channel" ? segs[1] : segs[1].toLowerCase();
      return { ...base_, kind: "youtube", url: `https://www.youtube.com/${first}/${id}`, handle: id };
    }
    return { ...base_, kind: "youtube", url: canonical, handle: null };
  }

  if (host === "tiktok.com") {
    if (first?.startsWith("@")) {
      const handle = first.slice(1);
      return {
        ...base_,
        kind: "tiktok",
        url: `https://www.tiktok.com/@${handle}`,
        handle,
        isContentItem: segs[1] === "video",
      };
    }
    return { ...base_, kind: "tiktok", url: canonical, handle: null, isContentItem: true };
  }

  if (host === "github.com" && first) {
    return { ...base_, kind: "github", url: `https://github.com/${first}`, handle: first };
  }

  if (host === "discord.gg" || (host === "discord.com" && first === "invite")) {
    return { ...base_, kind: "discord", url: canonical, handle: null };
  }

  if (isLinkInBioUrl(url.toString())) {
    const handle = LINK_IN_BIO_HOSTS.has(host) && first ? first.toLowerCase() : host.replace(/\.carrd\.co$/, "");
    const canonicalBio = LINK_IN_BIO_HOSTS.has(host) && first ? `https://${host}/${handle}` : canonical;
    return { ...base_, kind: "link_in_bio", url: canonicalBio, handle };
  }

  if (host === "forms.gle" || (host === "docs.google.com" && first === "forms")) {
    return { ...base_, kind: "application_form", url: canonical, handle: null };
  }

  if (host === "lists.hcs.harvard.edu" || host === "groups.google.com" || host.endsWith(".list-manage.com")) {
    return { ...base_, kind: "mailing_list", url: canonical, handle: null };
  }

  if (host.endsWith("substack.com") || host === "mailchi.mp") {
    return { ...base_, kind: "newsletter", url: canonical, handle: null };
  }

  return { ...base_, kind: "website", url: canonical, handle: null };
}

/** Identity key for social accounts ("instagram:handle"), or null for non-account URLs. */
export function socialIdentityKey(input: string): string | null {
  const c = classifyLink(input);
  if (!c || !c.handle || c.isContentItem || c.kind === "email") return null;
  if (["instagram", "linkedin", "facebook", "x", "youtube", "tiktok", "github", "link_in_bio"].includes(c.kind)) {
    return `${c.kind}:${c.handle}`;
  }
  return null;
}

/** Duplicate-URL detection: two URLs are duplicates if their identity keys match. */
export function isSameLink(a: string, b: string): boolean {
  const ka = urlIdentityKey(a, socialIdentityKey);
  const kb = urlIdentityKey(b, socialIdentityKey);
  return ka !== null && ka === kb;
}

/** Remove duplicate URLs, keeping the first occurrence of each identity. */
export function dedupeUrls(urls: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const u of urls) {
    const key = urlIdentityKey(u, socialIdentityKey);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(u);
  }
  return out;
}
