import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ClubFilters, getCategories, listClubs } from "@hci/db";
import { ClubRow } from "@/components/club-row";
import { EmptyState, SectionHeading } from "@/components/ui";
import { db } from "@/lib/db";
import { pluralize } from "@/lib/format";
import { pageMetadata } from "@/lib/meta";

export const dynamicParams = false;
export async function generateStaticParams() {
  return (await getCategories(db())).map((c) => ({ slug: c.slug }));
}

const LIMIT = 50;

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
  const result = await listClubs(db(), {
    text: null,
    filters: ClubFilters.parse({ categories: [slug] }),
    sort: "completeness",
    page: 1,
    pageSize: LIMIT,
    now,
  });
  const directoryHref = `/clubs?category=${slug}`;

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
        <p className="tabular text-sm text-stone-500">{pluralize(result.total, "organization")}</p>
      </header>

      {children.length > 0 ? (
        <div className="flex flex-wrap gap-2">
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

      <section>
        <SectionHeading
          aside={
            <Link href={directoryHref} className="text-sm text-stone-500 hover:text-stone-900 dark:hover:text-stone-100">
              Filter &amp; sort in directory →
            </Link>
          }
        >
          Most complete profiles first
        </SectionHeading>
        {result.clubs.length > 0 ? (
          <ul className="divide-y divide-stone-100 overflow-hidden rounded-xl border border-stone-200 dark:divide-stone-800 dark:border-stone-800">
            {result.clubs.map((c) => (
              <ClubRow key={c.id} club={c} />
            ))}
          </ul>
        ) : (
          <EmptyState title="No organizations here yet">
            We haven&apos;t found a source that places a club in this category.
          </EmptyState>
        )}
        {result.total > LIMIT ? (
          <p className="mt-3 text-sm">
            <Link href={directoryHref} className="underline underline-offset-2">
              See all {result.total} in the directory
            </Link>
          </p>
        ) : null}
      </section>
    </div>
  );
}
