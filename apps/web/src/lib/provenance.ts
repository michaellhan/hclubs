import type { SourceType } from "@hci/core/browser";

/**
 * Evidence metadata in human terms (CLAUDE.md §7.4, ADR 0028 amendment): where a fact came
 * from and when we last saw it there — never a confidence score.
 */
export const SOURCE_KIND: Record<SourceType, string> = {
  harvard_official: "Harvard page",
  club_website: "Club website",
  club_social: "Club's social account",
  club_recruiting_material: "Club recruiting page",
  club_publication: "Club publication",
  harvard_crimson: "The Harvard Crimson",
  harvard_related_other: "Harvard-related site",
  public_web: "Other website",
  student_submission: "Student report",
  editorial: "hclubs editor",
};

export function hostOf(url: string): string | null {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}

/** A source's title for the list: discovery's "(page)" suffixes for later listing pages dropped. */
export function sourceTitle(title: string | null, url: string): string {
  return (title ?? "").replace(/(\s*\(page\))+\s*$/, "").trim() || hostOf(url) || url;
}

/** Social platforms: an unestablished account there is a social account, not "Other website". */
const SOCIAL_HOST =
  /(^|\.)(instagram\.com|facebook\.com|x\.com|twitter\.com|tiktok\.com|linkedin\.com|youtube\.com|linktr\.ee)$/;

/**
 * The profile's Sources list, one line per title and kind: several pages of a site with the
 * same title ("Crimson Business article") read as one. Keeps the first (the query's order).
 * A page on a host the club's own website uses reads as the club's website (a /donate page
 * crawled before the site was confirmed), and an account on a social platform as a social
 * account. PURE.
 */
export function sourceRows<T extends { url: string; title: string | null; sourceType: string }>(
  rows: readonly T[],
): (T & { label: string; kind: string })[] {
  const ownHosts = new Set(rows.filter((r) => r.sourceType === "club_website").map((r) => hostOf(r.url)));
  const seen = new Set<string>();
  const out: (T & { label: string; kind: string })[] = [];
  for (const r of rows) {
    const label = sourceTitle(r.title, r.url);
    const host = hostOf(r.url);
    const type = r.sourceType === "public_web" && host && ownHosts.has(host) ? "club_website" : r.sourceType;
    const kind =
      type === "public_web" && host && SOCIAL_HOST.test(host)
        ? "Social account"
        : (SOURCE_KIND[type as SourceType] ?? SOURCE_KIND.public_web);
    const key = `${type}|${label.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ ...r, label, kind });
  }
  return out;
}
