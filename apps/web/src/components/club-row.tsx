import Link from "next/link";
import type { ClubSummary } from "@hci/db/local";
import { formatRange } from "@/lib/format";
import { CycleStatusPill, JoinModePills } from "./club-bits";
import { QuickLinks } from "./link-icons";
import { ClubLogo } from "./club-logo";
import { DemoPill, Pill } from "./ui";

/** Dense directory row. Everything shown is resolved projection data. */
export function ClubRow({ club }: { club: ClubSummary }) {
  const members = formatRange(club.memberCount);
  const hours = formatRange(club.hoursPerWeek, "h/wk");
  return (
    <li className="group relative flex gap-3 px-3 py-3 hover:bg-zinc-50 sm:px-4 dark:hover:bg-zinc-900/60">
      <ClubLogo name={club.name} src={club.isFixture ? null : club.logo} />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
          <Link
            href={`/clubs/${club.slug}`}
            className="font-semibold tracking-tight after:absolute after:inset-0 hover:underline"
          >
            {club.name}
          </Link>
          {club.acronym ? <span className="text-sm text-zinc-500 dark:text-zinc-400">{club.acronym}</span> : null}
          {club.isFixture ? <DemoPill /> : null}
        </div>
        {club.shortDescription ? (
          <p className="mt-0.5 line-clamp-2 text-sm text-zinc-600 sm:line-clamp-1 dark:text-zinc-400">
            {club.shortDescription}
          </p>
        ) : (
          <p className="mt-0.5 text-sm text-zinc-400 italic dark:text-zinc-500">No description yet</p>
        )}
        <div className="relative mt-1.5 flex flex-wrap items-center gap-1.5">
          {club.currentCycle && club.currentCycle.status !== "unknown" ? (
            <CycleStatusPill cycle={club.currentCycle} />
          ) : null}
          <JoinModePills modes={club.joinModes} />
          {club.freshmenEligible === true ? <Pill tone="blue">First-years OK</Pill> : null}
          {club.categories.slice(0, 2).map((c) => (
            <span key={c.slug} className="text-xs text-zinc-500 dark:text-zinc-400">
              {c.name}
            </span>
          ))}
        </div>
      </div>
      {club.isFixture || !club.quickLinks ? null : <QuickLinks links={club.quickLinks} name={club.name} />}
      <dl className="hidden shrink-0 grid-cols-[auto_auto] gap-x-3 gap-y-0.5 self-center text-right text-xs sm:grid">
        <dt className="text-zinc-400">Members</dt>
        <dd className="tabular font-medium text-zinc-700 dark:text-zinc-300">{members ?? "—"}</dd>
        <dt className="text-zinc-400">Time</dt>
        <dd className="tabular font-medium text-zinc-700 dark:text-zinc-300">{hours ?? "—"}</dd>
      </dl>
    </li>
  );
}
