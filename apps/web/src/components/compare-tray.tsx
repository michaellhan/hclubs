"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useIndex } from "@/lib/use-index";
import { track } from "@/lib/track";
import { setCompare, useCompare } from "@/lib/use-compare";

/** "+ Compare" toggle for a directory row or profile. */
export function CompareToggle({ slug, variant = "row" }: { slug: string; variant?: "row" | "button" }) {
  const { slugs, toggle, full } = useCompare();
  const on = slugs.includes(slug);
  const disabled = !on && full;
  const label = on ? "Added to compare" : disabled ? "Compare is full (4)" : "Add to compare";
  const onToggle = () => {
    if (!on) track("compare-add");
    toggle(slug);
  };
  if (variant === "button") {
    return (
      <button
        type="button"
        onClick={onToggle}
        disabled={disabled}
        aria-pressed={on}
        title={label}
        className={`inline-flex h-9 shrink-0 items-center gap-1.5 rounded-lg border px-3 text-sm font-medium transition-colors disabled:opacity-40 ${
          on
            ? "border-zinc-900 bg-zinc-900 text-white dark:border-zinc-100 dark:bg-zinc-100 dark:text-zinc-900"
            : "border-zinc-200 text-zinc-700 hover:border-zinc-400 hover:bg-zinc-50 dark:border-zinc-800 dark:text-zinc-300 dark:hover:border-zinc-600 dark:hover:bg-zinc-900"
        }`}
      >
        {on ? "✓ Comparing" : "+ Compare"}
      </button>
    );
  }
  return (
    <button
      type="button"
      onClick={onToggle}
      disabled={disabled}
      aria-pressed={on}
      aria-label={label}
      title={label}
      className={`relative z-10 inline-flex size-10 shrink-0 sm:size-8 items-center justify-center rounded-md text-base leading-none transition disabled:opacity-30 ${
        on
          ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
          : "text-zinc-400 ring-1 ring-zinc-200 ring-inset hover:text-zinc-900 hover:ring-zinc-400 dark:ring-zinc-700 dark:hover:text-zinc-100"
      }`}
    >
      {on ? "✓" : "+"}
    </button>
  );
}

/** Floating bar listing the clubs picked to compare, everywhere except /compare itself. */
export function CompareTray() {
  const { slugs } = useCompare();
  const { data } = useIndex();
  const path = usePathname();
  if (slugs.length === 0 || path.startsWith("/compare")) return null;
  const names = new Map((data?.clubs ?? []).map((c) => [c.slug, c.acronym || c.name]));
  return (
    <>
      {/* Room at the end of the page so the bar never covers the footer. */}
      <div aria-hidden className="h-20" />
      <div className="pointer-events-none fixed inset-x-0 bottom-0 z-40 flex justify-center px-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
        <div className="pointer-events-auto flex max-w-full items-center gap-2 rounded-xl border border-zinc-200 bg-white/95 p-2 pl-3 shadow-lg backdrop-blur dark:border-zinc-800 dark:bg-zinc-900/95">
          <ul className="flex min-w-0 items-center gap-1.5 overflow-x-auto">
            {slugs.map((s) => (
              <li
                key={s}
                className="flex shrink-0 items-center gap-1 rounded-md bg-zinc-100 py-1 pr-1 pl-2 text-xs font-medium dark:bg-zinc-800"
              >
                <span className="max-w-[9rem] truncate">{names.get(s) ?? s}</span>
                <button
                  type="button"
                  onClick={() => setCompare(slugs.filter((x) => x !== s))}
                  aria-label={`Remove ${names.get(s) ?? s}`}
                  className="rounded px-1 text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100"
                >
                  ×
                </button>
              </li>
            ))}
          </ul>
          <Link
            href={`/compare?clubs=${slugs.join(",")}`}
            className={`inline-flex h-9 shrink-0 items-center rounded-lg px-3 text-sm font-medium ${
              slugs.length >= 2
                ? "bg-zinc-900 text-white hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
                : "bg-zinc-100 text-zinc-500 dark:bg-zinc-800"
            }`}
          >
            {slugs.length >= 2 ? `Compare ${slugs.length}` : "Pick one more"}
          </Link>
        </div>
      </div>
    </>
  );
}
