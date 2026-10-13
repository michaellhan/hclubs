"use client";

import Link from "next/link";
import {
  ClubFilters,
  INTENTS,
  cleanQuery,
  type CategoryWithCount,
  type FacetCounts,
  type IndexClub,
  type LocalSearchResult,
} from "@hci/db/local";
import { filterChips, hrefWith, type DirectoryParams } from "@/lib/params";
import { pluralize } from "@/lib/format";
import { unconfirmedHint } from "@/lib/empty-hint";
import { JOINING_FILTERS } from "@/lib/joining";
import { TOPICS } from "./topic-menu";
import { ClubRow } from "./club-row";
import { EmptyState } from "./ui";
import type { SearchEngine } from "@/lib/search-engine";

const pill =
  "inline-flex min-h-11 items-center rounded-full border border-stone-200 px-3 text-sm text-stone-700 hover:border-stone-400 sm:min-h-9 dark:border-stone-700 dark:text-stone-300";

/**
 * Zero results, made useful: which single filter to drop (with the count it would show),
 * clubs matching part of a multi-word query (clearly labeled as weaker), related
 * categories, and intents. Nothing here invents a result.
 */
export function NoResults({
  params,
  result,
  clubs,
  categories,
  now,
  facets,
  engine,
}: {
  params: DirectoryParams;
  result: LocalSearchResult;
  clubs: readonly IndexClub[];
  categories: CategoryWithCount[];
  now: Date;
  facets?: FacetCounts | null;
  /** Loaded before any result exists (see `useSearchEngine`). */
  engine: SearchEngine;
}) {
  const { relaxations, readsAsBrowse } = engine;
  const shownQ = cleanQuery(params.q);
  const hideSparse = !params.showAll && (!params.q || readsAsBrowse(clubs, params.q));
  const chips = filterChips(params.filters, categories);
  const relax = relaxations(clubs, { text: params.q, filters: { ...params.filters, hideSparse }, now }, [
    ...chips,
    ...(params.q && chips.length ? [{ key: "q", label: `the search “${shownQ}”`, patch: null }] : []),
  ]).slice(0, 3);
  // Filters that contradict each other in pairs ("Open membership" + "Audition"): dropping any
  // one still finds nothing, so offer clearing them all, keeping the search.
  const cleared = ClubFilters.parse({});
  const clearAll =
    !relax.length && chips.length >= 2
      ? relaxations(clubs, { text: params.q, filters: { ...params.filters, hideSparse }, now }, [
          { key: "all", label: "filters", patch: { ...cleared, hideSparse } },
        ])[0]
      : undefined;
  // "Recruiting now" between rounds: the clubs a student can still join today, same other filters.
  const anytime =
    params.filters.recruitingNow && !params.filters.openJoin
      ? relaxations(clubs, { text: params.q, filters: { ...params.filters, hideSparse }, now }, [
          { key: "anytime", label: "join anytime", patch: { recruitingNow: false, openJoin: true } },
        ])[0]
      : undefined;
  // "No comp" left nothing but the topic has clubs: say how many don't say, and offer them (prominent).
  const hint = facets ? unconfirmedHint(facets.known, params.filters) : null;
  const topic = TOPICS.find((t) => t.slug === params.filters.intent)?.label.toLowerCase();
  const cats = [...new Set(result.concepts.flatMap((c) => c.categories))]
    .map((s) => categories.find((c) => c.slug === s))
    .filter((c): c is CategoryWithCount => Boolean(c));
  // Intents that fit what was typed come first; the rest fill in.
  const conceptCats = new Set(result.concepts.flatMap((c) => c.categories));
  const related = INTENTS.filter((i) => i.categories.some((c) => conceptCats.has(c)));
  const intents = [...related, ...INTENTS.filter((i) => !related.includes(i))].slice(0, 6);
  return (
    <div className="space-y-5">
      <EmptyState
        title={
          params.q
            ? result.partial.length
              ? `No organization matches all of “${shownQ}”`
              : `No organizations match “${shownQ}”`
            : params.filters.recruitingNow && chips.length === 1
              ? "No open applications we know of right now"
              : "No organizations match these filters"
        }
      >
        {hint ? (
          <span className="mb-3 block text-base text-stone-800 dark:text-stone-200">
            No {topic ? `${topic} ` : ""}club is confirmed for “{JOINING_FILTERS[hint.key].label}”.{" "}
            <Link
              scroll={false}
              href={hrefWith(params, { filters: { ...params.filters, [hint.key]: false } })}
              className="font-medium underline underline-offset-2"
            >
              Show all {pluralize(hint.total, topic ? `${topic} club` : "club")}
            </Link>{" "}
            ({hint.no ? `${hint.no.toLocaleString("en-US")} say no, ` : ""}
            {hint.unknown.toLocaleString("en-US")} don't say).
          </span>
        ) : null}
        {anytime ? (
          <span className="mb-3 block">
            <Link
              scroll={false}
              href={hrefWith(params, { filters: { ...params.filters, recruitingNow: false, openJoin: true } })}
              className={pill}
            >
              Clubs you can join anytime: {pluralize(anytime.count, "club")}
            </Link>
          </span>
        ) : null}
        {relax.length
          ? "Try removing one filter:"
          : clearAll
            ? "These filters rule each other out."
            : result.relaxed.length
              ? "The words matched; it's the filter that rules them out (see above)."
              : params.q
                ? // Only when a word is unknown: "finance clubs for sophomores" has no typo (Round 12).
                  result.corrected || result.unknownWords.length
                  ? "Check the spelling, or try a broader word."
                  : "No club matches every word. Try fewer or broader words."
                : null}
        {relax.length ? (
          <span className="mt-3 flex flex-wrap justify-center gap-2">
            {relax.map((r) => (
              <Link
                key={r.key}
                scroll={false}
                href={
                  r.patch === null
                    ? hrefWith(params, { q: null })
                    : hrefWith(params, { filters: { ...params.filters, ...r.patch } })
                }
                className={pill}
              >
                Without {r.patch === null ? r.label : `“${r.label}”`}: {pluralize(r.count, "club")}
              </Link>
            ))}
          </span>
        ) : clearAll ? (
          <span className="mt-3 flex flex-wrap justify-center gap-2">
            <Link scroll={false} href={hrefWith(params, { filters: cleared })} className={pill}>
              Clear all filters: {pluralize(clearAll.count, "club")}
            </Link>
          </span>
        ) : null}
      </EmptyState>

      {result.partial.length > 0 ? (
        <section aria-labelledby="partial-heading" className="space-y-2">
          <h2 id="partial-heading" className="text-sm font-medium text-stone-700 dark:text-stone-300">
            Closest matches for “{shownQ}”
            <span className="font-normal text-stone-500 dark:text-stone-400">
              {" "}
              — each matches only some of your words
            </span>
          </h2>
          <ul className="hc-list">
            {result.partial.map(({ club, matched }) => (
              <ClubRow key={club.id} club={club} why={[`Matches “${matched.join(" ")}” only`]} />
            ))}
          </ul>
        </section>
      ) : null}

      {params.q ? (
        <div className="space-y-3 text-sm">
          {cats.length ? (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-stone-500">Related categories:</span>
              {cats.map((c) => (
                <Link key={c.slug} href={`/clubs?category=${c.slug}`} className={pill}>
                  {c.name}
                </Link>
              ))}
            </div>
          ) : null}
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-stone-500">Or browse by what you want to do:</span>
            {intents.map((i) => (
              <Link key={i.slug} href={`/clubs?do=${i.slug}`} className={pill}>
                {i.label}
              </Link>
            ))}
          </div>
          <p className="text-stone-500">
            Know a club we&apos;re missing?{" "}
            <Link href="/contribute" className="underline underline-offset-2">
              Tell us about it
            </Link>
            .
          </p>
        </div>
      ) : null}
    </div>
  );
}
