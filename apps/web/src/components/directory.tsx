"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useRef } from "react";
import {
  JOIN_MODES,
  JOIN_MODE_LABEL,
  RECOGNITION_STATUS_LABEL,
  RECRUITING_SEASON_LABEL,
  type JoinMode,
  type RecognitionStatus,
  type RecruitingSeason,
} from "@hci/core/browser";
import {
  INTENTS,
  searchLocal,
  similarClubs,
  type CategoryWithCount,
  type IndexClub,
  type LocalSearchResult,
} from "@hci/db/local";
import { pluralize } from "@/lib/format";
import {
  activeFilterCount,
  hrefWith,
  parseDirectoryParams,
  type DirectoryParams,
  type RawSearchParams,
} from "@/lib/params";
import { useIndex } from "@/lib/use-index";
import { useNow } from "@/lib/use-now";
import { ClubRow } from "./club-row";
import { FilterForm } from "./filter-form";
import { ListSkeleton } from "./recruiting-now";
import { SearchBox } from "./search-box";
import { EmptyState } from "./ui";

const PAGE_SIZE = 30;
const SORTS = [
  ["relevance", "Best match"],
  ["name", "Name"],
  ["deadline", "Soonest deadline"],
  ["updated", "Recently updated"],
  ["completeness", "Most complete"],
] as const;
const SEASON_OPTIONS: RecruitingSeason[] = ["fall", "spring"];
const RECOGNITION_OPTIONS: RecognitionStatus[] = ["recognized", "not_recognized", "formerly_recognized", "unknown"];

function Checkbox({
  name,
  value,
  checked,
  children,
  count,
}: {
  name: string;
  value: string;
  checked: boolean;
  children: React.ReactNode;
  count?: number;
}) {
  return (
    <label className="flex cursor-pointer items-center gap-2.5 py-1.5 text-sm lg:gap-2 lg:py-0.5 text-zinc-700 hover:text-zinc-950 dark:text-zinc-300 dark:hover:text-white">
      <input
        type="checkbox"
        name={name}
        value={value}
        defaultChecked={checked}
        className="size-4 rounded border-zinc-300 accent-zinc-900 lg:size-3.5 dark:accent-zinc-100"
      />
      <span className="flex-1">{children}</span>
      {count !== undefined ? <span className="tabular text-xs text-zinc-500 dark:text-zinc-400">{count}</span> : null}
    </label>
  );
}

function FilterGroup({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <fieldset className="border-t border-zinc-100 py-3 first:border-t-0 first:pt-0 dark:border-zinc-800">
      <legend className="mb-1.5 text-xs font-semibold tracking-wide text-zinc-500 uppercase">{title}</legend>
      {children}
    </fieldset>
  );
}

function Filters({ params, categories }: { params: DirectoryParams; categories: CategoryWithCount[] }) {
  const f = params.filters;
  const parents = categories.filter((c) => !c.parentSlug);
  return (
    <FilterForm>
      {params.q ? <input type="hidden" name="q" value={params.q} /> : null}
      {params.showAll ? <input type="hidden" name="all" value="1" /> : null}
      {f.intent ? <input type="hidden" name="do" value={f.intent} /> : null}
      {params.sort !== (params.q ? "relevance" : "name") ? (
        <input type="hidden" name="sort" value={params.sort} />
      ) : null}
      <FilterGroup title="Status">
        <Checkbox name="recruiting" value="1" checked={f.recruitingNow}>
          Recruiting now
        </Checkbox>
        <Checkbox name="freshmen" value="1" checked={f.freshmenEligible}>
          Open to first-years
        </Checkbox>
        <Checkbox name="grad" value="1" checked={f.includeGraduate}>
          Include graduate-school groups
        </Checkbox>
        <Checkbox name="inactive" value="1" checked={f.includeInactive}>
          Include inactive
        </Checkbox>
      </FilterGroup>
      <FilterGroup title="How to join">
        <Checkbox name="open" value="1" checked={f.openJoin}>
          No comp or application
        </Checkbox>
        {JOIN_MODES.map((m: JoinMode) => (
          <Checkbox key={m} name="join" value={m} checked={f.joinModes.includes(m)}>
            {JOIN_MODE_LABEL[m]}
          </Checkbox>
        ))}
      </FilterGroup>
      <FilterGroup title="Usually recruits in">
        {SEASON_OPTIONS.map((season) => (
          <Checkbox key={season} name="season" value={season} checked={f.recruitingSeasons.includes(season)}>
            {RECRUITING_SEASON_LABEL[season]}
          </Checkbox>
        ))}
        <p className="mt-1 text-[11px] leading-4 text-zinc-500 dark:text-zinc-400">
          From past recruiting. Clubs with no known pattern are left out.
        </p>
      </FilterGroup>
      <FilterGroup title="Category">
        {parents.map((p) => {
          const children = categories.filter((c) => c.parentSlug === p.slug);
          return (
            <div key={p.slug}>
              <Checkbox name="category" value={p.slug} checked={f.categories.includes(p.slug)} count={p.clubCount}>
                {p.name}
              </Checkbox>
              {children.length > 0 ? (
                <div className="ml-5">
                  {children.map((c) => (
                    <Checkbox
                      key={c.slug}
                      name="category"
                      value={c.slug}
                      checked={f.categories.includes(c.slug)}
                      count={c.clubCount}
                    >
                      {c.name}
                    </Checkbox>
                  ))}
                </div>
              ) : null}
            </div>
          );
        })}
      </FilterGroup>
      <FilterGroup title="Recognition">
        {RECOGNITION_OPTIONS.map((r) => (
          <Checkbox key={r} name="recognition" value={r} checked={f.recognition.includes(r)}>
            {RECOGNITION_STATUS_LABEL[r]}
          </Checkbox>
        ))}
      </FilterGroup>
    </FilterForm>
  );
}

