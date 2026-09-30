/**
 * Public site settings, read at build time. Contact details come from env so no personal
 * address is ever hard-coded; pages render a neutral fallback when it is unset.
 */
export const SITE_NAME = "Harvard Club Index";

/** Sub-path when hosted under one (e.g. GitHub Pages project sites: "/hci"). */
export const BASE_PATH = (process.env.NEXT_PUBLIC_BASE_PATH ?? "").replace(/\/$/, "");

/** Prefix for URLs that bypass next/link and the router (fetch, plain forms/anchors). */
export function withBase(path: string): string {
  return `${BASE_PATH}${path}`;
}

/** Public origin plus base path, e.g. "https://example.github.io/hci". */
export function siteUrl(): string {
  return (process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000").replace(/\/$/, "") + BASE_PATH;
}

/** Where students, clubs, and site owners reach us (corrections, takedowns, crawler opt-out). */
export function contactEmail(): string | null {
  const v = process.env.CONTACT_EMAIL?.trim();
  return v && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v) ? v : null;
}

/** Optional external form (e.g. a Google Form) for corrections; used instead of email when set. */
export function correctionsFormUrl(): string | null {
  return httpsUrl(process.env.NEXT_PUBLIC_CORRECTIONS_FORM_URL);
}

function httpsUrl(raw: string | undefined): string | null {
  const v = raw?.trim();
  return v && /^https:\/\//.test(v) ? v : null;
}

/**
 * Optional external form (e.g. a Google Form prefill link) where students share what they
 * know about a club. `{club}` and `{slug}` in the URL are replaced (URL-encoded) per club.
 */
export function contributeFormUrl(): string | null {
  return httpsUrl(process.env.NEXT_PUBLIC_CONTRIBUTE_FORM_URL);
}

/** Optional external form for club officers updating their page; same placeholders. */
export function clubManagerFormUrl(): string | null {
  return httpsUrl(process.env.NEXT_PUBLIC_CLUB_MANAGER_FORM_URL);
}

/**
 * Site-wide feedback form: NEXT_PUBLIC_FEEDBACK_FORM_URL, else the contribute form with
 * its per-club prefill removed.
 */
export function feedbackFormUrl(): string | null {
  const direct = httpsUrl(process.env.NEXT_PUBLIC_FEEDBACK_FORM_URL);
  if (direct) return direct;
  const contribute = contributeFormUrl();
  if (!contribute) return null;
  try {
    const u = new URL(contribute);
    for (const [k, v] of [...u.searchParams]) if (/\{(club|slug)\}/.test(v)) u.searchParams.delete(k);
    if (u.searchParams.get("usp") === "pp_url") u.searchParams.delete("usp");
    return u.toString();
  } catch {
    return null;
  }
}

/** Fill `{club}` / `{slug}` placeholders in a form URL with URL-encoded values. */
export function fillFormUrl(template: string, club: { name: string; slug: string }): string {
  return template
    .replaceAll("{club}", encodeURIComponent(club.name))
    .replaceAll("{slug}", encodeURIComponent(club.slug));
}

/** A mailto: link with an encoded subject and body. */
export function mailtoHref(email: string, subject: string, body: string): string {
  return `mailto:${email}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

export const CRAWLER_USER_AGENT_PREFIX = "ClubIndexBot";
