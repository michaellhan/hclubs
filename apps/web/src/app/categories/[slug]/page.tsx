import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ClubFilters, getCategories } from "@hci/db";
import { searchLocal, type IndexClub } from "@hci/db/local";
import { CategoryClubs } from "@/components/category-clubs";
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
  // Rows as the directory shows them (specific categories only, the College's "no comp" flag).
  const indexed = new Map(index.clubs.map((c) => [c.id, c]));

  return (
    <div className="mx-auto max-w-3xl space-y-8">
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
        {cat.description ? <p className="text-sm text-stone-600 dark:text-stone-400">{cat.description}</p> : null}
      </header>

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
              <Link key={c.slug} href={`/categories/${c.slug}`} className="hc-chip">
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
