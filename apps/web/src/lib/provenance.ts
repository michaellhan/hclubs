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

/**
 * The profile's Sources list, one line per title and kind: several pages of a site with the
 * same title ("Crimson Business article") read as one. Keeps the first (the query's order). PURE.
 */
export function sourceRows<T extends { url: string; title: string | null; sourceType: string }>(
  rows: readonly T[],
): (T & { label: string })[] {
  const seen = new Set<string>();
  const out: (T & { label: string })[] = [];
  for (const r of rows) {
    const label = sourceTitle(r.title, r.url);
    const key = `${r.sourceType}|${label.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ ...r, label });
  }
  return out;
}
