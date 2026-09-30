"use client";

import { useRouter } from "next/navigation";

export function ComparePicker({
  options,
  selected,
}: {
  options: { slug: string; name: string; acronym: string | null }[];
  selected: string[];
}) {
  const router = useRouter();
  const go = (slugs: string[]) => router.push(slugs.length ? `/compare?clubs=${slugs.join(",")}` : "/compare");
  const available = options.filter((o) => !selected.includes(o.slug));
  return (
    <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">
      {selected.length < 4 ? (
        <label className="relative min-w-0 flex-1 sm:flex-none">
          <span className="sr-only">Add a club to compare</span>
          <select
            value=""
            onChange={(e) => e.target.value && go([...selected, e.target.value])}
            className="h-10 w-full rounded-md border border-zinc-300 bg-white pr-8 pl-3 text-base sm:h-9 sm:w-auto sm:max-w-[18rem] sm:text-sm dark:border-zinc-700 dark:bg-zinc-900"
          >
            <option value="">+ Add a club ({selected.length}/4)</option>
            {available.map((o) => (
              <option key={o.slug} value={o.slug}>
                {o.name}
                {o.acronym ? ` (${o.acronym})` : ""}
              </option>
            ))}
          </select>
        </label>
      ) : (
        <span className="text-sm text-zinc-500">Maximum of 4 clubs</span>
      )}
      {selected.length > 0 ? (
        <button
          type="button"
          onClick={() => go([])}
          className="h-10 rounded-md px-3 text-sm text-zinc-500 sm:h-9 sm:px-2 hover:text-zinc-900 dark:hover:text-zinc-100"
        >
          Clear
        </button>
      ) : null}
    </div>
  );
}

export function RemoveFromCompare({ slug, selected }: { slug: string; selected: string[] }) {
  const router = useRouter();
  const rest = selected.filter((s) => s !== slug);
  return (
    <button
      type="button"
      onClick={() => router.push(rest.length ? `/compare?clubs=${rest.join(",")}` : "/compare")}
      className="-my-1.5 py-1.5 text-xs text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
      aria-label="Remove from comparison"
    >
      Remove
    </button>
  );
}
