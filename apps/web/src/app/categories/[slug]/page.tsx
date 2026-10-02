import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ClubFilters, getCategories } from "@hci/db";
import { searchLocal, type IndexClub } from "@hci/db/local";
import { JOIN_MODE_HELP, JOIN_MODE_LABEL } from "@hci/core";
import { CategoryClubs } from "@/components/category-clubs";
import { FacetDisclosure } from "@/components/facet-disclosure";
import { RecruitingNow } from "@/components/recruiting-now";
import { EmptyState, SectionHeading } from "@/components/ui";
import { categoryOverview } from "@/lib/category-overview";
import { db } from "@/lib/db";
import { pluralize } from "@/lib/format";
import { pageMetadata } from "@/lib/meta";
import { buildTimeIndex } from "@/lib/static-index";

export const dynamicParams = false;
export async function generateStaticParams() {
  return (await getCategories(db())).map((c) => ({ slug: c.slug }));
}

const LIMIT = 200;

type Props = { params: Promise<{ slug: string }> };

async function load(slug: string) {
  const categories = await getCategories(db());
  const cat = categories.find((c) => c.slug === slug);
  if (!cat) return null;
  return {
    cat,
    parent: cat.parentSlug ? (categories.find((c) => c.slug === cat.parentSlug) ?? null) : null,
    children: categories.filter((c) => c.parentSlug === slug && c.clubCount > 0),
  };
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const data = await load((await params).slug);
  if (!data) return { title: "Category not found" };
  return pageMetadata({
    title: data.cat.name,
    description: data.cat.description ?? `Harvard student organizations in ${data.cat.name}.`,
    path: `/categories/${data.cat.slug}/`,
  });
}

