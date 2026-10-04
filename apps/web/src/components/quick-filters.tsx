"use client";

import Link from "next/link";
import type { ConstraintFilter, FacetCounts } from "@hci/db/local";
import { hrefWith, type DirectoryParams } from "@/lib/params";
import { JOINING_FILTERS } from "@/lib/joining";

/** The four joining questions students ask first; they sit above the results, not in the sidebar. */
export const QUICK_FILTERS = [
  { key: "openJoin", chip: "open", label: "Join anytime", info: JOINING_FILTERS.openJoin.help },
  { key: "freshmenEligible", chip: "freshmen", label: "First-years", info: JOINING_FILTERS.freshmenEligible.help },
  { key: "noComp", chip: "nocomp", label: "No comp", info: JOINING_FILTERS.noComp.help },
  { key: "recruitingNow", chip: "recruiting", label: "Recruiting now", info: JOINING_FILTERS.recruitingNow.help },
] as const;

/** Chip keys (see `filterChips`) the quick row already shows, so they aren't listed twice. */
export const QUICK_CHIP_KEYS: string[] = QUICK_FILTERS.map((q) => q.chip);

export function quickActiveCount(f: DirectoryParams["filters"]): number {
  return QUICK_FILTERS.filter((q) => f[q.key]).length;
}

const BASE =
  "inline-flex h-11 items-center gap-1.5 rounded-full border px-3 text-sm font-medium whitespace-nowrap transition-colors sm:h-8";

/**
 * Toggle chips for the common joining filters. Each is a link to the same URL with the
 * filter flipped (shareable, works without JS state). A chip no club matches is hidden
 * unless it's on; the count is clubs a source confirms, never "everyone else is a no".
 */
export function QuickFilters({
  params,
  facets,
  implied = [],
  convertHref,
}: {
  params: DirectoryParams;
  facets: FacetCounts | null;
  /** Filters the search text implies ("no comp" in the query): shown on; a tap makes them real filters. */
  implied?: readonly ConstraintFilter[];
  convertHref?: string | undefined;
}) {
  const f = params.filters;
  const chips = QUICK_FILTERS.filter((q) => f[q.key] || implied.includes(q.key) || !facets || (facets[q.key] ?? 0) > 0);
  if (!chips.length) return null;
  return (
    <div role="group" aria-label="Quick filters" className="contents">
      {chips.map((q) => {
        const isImplied = !f[q.key] && implied.includes(q.key);
        const on = f[q.key] || isImplied;
        const count = facets?.[q.key];
        return (
          <Link
            key={q.key}
            href={isImplied && convertHref ? convertHref : hrefWith(params, { filters: { ...f, [q.key]: !on } })}
            scroll={false}
            replace
            prefetch={false}
            aria-current={on ? "true" : undefined}
            title={q.info}
            className={`${BASE} ${
              on
                ? "border-accent bg-accent-soft text-accent"
                : "border-stone-200 text-stone-700 hover:border-stone-400 hover:bg-stone-50 dark:border-stone-700 dark:text-stone-300 dark:hover:border-stone-500 dark:hover:bg-stone-900"
            }`}
          >
            {on ? <span aria-hidden>✓</span> : null}
            {q.label}
            <span className="sr-only">
              {on ? ". On. Remove filter" : count !== undefined ? `. ${count} ${count === 1 ? "club" : "clubs"}` : ""}
            </span>
          </Link>
        );
      })}
    </div>
  );
}
