/**
 * Public site settings, read at build time. Contact details come from env so no personal
 * address is ever hard-coded; pages render a neutral fallback when it is unset.
 */
export const SITE_NAME = "Club Index";

/** Sub-path when hosted under one (e.g. GitHub Pages project sites: "/clubindex"). */
export const BASE_PATH = (process.env.NEXT_PUBLIC_BASE_PATH ?? "").replace(/\/$/, "");

/** Prefix for URLs that bypass next/link and the router (fetch, plain forms/anchors). */
export function withBase(path: string): string {
  return `${BASE_PATH}${path}`;
}

/** Public origin plus base path, e.g. "https://example.github.io/clubindex". */
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
  const v = process.env.NEXT_PUBLIC_CORRECTIONS_FORM_URL?.trim();
  return v && /^https:\/\//.test(v) ? v : null;
}

export const CRAWLER_USER_AGENT_PREFIX = "ClubIndexBot";
