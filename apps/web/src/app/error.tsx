"use client";

export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="mx-auto max-w-md py-20 text-center">
      <h1 className="text-2xl font-semibold tracking-tight">Something went wrong</h1>
      <p className="mt-2 text-stone-600 dark:text-stone-400">
        We couldn&apos;t load this page. If you&apos;re running locally, check that the database is running and
        migrated.
      </p>
      {error.digest ? <p className="mt-2 font-mono text-xs text-stone-500">ref {error.digest}</p> : null}
      <button
        onClick={reset}
        className="mt-6 rounded-md border border-stone-300 px-4 py-2 text-sm font-medium dark:border-stone-700"
      >
        Try again
      </button>
    </div>
  );
}