function ActiveChips({ params, categories }: { params: DirectoryParams; categories: CategoryWithCount[] }) {
  const f = params.filters;
  const chips: { label: string; href: string }[] = [];
  const catName = (s: string) => categories.find((c) => c.slug === s)?.name ?? s;
  for (const c of f.categories)
    chips.push({
      label: catName(c),
      href: hrefWith(params, { filters: { ...f, categories: f.categories.filter((x) => x !== c) } }),
    });
  for (const j of f.joinModes)
    chips.push({
      label: JOIN_MODE_LABEL[j],
      href: hrefWith(params, { filters: { ...f, joinModes: f.joinModes.filter((x) => x !== j) } }),
    });
  for (const r of f.recognition)
    chips.push({
      label: RECOGNITION_STATUS_LABEL[r],
      href: hrefWith(params, { filters: { ...f, recognition: f.recognition.filter((x) => x !== r) } }),
    });
  for (const season of f.recruitingSeasons)
    chips.push({
      label: `Usually ${RECRUITING_SEASON_LABEL[season].toLowerCase()}`,
      href: hrefWith(params, {
        filters: { ...f, recruitingSeasons: f.recruitingSeasons.filter((x) => x !== season) },
      }),
    });
  if (f.recruitingNow)
    chips.push({ label: "Recruiting now", href: hrefWith(params, { filters: { ...f, recruitingNow: false } }) });
  if (f.openJoin)
    chips.push({ label: "No comp or application", href: hrefWith(params, { filters: { ...f, openJoin: false } }) });
  const intent = INTENTS.find((i) => i.slug === f.intent);
  if (intent) chips.push({ label: intent.label, href: hrefWith(params, { filters: { ...f, intent: null } }) });
  if (f.freshmenEligible)
    chips.push({ label: "First-years", href: hrefWith(params, { filters: { ...f, freshmenEligible: false } }) });
  if (f.includeGraduate)
    chips.push({ label: "Incl. graduate", href: hrefWith(params, { filters: { ...f, includeGraduate: false } }) });
  if (f.includeInactive)
    chips.push({ label: "Incl. inactive", href: hrefWith(params, { filters: { ...f, includeInactive: false } }) });
  if (chips.length === 0) return null;
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {chips.map((c) => (
        <Link
          key={c.label}
          href={c.href}
          scroll={false}
          className="inline-flex items-center gap-1 rounded-full bg-zinc-900 py-0.5 pr-2 pl-2.5 text-xs text-white hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900"
          aria-label={`Remove filter ${c.label}`}
        >
          {c.label} <span aria-hidden>×</span>
        </Link>
      ))}
      <Link
        href={params.q ? `/clubs?q=${encodeURIComponent(params.q)}` : "/clubs"}
        className="ml-1 text-xs text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100"
      >
        Clear all
      </Link>
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
      ? `whose name or description mentions ${intent.words
          .slice(0, 4)
          .map((w) => `“${w}”`)
          .join(", ")}`
      : null,
  ].filter(Boolean);
  return (
    <p className="rounded-lg bg-zinc-50 px-3 py-2 text-sm text-zinc-600 dark:bg-zinc-900 dark:text-zinc-400">
      <span className="font-medium text-zinc-900 dark:text-zinc-100">{intent.label}:</span> clubs {parts.join(", or ")}.
      This is a fixed rule over each club&apos;s categories and text, not a recommendation.
    </p>
  );
}

