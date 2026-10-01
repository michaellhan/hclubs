"use client";

import Link from "next/link";
import { isRecruitingNow } from "@hci/core/browser";
import { withLiveStatus, type ListedClub } from "@hci/db/local";
import { formatDateValue, relativeDateValue } from "@/lib/format";
import { useNow } from "@/lib/use-now";
import { ClubLogo } from "../club-logo";
import { SectionHeading } from "../ui";

/** A similar club with what the alternatives need to know (build-time picked, live-filtered). */
export interface AlternativeCandidate {
  club: Pick<ListedClub, "id" | "slug" | "name" | "logo" | "shortDescription" | "isFixture">;
  /** Dated cycles (the browser decides which are still open). */
  cycles: ListedClub["currentCycle"][];
  /** "Also Consulting". */
  reason: string | null;
  /** Says anyone can join, or the College directory lists no comping requirement (an application may remain). */
  openJoin: boolean;
  /** The club itself says anyone can join (not only the directory's "no comp" flag). */
  statesOpen: boolean;
}

/**
 * "Missed the deadline? / Prefer no application?" on a profile: similar clubs (the same
 * fixed similarity as "Similar clubs") that are recruiting right now, or that anyone can
 * join. Shown only when this club's own cycle is closed (or it has no open cycle) or it
 * selects members. Rule-based and explained; recomputed on the reader's day.
 */
export function Alternatives({
  candidates,
  ownCycle,
  selective,
}: {
  candidates: AlternativeCandidate[];
  ownCycle: ListedClub["currentCycle"];
  selective: boolean;
}) {
  const now = useNow();
  if (!now) return null;
  const own = ownCycle ? withLiveStatus(ownCycle, now) : null;
  if (own && (isRecruitingNow(own.status) || own.status === "upcoming")) return null;
  const recruiting = candidates
    .map((c) => {
      const live = c.cycles
        .filter((cy): cy is NonNullable<typeof cy> => cy !== null)
        .map((cy) => withLiveStatus(cy, now))
        .find((cy) => isRecruitingNow(cy.status) || cy.status === "upcoming");
      return live ? { ...c, live } : null;
    })
    .filter((c): c is AlternativeCandidate & { live: NonNullable<ListedClub["currentCycle"]> } => c !== null)
    .slice(0, 3);
  const open = selective
    ? candidates
        .filter((c) => c.openJoin && !recruiting.some((r) => r.club.id === c.club.id))
        // Clubs that say anyone can join before ones only the directory's "no comp" flag lets in.
        .sort((a, b) => Number(b.statesOpen) - Number(a.statesOpen))
        .slice(0, 3)
    : [];
  if (!recruiting.length && !open.length) return null;
  const closed = own?.status === "closed";
  return (
    <section aria-labelledby="alternatives-heading">
      <SectionHeading id="alternatives-heading">{closed ? "Missed this deadline?" : "Other ways in"}</SectionHeading>
      <ul className="divide-y divide-stone-100 overflow-hidden rounded-xl border border-stone-200 dark:divide-stone-800 dark:border-stone-800">
        {recruiting.map((c) => (
          <Item key={c.club.id} c={c}>
            {liveLabel(c.live, now)}
          </Item>
        ))}
        {open.map((c) => (
          <Item key={c.club.id} c={c}>
            {c.statesOpen ? "Open membership — anyone can join" : "No comp needed, per the College directory"}
          </Item>
        ))}
      </ul>
      <p className="mt-1.5 text-[11px] text-stone-500 dark:text-stone-400">
        Similar clubs (shared categories and descriptions) that are recruiting, say anyone can join, or are listed with
        no comping requirement. Not a ranking.
      </p>
    </section>
  );
}

/** An upcoming cycle is never "Recruiting now", even when its deadline is known. */
function liveLabel(cy: NonNullable<ListedClub["currentCycle"]>, now: Date): string {
  const due = cy.deadline ? `due ${formatDateValue(cy.deadline, now)} (${relativeDateValue(cy.deadline, now)})` : null;
  if (isRecruitingNow(cy.status)) return due ? `Recruiting now · ${due}` : "Recruiting now";
  if (cy.opens) return `Opens ${formatDateValue(cy.opens, now)}${due ? ` · ${due}` : ""}`;
  return due ? `Opens soon · ${due}` : "Opens soon";
}

function Item({ c, children }: { c: AlternativeCandidate; children: React.ReactNode }) {
  return (
    <li className="relative flex items-center gap-3 px-3 py-2.5 hover:bg-stone-50 dark:hover:bg-stone-900/60">
      <ClubLogo name={c.club.name} src={c.club.isFixture ? null : c.club.logo} size="sm" />
      <div className="min-w-0 flex-1">
        <Link
          href={`/clubs/${c.club.slug}`}
          className="text-sm font-medium after:absolute after:inset-0 hover:underline"
        >
          {c.club.name}
        </Link>
        <p className="text-xs text-emerald-700 dark:text-emerald-400">{children}</p>
        {c.reason ? <p className="text-[11px] text-stone-500 dark:text-stone-400">{c.reason}</p> : null}
      </div>
    </li>
  );
}
