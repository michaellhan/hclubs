"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useMemo, useRef } from "react";
import {
  INTENTS,
  facetCounts,
  searchLocal,
  similarClubs,
  type CategoryWithCount,
  type FacetCounts,
  type IndexClub,
  type LocalSearchResult,
  cleanQuery,
  constraintPatch,
} from "@hci/db/local";
import { pluralize } from "@/lib/format";
import { constraintSentences, constraintsToFilters, negatedSentence, softSentence } from "@/lib/query-notes";
import {
  activeFilterCount,
  filterChips,
  hrefWith,
  parseDirectoryParams,
  type DirectoryParams,
  type RawSearchParams,
} from "@/lib/params";
import { useIndex } from "@/lib/use-index";
import { useNow } from "@/lib/use-now";
import { ClubRow } from "./club-row";
import { CopyLink } from "./copy-link";
import { NoResults } from "./directory-empty";
import { Filters } from "./directory-filters";
import { QUICK_CHIP_KEYS, QuickFilters, quickActiveCount } from "./quick-filters";
import { ListSkeleton } from "./recruiting-now";
import { SearchBox } from "./search-box";
import { EmptyState } from "./ui";

const PAGE_SIZE = 30;
const SORTS = [
  ["relevance", "Best match"],
  ["featured", "Suggested"],
  ["name", "Name"],
  ["deadline", "Soonest deadline"],
] as const;

function ActiveChips({ params, categories }: { params: DirectoryParams; categories: CategoryWithCount[] }) {
  const chips = filterChips(params.filters, categories).filter((c) => !QUICK_CHIP_KEYS.includes(c.key));
  if (chips.length === 0) return null;
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {chips.map((c) => (
        <Link
          key={c.key}
          href={hrefWith(params, { filters: { ...params.filters, ...c.patch } })}
          scroll={false}
          className="inline-flex min-h-7 items-center gap-1 rounded-full bg-stone-900 py-0.5 pr-2 pl-2.5 text-xs text-white hover:bg-stone-700 dark:bg-stone-100 dark:text-stone-900 dark:hover:bg-stone-300"
          aria-label={`Remove filter: ${c.label}`}
        >
          {c.label} <span aria-hidden>×</span>
        </Link>
      ))}
      {chips.length > 1 ? (
        <Link
          href={params.q ? `/clubs?q=${encodeURIComponent(params.q)}` : "/clubs"}
          scroll={false}
          className="ml-1 inline-block py-1 text-xs text-stone-500 underline-offset-2 hover:text-stone-900 hover:underline dark:hover:text-stone-100"
        >
          Clear all
        </Link>
      ) : null}
    </div>
  );
}

const UNKNOWN_PHRASE = {
  freshmenEligible: "whether first-years can join",
  openJoin: "how members join",
  noComp: "whether there's a comp",
  noDues: "whether there are dues",
  noExperience: "whether experience is needed",
} as const;

/**
 * Under a yes/no filter, the clubs it leaves out because no source says either way, so
 * "16 clubs" reads as "16 confirmed", never "only 16 exist" (ADR 0041).
 */
function UnknownNote({ params, facets }: { params: DirectoryParams; facets: FacetCounts | null }) {
  if (!facets) return null;
  const notes = (Object.keys(UNKNOWN_PHRASE) as (keyof typeof UNKNOWN_PHRASE)[])
    .filter((k) => params.filters[k] && facets.known[k].unknown > 0)
    .map(
      (k) =>
        `${pluralize(facets.known[k].unknown, "other club")} here ${facets.known[k].unknown === 1 ? "doesn't" : "don't"} say ${UNKNOWN_PHRASE[k]}`,
    );
  if (!notes.length) return null;
  return (
    <p className="text-xs text-stone-500 dark:text-stone-400">
      Confirmed matches only. {notes.join("; ")} — they aren&apos;t counted as a no.{" "}
      <Link href="/contribute" className="underline underline-offset-2">
        Know one?
      </Link>
    </p>
  );
}

