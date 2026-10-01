import Link from "next/link";
import { Suspense } from "react";
import { getCategories, getIndexStats } from "@hci/db";
import { RecruitingNow } from "@/components/recruiting-now";
import { SearchBox } from "@/components/search-box";
import { SectionHeading } from "@/components/ui";
import { db } from "@/lib/db";
import { intentCounts, presetCounts } from "@/lib/discovery";
import { pluralize } from "@/lib/format";
import { buildTimeIndex } from "@/lib/static-index";

export default async function HomePage() {
  const [stats, categories, index] = await Promise.all([getIndexStats(db()), getCategories(db()), buildTimeIndex()]);
  const topLevel = categories.filter((c) => c.parentSlug === null);
  const presets = presetCounts(index.clubs);
  const intents = intentCounts(index.clubs);

  return (
    <div className="space-y-12">
      <section className="mx-auto max-w-2xl pt-4 text-center sm:pt-10">
        <h1 className="text-3xl font-semibold tracking-tight text-balance sm:text-4xl">
          Every Harvard club, in one place.
        </h1>
        <p className="mx-auto mt-3 max-w-xl text-zinc-600 text-pretty dark:text-zinc-400">
          What they do, how to join, when applications close, and how much time they take.
        </p>
        <div className="mt-6">
          <Suspense>
            <SearchBox size="lg" autoFocus />
          </Suspense>
        </div>
        <div className="mt-4 flex flex-wrap justify-center gap-2">
          <Link
            href="/clubs?recruiting=1&sort=deadline"
            className="rounded-full border border-zinc-200 px-3.5 py-2 text-sm text-zinc-700 hover:border-zinc-400 hover:bg-zinc-50 sm:py-1 dark:border-zinc-800 dark:text-zinc-300 dark:hover:border-zinc-600 dark:hover:bg-zinc-900"
          >
            Recruiting now
          </Link>
          {presets.map((f) => (
            <Link
              key={f.href}
              href={f.href}
              className="rounded-full border border-zinc-200 px-3.5 py-2 text-sm text-zinc-700 hover:border-zinc-400 hover:bg-zinc-50 sm:py-1 dark:border-zinc-800 dark:text-zinc-300 dark:hover:border-zinc-600 dark:hover:bg-zinc-900"
            >
              {f.label} <span className="tabular text-xs text-zinc-500 dark:text-zinc-400">{f.count}</span>
            </Link>
          ))}
        </div>
        <p className="tabular mt-5 text-xs text-zinc-500">
          {pluralize(stats.clubs, "organization")} indexed
          {stats.fixtureClubs > 0 ? ` · includes ${stats.fixtureClubs} fictional demo clubs` : ""}
        </p>
      </section>

      <section>
        <SectionHeading
          aside={
            <Link
              href="/clubs?recruiting=1&sort=deadline"
              className="-my-2 inline-block py-2 text-sm text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100"
            >
              All recruiting →
            </Link>
          }
        >
          Recruiting now
        </SectionHeading>
        <RecruitingNow />
      </section>

      <section>
        <SectionHeading>What do you want to do?</SectionHeading>
        <ul className="grid grid-cols-1 gap-px overflow-hidden rounded-xl border border-zinc-200 bg-zinc-200 sm:grid-cols-2 lg:grid-cols-3 dark:border-zinc-800 dark:bg-zinc-800">
          {intents.map((i) => (
            <li key={i.slug} className="bg-white dark:bg-zinc-950">
              <Link
                href={`/clubs?do=${i.slug}`}
                className="flex min-h-12 items-center justify-between gap-2 px-4 py-3 hover:bg-zinc-50 dark:hover:bg-zinc-900"
              >
                <span className="font-medium">{i.label}</span>
                <span className="tabular text-xs text-zinc-500 dark:text-zinc-400">
                  {i.count}
                  <span className="sr-only"> clubs</span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
        <p className="mt-2 text-xs text-zinc-500 dark:text-zinc-400">
          Each list is a fixed rule over clubs&apos; categories and descriptions, not a personalized recommendation.
        </p>
      </section>

      <section>
        <SectionHeading>Browse by category</SectionHeading>
        <div className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-zinc-200 bg-zinc-200 sm:grid-cols-3 lg:grid-cols-4 dark:border-zinc-800 dark:bg-zinc-800">
          {topLevel.map((c) => (
            <Link
              key={c.slug}
              href={`/categories/${c.slug}`}
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

      <p className="border-t border-zinc-200 pt-6 text-sm text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
        Many clubs are still missing details.{" "}
        <Link href="/contribute" className="font-medium text-zinc-900 underline underline-offset-2 dark:text-zinc-100">
          Help fill them in
        </Link>
        .
      </p>
    </div>
  );
}
