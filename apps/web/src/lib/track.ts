"use client";

/**
 * Minimal event counts through GoatCounter (ADR 0034) and PostHog: no query text — only which
 * feature was used ("search", "filter:category", "compare-add", "apply-click",
 * "contribute-click"). PostHog keeps an anonymous visitor id (to count returning visitors) but
 * nothing about who they are. A no-op for whichever isn't configured or hasn't loaded.
 */
const sent = new Set<string>();

export function track(event: string, opts: { oncePerPage?: boolean } = {}): void {
  if (typeof window === "undefined") return;
  const key = `${window.location.pathname}|${event}`;
  if (opts.oncePerPage && sent.has(key)) return;
  sent.add(key);
  window.goatcounter?.count?.({ path: event, event: true });
  // PostHog gets the same name in its own style: "filter:category" → filter {detail: "category"},
  // "apply-click" → apply_click. Its page URL says which club; never the query text.
  const [name = event, detail] = event.split(":");
  window.posthog?.capture?.(name.replace(/-/g, "_"), detail ? { detail } : undefined);
}
