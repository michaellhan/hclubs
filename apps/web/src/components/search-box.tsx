"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { withBase } from "@/lib/site";

/**
 * Keyboard-friendly search: "/" focuses, Esc clears, typing updates the URL (debounced)
 * so results are shareable; the directory filters in the browser from the URL.
 */
export function SearchBox({
  initial = "",
  action = "/clubs",
  autoFocus = false,
  size = "md",
  placeholder = "Search clubs, acronyms, topics…",
}: {
  initial?: string;
  action?: string;
  autoFocus?: boolean;
  size?: "md" | "lg";
  placeholder?: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [value, setValue] = useState(initial);
  const [pending, startTransition] = useTransition();
  const input = useRef<HTMLInputElement>(null);
  const live = pathname === action;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const typing =
        target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable);
      if (e.key === "/" && !typing) {
        e.preventDefault();
        input.current?.focus();
        input.current?.select();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if (!live) return;
    const current = params.get("q") ?? "";
    if (value.trim() === current) return;
    const t = setTimeout(() => {
      const next = new URLSearchParams(params.toString());
      if (value.trim()) next.set("q", value.trim());
      else next.delete("q");
      next.delete("page");
      next.delete("sort");
      startTransition(() => router.replace(`${action}${next.size ? `?${next}` : ""}`, { scroll: false }));
    }, 220);
    return () => clearTimeout(t);
  }, [value, live, params, router, action]);

  const big = size === "lg";
  return (
    <form
      action={withBase(action)}
      method="get"
      role="search"
      className="relative w-full"
      onSubmit={(e) => {
        e.preventDefault();
        if (live) return;
        const q = value.trim();
        router.push(q ? `${action}?q=${encodeURIComponent(q)}` : action);
      }}
    >
      <svg
        aria-hidden
        viewBox="0 0 20 20"
        className={`pointer-events-none absolute top-1/2 -translate-y-1/2 fill-zinc-400 ${big ? "left-4 size-5" : "left-3 size-4"}`}
      >
        <path d="M8.5 3a5.5 5.5 0 0 1 4.383 8.823l3.647 3.647a.75.75 0 1 1-1.06 1.06l-3.647-3.646A5.5 5.5 0 1 1 8.5 3Zm0 1.5a4 4 0 1 0 0 8 4 4 0 0 0 0-8Z" />
      </svg>
      <input
        ref={input}
        name="q"
        type="search"
        value={value}
        autoFocus={autoFocus}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            setValue("");
            (e.target as HTMLInputElement).blur();
          }
        }}
        placeholder={placeholder}
        aria-label="Search clubs"
        autoComplete="off"
        spellCheck={false}
        className={`w-full rounded-lg border border-zinc-300 bg-white text-zinc-900 shadow-xs placeholder:text-zinc-400 focus:border-zinc-900 focus:outline-none focus:ring-2 focus:ring-zinc-900/10 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100 dark:focus:border-zinc-300 ${big ? "h-13 pl-11 pr-16 text-base" : "h-10 pl-9 pr-12 text-base sm:h-9 sm:text-sm"}`}
      />
      <kbd
        className={`pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 rounded border border-zinc-200 px-1.5 font-mono text-[10px] text-zinc-400 dark:border-zinc-700 ${pending || value ? "opacity-0" : ""}`}
      >
        /
      </kbd>
      {pending ? (
        <span
          className="absolute top-1/2 right-3 size-3 -translate-y-1/2 animate-spin rounded-full border-2 border-zinc-300 border-t-zinc-700"
          aria-label="Loading"
        />
      ) : null}
    </form>
  );
}
