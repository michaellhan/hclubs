import Link from "next/link";
import { Suspense } from "react";
import { getCategories, getIndexStats, getRecruitingNow } from "@hci/db";
import { ClubRow } from "@/components/club-row";
import { SearchBox } from "@/components/search-box";
import { EmptyState, SectionHeading } from "@/components/ui";
import { db } from "@/lib/db";
import { pluralize } from "@/lib/format";

export const dynamic = "force-dynamic";

const QUICK_FILTERS = [
  { label: "Recruiting now", href: "/clubs?recruiting=1&sort=deadline" },
  { label: "No application needed", href: "/clubs?join=open" },
  { label: "Open to first-years", href: "/clubs?freshmen=1" },
  { label: "Has a comp", href: "/clubs?join=comp" },
  { label: "Auditions", href: "/clubs?join=audition" },
];

export default async function HomePage() {
  const now = new Date();
  const [stats, categories, recruiting] = await Promise.all([
    getIndexStats(db()),
    getCategories(db()),
    getRecruitingNow(db(), now, 6),
  ]);
  const topLevel = categories.filter((c) => c.parentSlug === null);

  return (
    <div className="space-y-12">
      <section className="mx-auto max-w-2xl pt-4 text-center sm:pt-10">
        <h1 className="text-3xl font-semibold tracking-tight text-balance sm:text-4xl">
          Every Harvard club, in one place.
        </h1>
        <p className="mx-auto mt-3 max-w-xl text-zinc-600 text-pretty dark:text-zinc-400">
          What they do, how to join, when applications close, and how much time they take — with a source behind every
          fact.
        </p>
        <div className="mt-6">
          <Suspense>
            <SearchBox size="lg" autoFocus />
          </Suspense>
        </div>
        <div className="mt-4 flex flex-wrap justify-center gap-2">
          {QUICK_FILTERS.map((f) => (
            <Link
              key={f.href}
              href={f.href}
              className="rounded-full border border-zinc-200 px-3 py-1 text-sm text-zinc-700 hover:border-zinc-400 hover:bg-zinc-50 dark:border-zinc-800 dark:text-zinc-300 dark:hover:border-zinc-600 dark:hover:bg-zinc-900"
            >
              {f.label}
            </Link>
          ))}
        </div>
        <p className="tabular mt-5 text-xs text-zinc-500">
          {pluralize(stats.clubs, "organization")} indexed from {pluralize(stats.sources, "source")}
          {stats.fixtureClubs > 0 ? ` · includes ${stats.fixtureClubs} fictional demo clubs` : ""}
        </p>
      </section>

      <section>
        <SectionHeading
          aside={
            <Link
              href="/clubs?recruiting=1&sort=deadline"
              className="text-sm text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100"
            >
              All recruiting →
            </Link>
          }
        >
          Recruiting now
        </SectionHeading>
        {recruiting.length > 0 ? (
          <ul className="divide-y divide-zinc-100 overflow-hidden rounded-xl border border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800">
            {recruiting.map((c) => (
              <ClubRow key={c.id} club={c} now={now} />
            ))}
          </ul>
        ) : (
          <EmptyState title="No open applications we know of">
            Deadlines appear here as soon as we have a source for them.
          </EmptyState>
        )}
      </section>

      <section>
        <SectionHeading>Browse by category</SectionHeading>
        <div className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-zinc-200 bg-zinc-200 sm:grid-cols-3 lg:grid-cols-4 dark:border-zinc-800 dark:bg-zinc-800">
          {topLevel.map((c) => (
            <Link
              key={c.slug}
              href={`/clubs?category=${c.slug}`}
              className="group bg-white p-4 hover:bg-zinc-50 dark:bg-zinc-950 dark:hover:bg-zinc-900"
            >
              <div className="flex items-baseline justify-between gap-2">
                <span className="font-medium group-hover:underline">{c.name}</span>
                <span className="tabular text-xs text-zinc-400">{c.clubCount}</span>
              </div>
              {c.description ? (
                <p className="mt-1 line-clamp-2 text-xs text-zinc-500 dark:text-zinc-400">{c.description}</p>
              ) : null}
            </Link>
          ))}
        </div>
      </section>

      <section className="grid gap-6 border-t border-zinc-200 pt-8 text-sm sm:grid-cols-3 dark:border-zinc-800">
        {[
          [
            "Evidence first",
            "Each fact links to where it came from and when we saw it. We don't guess acceptance rates or member counts.",
          ],
          [
            "Built for recruiting season",
            "Deadlines, comp stages, and time commitments — scoped to the semester they apply to.",
          ],
          [
            "Unknown means unknown",
            "Missing data is labeled, not filled in. Estimates are always marked as estimates.",
          ],
        ].map(([t, d]) => (
          <div key={t}>
            <p className="font-medium">{t}</p>
            <p className="mt-1 text-zinc-600 dark:text-zinc-400">{d}</p>
          </div>
        ))}
      </section>
    </div>
  );
}
