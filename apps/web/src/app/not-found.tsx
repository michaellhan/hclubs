import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { MissingClub, MissingClubGate } from "@/components/missing-club";
import { SearchBox } from "@/components/search-box";

export const metadata: Metadata = { title: "Page not found", robots: { index: false } };

export default function NotFound() {
  return (
    <MissingClubGate>
      <div className="mx-auto max-w-md py-16 text-center">
        <p className="text-sm font-medium text-stone-500">404</p>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight">We couldn&apos;t find that page</h1>
        <p className="mt-2 text-stone-600 dark:text-stone-400">
          The club may have been renamed or merged with another listing. Try searching for it.
        </p>
        <div className="mt-5 text-left">
          <Suspense>
            <SearchBox placeholder="Search clubs or topics" />
          </Suspense>
        </div>
        <MissingClub />
        <Link href="/clubs" className="hc-btn-primary mt-6">
          Browse the directory
        </Link>
      </div>
    </MissingClubGate>
  );
}
