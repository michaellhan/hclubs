"use client";

import Link from "next/link";
import { useMemo } from "react";
import { withLiveStatus, type IndexClub } from "@hci/db/local";
import { orderCategoryClubs } from "@/lib/category-overview";
import { pluralize } from "@/lib/format";
import { useNow } from "@/lib/use-now";
import { ClubRow } from "./club-row";

const SHOWN = 25;
const LIST =
  "divide-y divide-stone-100 overflow-hidden rounded-xl border border-stone-200 dark:divide-stone-800 dark:border-stone-800";
const CHIP =
  "inline-flex min-h-8 items-center rounded-full border border-stone-200 px-3 text-sm hover:border-stone-400 dark:border-stone-800 dark:hover:border-stone-600";

/**
 * A category page's club list. Server-rendered in a fixed order (described clubs A–Z, then
 * sparse ones, numbers last) so it reads without JavaScript; after mount, clubs recruiting
 * right now on the viewer's clock move to the top (pages are built ahead, ADR 0022). The
 * first rows show; the rest sit in a <details> so every club stays in the HTML.
 */
export function CategoryClubs({
  clubs,
  directoryHref,
  openJoinCount,
}: {
  clubs: IndexClub[];
  directoryHref: string;
  openJoinCount: number;
}) {
  const now = useNow();
  const live = useMemo(() => {
    const ids = new Set<string>();
    if (!now) return ids;
    for (const c of clubs) {
      if (c.activityStatus === "defunct" || !c.currentCycle) continue;
      if (withLiveStatus(c.currentCycle, now).status === "open") ids.add(c.id);
    }
    return ids;
  }, [clubs, now]);
  const ordered = useMemo(() => orderCategoryClubs(clubs, (c) => live.has(c.id)), [clubs, live]);
  const head = ordered.slice(0, SHOWN);
  const rest = ordered.slice(SHOWN);

  return (
    <div className="space-y-3">
      {live.size > 0 || openJoinCount > 0 ? (
        <div className="flex flex-wrap gap-2">
          {live.size > 0 ? (
            <Link href={`${directoryHref}&recruiting=1`} className={CHIP}>
              Recruiting now <span className="tabular ml-1.5 text-stone-500">{live.size}</span>
            </Link>
          ) : null}
          {openJoinCount > 0 ? (
            <Link href={`${directoryHref}&open=1&all=1`} className={CHIP} data-tip="A source says anyone can join">
              Join anytime <span className="tabular ml-1.5 text-stone-500">{openJoinCount}</span>
            </Link>
          ) : null}
        </div>
      ) : null}
      <ul className={LIST}>
        {head.map((c) => (
          <ClubRow key={c.id} club={c} />
        ))}
      </ul>
      {rest.length > 0 ? (
        <details className="group">
          <summary className="inline-flex min-h-10 cursor-pointer items-center rounded-full border border-stone-200 px-4 text-sm font-medium hover:border-stone-400 dark:border-stone-800 dark:hover:border-stone-600">
            <span className="group-open:hidden">Show all {ordered.length}</span>
            <span className="hidden group-open:inline">Hide {pluralize(rest.length, "more club")}</span>
          </summary>
          <ul className={`${LIST} mt-3`}>
            {rest.map((c) => (
              <ClubRow key={c.id} club={c} />
            ))}
          </ul>
        </details>
      ) : null}
    </div>
  );
}
