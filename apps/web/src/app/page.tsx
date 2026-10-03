import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { getCategories } from "@hci/db";
import { SearchBox } from "@/components/search-box";
import { db } from "@/lib/db";
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
  const categories = await getCategories(db());
  const topLevel = categories.filter((c) => c.parentSlug === null && c.clubCount > 0);

  return (
    <div className="flex min-h-[60vh] flex-col justify-center sm:min-h-[65vh]">
      <WebsiteJsonLd />
      <section className="mx-auto w-full max-w-2xl text-center">
        <h1 className="text-3xl font-semibold tracking-tight text-balance sm:text-4xl">
          Every Harvard club, <span className="text-accent">in one place.</span>
        </h1>
        <div className="mt-6 sm:mt-8">
          <Suspense>
            <SearchBox size="lg" autoFocus />
          </Suspense>
        </div>
      </section>

      <nav aria-label="Browse by category" className="mx-auto mt-12 max-w-2xl text-center sm:mt-16">
        <ul className="flex flex-wrap justify-center gap-x-4 gap-y-1 text-sm">
          {topLevel.map((c) => (
            <li key={c.slug}>
              <Link
                href={`/categories/${c.slug}`}
                className="inline-flex min-h-11 items-center text-stone-500 hover:text-accent sm:min-h-0 sm:py-1 dark:text-stone-400"
              >
                {c.name}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
    </div>
  );
}
