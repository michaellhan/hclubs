"use client";

import Link from "next/link";
import { ClubFilters, searchLocal } from "@hci/db/local";
import { pluralize } from "@/lib/format";
import { useIndex } from "@/lib/use-index";
import { useNow } from "@/lib/use-now";
import { ClubRow } from "./club-row";

/**
 * "Recruiting now in <category>" (category pages): computed in the browser so it's right on
 * the day you visit, and nothing at all when no club in the category is recruiting.
 */
export function RecruitingNow({
  limit = 6,
  category,
  heading,
}: {
  limit?: number;
  category?: string;
  /** Shown above the list, and only when there is a list. */
  heading?: React.ReactNode;
}) {
  const { data } = useIndex();
  const now = useNow();
  if (!data || !now) return null;
  const filters = ClubFilters.parse({ recruitingNow: true, ...(category ? { categories: [category] } : {}) });
  const { clubs } = searchLocal(data.clubs, { text: null, filters, sort: "deadline", offset: 0, limit, now });
  if (clubs.length === 0) return null;
  return (
    <section>
      {heading}
      <ul className="hc-list">
        {clubs.map((c) => (
          <ClubRow key={c.id} club={c} />
        ))}
      </ul>
    </section>
  );
}

/**
 * The home page's one link: clubs recruiting now when a round is open on the reader's day,
 * else the whole directory. Never a link to an empty or misleadingly small list (most clubs
 * don't say how to join, so "join anytime" read as "only these").
 */
export function JoinNowLink() {
  const { data } = useIndex();
  const now = useNow();
  const count = (filters: Record<string, boolean>) =>
    data && now
      ? searchLocal(data.clubs, {
          text: null,
          filters: ClubFilters.parse(filters),
          sort: "name",
          offset: 0,
          limit: 1,
          now,
        }).total
      : 0;
  const recruiting = count({ recruitingNow: true });
  if (recruiting > 0) {
    return (
      <Link href="/clubs?recruiting=1" className="hc-chip-text">
        {pluralize(recruiting, "club")} recruiting now <span aria-hidden>→</span>
      </Link>
    );
  }
  // The directory's default view hides name-only clubs, so count what it will show.
  const shown = count({ hideSparse: true });
  return (
    <Link href="/clubs" className="hc-chip-text">
      {shown > 0 ? `Browse ${shown} clubs` : "Browse clubs"} <span aria-hidden>→</span>
    </Link>
  );
}

export function ListSkeleton({ rows = 6 }: { rows?: number }) {
  return (
    <ul aria-busy="true" aria-label="Loading" className="hc-list">
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
