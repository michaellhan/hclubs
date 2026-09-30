/**
 * Public site settings. Contact details come from env so no personal address is ever
 * hard-coded; pages render a neutral fallback when it is unset.
 */
export const SITE_NAME = "Club Index";

export function siteUrl(): string {
  return (process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000").replace(/\/$/, "");
}

/** Where students, clubs, and site owners reach us (corrections, takedowns, crawler opt-out). */
export function contactEmail(): string | null {
  const v = process.env.CONTACT_EMAIL?.trim();
  return v && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v) ? v : null;
}

export const CRAWLER_USER_AGENT_PREFIX = "ClubIndexBot";
