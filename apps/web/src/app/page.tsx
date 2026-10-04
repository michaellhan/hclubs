import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { SearchBox } from "@/components/search-box";
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

/** Searches that show what the search understands: topics, activities and joining questions. */
const EXAMPLES = ["consulting", "a cappella", "coding for beginners", "no comp"];

export default function HomePage() {
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
        <p className="mt-4 flex flex-wrap items-center justify-center gap-x-1 text-sm text-stone-500 dark:text-stone-400">
          <span className="mr-1">Try</span>
          {EXAMPLES.map((q, i) => (
            <span key={q} className="inline-flex items-center gap-x-1">
              {i ? <span aria-hidden>·</span> : null}
              <Link
                href={`/clubs?q=${encodeURIComponent(q)}`}
                className="hc-chip-text text-stone-700 dark:text-stone-300"
              >
                {q}
              </Link>
            </span>
          ))}
        </p>
      </section>

      <p className="mx-auto mt-10 flex flex-wrap justify-center gap-x-6 gap-y-2 text-center text-sm sm:mt-14">
        <Link href="/recruiting" className="hc-chip-text">
          See who&apos;s recruiting now <span aria-hidden>→</span>
        </Link>
        <Link href="/match" className="hc-chip-text">
          Find clubs from your resume <span aria-hidden>→</span>
        </Link>
      </p>
    </div>
  );
}
