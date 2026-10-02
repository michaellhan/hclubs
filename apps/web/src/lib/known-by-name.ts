/**
 * A source that is only a web-search query ("Brave Search: "Adams House Committee" Harvard")
 * is how we found a link, not somewhere a student can read the club's name. PURE.
 */
export function isSearchSource(s: { url: string; title?: string | null }): boolean {
  if (s.title && /^(brave|google|bing|duckduckgo) search\b/i.test(s.title)) return true;
  try {
    const u = new URL(s.url);
    const host = u.hostname.replace(/^www\./, "");
    return (
      host === "search.brave.com" ||
      host === "api.search.brave.com" ||
      host === "duckduckgo.com" ||
      (/^google\.[a-z.]+$/.test(host) && u.pathname.startsWith("/search")) ||
      (host === "bing.com" && u.pathname.startsWith("/search"))
    );
  } catch {
    return false;
  }
}
