"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useIndex } from "@/lib/use-index";
import { track } from "@/lib/track";
import { trayWithoutUnknown } from "@/lib/compare-picks";
import { setCompare, useCompare } from "@/lib/use-compare";

/** "+ Compare" toggle for a directory row or profile. */
export function CompareToggle({
  slug,
  name,
  variant = "row",
}: {
  slug: string;
  name?: string;
  variant?: "row" | "button";
}) {
  const { slugs, toggle, full } = useCompare();
  const on = slugs.includes(slug);
  const disabled = !on && full;
  // Constant name (with the club, so rows are told apart); aria-pressed carries the state.
  const label = `Compare${name ? ` ${name}` : ""}${disabled ? " (compare is full, 4 clubs)" : ""}`;
  const title = on ? "Added to compare" : disabled ? "Compare is full (4)" : "Add to compare";
  const [note, setNote] = useState("");
  const onToggle = () => {
    if (!on) track("compare-add");
    toggle(slug);
    setNote(on ? "Removed from compare" : "Added to compare");
  };
  const status = (
    <span role="status" className="sr-only">
      {note}
    </span>
  );
  if (variant === "button") {
    return (
      <>
        <button
          type="button"
          onClick={onToggle}
          disabled={disabled}
          aria-pressed={on}
          data-tip={title}
          className={`inline-flex h-11 shrink-0 items-center gap-1.5 rounded-full border sm:h-9 px-3.5 text-sm font-medium transition-colors disabled:opacity-40 ${
            on
              ? "border-accent bg-accent-soft text-accent"
              : "border-stone-200 text-stone-700 hover:border-stone-400 hover:bg-stone-50 dark:border-stone-800 dark:text-stone-300 dark:hover:border-stone-600 dark:hover:bg-stone-900"
          }`}
        >
          {on ? "✓ Comparing" : "+ Compare"}
        </button>
        {status}
      </>
    );
  }
  return (
    <>
      <button
        type="button"
        onClick={onToggle}
        disabled={disabled}
        aria-pressed={on}
        aria-label={label}
        data-tip={title}
        data-tip-align="right"
        className={`relative z-10 inline-flex size-11 shrink-0 sm:size-8 items-center justify-center rounded-md text-base leading-none transition disabled:opacity-30 ${
          on
            ? "bg-accent-soft text-accent ring-1 ring-accent/40 ring-inset"
            : "text-stone-500 ring-1 ring-stone-200 ring-inset hover:text-stone-900 hover:ring-stone-400 dark:ring-stone-700 dark:hover:text-stone-100"
        }`}
      >
        {on ? <span aria-hidden>✓</span> : <span aria-hidden>+</span>}
      </button>
      {status}
    </>
  );
}

/** Pages with their own compare action, or where a floating bar only gets in the way (a form). */
const NO_TRAY = ["/compare", "/saved", "/feedback", "/for-clubs", "/suggest"];

/**
 * Floating bar listing the clubs picked to compare, hidden on `NO_TRAY` pages and while the
 * directory's filter panel is open (`html[data-filters-open]`, set by the directory).
 */
export function CompareTray() {
  const { slugs } = useCompare();
  const path = usePathname();
  if (slugs.length === 0 || NO_TRAY.some((p) => path.startsWith(p))) return null;
  return <TrayBar slugs={slugs} />;
}

