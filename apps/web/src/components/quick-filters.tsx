"use client";

import Link from "next/link";
import type { ConstraintFilter, FacetCounts } from "@hci/db/local";
import { hrefWith, type DirectoryParams } from "@/lib/params";
import { JOINING_FILTERS } from "@/lib/joining";

/**
 * The joining questions students ask first; they sit above the results, not in the panel.
 * Recruiting now and Still time to join take turns (see `RECRUITING_WINDOW`).
 */
export const QUICK_FILTERS = [
  { key: "recruitingNow", chip: "recruiting", label: "Recruiting now", info: JOINING_FILTERS.recruitingNow.help },
  { key: "stillTime", chip: "later", label: "Still time to join", info: JOINING_FILTERS.stillTime.help },
  { key: "openJoin", chip: "open", label: "Join anytime", info: JOINING_FILTERS.openJoin.help },
  { key: "noComp", chip: "nocomp", label: "No comp", info: JOINING_FILTERS.noComp.help },
  { key: "noDues", chip: "nodues", label: "No dues", info: JOINING_FILTERS.noDues.help },
] as const;

/**
 * Clubs with a live round (across the whole directory) that make it a recruiting window:
 * then the row offers Recruiting now; the rest of the year, when it would show a club or
 * two, Still time to join (late rounds, join-anytime and spring-recruiting clubs).
 */
export const RECRUITING_WINDOW = 5;

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
  recruitingWindow,
}: {
  params: DirectoryParams;
  facets: FacetCounts | null;
  /** Whether enough clubs are recruiting right now to offer Recruiting now (see `RECRUITING_WINDOW`). */
  recruitingWindow: boolean;
  /** Filters the search text implies ("no comp" in the query): shown on; a tap makes them real filters. */
  implied?: readonly ConstraintFilter[];
  convertHref?: string | undefined;
}) {
  const f = params.filters;
  const seasonal = (key: string) =>
    key === "recruitingNow" ? recruitingWindow : key === "stillTime" ? !recruitingWindow : true;
  const chips = QUICK_FILTERS.filter(
    (q) =>
      f[q.key] ||
      implied.includes(q.key as ConstraintFilter) ||
      (seasonal(q.key) && (!facets || (facets[q.key] ?? 0) > 0)),
  );
  if (!chips.length) return null;
  return (
    <div role="group" aria-label="Quick filters" className="contents">
      {chips.map((q) => {
        const isImplied = !f[q.key] && implied.includes(q.key as ConstraintFilter);
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
            className={`${BASE} ${
              on
                ? "border-accent bg-accent-soft text-accent"
                : "border-stone-200 text-stone-700 hover:border-stone-400 hover:bg-stone-50 dark:border-stone-700 dark:text-stone-300 dark:hover:border-stone-500 dark:hover:bg-stone-900"
            }`}
          >
            {on ? <span aria-hidden>✓</span> : null}
            {q.label}
            <span className="sr-only">
              {q.info ? `. ${q.info}` : ""}
              {on ? ". On. Remove filter" : count !== undefined ? `. ${count} ${count === 1 ? "club" : "clubs"}` : ""}
            </span>
          </Link>
        );
      })}
    </div>
  );
}
