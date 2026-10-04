import type { Metadata } from "next";
import Link from "next/link";
import { getCategories } from "@hci/db";
import { db } from "@/lib/db";
import { pluralize } from "@/lib/format";
import { pageMetadata } from "@/lib/meta";

export const metadata: Metadata = pageMetadata({
  title: "Categories",
  description: "Every kind of Harvard student club, with how many we know of.",
  path: "/categories/",
});

/** Every category with clubs, top level first, its subcategories beneath. */
export default async function CategoriesPage() {
  const categories = (await getCategories(db())).filter((c) => c.clubCount > 0);
  const top = categories.filter((c) => !c.parentSlug);
  return (
    <div className="mx-auto max-w-2xl">
      <h1 className="text-2xl font-semibold tracking-tight">Categories</h1>
      <ul className="hc-list mt-4">
        {top.map((c) => {
          const children = categories.filter((x) => x.parentSlug === c.slug);
          return (
            <li key={c.slug} className="px-3 py-3 sm:px-4">
              <Link
                href={`/categories/${c.slug}/`}
                className="inline-flex min-h-11 items-center font-medium hover:underline sm:min-h-0"
              >
                {c.name}
              </Link>
              <span className="tabular ml-2 text-sm text-stone-500 dark:text-stone-400">
                {pluralize(c.clubCount, "club")}
              </span>
              {children.length ? (
                <p className="mt-1 flex flex-wrap gap-x-3 text-sm text-stone-600 dark:text-stone-400">
                  {children.map((x) => (
                    <Link
                      key={x.slug}
                      href={`/categories/${x.slug}/`}
                      className="inline-flex min-h-11 items-center hover:text-stone-900 hover:underline sm:min-h-0 dark:hover:text-stone-100"
                    >
                      {x.name}
                    </Link>
                  ))}
                </p>
              ) : null}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