/** Split out so the club index (~136 KB gz) loads only once something is picked, not on every page. */
function TrayBar({ slugs }: { slugs: string[] }) {
  const { data } = useIndex();
  const names = new Map((data?.clubs ?? []).map((c) => [c.slug, c.acronym || c.name]));
  const fullNames = new Map((data?.clubs ?? []).map((c) => [c.slug, c.name]));
  // Until the index arrives a slug would show raw: say only how many (never "harvard-…-club").
  const known = slugs.every((s) => fullNames.has(s));
  // A pick the index no longer lists (club removed or merged since) is dropped once it loads.
  useEffect(() => {
    if (!data) return;
    const kept = trayWithoutUnknown(slugs, new Set(data.clubs.map((c) => c.slug)));
    if (kept.length !== slugs.length) setCompare(kept);
  }, [data, slugs]);
  // Other sticky bottom controls (the directory's "Show N clubs") sit above the bar.
  useEffect(() => {
    document.documentElement.style.setProperty("--tray-offset", "4.75rem");
    return () => {
      document.documentElement.style.removeProperty("--tray-offset");
    };
  }, []);
  // Room at the end of the page only when the bar would cover the footer's text or links
  // (narrow screens); on wide screens they sit side by side and the footer stays put.
  const barRef = useRef<HTMLDivElement>(null);
  const [coversFooter, setCoversFooter] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  useEffect(() => {
    if (!confirmClear) return;
    const t = setTimeout(() => setConfirmClear(false), 3000);
    return () => clearTimeout(t);
  }, [confirmClear]);
  useLayoutEffect(() => {
    const bar = barRef.current;
    if (!bar) return;
    const check = () => {
      const b = bar.getBoundingClientRect();
      const parts = document.querySelectorAll("body > footer p, body > footer nav");
      setCoversFooter(
        Array.from(parts).some((el) => {
          const r = el.getBoundingClientRect();
          return r.left < b.right && r.right > b.left;
        }),
      );
    };
    check();
    const ro = new ResizeObserver(check);
    ro.observe(bar);
    window.addEventListener("resize", check);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", check);
    };
  }, []);
  return (
    <>
      {/* Phones: the bar covers the page bottom, so the page always ends above it. */}
      <div aria-hidden className={`h-20 ${coversFooter ? "" : "sm:hidden"}`} />
      <aside
        aria-label="Clubs picked to compare"
        className="pointer-events-none fixed inset-x-0 bottom-0 z-40 flex [html[data-filters-open]_&]:hidden justify-center px-4 pb-[max(1rem,env(safe-area-inset-bottom))]"
      >
        <div
          ref={barRef}
          className="pointer-events-auto flex max-w-full items-center gap-2 rounded-xl border border-stone-200 bg-white/95 p-2 pl-3 shadow-lg backdrop-blur dark:border-stone-800 dark:bg-stone-900/95"
        >
          {/* Phones: every name on one line (chips would clip to one), and one Clear. */}
          <p className="min-w-0 text-xs font-medium sm:hidden">
            <span className="block">
              {slugs.length} {slugs.length === 1 ? "club" : "clubs"}
            </span>
            {known ? (
              <span className="line-clamp-2 font-normal text-stone-600 dark:text-stone-400">
                {slugs.map((s) => fullNames.get(s)).join(", ")}
              </span>
            ) : null}
          </p>
          <button
            type="button"
            onClick={() => {
              // No undo: the first tap asks, the second clears.
              if (confirmClear) setCompare([]);
              setConfirmClear(!confirmClear);
            }}
            aria-label={confirmClear ? "Tap again to clear the compare list" : "Clear the compare list"}
            className="inline-flex h-11 min-w-11 shrink-0 items-center justify-center rounded px-1 text-xs text-stone-600 hover:text-stone-900 sm:hidden dark:text-stone-400 dark:hover:text-stone-100"
          >
            {confirmClear ? "Clear all?" : "×"}
          </button>
          <ul className="flex min-w-0 items-center gap-1.5 overflow-x-auto max-sm:hidden">
            {slugs.map((s) => (
              <li
                key={s}
                className="flex shrink-0 items-center gap-1 rounded-md bg-stone-100 py-1 pr-1 pl-2 text-xs font-medium dark:bg-stone-800"
              >
                <span className="max-w-[9rem] truncate">{names.get(s) ?? "Club"}</span>
                <button
                  type="button"
                  onClick={() => setCompare(slugs.filter((x) => x !== s))}
                  aria-label={`Remove ${names.get(s) ?? "club"}`}
                  className="-my-1 inline-flex size-11 items-center justify-center rounded text-stone-600 hover:text-stone-900 sm:my-0 sm:size-6 dark:text-stone-400 dark:hover:text-stone-100"
                >
                  ×
                </button>
              </li>
            ))}
          </ul>
          <Link
            href={`/compare?clubs=${slugs.join(",")}`}
            className={`inline-flex h-11 shrink-0 items-center rounded-full px-3.5 text-sm font-medium sm:h-9 ${
              slugs.length >= 2
                ? "bg-brand text-on-brand hover:bg-brand-hover"
                : "bg-stone-100 text-stone-600 dark:bg-stone-800 dark:text-stone-400"
            }`}
          >
            {slugs.length >= 2 ? `Compare ${slugs.length}` : "Pick one more"}
          </Link>
        </div>
      </aside>
    </>
  );
}
