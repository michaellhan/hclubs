import type { Metadata } from "next";
import Link from "next/link";
import { CLASS_YEAR_LABEL, JOIN_MODE_LABEL, JoinMode, formatTerm, type ClassYear } from "@hci/core";
import { getCategories, getRecruitingBoard, type RecruitingEntry } from "@hci/db";
import { CycleStatusPill, JoinModePills } from "@/components/club-bits";
import { DemoPill, EmptyState, LogoPlaceholder, SectionHeading } from "@/components/ui";
import { db } from "@/lib/db";
import { formatDateValue, relativeDays } from "@/lib/format";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Recruiting" };

type SP = Record<string, string | string[] | undefined>;
const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
const WINDOWS = [
  ["", "Any time"],
  ["7", "Next 7 days"],
  ["14", "Next 2 weeks"],
  ["30", "Next 30 days"],
] as const;
const CLASS_OPTIONS: ClassYear[] = ["first_year", "sophomore", "junior", "senior"];
const JOIN_OPTIONS: JoinMode[] = ["application", "comp", "audition", "tryout"];

function Row({ entry, now }: { entry: RecruitingEntry; now: Date }) {
  const { club, cycle } = entry;
  return (
    <li className="relative flex gap-3 px-3 py-3 hover:bg-zinc-50 sm:px-4 dark:hover:bg-zinc-900/60">
      <LogoPlaceholder name={club.name} size="sm" />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-x-2">
          <Link href={`/clubs/${club.slug}`} className="font-semibold after:absolute after:inset-0 hover:underline">
            {club.name}
          </Link>
          {club.acronym ? <span className="text-sm text-zinc-500">{club.acronym}</span> : null}
          {club.isFixture ? <DemoPill /> : null}
        </div>
        <div className="relative mt-1 flex flex-wrap items-center gap-1.5 text-xs">
          <CycleStatusPill cycle={cycle} now={now} />
          <JoinModePills modes={cycle.processTypes.length ? cycle.processTypes : club.joinModes} />
          {cycle.eligibleClasses?.length ? (
            <span className="text-zinc-500">
              Open to {cycle.eligibleClasses.map((c) => CLASS_YEAR_LABEL[c as ClassYear]).join(", ")}
            </span>
          ) : club.freshmenEligible ? (
            <span className="text-zinc-500">First-years eligible</span>
          ) : null}
          {club.categories[0] ? <span className="text-zinc-400">{club.categories[0].name}</span> : null}
        </div>
      </div>
      <div className="hidden shrink-0 text-right text-xs sm:block">
        <div className="tabular font-medium">{cycle.deadline ? formatDateValue(cycle.deadline, now) : "—"}</div>
        <div className="text-zinc-400">{formatTerm(cycle.termKey)}</div>
        {cycle.lastVerifiedAt ? (
          <div className="text-zinc-400">checked {relativeDays(cycle.lastVerifiedAt, now)}</div>
        ) : null}
        {cycle.applicationUrl && !club.isFixture ? (
          <a
            href={cycle.applicationUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="relative underline decoration-zinc-300 underline-offset-2"
          >
            Apply
          </a>
        ) : null}
      </div>
    </li>
  );
}

function Group({
  title,
  entries,
  now,
  empty,
}: {
  title: string;
  entries: RecruitingEntry[];
  now: Date;
  empty: string;
}) {
  return (
    <section>
      <SectionHeading aside={<span className="tabular text-xs text-zinc-400">{entries.length}</span>}>
        {title}
      </SectionHeading>
      {entries.length ? (
        <ul className="divide-y divide-zinc-100 overflow-hidden rounded-xl border border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800">
          {entries.map((e) => (
            <Row key={e.cycle.id} entry={e} now={now} />
          ))}
        </ul>
      ) : (
        <p className="text-sm text-zinc-500">{empty}</p>
      )}
    </section>
  );
}

export default async function RecruitingPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const now = new Date();
  const category = first(sp.category)?.match(/^[a-z0-9-]+$/)?.[0] ?? null;
  const join = JoinMode.safeParse(first(sp.join)).data ?? null;
  const classYear = (CLASS_OPTIONS as string[]).includes(first(sp.class) ?? "") ? (first(sp.class) as ClassYear) : null;
  const within = Number(first(sp.within)) || null;
  const [board, categories] = await Promise.all([
    getRecruitingBoard(db(), {
      now,
      ...(category ? { categories: [category] } : {}),
      ...(join ? { joinModes: [join] } : {}),
      classYear:
        classYear === "graduate" ? null : (classYear as "first_year" | "sophomore" | "junior" | "senior" | null),
      withinDays: within,
    }),
    getCategories(db()),
  ]);
  const hrefWith = (patch: Record<string, string | null>) => {
    const p = new URLSearchParams();
    const cur: Record<string, string | null> = {
      category,
      join,
      class: classYear,
      within: within ? String(within) : null,
      ...patch,
    };
    for (const [k, v] of Object.entries(cur)) if (v) p.set(k, v);
    return p.size ? `/recruiting?${p}` : "/recruiting";
  };
  const chip = (active: boolean) =>
    `rounded-full border px-2.5 py-1 text-xs ${active ? "border-zinc-900 bg-zinc-900 text-white dark:border-zinc-100 dark:bg-zinc-100 dark:text-zinc-900" : "border-zinc-200 text-zinc-600 hover:border-zinc-400 dark:border-zinc-800 dark:text-zinc-400"}`;

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Recruiting</h1>
        <p className="mt-1 max-w-2xl text-sm text-zinc-500">
          Applications, comps, auditions and tryouts with a sourced date. Each entry shows when we last checked it —
          always confirm on the club&apos;s own page before a deadline.
        </p>
      </div>

      <div className="space-y-2">
        <div className="flex flex-wrap gap-1.5">
          {WINDOWS.map(([v, label]) => (
            <Link key={label} href={hrefWith({ within: v || null })} className={chip(String(within ?? "") === v)}>
              {label}
            </Link>
          ))}
        </div>
        <div className="flex flex-wrap gap-1.5">
          <Link href={hrefWith({ join: null })} className={chip(!join)}>
            Any process
          </Link>
          {JOIN_OPTIONS.map((j) => (
            <Link key={j} href={hrefWith({ join: j })} className={chip(join === j)}>
              {JOIN_MODE_LABEL[j]}
            </Link>
          ))}
          <span className="mx-1 w-px bg-zinc-200 dark:bg-zinc-800" />
          <Link href={hrefWith({ class: null })} className={chip(!classYear)}>
            Any class
          </Link>
          {CLASS_OPTIONS.map((c) => (
            <Link key={c} href={hrefWith({ class: c })} className={chip(classYear === c)}>
              {CLASS_YEAR_LABEL[c]}
            </Link>
          ))}
        </div>
        <form action="/recruiting" className="flex items-center gap-2 text-xs">
          {join ? <input type="hidden" name="join" value={join} /> : null}
          {classYear ? <input type="hidden" name="class" value={classYear} /> : null}
          {within ? <input type="hidden" name="within" value={within} /> : null}
          <label htmlFor="category" className="text-zinc-500">
            Category
          </label>
          <select
            id="category"
            name="category"
            defaultValue={category ?? ""}
            className="h-8 rounded-md border border-zinc-300 bg-white px-2 dark:border-zinc-700 dark:bg-zinc-900"
          >
            <option value="">All</option>
            {categories.map((c) => (
              <option key={c.slug} value={c.slug}>
                {c.parentSlug ? "— " : ""}
                {c.name}
              </option>
            ))}
          </select>
          <button type="submit" className="h-8 rounded-md border border-zinc-300 px-2 dark:border-zinc-700">
            Apply
          </button>
        </form>
      </div>

      {board.open.length + board.upcoming.length + board.recentlyClosed.length === 0 ? (
        <EmptyState title="No sourced recruiting dates match">
          Clubs appear here once we find a dated application, comp, audition or tryout on an official page.
        </EmptyState>
      ) : (
        <>
          <Group title="Open now / deadline ahead" entries={board.open} now={now} empty="Nothing open that matches." />
          <Group title="Opening soon" entries={board.upcoming} now={now} empty="No announced openings." />
          <Group
            title="Recently closed (last 30 days)"
            entries={board.recentlyClosed}
            now={now}
            empty="Nothing closed recently."
          />
        </>
      )}
    </div>
  );
}
