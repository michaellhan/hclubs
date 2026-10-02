"use client";

import Link from "next/link";
import {
  ClubFilters,
  buildRecruitingBoard,
  buildUsuallyRecruiting,
  recruitingSeasonForDate,
  searchLocal,
  type IndexClub,
} from "@hci/db/local";
import { useIndex } from "@/lib/use-index";
import { useNow } from "@/lib/use-now";
import { ClubRow } from "./club-row";
import { EmptyState } from "./ui";

/**
 * "Recruiting now" (home page, category pages): computed in the browser so it's right on
 * the day you visit. With `category`, only that category; with `quiet`, nothing at all
 * when no club is recruiting.
 */
export function RecruitingNow({
  limit = 6,
  category,
  quiet = false,
  heading,
}: {
  limit?: number;
  category?: string;
  quiet?: boolean;
  /** Shown above the list, and only when there is a list (for `quiet` sections). */
  heading?: React.ReactNode;
}) {
  const { data, error } = useIndex();
  const now = useNow();
  if (error)
    return quiet ? null : <EmptyState title="Couldn't load recruiting data">Try reloading the page.</EmptyState>;
  if (!data || !now) return quiet ? null : <ListSkeleton rows={3} />;
  const filters = ClubFilters.parse({ recruitingNow: true, ...(category ? { categories: [category] } : {}) });
  const { clubs } = searchLocal(data.clubs, { text: null, filters, sort: "deadline", offset: 0, limit, now });
  if (quiet && clubs.length === 0) return null;
  return clubs.length > 0 ? (
    <section>
      {heading}
      <ul className="divide-y divide-stone-100 overflow-hidden rounded-xl border border-stone-200 dark:divide-stone-800 dark:border-stone-800">
        {clubs.map((c) => (
          <ClubRow key={c.id} club={c} />
        ))}
      </ul>
    </section>
  ) : (
    <EmptyState title="No open applications we know of right now">
      <OffSeason clubs={data.clubs} now={now} category={category} />
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

/**
 * Between recruiting rounds the box still says what is known: comps opening soon and clubs
 * that usually recruit this season (a pattern, never a date). Both live on /recruiting.
 */
function OffSeason({
  clubs,
  now,
  category,
}: {
  clubs: readonly IndexClub[];
  now: Date;
  category?: string | undefined;
}) {
  const q = { now, ...(category ? { category } : {}) };
  const upcoming = buildRecruitingBoard(clubs, q).upcoming.length;
  const usually = buildUsuallyRecruiting(clubs, q).length;
  const season = recruitingSeasonForDate(now);
  const bits = [
    upcoming ? `${upcoming} opening soon` : null,
    usually ? `${usually} that usually recruit in the ${season}` : null,
  ].filter(Boolean);
  return (
    <>
      Deadlines appear here as soon as a source states one.{" "}
      {bits.length ? (
        <Link href="/recruiting" className="underline underline-offset-2">
          See {bits.join(" and ")} on the recruiting board
        </Link>
      ) : null}
    </>
  );
}
