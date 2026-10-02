import { withBase } from "./site";

/**
 * The current slug for a club slug that is no longer in the index. A renamed or merged
 * club's old slug serves `{ redirect }` from /data/clubs/<slug>.json (launch audit);
 * follows up to 3 hops. Null when the club is really gone or the fetch fails.
 */
export async function currentSlug(slug: string, hops = 0): Promise<string | null> {
  try {
    const r = await fetch(withBase(`/data/clubs/${slug}.json`));
    if (!r.ok) return null;
    const d = (await r.json()) as { redirect?: unknown };
    if (typeof d.redirect !== "string") return slug;
    return hops < 3 ? currentSlug(d.redirect, hops + 1) : null;
  } catch {
    return null;
  }
}
