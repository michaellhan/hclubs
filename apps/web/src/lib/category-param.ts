/**
 * A `?category=` value resolved against the known categories: the exact slug, else the one
 * category whose slug starts with it as a whole word ("publications" → "publications-media"),
 * preferring a top-level category; anything else is no filter at all. An unknown slug must
 * never empty the page while the dropdown says "All categories". PURE.
 */
export function resolveCategorySlug(
  raw: string | null | undefined,
  categories: readonly { slug: string; parentSlug?: string | null }[],
): string | null {
  const v = raw?.trim().toLowerCase() ?? "";
  if (!/^[a-z0-9-]+$/.test(v)) return null;
  if (categories.some((c) => c.slug === v)) return v;
  const prefixed = categories.filter((c) => c.slug.startsWith(`${v}-`));
  const top = prefixed.filter((c) => !c.parentSlug);
  const pick = top.length === 1 ? top : prefixed.length === 1 ? prefixed : [];
  return pick[0]?.slug ?? null;
}