export default async function CategoryPage({ params }: Props) {
  const { slug } = await params;
  const data = await load(slug);
  if (!data) notFound();
  const { cat, parent, children } = data;
  const now = new Date();
  const index = await buildTimeIndex();
  // A–Z, the same rows and rules as the directory (ADR 0038). Not "most complete first":
  // completeness mostly measures how easy a club's sources are for our crawler, which would
  // bury cultural, religious and service groups whose information lives elsewhere.
  const result = searchLocal(index.clubs, {
    text: null,
    filters: ClubFilters.parse({ categories: [slug], hideSparse: true }),
    sort: "name",
    offset: 0,
    limit: LIMIT,
    now,
  });
  const directoryHref = `/clubs?category=${slug}`;
  const o = categoryOverview(index.clubs, index.categories, slug);
  const facetCount =
    o.join.length +
    (o.openJoin > 0 ? 1 : 0) +
    (o.noComp > o.openJoin ? 1 : 0) +
    Number(o.firstYears >= 5) +
    Number(o.usuallyFall >= 5) +
    Number(o.usuallySpring >= 5) +
    1;
  // Rows as the directory shows them (specific categories only, the College's "no comp" flag).
  const indexed = new Map(index.clubs.map((c) => [c.id, c]));
  /** A "good to know" count is shown only when it describes more than a couple of clubs. */
  const MIN_STAT = 5;
  const stat =
    "flex items-baseline justify-between gap-3 rounded-lg px-3 py-2 text-sm hover:bg-stone-50 dark:hover:bg-stone-900";

  return (
    <div className="space-y-8">
      <header className="space-y-2">
        <nav aria-label="Breadcrumb" className="text-sm text-stone-500">
          <Link href="/clubs" className="hover:text-stone-900 dark:hover:text-stone-100">
            Directory
          </Link>
          {parent ? (
            <>
              {" / "}
              <Link href={`/categories/${parent.slug}`} className="hover:text-stone-900 dark:hover:text-stone-100">
                {parent.name}
              </Link>
            </>
          ) : null}
        </nav>
        <h1 className="text-2xl font-semibold tracking-tight">{cat.name}</h1>
        {cat.description ? <p className="max-w-2xl text-stone-600 dark:text-stone-400">{cat.description}</p> : null}
        <p className="tabular text-sm text-stone-500">
          {pluralize(o.total, "organization")}
          {o.total > o.withDetails ? ` · ${o.total - o.withDetails} with no description or link yet` : ""}
        </p>
      </header>

      {o.total > 0 ? (
        <FacetDisclosure label={`Filter this list (${facetCount})`}>
          <section aria-labelledby="overview-heading" className="grid gap-6 md:grid-cols-2">
            <div>
              <h2
                id="overview-heading"
                className="mb-1 text-[13px] font-semibold tracking-wide text-stone-500 uppercase dark:text-stone-400"
              >
                How they take members
              </h2>
              <ul className="-mx-3">
                {o.openJoin > 0 ? (
                  <li>
                    <Link href={`${directoryHref}&open=1&all=1`} className={stat}>
                      <span>Open membership</span>
                      <span className="tabular text-stone-500">{o.openJoin}</span>
                    </Link>
                  </li>
                ) : null}
                {o.noComp > o.openJoin ? (
                  <li>
                    <Link href={`${directoryHref}&nocomp=1&all=1`} className={stat}>
                      <span>No comp</span>
                      <span className="tabular text-stone-500">{o.noComp}</span>
                    </Link>
                  </li>
                ) : null}
                {o.join
                  .filter((j) => j.mode !== "open" && j.mode !== "attendance_based")
                  .map((j) => (
                    <li key={j.mode}>
                      <Link
                        href={`${directoryHref}&join=${j.mode}&all=1`}
                        className={stat}
                        title={JOIN_MODE_HELP[j.mode]}
                      >
                        <span>{JOIN_MODE_LABEL[j.mode]}</span>
                        <span className="tabular text-stone-500">{j.count}</span>
                      </Link>
                    </li>
                  ))}
                <li className="flex items-baseline justify-between gap-3 px-3 py-2 text-sm text-stone-500 dark:text-stone-400">
                  <span>
                    Not stated yet{" "}
                    <Link
                      href="/contribute"
                      className="underline underline-offset-2 hover:text-stone-900 dark:hover:text-stone-100"
                    >
                      Help fill in
                    </Link>
                  </span>
                  <span className="tabular">{o.joinUnknown}</span>
                </li>
              </ul>
              <p className="mt-1 text-xs text-stone-500 dark:text-stone-400">
                A club can use more than one. Counts come from what clubs and Harvard pages say, not from estimates.
              </p>
            </div>
            <div>
              <h2 className="mb-1 text-[13px] font-semibold tracking-wide text-stone-500 uppercase dark:text-stone-400">
                Good to know
              </h2>
              <ul className="-mx-3">
                {/* A zero here would read as "none take first-years"; it only means none say so. A
                  count of 2 of 120 says more about missing data than about the clubs (ADR 0040). */}
                {o.firstYears >= MIN_STAT ? (
                  <li>
                    <Link href={`${directoryHref}&freshmen=1&all=1`} className={stat}>
                      <span>First-years eligible</span>
                      <span className="tabular text-stone-500">{o.firstYears}</span>
                    </Link>
                  </li>
                ) : null}
                {o.usuallyFall >= MIN_STAT ? (
                  <li>
                    <Link href={`${directoryHref}&season=fall&all=1`} className={stat}>
                      <span>Usually recruit in the fall</span>
                      <span className="tabular text-stone-500">{o.usuallyFall}</span>
                    </Link>
                  </li>
                ) : null}
                {o.usuallySpring >= MIN_STAT ? (
                  <li>
                    <Link href={`${directoryHref}&season=spring&all=1`} className={stat}>
                      <span>Usually recruit in the spring</span>
                      <span className="tabular text-stone-500">{o.usuallySpring}</span>
                    </Link>
                  </li>
                ) : null}
              </ul>
              {Math.max(o.firstYears, o.usuallyFall, o.usuallySpring) < MIN_STAT ? (
                <p className="text-sm text-stone-500 dark:text-stone-400">
                  {o.firstYears + o.usuallyFall + o.usuallySpring === 0 ? "No club" : "Few clubs"} here have said yet
                  whether they take first-years or when they usually recruit.
                </p>
              ) : null}
              {o.related.length ? (
                <p className="mt-2 text-sm">
                  <span className="text-stone-500 dark:text-stone-400">Clubs here are often also in </span>
                  {o.related.map((r, i) => (
                    <span key={r.slug}>
                      {i ? ", " : ""}
                      <Link
                        href={`/categories/${r.slug}/`}
                        className="underline decoration-stone-300 underline-offset-2"
                      >
                        {r.name}
                      </Link>
                    </span>
                  ))}
                </p>
              ) : null}
            </div>
          </section>
        </FacetDisclosure>
      ) : null}

      <RecruitingNow
        category={slug}
        quiet
        limit={5}
        heading={<SectionHeading>Recruiting now in {cat.name}</SectionHeading>}
      />

      <section>
        <SectionHeading
          aside={
            <Link
              href={directoryHref}
              className="text-sm text-stone-500 hover:text-stone-900 dark:hover:text-stone-100"
            >
              Filter &amp; sort in directory →
            </Link>
          }
        >
          Clubs
        </SectionHeading>
        {children.length > 0 ? (
          <div className="mb-3 flex flex-wrap gap-2">
            {children.map((c) => (
              <Link
                key={c.slug}
                href={`/categories/${c.slug}`}
                className="rounded-full border border-stone-200 px-3 py-1 text-sm hover:border-stone-400 dark:border-stone-800 dark:hover:border-stone-600"
              >
                {c.name} <span className="tabular text-stone-500">{c.clubCount}</span>
              </Link>
            ))}
          </div>
        ) : null}
        {result.clubs.length > 0 ? (
          <CategoryClubs
            clubs={result.clubs.map((c) => indexed.get(c.id) ?? c) as IndexClub[]}
            directoryHref={directoryHref}
            openJoinCount={o.openJoin}
          />
        ) : (
          <EmptyState title="No organizations here yet">
            We haven&apos;t found a source that places a club in this category.
          </EmptyState>
        )}
        {result.total > LIMIT || result.hiddenSparse > 0 ? (
          <p className="mt-3 text-sm text-stone-500 dark:text-stone-400">
            {result.total > LIMIT ? (
              <Link href={directoryHref} className="text-stone-900 underline underline-offset-2 dark:text-stone-100">
                See all {result.total} in the directory
              </Link>
            ) : null}
            {result.total > LIMIT && result.hiddenSparse > 0 ? " · " : null}
            {result.hiddenSparse > 0 ? (
              <>
                {pluralize(result.hiddenSparse, "more club")} with no description or link yet:{" "}
                <Link
                  href={`${directoryHref}&all=1`}
                  className="text-stone-900 underline underline-offset-2 dark:text-stone-100"
                >
                  show them
                </Link>
              </>
            ) : null}
          </p>
        ) : null}
      </section>
    </div>
  );
}