/** Zero results: per-word searches, the topics the query names, and intents to browse. */
function QueryHelp({
  q,
  result,
  categories,
}: {
  q: string;
  result: LocalSearchResult;
  categories: CategoryWithCount[];
}) {
  const words = q
    .split(/\s+/)
    .map((w) => w.trim())
    .filter((w) => w.length >= 3);
  const cats = [...new Set(result.concepts.flatMap((c) => c.categories))]
    .map((s) => categories.find((c) => c.slug === s))
    .filter((c): c is CategoryWithCount => Boolean(c));
  const link =
    "inline-flex min-h-11 items-center rounded-full border sm:min-h-9 border-zinc-200 px-3 text-sm text-zinc-700 hover:border-zinc-400 dark:border-zinc-700 dark:text-zinc-300";
  return (
    <div className="space-y-3 text-sm">
      {words.length > 1 ? (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-zinc-500">Search one word:</span>
          {words.map((w) => (
            <Link key={w} href={`/clubs?q=${encodeURIComponent(w)}`} className={link}>
              {w}
            </Link>
          ))}
        </div>
      ) : null}
      {cats.length ? (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-zinc-500">Related categories:</span>
          {cats.map((c) => (
            <Link key={c.slug} href={`/clubs?category=${c.slug}`} className={link}>
              {c.name}
            </Link>
          ))}
        </div>
      ) : null}
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-zinc-500">Or browse by what you want to do:</span>
        {INTENTS.slice(0, 6).map((i) => (
          <Link key={i.slug} href={`/clubs?do=${i.slug}`} className={link}>
            {i.label}
          </Link>
        ))}
      </div>
    </div>
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
      <h2 className="text-sm font-medium text-zinc-700 dark:text-zinc-300">Clubs like {club.name}</h2>
      <ul className="divide-y divide-zinc-100 overflow-hidden rounded-xl border border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800">
        {similar.map((s) => (
          <ClubRow key={s.club.id} club={s.club} />
        ))}
      </ul>
    </section>
  );
}

function toRaw(sp: URLSearchParams): RawSearchParams {
  const out: Record<string, string[]> = {};
  for (const [k, v] of sp.entries()) (out[k] ??= []).push(v);
  return out;
}

/**
 * The directory, filtered and searched in the browser over the static index. Filter
 * state lives in the URL, exactly as before, so every view is shareable.
 */
