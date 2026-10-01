/**
 * Recovering a club link that 404s on the static host (GitHub Pages is case-sensitive and
 * has no server redirects): "/clubs/Harvard_Lampoon" → "harvard-lampoon". PURE.
 */

/** The slug-like part of a missing /clubs/… path, normalized the way slugs are written; null otherwise. */
export function missingClubSlug(pathname: string, basePath = ""): string | null {
  const path = basePath && pathname.startsWith(basePath) ? pathname.slice(basePath.length) : pathname;
  const m = /^\/clubs\/([^/?#]+)\/?$/.exec(path);
  if (!m) return null;
  let raw = m[1]!;
  try {
    raw = decodeURIComponent(raw);
  } catch {
    // A malformed escape: use it as written.
  }
  const slug = raw
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || null;
}

/** The words of a guessed slug, for a "did you mean" search. */
export const slugWords = (slug: string) => slug.replace(/-/g, " ");