/**
 * Words in the search the directory acted on, said plainly: phrases read as filters ("no
 * comp") with a tap to make them real filters, and soft words ("beginner") that only re-rank.
 */
function QueryNotes({
  result,
  convertHref,
  hoursUnknown,
}: {
  result: { constraints: LocalSearchResult["constraints"]; soft: string[]; negated?: string[] } | null;
  convertHref: string | undefined;
  hoursUnknown?: number | null;
}) {
  if (!result) return null;
  const sentences = constraintSentences(result.constraints, hoursUnknown);
  const soft = softSentence(result.soft);
  const negated = negatedSentence(result.negated ?? []);
  if (!sentences.length && !soft && !negated) return null;
  return (
    <div className="space-y-0.5 text-xs text-stone-500 dark:text-stone-400">
      {sentences.length ? (
        <p>
          {sentences.join(" ")}{" "}
          {convertHref ? (
            <Link href={convertHref} scroll={false} className="underline underline-offset-2">
              Use the filter instead
            </Link>
          ) : null}
        </p>
      ) : null}
      {soft ? <p>{soft}</p> : null}
      {negated ? <p>{negated}</p> : null}
    </div>
  );
}

/**
 * A constraint phrase ("no comp") left almost nothing but the topic alone has plenty: say how
 * few say it, and offer the whole topic with the phrase dropped (what's left of the query).
 */
function RelaxedHints({
  params,
  result,
}: {
  params: DirectoryParams;
  result: Pick<LocalSearchResult, "relaxed" | "constraints" | "searchedText" | "total">;
}) {
  if (!result.relaxed.length) return null;
  const topic = result.searchedText.trim();
  return (
    <div className="space-y-0.5 text-sm text-stone-600 dark:text-stone-400">
      {result.relaxed.map((r) => {
        const rest = result.constraints.filter((c) => c.filter !== r.constraint).map((c) => c.phrase);
        const q = [topic, ...rest].filter(Boolean).join(" ") || null;
        const what = topic ? `${topic} club` : "club";
        return (
          <p key={r.constraint}>
            {result.total === 0
              ? `No ${what} says “${r.phrase}”.`
              : `Only ${pluralize(result.total, what)} say${result.total === 1 ? "s" : ""} “${r.phrase}”.`}{" "}
            <Link href={hrefWith(params, { q })} scroll={false} className="underline underline-offset-2">
              Show all {pluralize(r.without, what)}
            </Link>{" "}
            ({r.unknown.toLocaleString("en-US")} don&apos;t say).
          </p>
        );
      })}
    </div>
  );
}

/** How an intent picks clubs, said plainly: it's a rule, not a recommendation. */
function IntentNote({ intentSlug, categories }: { intentSlug: string | null; categories: CategoryWithCount[] }) {
  const intent = INTENTS.find((i) => i.slug === intentSlug);
  if (!intent) return null;
  const cats = intent.categories.map((s) => categories.find((c) => c.slug === s)?.name ?? s);
  const parts = [
    cats.length ? `in ${cats.join(" or ")}` : null,
    intent.words.length
      ? `whose name or description says ${intent.words
          .slice(0, 4)
          .map((w) => `“${w}”`)
          .join(", ")}${intent.words.length > 4 ? "…" : ""}`
      : null,
  ].filter(Boolean);
  const body = (
    <>
      clubs {parts.join(", or ")}
      {intent.rank ? "; invitation-only clubs and final clubs left out, open clubs first" : ""}. A fixed rule over each
      club&apos;s categories and text, the same for everyone.
    </>
  );
  const label = <span className="font-medium text-stone-900 dark:text-stone-100">{intent.label}:</span>;
  return (
    <>
      {/* Phones: one line and a disclosure, so the first club isn't pushed off-screen. */}
      <details className="group rounded-lg bg-stone-50 px-3 text-sm text-stone-600 sm:hidden dark:bg-stone-900 dark:text-stone-400">
        <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-2 [&::-webkit-details-marker]:hidden">
          <span className="min-w-0 truncate font-medium text-stone-900 dark:text-stone-100">{intent.label}</span>
          <span className="shrink-0 text-xs font-medium text-accent group-open:hidden">How we decide</span>
          <span className="hidden shrink-0 text-xs font-medium text-accent group-open:inline">Hide</span>
        </summary>
        <p className="pb-3">
          {label} {body}
        </p>
      </details>
      <p className="hidden rounded-lg bg-stone-50 px-3 py-2 text-sm text-stone-600 sm:block dark:bg-stone-900 dark:text-stone-400">
        {label} {body}
      </p>
    </>
  );
}

