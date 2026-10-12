"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { isRecruitingNow } from "@hci/core/browser";
import {
  INTENTS,
  facetCounts,
  liveClub,
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
import { JOINING_FILTERS } from "@/lib/joining";
import {
  constraintSentences,
  constraintsToFilters,
  negatedSentence,
  processSentence,
  softSentence,
} from "@/lib/query-notes";
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
import { QUICK_CHIP_KEYS, QuickFilters, RECRUITING_WINDOW, quickActiveCount } from "./quick-filters";
import { TopicChips, isTopicChip } from "./topic-chips";
import { ListSkeleton } from "./recruiting-now";
import { SearchBox } from "./search-box";
import { SelectMenu } from "./select-menu";
import { Chevron, EmptyState } from "./ui";

/** Rows added each time the list end scrolls into view. */
const PAGE_SIZE = 30;

/** How far a visitor had scrolled this list, so Back from a profile shows the same rows. */
const SHOWN_KEY = "hc-directory-shown";
function savedShown(key: string): number | null {
  try {
    const v = JSON.parse(sessionStorage.getItem(SHOWN_KEY) ?? "null") as { key?: string; n?: number } | null;
    return v?.key === key && typeof v.n === "number" ? v.n : null;
  } catch {
    return null;
  }
}

/**
 * Rows to show for one list: grows by a page when the sentinel nears the viewport. Starts at
 * the old `page` param's worth (shared links) or where this tab last was; a new search,
 * filter or sort starts over.
 */
function useShownCount(listKey: string, page: number) {
  const [state, setState] = useState(() => ({ key: listKey, n: page * PAGE_SIZE }));
  // Session storage is read after mount, so the prerendered HTML and first render agree.
  useEffect(() => {
    const n = savedShown(listKey);
    setState({ key: listKey, n: Math.max(n ?? 0, page * PAGE_SIZE) });
  }, [listKey, page]);
  const n = state.key === listKey ? state.n : page * PAGE_SIZE;
  const more = () =>
    setState((s) => {
      const next = { key: listKey, n: (s.key === listKey ? s.n : page * PAGE_SIZE) + PAGE_SIZE };
      try {
        sessionStorage.setItem(SHOWN_KEY, JSON.stringify(next));
      } catch {
        // Private mode: the list still grows, it just isn't remembered.
      }
      return next;
    });
  return [n, more] as const;
}

/** Calls `onVisible` whenever this marker comes within a screen of the viewport. */
function LoadMore({ onVisible, remaining }: { onVisible: () => void; remaining: number }) {
  const ref = useRef<HTMLButtonElement>(null);
  const cb = useRef(onVisible);
  cb.current = onVisible;
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver((es) => es.some((e) => e.isIntersecting) && cb.current(), {
      rootMargin: "0px 0px 800px 0px",
    });
    io.observe(el);
    return () => io.disconnect();
  }, [remaining]);
  // A real button too, for keyboards and browsers without IntersectionObserver.
  return (
    <button ref={ref} type="button" onClick={onVisible} className="hc-chip mx-auto flex">
      Show {Math.min(remaining, PAGE_SIZE)} more
    </button>
  );
}
const SORTS = [
  ["relevance", "Best match"],
  ["popularity", "Popularity"],
  ["name", "Name"],
] as const;

