import Link from "next/link";
import { matchesFirstYears, reasonText, type ListedClub, type MatchReason } from "@hci/db/local";
import { formatRange } from "@/lib/format";
import { CycleStatusPill, JoinModePills } from "./club-bits";
import { QuickLinks } from "./link-icons";
import { ClubLogo } from "./club-logo";
import { CompareToggle } from "./compare-tray";
import { DemoPill, Pill } from "./ui";

/**
 * Dense directory row: what it is, how to join, whether it's recruiting, where to learn
 * more. Everything shown is resolved projection data. `why` lists what a text search
 * matched besides the name ("category Consulting", "mentions “software”").
 */
export function ClubRow({
  club,
  why,
}: {
  club: ListedClub & { noComp?: true };
  why?: MatchReason[] | string[] | undefined;
}) {
  // A plain name match is visible in the row already; say what else matched.
  const matched = (why ?? [])
    .map((r) => (typeof r === "string" ? r : r.kind === "name" ? null : reasonText(r)))
    .filter((r): r is string => r !== null)
    .slice(0, 2);
  const members = formatRange(club.memberCount);
  const hours = formatRange(club.hoursPerWeek, "h/wk");
  return (
    <li className="group relative flex gap-3 px-3 py-3 hover:bg-stone-50 sm:px-4 dark:hover:bg-stone-900/60">
      <ClubLogo name={club.name} src={club.isFixture ? null : club.logo} />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
          <Link
            href={`/clubs/${club.slug}`}
            data-result=""
            className="font-semibold tracking-tight after:absolute after:inset-0 hover:underline"
          >
            {club.name}
          </Link>
          {club.acronym ? <span className="text-sm text-stone-500 dark:text-stone-400">{club.acronym}</span> : null}
          {club.isFixture ? <DemoPill /> : null}
        </div>
        {club.shortDescription ? (
          <p className="mt-0.5 line-clamp-2 text-sm text-stone-600 sm:line-clamp-1 dark:text-stone-400">
            {club.shortDescription}
          </p>
        ) : null}
        {matched.length ? (
          <p className="mt-0.5 text-xs text-stone-500 dark:text-stone-400">
            <span className="sr-only">Matched: </span>
            {matched.join(" · ")}
          </p>
        ) : null}
        <div className="relative mt-1.5 flex flex-wrap items-center gap-1.5">
          {club.currentCycle && club.currentCycle.status !== "unknown" ? (
            <CycleStatusPill cycle={club.currentCycle} hideClosedAfterDays={21} />
          ) : null}
          <JoinModePills modes={club.joinModes} max={2} />
          {club.joinModes.length === 0 && club.noComp ? (
            <Pill tone="green" title="The College's student-organization directory lists no comping requirement">
              No comp
            </Pill>
          ) : null}
          {matchesFirstYears(club) ? <Pill tone="blue">Takes first-years</Pill> : null}
          {club.categories.slice(0, 2).map((c) => (
            <span key={c.slug} className="text-xs text-stone-500 dark:text-stone-400">
              {c.name}
            </span>
          ))}
        </div>
      </div>
      {club.isFixture || !club.quickLinks ? null : <QuickLinks links={club.quickLinks} name={club.name} />}
      {members || hours ? (
        <dl className="hidden w-28 shrink-0 grid-cols-[auto_auto] justify-end whitespace-nowrap gap-x-2 gap-y-0.5 self-center text-right text-xs sm:grid">
          {members ? (
            <>
              <dt className="text-stone-500">Members</dt>
              <dd className="tabular font-medium text-stone-700 dark:text-stone-300">{members}</dd>
            </>
          ) : null}
          {hours ? (
            <>
              <dt className="text-stone-500">Time</dt>
              <dd className="tabular font-medium text-stone-700 dark:text-stone-300">{hours}</dd>
            </>
          ) : null}
        </dl>
      ) : (
        <div className="hidden w-28 shrink-0 sm:block" />
      )}
      {club.isFixture ? null : (
        <div className="self-center">
          <CompareToggle slug={club.slug} />
        </div>
      )}
    </li>
  );
}
