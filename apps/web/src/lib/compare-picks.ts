/**
 * The tray picks a /compare link should leave behind: the slugs of the clubs it actually
 * resolved (a merged club's old slug becomes its current one). Nothing while still loading
 * and nothing when no club resolved, so a link of dead slugs never replaces the visitor's
 * own picks with names that show as blanks. PURE.
 */
export function trayFromLink(resolved: readonly { slug: string }[] | null): string[] | null {
  if (!resolved || resolved.length === 0) return null;
  return resolved.map((c) => c.slug);
}

/** Picks still in the index; a club removed since the visitor picked it would show as a blank "Club". PURE. */
export function trayWithoutUnknown(slugs: readonly string[], listed: ReadonlySet<string>): string[] {
  return slugs.filter((s) => listed.has(s));
}
