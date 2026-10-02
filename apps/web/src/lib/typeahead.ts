import { accessText } from "./joining";

/**
 * The muted second line of a typeahead suggestion: primary category and how members join
 * ("Consulting · Application, then comp"). Either part is left out when unknown; null when
 * both are, so a bare name stays a one-line row. PURE.
 */
export function typeaheadSubline(club: {
  categories: readonly { name: string }[];
  joining: Parameters<typeof accessText>[0];
}): string | null {
  const parts = [club.categories[0]?.name ?? null, accessText(club.joining)].filter((p): p is string => Boolean(p));
  return parts.length ? parts.join(" · ") : null;
}
