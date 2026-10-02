import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { getCategories, getIndexStats } from "@hci/db";
import { INTENT_GROUPS, isSparseClub } from "@hci/db/local";
import { RecruitingNow } from "@/components/recruiting-now";
import { SearchBox } from "@/components/search-box";
import { SectionHeading } from "@/components/ui";
import { db } from "@/lib/db";
import { intentCounts, mobileHiddenGroups, presetCounts } from "@/lib/discovery";
import { pluralize } from "@/lib/format";
import { buildTimeIndex } from "@/lib/static-index";
import { HOME_METADATA } from "@/lib/meta";
import { siteUrl } from "@/lib/site";

export const metadata: Metadata = HOME_METADATA;

/** schema.org WebSite for search engines; names the site only, implies no affiliation. */
function WebsiteJsonLd() {
  const data = {
    "@context": "https://schema.org",
    "@type": "WebSite",
    name: "hclubs",
    url: `${siteUrl()}/`,
    description:
      "An independent, student-built index of Harvard student clubs. Not affiliated with Harvard University.",
  };
  return <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(data) }} />;
}

export default async function HomePage() {
  const [stats, categories, index] = await Promise.all([getIndexStats(db()), getCategories(db()), buildTimeIndex()]);
  const topLevel = categories.filter((c) => c.parentSlug === null);
  const presets = presetCounts(index.clubs);
  const intents = intentCounts(index.clubs);
  const meet = intents.find((i) => i.slug === "meet-people");
  const groups = INTENT_GROUPS.map((g) => ({ g, list: intents.filter((i) => i.group === g.key) })).filter(
    (x) => x.list.length > 0,
  );
  const hiddenOnPhone = mobileHiddenGroups(groups.map((x) => x.list.length));
  const described = index.clubs.filter((c) => !c.isFixture && !isSparseClub(c)).length;
  const EXAMPLES = ["quant", "a cappella", "debate", "hiking", "hccg", "premed", "theatre"];

  return (
    <div className="space-y-12">
      <WebsiteJsonLd />
      <section className="mx-auto max-w-2xl pt-4 text-center sm:pt-10">
        <h1 className="text-3xl font-semibold tracking-tight text-balance sm:text-4xl">
          Every Harvard club, <span className="text-accent">in one place.</span>
        </h1>
        <p className="mx-auto mt-3 max-w-xl text-stone-600 text-pretty dark:text-stone-400">
          What they do, how to join, when applications close, and how much time they take.
        </p>
        <div className="mt-6">
          <Suspense>
            <SearchBox size="lg" autoFocus />
          </Suspense>
        </div>
        <p className="mt-2.5 text-xs text-stone-500 dark:text-stone-400">
          Try{" "}
          {EXAMPLES.map((q, i) => (
            <span key={q}>
              {i ? ", " : ""}
              <Link
                href={`/clubs?q=${encodeURIComponent(q)}`}
                className="text-stone-700 underline decoration-stone-300 underline-offset-2 hover:decoration-stone-700 dark:text-stone-300 dark:decoration-stone-600"
              >
                {q}
              </Link>
            </span>
          ))}
        </p>
        <div className="mt-4 flex flex-wrap justify-center gap-2">
          {/* The board, not a "recruiting now" filter: open-now is computed in the browser and is
              often empty between rounds; the board also lists what's opening and the usual season. */}
          <Link
            href="/recruiting"
            className="rounded-full border border-stone-200 px-3.5 py-2 text-sm text-stone-700 hover:border-accent/40 hover:bg-accent-soft hover:text-accent sm:py-1 dark:border-stone-800 dark:text-stone-300"
          >
            Recruiting board
          </Link>
          {meet ? (
            <Link
              href="/clubs?do=meet-people"
              className="rounded-full border border-stone-200 px-3.5 py-2 text-sm text-stone-700 hover:border-accent/40 hover:bg-accent-soft hover:text-accent sm:py-1 dark:border-stone-800 dark:text-stone-300"
            >
              Meet people <span className="tabular text-xs text-stone-500 dark:text-stone-400">{meet.count}</span>
            </Link>
          ) : null}
          {presets.map((f) => (
            <Link
              key={f.href}
              href={f.href}
              className="rounded-full border border-stone-200 px-3.5 py-2 text-sm text-stone-700 hover:border-accent/40 hover:bg-accent-soft hover:text-accent sm:py-1 dark:border-stone-800 dark:text-stone-300"
            >
              {f.label} <span className="tabular text-xs text-stone-500 dark:text-stone-400">{f.count}</span>
            </Link>
          ))}
        </div>
      </section>

      <section>
        <SectionHeading
          aside={
            <Link
              href="/clubs?recruiting=1&sort=deadline"
              className="-my-2 inline-block py-2 text-sm text-stone-500 hover:text-stone-900 dark:hover:text-stone-100"
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
        {/* A checkbox, not JavaScript: "Show all" works without scripts. Below sm only the first
            dozen tiles show; from sm up everything does. */}
        <input id="intents-all" type="checkbox" className="peer sr-only" aria-label="Show all topics" />
        <div className="grid gap-x-8 gap-y-5 max-sm:peer-checked:[&>div]:block sm:grid-cols-2 lg:grid-cols-3">
          {groups.map(({ g, list }, gi) => (
            <div key={g.key} className={hiddenOnPhone[gi] ? "max-sm:hidden" : undefined}>
              <h3 className="mb-1 text-xs font-medium text-stone-500 dark:text-stone-400">{g.label}</h3>
              <ul className="divide-y divide-stone-100 dark:divide-stone-800">
                {list.map((i) => (
                  <li key={i.slug}>
                    <Link
                      href={`/clubs?do=${i.slug}`}
                      className="-mx-2 flex min-h-11 items-center justify-between gap-2 rounded-md px-2 py-1.5 hover:bg-stone-50 sm:min-h-9 dark:hover:bg-stone-900"
                    >
                      <span className="font-medium">{i.label}</span>
                      <span className="tabular text-xs text-stone-500 dark:text-stone-400">
                        {i.count}
                        <span className="sr-only"> clubs</span>
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
        {hiddenOnPhone.some(Boolean) ? (
          <label
            htmlFor="intents-all"
            className="mt-2 inline-flex min-h-11 cursor-pointer items-center rounded-full border border-stone-200 px-4 text-sm text-stone-700 peer-checked:hidden peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-accent sm:hidden dark:border-stone-800 dark:text-stone-300"
          >
            Show all topics
          </label>
        ) : null}
        <p className="mt-3 text-xs text-stone-500 dark:text-stone-400">
          Each list is a fixed rule over clubs&apos; categories and descriptions, the same for everyone — not a
          recommendation.
        </p>
      </section>

      <section>
        <SectionHeading>Browse by category</SectionHeading>
        <div className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-stone-200 bg-stone-200 sm:grid-cols-3 lg:grid-cols-4 dark:border-stone-800 dark:bg-stone-800">
          {topLevel.map((c) => (
            <Link
              key={c.slug}
              href={`/categories/${c.slug}`}
              className="group bg-white p-3 hover:bg-stone-50 sm:p-4 dark:bg-stone-950 dark:hover:bg-stone-900"
            >
              <div className="flex items-baseline justify-between gap-2">
                <span className="font-medium group-hover:underline">{c.name}</span>
                <span className="tabular text-xs text-stone-500">{c.clubCount}</span>
              </div>
              {c.description ? (
                <p className="mt-1 line-clamp-2 hidden text-xs text-stone-500 sm:block dark:text-stone-400">
                  {c.description}
                </p>
              ) : null}
            </Link>
          ))}
        </div>
      </section>

      <p className="tabular border-t border-stone-200 pt-6 text-xs text-stone-500 text-pretty dark:border-stone-800 dark:text-stone-400">
        {pluralize(stats.clubs, "organization")} indexed, {described.toLocaleString("en-US")} with a description,
        website or Instagram
        {stats.fixtureClubs > 0 ? `; includes ${stats.fixtureClubs} fictional demo clubs` : ""}.
        {presets.length ? " Counts on the quick links are clubs a source says this about; most clubs don't say." : ""}{" "}
        Many are still missing details:{" "}
        <Link
          href="/contribute"
          className="font-medium text-stone-700 underline underline-offset-2 dark:text-stone-300"
        >
          help fill them in
        </Link>
        . Independent and student-built, from public pages and reviewed contributions;{" "}
        <Link href="/about/" className="underline underline-offset-2">
          how it works
        </Link>
        .
      </p>
    </div>
  );
}
