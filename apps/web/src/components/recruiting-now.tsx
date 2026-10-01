"use client";

import { ClubFilters, searchLocal } from "@hci/db/local";
import { useIndex } from "@/lib/use-index";
import { useNow } from "@/lib/use-now";
import { ClubRow } from "./club-row";
import { EmptyState } from "./ui";

const FILTERS = ClubFilters.parse({ recruitingNow: true });

/** Home-page "Recruiting now": computed in the browser so it's right on the day you visit. */
export function RecruitingNow({ limit = 6 }: { limit?: number }) {
  const { data, error } = useIndex();
  const now = useNow();
  if (error) return <EmptyState title="Couldn't load recruiting data">Try reloading the page.</EmptyState>;
  if (!data || !now) return <ListSkeleton rows={3} />;
  const { clubs } = searchLocal(data.clubs, { text: null, filters: FILTERS, sort: "deadline", offset: 0, limit, now });
  return clubs.length > 0 ? (
    <ul className="divide-y divide-stone-100 overflow-hidden rounded-xl border border-stone-200 dark:divide-stone-800 dark:border-stone-800">
      {clubs.map((c) => (
        <ClubRow key={c.id} club={c} />
      ))}
    </ul>
  ) : (
    <EmptyState title="No open applications we know of">
      Deadlines appear here as soon as we have a source for them.
    </EmptyState>
  );
}

export function ListSkeleton({ rows = 6 }: { rows?: number }) {
  return (
    <ul
      aria-busy="true"
      aria-label="Loading"
      className="divide-y divide-stone-100 overflow-hidden rounded-xl border border-stone-200 dark:divide-stone-800 dark:border-stone-800"
    >
      {Array.from({ length: rows }, (_, i) => (
        <li key={i} className="flex gap-3 px-4 py-3">
          <div className="size-10 animate-pulse rounded-lg bg-stone-100 dark:bg-stone-800" />
          <div className="flex-1 space-y-2 py-1">
            <div className="h-3 w-1/3 animate-pulse rounded bg-stone-100 dark:bg-stone-800" />
            <div className="h-3 w-2/3 animate-pulse rounded bg-stone-100 dark:bg-stone-800" />
          </div>
        </li>
      ))}
    </ul>
  );
}
