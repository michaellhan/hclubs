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
        className={`inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full border px-3.5 text-sm font-medium transition-colors disabled:opacity-40 ${
          on
            ? "border-stone-900 bg-stone-900 text-white dark:border-stone-100 dark:bg-stone-100 dark:text-stone-900"
            : "border-stone-200 text-stone-700 hover:border-stone-400 hover:bg-stone-50 dark:border-stone-800 dark:text-stone-300 dark:hover:border-stone-600 dark:hover:bg-stone-900"
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
          ? "bg-stone-900 text-white dark:bg-stone-100 dark:text-stone-900"
          : "text-stone-500 ring-1 ring-stone-200 ring-inset hover:text-stone-900 hover:ring-stone-400 dark:ring-stone-700 dark:hover:text-stone-100"
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
        <div className="pointer-events-auto flex max-w-full items-center gap-2 rounded-xl border border-stone-200 bg-white/95 p-2 pl-3 shadow-lg backdrop-blur dark:border-stone-800 dark:bg-stone-900/95">
          <ul className="flex min-w-0 items-center gap-1.5 overflow-x-auto">
            {slugs.map((s) => (
              <li
                key={s}
                className="flex shrink-0 items-center gap-1 rounded-md bg-stone-100 py-1 pr-1 pl-2 text-xs font-medium dark:bg-stone-800"
              >
                <span className="max-w-[9rem] truncate">{names.get(s) ?? s}</span>
                <button
                  type="button"
                  onClick={() => setCompare(slugs.filter((x) => x !== s))}
                  aria-label={`Remove ${names.get(s) ?? s}`}
                  className="rounded px-1 text-stone-500 hover:text-stone-900 dark:hover:text-stone-100"
                >
                  ×
                </button>
              </li>
            ))}
          </ul>
          <Link
            href={`/compare?clubs=${slugs.join(",")}`}
            className={`inline-flex h-9 shrink-0 items-center rounded-full px-3.5 text-sm font-medium ${
              slugs.length >= 2
                ? "bg-brand text-on-brand hover:bg-brand-hover"
                : "bg-stone-100 text-stone-500 dark:bg-stone-800"
            }`}
          >
            {slugs.length >= 2 ? `Compare ${slugs.length}` : "Pick one more"}
          </Link>
        </div>
      </div>
    </>
  );
}
