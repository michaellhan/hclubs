/**
 * Public site settings, read at build time. Contact details come from env so no personal
 * address is ever hard-coded; pages render a neutral fallback when it is unset.
 */
export const SITE_NAME = "hclubs";

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
 * know about a club. Placeholders, URL-encoded per link: `{clubref}` ("Name [slug]"),
 * `{club}`, `{slug}`, `{type}` (the form's matching "What kind of update?" option) and
 * `{details}` (the answer template for that type). See ADR 0035.
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
    for (const [k, v] of [...u.searchParams]) if (/\{[a-z]+\}/.test(v)) u.searchParams.delete(k);
    if (u.searchParams.get("usp") === "pp_url") u.searchParams.delete("usp");
    return u.toString();
  } catch {
    return null;
  }
}

/** Fill a form URL's placeholders with URL-encoded values; unknown ones are left out. */
export function fillFormUrl(
  template: string,
  club: { name: string; slug: string },
  extra: { clubref?: string; type?: string; details?: string } = {},
): string {
  const values: Record<string, string> = {
    club: club.name,
    slug: club.slug,
    clubref: extra.clubref ?? `${club.name} [${club.slug}]`,
    type: extra.type ?? "",
    details: extra.details ?? "",
  };
  return template.replace(/\{(club|slug|clubref|type|details)\}/g, (_, k: string) =>
    encodeURIComponent(values[k] ?? ""),
  );
}

/** A mailto: link with an encoded subject and body. */
export function mailtoHref(email: string, subject: string, body: string): string {
  return `mailto:${email}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

export const CRAWLER_USER_AGENT_PREFIX = "hclubsBot";

/**
 * GoatCounter site code (e.g. "hclubs" → https://hclubs.goatcounter.com/count), or null
 * when analytics are off. Cookie-free page-view counts only; nothing loads when unset.
 */
export function goatcounterEndpoint(): string | null {
  const code = process.env.NEXT_PUBLIC_GOATCOUNTER_CODE?.trim();
  return code && /^[a-z0-9-]+$/i.test(code) ? `https://${code.toLowerCase()}.goatcounter.com/count` : null;
}

/**
 * PostHog project key (public, "phc_…"), or null when PostHog is off. It counts visitors
 * and the same feature events as GoatCounter (track.ts); nothing loads when unset.
 */
export function posthogKey(): string | null {
  const key = process.env.NEXT_PUBLIC_POSTHOG_KEY?.trim();
  return key && /^phc_[A-Za-z0-9]+$/.test(key) ? key : null;
}
