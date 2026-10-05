"use client";

import Link from "next/link";
import type { IndexClub } from "@hci/db/local";
import { typeaheadSubline } from "@/lib/typeahead";
import { RowRecruiting } from "./row-recruiting";

/**
 * The search box's suggestion list. Its own module, loaded only where typeahead runs (not on
 * the directory, where results update in place), so the directory doesn't ship its pills
 * and labels twice.
 */
export function TypeaheadList({
  id,
  matches,
  active,
  optionId,
}: {
  id: string;
  matches: readonly IndexClub[];
  active: number;
  optionId: (i: number) => string;
}) {
  return (
    <ul
      id={id}
      role="listbox"
      aria-label="Matching clubs"
      // Keep focus in the input while a suggestion is pressed: on touch the blur can otherwise
      // close (unmount) the list before the tap becomes a click.
      onMouseDown={(e) => e.preventDefault()}
      className="absolute top-full right-0 left-0 z-40 mt-1.5 overflow-hidden rounded-xl border border-stone-200 bg-white text-left shadow-lg dark:border-stone-700 dark:bg-stone-900"
    >
      {matches.map((c, i) => {
        const sub = typeaheadSubline(c);
        return (
          <li
            key={c.id}
            role="presentation"
            className={`flex items-center px-3 ${i === active ? "bg-stone-100 dark:bg-stone-800" : ""}`}
          >
            <Link
              id={optionId(i)}
              role="option"
              aria-selected={i === active}
              href={`/clubs/${c.slug}`}
              prefetch={false}
              tabIndex={-1}
              className="flex min-h-11 min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-0.5 py-1.5 text-sm"
            >
              <span className="font-medium">{c.name}</span>
              {c.acronym ? <span className="text-stone-500 dark:text-stone-400">{c.acronym}</span> : null}
              {c.currentCycle ? <RowRecruiting cycle={c.currentCycle} seasons={c.recruitingSeasons} /> : null}
              {sub ? <span className="basis-full truncate text-xs text-stone-500 dark:text-stone-400">{sub}</span> : null}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
