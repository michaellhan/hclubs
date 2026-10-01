import type { IndexClub } from "./types";
import { clubWords } from "./words";

/**
 * "Similar clubs" (ADR 0034): a fixed, explainable score over shared categories, shared
 * descriptive words and the joining model. No tracking, no personalization. PURE.
 */

export const SIMILAR_WEIGHTS = {
  /** Per shared specific category (no subcategories: "Consulting", "Hobbies & Games"), at most two. */
  sharedLeafCategory: 3,
  /** Per shared broad category (has subcategories: "Public Service"), at most two. */
  sharedTopCategory: 1,
  /** × the Jaccard overlap of descriptive words. */
  wordOverlap: 8,
  /** Both selective (application/comp/audition/tryout) or both open. */
  sameJoinModel: 0.5,
  /** Below this a club isn't shown as similar. */
  minimum: 3,
} as const;

/** Words too common in club text to say two clubs are alike. */
const GENERIC = new Set(
  "student students harvard undergraduate undergraduates college university club clubs group groups community events event members member campus organization organizations program programs society association team teams annual weekly year years new also various through their our who that this with from offers offering hosting hosts provide provides providing interested interest across including help helps support supports run runs led based".split(
    " ",
  ),
);

export interface SimilarClub {
  club: IndexClub;
  score: number;
  /** "Also Consulting", "Similar description". */
  reasons: string[];
}

interface Shape {
  leaf: Set<string>;
  top: Set<string>;
  words: Set<string>;
  selective: boolean | null;
  nameKey: string;
  links: string[];
}

const SELECTIVE = ["application", "comp", "audition", "tryout", "invite_only"];
const shapes = new WeakMap<IndexClub, Shape>();

function shape(c: IndexClub, isLeaf: (slug: string) => boolean): Shape {
  let s = shapes.get(c);
  if (!s) {
    const leaf = new Set<string>();
    const top = new Set<string>();
    for (const slug of c.categorySlugs) (isLeaf(slug) ? leaf : top).add(slug);
    const words = new Set(
      // Description, tags and activities — not category names, which are scored on their own.
      `${clubWords(c).about} ${c.searchTopics ?? ""}`.split(/\s+/).filter((w) => w.length >= 4 && !GENERIC.has(w)),
    );
    const joins = c.joinModes;
    s = {
      leaf,
      top,
      words,
      selective: joins.length ? joins.some((m) => SELECTIVE.includes(m)) : null,
      nameKey: c.searchNames
        .split(" | ")[0]!
        .split(" ")
        .filter((w) => !GENERIC.has(w) && !["pbha", "pbhas", "radcliffe", "the"].includes(w))
        .join(" "),
      links: [c.quickLinks?.website, c.quickLinks?.instagram].filter((x): x is string => Boolean(x)),
    };
    shapes.set(c, s);
  }
  return s;
}

/**
 * The clubs most like `target`, best first. Leaves out the club itself, inactive clubs,
 * graduate-school groups (unless the target is one), and look-alike duplicates (same name
 * once boilerplate is removed, or the same website/Instagram).
 */
export function similarClubs(
  target: IndexClub,
  clubs: readonly IndexClub[],
  opts: {
    limit?: number;
    /** Whether a category has no subcategories (the specific ones). */
    isLeaf: (slug: string) => boolean;
    exclude?: ReadonlySet<string>;
  },
): SimilarClub[] {
  const t = shape(target, opts.isLeaf);
  const out: SimilarClub[] = [];
  for (const c of clubs) {
    if (c.id === target.id || opts.exclude?.has(c.id)) continue;
    if (c.activityStatus === "inactive" || c.activityStatus === "defunct") continue;
    if (c.affiliationScope === "graduate_school" && target.affiliationScope !== "graduate_school") continue;
    const s = shape(c, opts.isLeaf);
    if (s.nameKey === t.nameKey || s.links.some((l) => t.links.includes(l))) continue;
    const leaf = [...s.leaf].filter((x) => t.leaf.has(x));
    const top = [...s.top].filter((x) => t.top.has(x));
    let shared = 0;
    for (const w of s.words) if (t.words.has(w)) shared++;
    const union = s.words.size + t.words.size - shared;
    const jaccard = union ? shared / union : 0;
    const score =
      Math.min(2, leaf.length) * SIMILAR_WEIGHTS.sharedLeafCategory +
      Math.min(2, top.length) * SIMILAR_WEIGHTS.sharedTopCategory +
      jaccard * SIMILAR_WEIGHTS.wordOverlap +
      (s.selective !== null && s.selective === t.selective ? SIMILAR_WEIGHTS.sameJoinModel : 0);
    if (score < SIMILAR_WEIGHTS.minimum) continue;
    const reasons = [
      ...leaf.slice(0, 1).map((x) => `cat:${x}`),
      ...(leaf.length ? [] : top.slice(0, 1).map((x) => `cat:${x}`)),
      ...(jaccard >= 0.12 ? ["Similar description"] : []),
      ...(s.selective === false && t.selective === false ? ["Also open to join"] : []),
    ];
    out.push({ club: c, score, reasons });
  }
  out.sort(
    (a, b) => b.score - a.score || b.club.completeness - a.club.completeness || a.club.name.localeCompare(b.club.name),
  );
  // Variety: one club per family of look-alike names ("Model Congress Europe/Asia/…"),
  // so near-copies don't crowd out other alternatives.
  const picked: SimilarClub[] = [];
  const families = new Set<string>();
  for (const s of out) {
    const family = shape(s.club, opts.isLeaf).nameKey.split(" ").slice(0, 2).join(" ");
    if (family && families.has(family)) continue;
    families.add(family);
    picked.push(s);
    if (picked.length >= (opts.limit ?? 5)) break;
  }
  return picked;
}
