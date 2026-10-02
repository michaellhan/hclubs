import type { JoinMode } from "@hci/core/browser";
import {
  isSparseClub,
  matchesFirstYears,
  matchesNoComp,
  matchesOpenJoin,
  type CategoryWithCount,
  type IndexClub,
} from "@hci/db/local";

/**
 * A category page's overview, counted from the build-time index (the same data as the
 * directory): how its clubs say they join, how many take first-years, and the categories
 * its clubs most often share. Descriptive only — no ranking. PURE.
 */
export interface CategoryOverview {
  total: number;
  /** Clubs with at least a description or an official link. */
  withDetails: number;
  /** Open membership (`matchesOpenJoin`): a source says anyone can join. */
  openJoin: number;
  /** No comp (`matchesNoComp`): the College directory's flag, or open membership. */
  noComp: number;
  join: { mode: JoinMode; count: number }[];
  /** Clubs whose joining process no source states. */
  joinUnknown: number;
  firstYears: number;
  usuallyFall: number;
  usuallySpring: number;
  /** Other categories sharing the most clubs with this one. */
  related: { slug: string; name: string; shared: number }[];
}

const JOIN_ORDER: JoinMode[] = ["open", "application", "comp", "audition", "tryout", "invite_only", "attendance_based"];

export function categoryOverview(
  clubs: readonly IndexClub[],
  categories: readonly CategoryWithCount[],
  slug: string,
): CategoryOverview {
  const inCat = clubs.filter(
    (c) =>
      c.categorySlugs.includes(slug) &&
      c.activityStatus !== "inactive" &&
      c.activityStatus !== "defunct" &&
      c.affiliationScope !== "graduate_school",
  );
  const modes = new Map<JoinMode, number>();
  for (const c of inCat) for (const m of new Set(c.joinModes)) modes.set(m, (modes.get(m) ?? 0) + 1);
  const cat = categories.find((c) => c.slug === slug);
  // Its own parent and children are navigation, not "related".
  const family = new Set([
    slug,
    cat?.parentSlug ?? "",
    ...categories.filter((c) => c.parentSlug === slug).map((c) => c.slug),
  ]);
  const shared = new Map<string, number>();
  for (const c of inCat) for (const s of c.categorySlugs) if (!family.has(s)) shared.set(s, (shared.get(s) ?? 0) + 1);
  const related = [...shared.entries()]
    .filter(([, n]) => n >= 2)
    .map(([s, n]) => ({ slug: s, name: categories.find((c) => c.slug === s)?.name ?? s, shared: n }))
    // A broad parent is implied by its child; list the specific one.
    .filter((r, _, all) => !all.some((o) => categories.find((c) => c.slug === o.slug)?.parentSlug === r.slug))
    .sort((a, b) => b.shared - a.shared || a.name.localeCompare(b.name))
    .slice(0, 5);
  return {
    total: inCat.length,
    withDetails: inCat.filter((c) => !isSparseClub(c)).length,
    openJoin: inCat.filter((c) => matchesOpenJoin(c)).length,
    noComp: inCat.filter((c) => matchesNoComp(c)).length,
    join: JOIN_ORDER.filter((m) => modes.has(m)).map((mode) => ({ mode, count: modes.get(mode)! })),
    joinUnknown: inCat.filter((c) => c.joining.access === null && c.joining.comp === null).length,
    firstYears: inCat.filter(matchesFirstYears).length,
    usuallyFall: inCat.filter((c) => c.recruitingSeasons.includes("fall")).length,
    usuallySpring: inCat.filter((c) => c.recruitingSeasons.includes("spring")).length,
    related,
  };
}

/** Names that start with a digit or symbol ("1L", "1636 Leadership Forum") sort after the letters. */
export function startsWithLetter(name: string): boolean {
  return /^\p{L}/u.test(name.trim());
}

/** A–Z by name, numbers and symbols last. */
export function compareNames(a: string, b: string): number {
  const la = startsWithLetter(a);
  const lb = startsWithLetter(b);
  if (la !== lb) return la ? -1 : 1;
  return a.localeCompare(b, "en", { sensitivity: "base", numeric: true });
}

/**
 * The order of a category page's list: clubs recruiting right now first (soonest-listed by
 * name), then clubs with a description, then clubs with only a name and links. Each group
 * is A–Z with numbers last. `isLive` is computed from the viewer's clock. PURE.
 */
export function orderCategoryClubs<T extends { name: string; shortDescription: string | null }>(
  clubs: readonly T[],
  isLive: (c: T) => boolean,
): T[] {
  const rank = (c: T) => (isLive(c) ? 0 : c.shortDescription?.trim() ? 1 : 2);
  return clubs
    .map((c) => ({ c, r: rank(c) }))
    .sort((x, y) => x.r - y.r || compareNames(x.c.name, y.c.name))
    .map((x) => x.c);
}