export function Directory({ categories }: { categories: CategoryWithCount[] }) {
  const searchParams = useSearchParams();
  const params = parseDirectoryParams(toRaw(searchParams));
  const { data, error } = useIndex();
  const now = useNow();
  // Browsing hides name-only rows; a text search always finds them.
  const hideSparse = !params.q && !params.showAll;
  const found =
    data && now
      ? searchLocal(data.clubs, {
          text: params.q,
          filters: { ...params.filters, hideSparse },
          sort: params.sort,
          offset: (params.page - 1) * PAGE_SIZE,
          limit: PAGE_SIZE,
          now,
          categoryName: (slug: string) => categories.find((c) => c.slug === slug)?.name ?? slug,
        })
      : null;
  const result = found
    ? { ...found, page: params.page, pageCount: Math.max(1, Math.ceil(found.total / PAGE_SIZE)) }
    : null;
  const nFilters = activeFilterCount(params.filters);
  const sortOptions = SORTS.filter(([k]) => k !== "relevance" || params.q);
  const router = useRouter();
  const mobileFilters = useRef<HTMLDetailsElement>(null);

  return (
    <div className="grid gap-6 lg:grid-cols-[14rem_1fr] lg:gap-10">
      <aside className="lg:sticky lg:top-18 lg:max-h-[calc(100dvh-6rem)] lg:overflow-y-auto lg:pr-2">
        <details ref={mobileFilters} className="group scroll-mt-16 lg:hidden">
          <summary className="flex h-11 cursor-pointer items-center justify-between rounded-lg border border-zinc-200 px-3 text-sm font-medium dark:border-zinc-800">
            Filters{nFilters > 0 ? ` (${nFilters})` : ""}
            <span className="text-zinc-500 group-open:rotate-180">▾</span>
          </summary>
          <div className="mt-2 rounded-lg border border-zinc-200 p-3 dark:border-zinc-800">
            <Filters params={params} categories={categories} />
            <button
              type="button"
              onClick={() => {
                const d = mobileFilters.current;
                if (!d) return;
                d.open = false;
                d.scrollIntoView({ block: "start", behavior: "smooth" });
              }}
              className="sticky bottom-3 mt-2 flex h-11 w-full items-center justify-center rounded-lg bg-zinc-900 text-sm font-medium text-white shadow-lg dark:bg-zinc-100 dark:text-zinc-900"
            >
              {result ? `Show ${pluralize(result.total, "club")}` : "Done"}
            </button>
          </div>
        </details>
        <div className="hidden lg:block">
          <Filters params={params} categories={categories} />
        </div>
      </aside>

      <div className="min-w-0 space-y-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <div className="flex-1">
            <Suspense>
              <SearchBox initial={params.q ?? ""} />
            </Suspense>
          </div>
          <label className="flex items-center gap-2 text-sm text-zinc-500 sm:hidden dark:text-zinc-400">
            Sort
            <select
              value={params.sort}
              onChange={(e) =>
                router.replace(hrefWith(params, { sort: e.target.value as DirectoryParams["sort"] }), { scroll: false })
              }
              className="h-10 flex-1 rounded-lg border border-zinc-200 bg-white px-2 text-base text-zinc-900 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-100"
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
                className="rounded-md px-2 py-1 whitespace-nowrap text-zinc-500 hover:text-zinc-900 aria-[current]:bg-zinc-100 aria-[current]:font-medium aria-[current]:text-zinc-900 dark:hover:text-zinc-100 dark:aria-[current]:bg-zinc-800 dark:aria-[current]:text-zinc-100"
              >
                {label}
              </Link>
            ))}
          </nav>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="tabular text-sm text-zinc-500" aria-live="polite">
            {result ? pluralize(result.total, "organization") : "Loading…"}
            {params.q ? <> matching “{params.q}”</> : null}
          </p>
          <ActiveChips params={params} categories={categories} />
        </div>

        {result?.corrected && result.total > 0 ? (
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            Showing results for{" "}
            <span className="font-medium text-zinc-900 dark:text-zinc-100">“{result.corrected}”</span>.
          </p>
        ) : null}
        <IntentNote intentSlug={params.filters.intent} categories={categories} />

        {error ? (
          <EmptyState title="Couldn't load the directory">Try reloading the page.</EmptyState>
        ) : !result ? (
          <ListSkeleton rows={8} />
        ) : result.clubs.length > 0 ? (
          <ul className="divide-y divide-zinc-100 overflow-hidden rounded-xl border border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800">
            {result.clubs.map((c) => (
              <ClubRow key={c.id} club={c} why={params.q ? result.reasons[c.id] : undefined} />
            ))}
          </ul>
        ) : (
          <>
            <EmptyState title="No organizations match">
              Try fewer filters or a different spelling.{" "}
              <Link className="underline" href="/clubs">
                Reset
              </Link>
            </EmptyState>
            {params.q ? <QueryHelp q={params.q} result={result} categories={categories} /> : null}
          </>
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
            <span className="text-zinc-500">
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
          <p className="text-center text-xs text-zinc-500 dark:text-zinc-400">
            {params.showAll ? (
              <Link
                href={hrefWith(params, { showAll: false })}
                scroll={false}
                className="inline-block py-2 underline decoration-zinc-300 underline-offset-2 hover:text-zinc-900 dark:decoration-zinc-600 dark:hover:text-zinc-100"
              >
                Hide clubs with little info
              </Link>
            ) : (
              <>
                {pluralize(result.hiddenSparse, "club")} with little info hidden ·{" "}
                <Link
                  href={hrefWith(params, { showAll: true })}
                  scroll={false}
                  className="inline-block py-2 font-medium text-zinc-700 underline decoration-zinc-300 underline-offset-2 hover:text-zinc-900 dark:text-zinc-300 dark:decoration-zinc-600 dark:hover:text-zinc-100"
                >
                  Show them
                </Link>{" "}
                ·{" "}
                <Link
                  href="/contribute"
                  className="inline-block py-2 text-zinc-600 underline decoration-zinc-300 underline-offset-2 hover:text-zinc-900 dark:text-zinc-400 dark:decoration-zinc-600 dark:hover:text-zinc-100"
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
