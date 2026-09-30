import type { SourceFetcher } from "../types";
import { classifyPageRole, sameSite } from "./site";

/**
 * Sitemap hints (ADR 0027): a club site's sitemap lists pages the shallow crawl can miss
 * (a comp page linked only from a dropdown, an FAQ two clicks deep). We read it through
 * the polite fetcher (robots honored) and seed the crawl with the pages whose URL says
 * joining, recruiting, FAQ or about. The crawl's page budget and priorities still apply.
 */

const HINT_ROLES = new Set(["recruiting", "join", "faq", "about"]);
const MAX_HINTS = 12;
const MAX_CHILD_SITEMAPS = 3;

/** `<loc>` entries of a sitemap or sitemap index. PURE. */
export function sitemapLocs(xml: string): { pages: string[]; sitemaps: string[] } {
  const locs = [...xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)].map((m) =>
    (m[1] ?? "").replace(/&amp;/g, "&").trim(),
  );
  const isIndex = /<sitemapindex[\s>]/i.test(xml);
  return isIndex ? { pages: [], sitemaps: locs } : { pages: locs, sitemaps: [] };
}

/** Sitemap pages worth crawling first, same-site only, best roles first. PURE. */
export function sitemapHintUrls(root: string, pages: readonly string[]): string[] {
  return pages
    .filter((u) => /^https?:\/\//i.test(u) && sameSite(root, u))
    .map((u) => ({ u, role: classifyPageRole(u) }))
    .filter((x) => HINT_ROLES.has(x.role))
    .sort((a, b) => [...HINT_ROLES].indexOf(a.role) - [...HINT_ROLES].indexOf(b.role))
    .map((x) => x.u)
    .slice(0, MAX_HINTS);
}

export async function sitemapHints(fetcher: SourceFetcher, root: string): Promise<string[]> {
  const base = root.replace(/\/?$/, "/");
  const get = async (url: string): Promise<string | null> => {
    try {
      const res = await fetcher.fetch({ url, sourceType: "public_web" });
      return res.status === "ok" && res.body ? new TextDecoder().decode(res.body) : null;
    } catch {
      return null;
    }
  };
  const top = await get(`${base}sitemap.xml`);
  if (!top) return [];
  const first = sitemapLocs(top);
  const pages = [...first.pages];
  // Page sitemaps (WordPress "page-sitemap.xml", Squarespace) usually hold the static pages.
  const children = first.sitemaps
    .sort((a, b) => Number(/page/i.test(b)) - Number(/page/i.test(a)))
    .slice(0, MAX_CHILD_SITEMAPS);
  for (const child of children) {
    const xml = await get(child);
    if (xml) pages.push(...sitemapLocs(xml).pages);
  }
  return sitemapHintUrls(base, pages);
}
