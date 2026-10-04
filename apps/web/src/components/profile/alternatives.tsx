"use client";

import Link from "next/link";
import { RECRUITING_SEASON_LABEL, isRecruitingNow, nextStepText } from "@hci/core/browser";
import { buildBoardSections, buildNextChances, withLiveStatus, type IndexClub, type ListedClub } from "@hci/db/local";
import type { AlternativeCandidate } from "@/lib/alternatives";
import { formatDateValue, relativeDateValue } from "@/lib/format";
import { useNow } from "@/lib/use-now";
import { ClubLogo } from "../club-logo";
import { Disclosure } from "./disclosure";

export type { AlternativeCandidate };

const SHOWN = 3;

/**
 * "Missed this deadline? / Other ways in" on a profile. Built with the recruiting board's own
 * section builders (`buildBoardSections`, `buildNextChances`), recomputed on the reader's day,
 * so a club shown here as "join anytime" or "rolling" is the same on /recruiting:
 *  - this club's own next usual round (a pattern from its past recruiting, never a date);
 *  - similar clubs with an open or announced round;
 *  - similar clubs anyone can join, then (for selective clubs) ones the College directory
 *    lists with no comping requirement;
 *  - similar clubs that recruit on a rolling basis.
 * Shown only when this club's own round isn't open or announced.
 */
export function Alternatives({
  candidates,
  self,
  ownCycle,
  selective,
  boardCategory = null,
}: {
  candidates: AlternativeCandidate[];
  /** This club's index row (trimmed), for its own next chance. */
  self: IndexClub | null;
  ownCycle: ListedClub["currentCycle"];
  selective: boolean;
  /** Category for the "who's recruiting" link when this club's round closed. */
  boardCategory?: string | null;
}) {
  const now = useNow();
  if (!now) return null;
  const own = ownCycle ? withLiveStatus(ownCycle, now) : null;
  if (own && (isRecruitingNow(own.status) || own.status === "upcoming")) return null;

  const ownNext = self ? (buildNextChances([self], { now })[0] ?? null) : null;
  const s = buildBoardSections(
    candidates.map((c) => c.club),
    { now },
  );
  const reasonOf = new Map(candidates.map((c) => [c.club.id, c.reason]));
  const recruiting = [...s.board.open, ...s.board.upcoming].slice(0, SHOWN);
  const used = new Set(recruiting.map((e) => e.club.id));
  const anytime = s.anytime.filter((c) => !used.has(c.id)).slice(0, SHOWN);
  for (const c of anytime) used.add(c.id);
  const noComp = selective
    ? candidates
        .filter((c) => c.noComp && !used.has(c.club.id))
        .slice(0, Math.max(0, SHOWN - anytime.length))
        .map((c) => c.club)
    : [];
  for (const c of noComp) used.add(c.id);
  const rolling = s.chances.filter((c) => c.reason === "rolling" && !used.has(c.club.id)).slice(0, 2);
  const closed = own?.status === "closed";
  // A closed round always answers "what now?", even when nothing similar is open.
  if (!closed && !ownNext && !recruiting.length && !anytime.length && !noComp.length && !rolling.length) return null;

  const fmt = (d: Parameters<typeof formatDateValue>[0]) => formatDateValue(d, now) ?? "";
  const boardHref = boardCategory ? `/recruiting?category=${encodeURIComponent(boardCategory)}` : "/recruiting";
  const ownLine = ownNext
    ? ownNext.reason === "rolling"
      ? "This club recruits on a rolling basis."
      : `This club usually recruits again in ${RECRUITING_SEASON_LABEL[ownNext.next].toLowerCase()}.`
    : closed
      ? "No next round announced yet. Their site or Instagram is the place to watch."
      : null;
  const others = recruiting.length + anytime.length + noComp.length + rolling.length > 0;
  const body = (
    <>
      {ownLine ? <p className="mb-3 text-sm font-medium">{ownLine}</p> : null}
      {others ? (
        <>
          <ul className="hc-list">
            {recruiting.map((e) => (
              <Item key={e.club.id} club={e.club} reason={reasonOf.get(e.club.id) ?? null}>
                {nextStepText(e.cycle, e.club.joinModes, fmt)}
                {e.cycle.deadline && isRecruitingNow(e.cycle.status)
                  ? ` · ${relativeDateValue(e.cycle.deadline, now)}`
                  : ""}
              </Item>
            ))}
            {anytime.map((c) => (
              <Item key={c.id} club={c} reason={reasonOf.get(c.id) ?? null}>
                Open membership: anyone can join
              </Item>
            ))}
            {noComp.map((c) => (
              <Item key={c.id} club={c} reason={reasonOf.get(c.id) ?? null}>
                No comp, per the College directory
              </Item>
            ))}
            {rolling.map((c) => (
              <Item key={c.club.id} club={c.club} reason={reasonOf.get(c.club.id) ?? null}>
                Recruits on a rolling basis
              </Item>
            ))}
          </ul>
          <p className="mt-1.5 text-[11px] text-stone-500 dark:text-stone-400">
            Similar clubs (shared categories and descriptions) that are recruiting, say anyone can join, are listed with
            no comping requirement, or recruit on a rolling basis. Not a ranking.{" "}
            <Link href="/recruiting" className="hc-link-muted">
              See the recruiting board
            </Link>
          </p>
        </>
      ) : closed ? (
        <p className="text-sm text-stone-600 dark:text-stone-400">
          <Link href={boardHref} className="hc-link">
            See who&apos;s recruiting in this category
          </Link>
        </p>
      ) : null}
    </>
  );
  return (
    <Disclosure id="alternatives" open={closed} title={closed ? "Missed this deadline?" : "Other ways in"}>
      {body}
    </Disclosure>
  );
}

function Item({
  club,
  reason,
  children,
}: {
  club: Pick<ListedClub, "slug" | "name" | "logo" | "isFixture">;
  reason: string | null;
  children: React.ReactNode;
}) {
  return (
    <li className="hc-row">
      <ClubLogo name={club.name} src={club.isFixture ? null : club.logo} size="sm" />
      <div className="min-w-0 flex-1">
        <Link href={`/clubs/${club.slug}`} className="hc-row-title">
          {club.name}
        </Link>
        <p className="text-xs text-emerald-700 dark:text-emerald-400">{children}</p>
        {reason ? <p className="text-[11px] text-stone-500 dark:text-stone-400">{reason}</p> : null}
      </div>
    </li>
  );
}