/** One result: a few clubs like it, so a narrow search isn't a dead end. */
function RelatedToOne({
  club,
  all,
  categories,
}: {
  club: IndexClub;
  all: IndexClub[];
  categories: CategoryWithCount[];
}) {
  const isLeaf = (s: string) => !categories.some((c) => c.parentSlug === s);
  const similar = similarClubs(club, all, { limit: 5, isLeaf });
  if (!similar.length) return null;
  return (
    <section aria-label="Related clubs" className="space-y-2">
      <h2 className="text-sm font-medium text-stone-700 dark:text-stone-300">Clubs like {club.name}</h2>
      <ul className="divide-y divide-stone-100 overflow-hidden rounded-xl border border-stone-200 dark:divide-stone-800 dark:border-stone-800">
        {similar.map((s) => (
          <ClubRow key={s.club.id} club={s.club} />
        ))}
      </ul>
    </section>
  );
}

/** ↑/↓ between result links, Esc back to the search box (Enter opens, natively). */
function resultKeys(e: React.KeyboardEvent<HTMLElement>) {
  if (!["ArrowDown", "ArrowUp", "Escape"].includes(e.key)) return;
  const links = [...e.currentTarget.querySelectorAll<HTMLElement>("[data-result]")];
  const i = links.indexOf(document.activeElement as HTMLElement);
  if (i < 0) return;
  e.preventDefault();
  if (e.key === "Escape" || (e.key === "ArrowUp" && i === 0)) {
    document.querySelector<HTMLInputElement>('input[type="search"][name="q"]')?.focus();
    return;
  }
  links[e.key === "ArrowDown" ? Math.min(i + 1, links.length - 1) : i - 1]?.focus();
}

function toRaw(sp: URLSearchParams): RawSearchParams {
  const out: Record<string, string[]> = {};
  for (const [k, v] of sp.entries()) (out[k] ??= []).push(v);
  return out;
}

/**
 * The directory, filtered and searched in the browser over the static index. Filter
 * state lives in the URL, so every view is shareable.
 */
