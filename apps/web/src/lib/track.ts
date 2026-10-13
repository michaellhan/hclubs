"use client";

/**
 * Minimal, privacy-preserving event counts through the existing GoatCounter setup (ADR 0034):
 * cookie-free, no user profiles, no query text — only which feature was used ("search",
 * "filter:category", "compare-add", "apply-click", "contribute-click").
 * Never anything about the visitor. A no-op when
 * GoatCounter isn't configured or hasn't loaded.
 */
const sent = new Set<string>();

export function track(event: string, opts: { oncePerPage?: boolean } = {}): void {
  if (typeof window === "undefined") return;
  const key = `${window.location.pathname}|${event}`;
  if (opts.oncePerPage && sent.has(key)) return;
  sent.add(key);
  window.goatcounter?.count?.({ path: event, event: true });
}
