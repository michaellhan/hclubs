import type { SourceType } from "@hci/core/browser";
import { formatDate } from "./format";

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

export interface FactSource {
  url: string;
  title: string | null;
  sourceType: SourceType;
  observedAt: string;
  isFixture: boolean;
}

export function hostOf(url: string): string | null {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}

/** "Club website · harvardconsulting.org · checked Sep 30, 2026". */
export function describeSource(s: FactSource): { kind: string; where: string | null; checked: string | null } {
  return {
    kind: SOURCE_KIND[s.sourceType] ?? "Source",
    where: s.title ?? hostOf(s.url),
    checked: formatDate(s.observedAt),
  };
}