export function Directory({ categories }: { categories: CategoryWithCount[] }) {
  const searchParams = useSearchParams();
  const params = parseDirectoryParams(toRaw(searchParams));
  const { data, error } = useIndex();
  const now = useNow();
  // Browsing hides name-only rows; a text search always finds them.
  const hideSparse = !params.q && !params.showAll;
  const filters = useMemo(() => ({ ...params.filters, hideSparse }), [searchParams.toString()]); // eslint-disable-line react-hooks/exhaustive-deps
  const categoryName = (slug: string) => categories.find((c) => c.slug === slug)?.name ?? slug;
  const found =
    data && now
      ? searchLocal(data.clubs, {
          text: params.q,
          filters,
          sort: params.sort,
          offset: (params.page - 1) * PAGE_SIZE,
          limit: PAGE_SIZE,
          now,
          categoryName,
        })
      : null;
  const facets = useMemo(
    () => (data && now ? facetCounts(data.clubs, { text: params.q, filters, now }) : null),
    [data, now, filters, params.q],
  );
  const result = found
    ? { ...found, page: params.page, pageCount: Math.max(1, Math.ceil(found.total / PAGE_SIZE)) }
    : null;
  // Offer "Use the filter instead" only when it would change something: not when every phrase
  // is already a filter, nor when a relaxed hint is already showing for it.
  const patch = found ? constraintPatch(found.constraints) : {};
  const alreadyFilters = Object.entries(patch).every(
    ([k, v]) => (params.filters as unknown as Record<string, unknown>)[k] === v,
  );
  const convertHref =
    found && found.constraints.length && !alreadyFilters && !found.relaxed.length
      ? hrefWith(params, constraintsToFilters(found.constraints, found.searchedText, params.filters))
      : undefined;
  const nFilters = activeFilterCount(params.filters) - quickActiveCount(params.filters);
  const anyFilter = activeFilterCount(params.filters) > 0;
  const ranked = Boolean(params.q) || INTENTS.some((i) => i.slug === params.filters.intent && i.rank);
  // "Best match" when there's something to match; "Suggested" when browsing.
  const sortOptions = SORTS.filter(([k]) => (k === "relevance" ? ranked : k === "featured" ? !ranked : true));
  const router = useRouter();
  const mobileFilters = useRef<HTMLDetailsElement>(null);
  const shareable = Boolean(params.q || anyFilter);

  return (
    <div className="grid gap-6 lg:grid-cols-[14rem_1fr] lg:gap-10">
      <aside className="lg:sticky lg:top-18 lg:max-h-[calc(100dvh-6rem)] lg:overflow-y-auto lg:pr-2">
        <details ref={mobileFilters} className="group scroll-mt-16 lg:hidden">
          <summary className="flex h-11 cursor-pointer items-center justify-between rounded-lg border border-stone-200 px-3 text-sm font-medium dark:border-stone-800">
            Filters{nFilters > 0 ? ` (${nFilters})` : ""}
            <span aria-hidden className="text-stone-500 group-open:rotate-180">
              ▾
            </span>
          </summary>
          <div className="mt-2 rounded-lg border border-stone-200 p-3 dark:border-stone-800">
            <Filters params={params} categories={categories} facets={facets} />
            <button
              type="button"
              onClick={() => {
                const d = mobileFilters.current;
                if (!d) return;
                d.open = false;
                d.querySelector("summary")?.focus();
                d.scrollIntoView({ block: "start", behavior: "smooth" });
              }}
              className="sticky bottom-3 mt-2 flex h-11 w-full items-center justify-center rounded-full bg-brand text-sm font-medium text-on-brand shadow-lg hover:bg-brand-hover"
            >
              {result ? `Show ${pluralize(result.total, "club")}` : "Done"}
            </button>
          </div>
        </details>
        <div className="hidden lg:block">
          <Filters params={params} categories={categories} facets={facets} />
        </div>
      </aside>

      <div className="min-w-0 space-y-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <div className="flex-1">
            <Suspense>
              <SearchBox initial={params.q ?? ""} />
            </Suspense>
          </div>
          <label className="flex items-center gap-2 text-sm text-stone-500 sm:hidden dark:text-stone-400">
            Sort
            <select
              value={params.sort}
              onChange={(e) =>
                router.replace(hrefWith(params, { sort: e.target.value as DirectoryParams["sort"] }), { scroll: false })
              }
              className="h-10 flex-1 rounded-lg border border-stone-200 bg-white px-2 text-base text-stone-900 dark:border-stone-800 dark:bg-stone-900 dark:text-stone-100"
            >
              {sortOptions.map(([key, label]) => (
                <option key={key} value={key}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <nav aria-label="Sort" className="hidden items-center gap-1 text-xs sm:flex">
            {sortOptions.map(([key, label]) => (
              <Link
                key={key}
                href={hrefWith(params, { sort: key })}
                scroll={false}
                aria-current={params.sort === key ? "true" : undefined}
                className="rounded-md px-2 py-1 whitespace-nowrap text-stone-500 hover:text-stone-900 aria-[current]:bg-stone-100 aria-[current]:font-medium aria-[current]:text-stone-900 dark:hover:text-stone-100 dark:aria-[current]:bg-stone-800 dark:aria-[current]:text-stone-100"
              >
                {label}
              </Link>
            ))}
          </nav>
        </div>

        <QuickFilters
          params={params}
          facets={facets}
          implied={result?.constraints.map((c) => c.filter) ?? []}
          convertHref={convertHref}
        />
        <QueryNotes result={result} convertHref={convertHref} hoursUnknown={facets?.hours.unknown ?? null} />
        {result ? <RelaxedHints params={params} result={result} /> : null}

        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="tabular text-sm text-stone-500" aria-live="polite" aria-atomic="true">
            {result ? pluralize(result.total, "organization") : "Loading…"}
            {params.q ? <> matching “{cleanQuery(params.q)}”</> : null}
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <ActiveChips params={params} categories={categories} />
            {shareable ? <CopyLink label="Copy link to this search" /> : null}
          </div>
        </div>

        <UnknownNote params={params} facets={facets} />

        {result?.corrected && result.total > 0 ? (
          <p className="text-sm text-stone-600 dark:text-stone-400">
            Showing results for{" "}
            <span className="font-medium text-stone-900 dark:text-stone-100">“{result.corrected}”</span>.
          </p>
        ) : null}
        <IntentNote intentSlug={params.filters.intent} categories={categories} />

        {error ? (
          <EmptyState title="Couldn't load the directory">
            Check your connection and{" "}
            <button type="button" className="underline" onClick={() => window.location.reload()}>
              reload the page
            </button>
            .
          </EmptyState>
        ) : !result || !data || !now ? (
          <ListSkeleton rows={8} />
        ) : result.clubs.length > 0 ? (
          <ul
            onKeyDown={resultKeys}
            className="divide-y divide-stone-100 overflow-hidden rounded-xl border border-stone-200 dark:divide-stone-800 dark:border-stone-800"
          >
            {result.clubs.map((c) => (
              <ClubRow key={c.id} club={c} why={params.q ? result.reasons[c.id] : undefined} filters={params.filters} />
            ))}
          </ul>
        ) : (
          <NoResults params={params} result={result} clubs={data.clubs} categories={categories} now={now} />
        )}
        {result && params.q && result.total === 1 && data ? (
          <RelatedToOne club={result.clubs[0]!} all={data.clubs} categories={categories} />
        ) : null}

        {result && result.pageCount > 1 ? (
          <nav aria-label="Pagination" className="tabular flex items-center justify-between text-sm">
            {result.page > 1 ? (
              <Link className="-my-2 py-2" href={hrefWith(params, { page: result.page - 1 })}>
                ← Previous
              </Link>
            ) : (
              <span />
            )}
            <span className="text-stone-500">
              Page {result.page} of {result.pageCount}
            </span>
            {result.page < result.pageCount ? (
              <Link className="-my-2 py-2" href={hrefWith(params, { page: result.page + 1 })}>
                Next →
              </Link>
            ) : (
              <span />
            )}
          </nav>
        ) : null}

        {result && (result.hiddenSparse > 0 || (params.showAll && !params.q)) ? (
          <p className="text-center text-xs text-stone-500 dark:text-stone-400">
            {params.showAll ? (
              <Link
                href={hrefWith(params, { showAll: false })}
                scroll={false}
                className="inline-block py-2 underline decoration-stone-300 underline-offset-2 hover:text-stone-900 dark:decoration-stone-600 dark:hover:text-stone-100"
              >
                Hide clubs we only know by name
              </Link>
            ) : (
              <>
                {pluralize(result.hiddenSparse, "more club")} with no description or link yet ·{" "}
                <Link
                  href={hrefWith(params, { showAll: true })}
                  scroll={false}
                  className="inline-block py-2 font-medium text-stone-700 underline decoration-stone-300 underline-offset-2 hover:text-stone-900 dark:text-stone-300 dark:decoration-stone-600 dark:hover:text-stone-100"
                >
                  Show them
                </Link>{" "}
                ·{" "}
                <Link
                  href="/contribute"
                  className="inline-block py-2 text-stone-600 underline decoration-stone-300 underline-offset-2 hover:text-stone-900 dark:text-stone-400 dark:decoration-stone-600 dark:hover:text-stone-100"
                >
                  Help fill them in
                </Link>
              </>
            )}
          </p>
        ) : null}
      </div>
    </div>
  );
}