function ActiveChips({ params, categories }: { params: DirectoryParams; categories: CategoryWithCount[] }) {
  // Quick chips and topic chips show their own on state; listing them again here would repeat them.
  const topic = isTopicChip(params.filters.intent);
  const chips = filterChips(params.filters, categories).filter(
    (c) => !QUICK_CHIP_KEYS.includes(c.key) && !(topic && c.key === "intent"),
  );
  if (chips.length === 0) return null;
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {chips.map((c) => (
        <Link
          key={c.key}
          href={hrefWith(params, { filters: { ...params.filters, ...c.patch } })}
          scroll={false}
          className="inline-flex min-h-11 items-center gap-1 rounded-full bg-stone-900 py-0.5 pr-3 pl-3 text-xs sm:min-h-7 sm:pr-2 sm:pl-2.5 text-white hover:bg-stone-700 dark:bg-stone-100 dark:text-stone-900 dark:hover:bg-stone-300"
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

/** Yes/no filters that leave out clubs whose sources don't say either way. */
const YES_NO_FILTERS = ["openJoin", "noComp", "noDues", "noExperience"] as const;

/**
 * Under a yes/no filter, one quiet line saying the list is clubs that say so, so "16 clubs"
 * never reads as "only 16 exist" (ADR 0041). The exact counts stay in the filter tooltips.
 */
function UnknownNote({ params, facets }: { params: DirectoryParams; facets: FacetCounts | null }) {
  if (!facets) return null;
  const leftOut = YES_NO_FILTERS.some((k) => params.filters[k] && facets.known[k].unknown > 0);
  if (!leftOut) return null;
  return (
    <p className="text-xs text-stone-500 dark:text-stone-400">
      Clubs that say so.{" "}
      <Link href="/contribute" className="underline underline-offset-2">
        Know another?
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
  result: {
    constraints: LocalSearchResult["constraints"];
    soft: string[];
    negated?: string[];
    process?: string[];
    searchedText?: string;
  } | null;
  convertHref: string | undefined;
  hoursUnknown?: number | null;
}) {
  if (!result) return null;
  const sentences = constraintSentences(result.constraints, hoursUnknown);
  const alone = !(result.searchedText ?? "").trim();
  const soft = softSentence(result.soft, alone);
  const negated = negatedSentence(result.negated ?? []);
  const process = processSentence(result.process ?? [], alone);
  if (!sentences.length && !soft && !negated && !process) return null;
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
      {process ? <p>{process}</p> : null}
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
        // Read as a filter, not a word: name the filter ("First-years eligible"), and account
        // for every club in "Show all N": confirmed + say no + don't say.
        const label =
          r.constraint in JOINING_FILTERS
            ? JOINING_FILTERS[r.constraint as keyof typeof JOINING_FILTERS].label
            : r.phrase;
        const no = Math.max(0, r.without - result.total - r.unknown);
        return (
          <p key={r.constraint}>
            {result.total === 0
              ? `No ${what} is confirmed for “${label}”.`
              : `Only ${pluralize(result.total, what)} ${result.total === 1 ? "is" : "are"} confirmed for “${label}”.`}{" "}
            <Link href={hrefWith(params, { q })} scroll={false} className="underline underline-offset-2">
              Show all {pluralize(r.without, what)}
            </Link>{" "}
            ({no ? `${no.toLocaleString("en-US")} say no, ` : ""}
            {r.unknown.toLocaleString("en-US")} don&apos;t say).
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
      {intent.rank ? "; invitation-only clubs and final clubs left out, open clubs first" : ""}.
    </>
  );
  const label = <span className="font-medium text-stone-900 dark:text-stone-100">{intent.label}:</span>;
  return (
    <>
      {/* Phones: one line and a disclosure, so the first club isn't pushed off-screen. */}
      <details className="group rounded-lg bg-stone-50 px-3 text-sm text-stone-600 sm:hidden dark:bg-stone-900 dark:text-stone-400">
        <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-2 [&::-webkit-details-marker]:hidden">
          <span className="min-w-0 truncate font-medium text-stone-900 dark:text-stone-100">{intent.label}</span>
          <span className="shrink-0 text-xs font-medium text-accent group-open:hidden">What&apos;s included</span>
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
      <ul className="hc-list">
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
  const listParams = new URLSearchParams(searchParams.toString());
  listParams.delete("page");
  const [shown, showMore] = useShownCount(listParams.toString(), params.page);
  // Searching the whole index is the costly step: rerun it only when the query changes, not on
  // every render (the More filters toggle, a tray update).
  const found = useMemo(
    () =>
      data && now
        ? searchLocal(data.clubs, {
            text: params.q,
            filters,
            sort: params.sort,
            // Every match at once: scrolling only reveals more of the list, without searching again.
            offset: 0,
            limit: Number.MAX_SAFE_INTEGER,
            now,
            categoryName: (slug: string) => categories.find((c) => c.slug === slug)?.name ?? slug,
          })
        : null,
    [data, now, filters, params.q, params.sort, categories],
  );
  const facets = useMemo(
    () => (data && now ? facetCounts(data.clubs, { text: params.q, filters, now }) : null),
    [data, now, filters, params.q],
  );
  const result = found;
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
  const nFilters =
    activeFilterCount(params.filters) - quickActiveCount(params.filters) - (isTopicChip(params.filters.intent) ? 1 : 0);
  // Directory-wide, not this view: the chip shouldn't come and go as a search narrows the list.
  const recruitingWindow = useMemo(() => {
    if (!data || !now) return false;
    const live = data.clubs.filter((c) => liveClub(c, now).cycles.some((cy) => isRecruitingNow(cy.status)));
    return live.length >= RECRUITING_WINDOW;
  }, [data, now]);
  const anyFilter = activeFilterCount(params.filters) > 0;
  const ranked = Boolean(params.q) || INTENTS.some((i) => i.slug === params.filters.intent && i.rank);
  // "Best match" only when there's something to match.
  const sortOptions = SORTS.filter(([k]) => k !== "relevance" || ranked);
  const router = useRouter();
  const [filtersOpen, setFiltersOpen] = useState(false);
  const shareable = Boolean(params.q || anyFilter);

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <Suspense>
        <SearchBox initial={params.q ?? ""} />
      </Suspense>

      <div className="flex flex-wrap items-center gap-1.5">
        <QuickFilters
          params={params}
          facets={facets}
          implied={result?.constraints.map((c) => c.filter) ?? []}
          convertHref={convertHref}
          recruitingWindow={recruitingWindow}
        />
        <button
          type="button"
          aria-expanded={filtersOpen}
          aria-controls="more-filters"
          onClick={() => setFiltersOpen((o) => !o)}
          className={`inline-flex h-11 items-center gap-1.5 rounded-full border px-3 text-sm font-medium whitespace-nowrap transition-colors sm:h-8 ${
            filtersOpen || nFilters > 0
              ? "border-accent bg-accent-soft text-accent"
              : "border-stone-200 text-stone-700 hover:border-stone-400 hover:bg-stone-50 dark:border-stone-700 dark:text-stone-300 dark:hover:border-stone-500 dark:hover:bg-stone-900"
          }`}
        >
          More filters{nFilters > 0 ? ` (${nFilters})` : ""}
          <Chevron className={filtersOpen ? "rotate-180" : ""} />
        </button>
      </div>

      <TopicChips params={params} facets={facets} />

      {filtersOpen ? (
        <div id="more-filters" className="rounded-xl border border-stone-200 p-4 dark:border-stone-800">
          <Filters params={params} categories={categories} facets={facets} />
          <button
            type="button"
            onClick={() => setFiltersOpen(false)}
            className="sticky bottom-[calc(var(--tray-offset,0px)+0.75rem)] mt-3 flex h-11 w-full items-center justify-center rounded-full bg-brand text-sm font-medium text-on-brand shadow-lg hover:bg-brand-hover sm:h-9"
          >
            {result ? `Show ${pluralize(result.total, "club")}` : "Done"}
          </button>
        </div>
      ) : null}

      <QueryNotes result={result} convertHref={convertHref} hoursUnknown={facets?.hours.unknown ?? null} />
      {result ? <RelaxedHints params={params} result={result} /> : null}

      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="tabular text-sm text-stone-500" aria-live="polite" aria-atomic="true">
          {result ? pluralize(result.total, "organization") : "Loading…"}
          {params.q ? <> matching “{cleanQuery(params.q)}”</> : null}
        </p>
        <div className="flex shrink-0 items-center gap-1 text-sm text-stone-500 dark:text-stone-400">
          <span aria-hidden className="hidden sm:inline">
            Sort
          </span>
          <SelectMenu
            label="Sort"
            align="right"
            value={params.sort}
            options={sortOptions.map(([key, label]) => ({ value: key, label }))}
            onChange={(sort) => router.replace(hrefWith(params, { sort }), { scroll: false })}
            className="-my-2 h-11 rounded-full px-2 text-base font-medium text-stone-800 hover:bg-stone-50 hover:text-stone-950 sm:h-8 sm:text-sm dark:text-stone-200 dark:hover:bg-stone-900 dark:hover:text-white"
          />
        </div>
      </div>
      {shareable ? (
        <div className="flex flex-wrap items-center gap-2">
          <ActiveChips params={params} categories={categories} />
          <CopyLink label="Copy link to this search" />
        </div>
      ) : null}

      <UnknownNote params={params} facets={facets} />

      {result?.corrected && result.total > 0 ? (
        <p className="text-sm text-stone-600 dark:text-stone-400">
          Showing results for{" "}
          <span className="font-medium text-stone-900 dark:text-stone-100">“{result.corrected}”</span>.
        </p>
      ) : null}
      {/* A topic chip speaks for itself; the rule note is for intents reached by link. */}
      {isTopicChip(params.filters.intent) ? null : (
        <IntentNote intentSlug={params.filters.intent} categories={categories} />
      )}

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
        <ul onKeyDown={resultKeys} className="hc-list">
          {result.clubs.slice(0, shown).map((c) => (
            <ClubRow key={c.id} club={c} why={params.q ? result.reasons[c.id] : undefined} filters={params.filters} />
          ))}
        </ul>
      ) : (
        <NoResults params={params} result={result} clubs={data.clubs} categories={categories} now={now} />
      )}
      {result && params.q && result.total === 1 && data ? (
        <RelatedToOne club={result.clubs[0]!} all={data.clubs} categories={categories} />
      ) : null}

      {result && result.clubs.length > shown ? (
        <LoadMore onVisible={showMore} remaining={result.clubs.length - shown} />
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
  );
}
