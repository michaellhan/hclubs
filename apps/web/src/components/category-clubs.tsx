"use client";

import Link from "next/link";
import { useMemo } from "react";
import { withLiveStatus, type IndexClub } from "@hci/db/local";
import { orderCategoryClubs } from "@/lib/category-overview";
import { pluralize } from "@/lib/format";
import { useNow } from "@/lib/use-now";
import { ClubRow } from "./club-row";
import { ShowMoreSummary } from "./ui";

const SHOWN = 25;
const LIST = "hc-list";
const CHIP = "hc-chip";

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
            <Link href={`${directoryHref}&open=1&all=1`} className={CHIP}>
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
          <ShowMoreSummary closed={`Show all ${ordered.length}`} open={`Hide ${pluralize(rest.length, "more club")}`} />
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
