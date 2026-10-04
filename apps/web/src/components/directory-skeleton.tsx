import { ListSkeleton } from "./recruiting-now";

/** Placeholder while the directory reads its URL state, in the directory's own layout. Not a
 * route `loading.tsx`: that would wrap every /clubs/<slug> page too and hide profiles behind a
 * skeleton until JS runs. */
export function DirectorySkeleton() {
  const bar = "animate-pulse bg-stone-100 dark:bg-stone-800";
  return (
    <div className="mx-auto max-w-3xl space-y-4" role="status" aria-busy="true" aria-label="Loading clubs">
      <div className={`h-10 rounded-lg sm:h-9 ${bar}`} />
      <div className="flex flex-wrap gap-1.5">
        {[28, 24, 22, 30, 28].map((w, i) => (
          <div key={i} className={`h-11 rounded-full sm:h-8 ${bar}`} style={{ width: `${w * 4}px` }} />
        ))}
      </div>
      <div className={`h-4 w-32 rounded ${bar}`} />
      <ListSkeleton rows={8} />
    </div>
  );
}
