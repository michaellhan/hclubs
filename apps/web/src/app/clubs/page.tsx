import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { getCategories } from "@hci/db";
import { Directory } from "@/components/directory";
import { db } from "@/lib/db";
import { DirectorySkeleton } from "@/components/directory-skeleton";
import { pageMetadata } from "@/lib/meta";

export const metadata: Metadata = pageMetadata({
  title: "Directory",
  description:
    "Search and filter every Harvard student club we know of by topic, how to join, time commitment and more.",
  path: "/clubs/",
});

export default async function DirectoryPage() {
  // Categories (and their counts) are fixed at build time; search and filtering run in the browser.
  const categories = await getCategories(db());
  return (
    <>
      <h1 className="sr-only">Club directory</h1>
      <noscript>
        <p className="mb-4 text-sm">Search and filters need JavaScript. Browse clubs by category instead:</p>
        <ul className="mb-8 columns-2 text-sm sm:columns-3">
          {categories.map((c) => (
            <li key={c.slug}>
              <Link href={`/categories/${c.slug}/`} className="underline underline-offset-2">
                {c.name}
              </Link>
            </li>
          ))}
        </ul>
      </noscript>
      <Suspense fallback={<DirectorySkeleton />}>
        <Directory categories={categories} />
      </Suspense>
    </>
  );
}
