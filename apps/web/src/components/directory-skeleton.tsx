/** Placeholder while the directory reads its URL state. Not a route `loading.tsx`: that would
 * wrap every /clubs/<slug> page too and hide profiles behind a skeleton until JS runs. */
export function DirectorySkeleton() {
  return (
    <div
      className="grid gap-6 lg:grid-cols-[14rem_1fr] lg:gap-10"
      role="status"
      aria-busy="true"
      aria-label="Loading clubs"
    >
      <div className="hidden space-y-2 lg:block">
        {Array.from({ length: 10 }, (_, i) => (
          <div
            key={i}
            className="h-4 animate-pulse rounded bg-zinc-100 dark:bg-zinc-800"
            style={{ width: `${50 + ((i * 17) % 40)}%` }}
          />
        ))}
      </div>
      <div className="space-y-4">
        <div className="h-9 animate-pulse rounded-lg bg-zinc-100 dark:bg-zinc-800" />
        <ul className="divide-y divide-zinc-100 rounded-xl border border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800">
          {Array.from({ length: 8 }, (_, i) => (
            <li key={i} className="flex gap-3 p-4">
              <div className="size-10 animate-pulse rounded-lg bg-zinc-100 dark:bg-zinc-800" />
              <div className="flex-1 space-y-2">
                <div className="h-4 w-1/3 animate-pulse rounded bg-zinc-100 dark:bg-zinc-800" />
                <div className="h-3 w-2/3 animate-pulse rounded bg-zinc-100 dark:bg-zinc-800" />
              </div>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
