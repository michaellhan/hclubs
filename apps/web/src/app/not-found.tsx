import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = { title: "Page not found", robots: { index: false } };

export default function NotFound() {
  return (
    <div className="mx-auto max-w-md py-20 text-center">
      <p className="text-sm font-medium text-stone-500">404</p>
      <h1 className="mt-1 text-2xl font-semibold tracking-tight">We couldn&apos;t find that page</h1>
      <p className="mt-2 text-stone-600 dark:text-stone-400">
        The club may have been renamed or merged with another listing.
      </p>
      <Link
        href="/clubs"
        className="mt-6 inline-block rounded-full bg-brand text-on-brand hover:bg-brand-hover px-4 py-2 text-sm font-medium"
      >
        Browse the directory
      </Link>
    </div>
  );
}
