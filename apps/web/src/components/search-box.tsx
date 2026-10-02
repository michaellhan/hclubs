"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useId, useMemo, useRef, useState, useTransition } from "react";
import { suggest } from "@hci/db/local";
import { withBase } from "@/lib/site";
import { track } from "@/lib/track";
import { useIndex } from "@/lib/use-index";
import { RowRecruiting } from "./row-recruiting";

/**
 * Keyboard-friendly search: "/" focuses, Esc clears, typing updates the URL (debounced)
 * so results are shareable; the directory filters in the browser from the URL.
 */
export function SearchBox({
  initial = "",
  action = "/clubs",
  autoFocus = false,
  size = "md",
  placeholder = "Search clubs or topics",
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
  // The static export serves "/clubs/" (trailingSlash), dev serves "/clubs": compare without it.
  const live = pathname.replace(/\/$/, "") === action.replace(/\/$/, "");

  // Typeahead (not on the directory, where results already update as you type). The index is
  // fetched on first focus, not on page load.
  const listId = useId();
  const [everFocused, setEverFocused] = useState(false);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const { data: index } = useIndex(!live && everFocused);
  const matches = useMemo(
    () => (!live && index && open ? suggest(index.clubs, value, 5).map((s) => s.club) : []),
    [live, index, open, value],
  );
  const showList = open && matches.length > 0;
  const optionId = (i: number) => `${listId}-${i}`;
  useEffect(() => setActive(-1), [value]);

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
      if (value.trim()) track("search", { oncePerPage: true });
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
      onFocus={() => {
        setEverFocused(true);
        setOpen(true);
      }}
      onBlur={(e) => {
        // Focus moving to a suggestion's link stays inside the form. (No Save buttons in the list: a listbox may own only options.)
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
          setOpen(false);
        }
      }}
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
        className={`pointer-events-none absolute top-1/2 -translate-y-1/2 fill-stone-400 ${big ? "left-4 size-5" : "left-3 size-4"}`}
      >
        <path d="M8.5 3a5.5 5.5 0 0 1 4.383 8.823l3.647 3.647a.75.75 0 1 1-1.06 1.06l-3.647-3.646A5.5 5.5 0 1 1 8.5 3Zm0 1.5a4 4 0 1 0 0 8 4 4 0 0 0 0-8Z" />
      </svg>
      <input
        ref={input}
        name="q"
        type="search"
        value={value}
        autoFocus={autoFocus}
        onChange={(e) => {
          setValue(e.target.value);
          setOpen(true);
        }}
        role={live ? undefined : "combobox"}
        aria-expanded={live ? undefined : showList}
        aria-controls={live ? undefined : listId}
        aria-autocomplete={live ? undefined : "list"}
        aria-activedescendant={showList && active >= 0 ? optionId(active) : undefined}
        onKeyDown={(e) => {
          if (showList && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
            e.preventDefault();
            setActive((i) => (e.key === "ArrowDown" ? (i + 1) % matches.length : (i <= 0 ? matches.length : i) - 1));
          } else if (showList && e.key === "Enter" && active >= 0) {
            e.preventDefault();
            const club = matches[active];
            if (club) {
              setOpen(false);
              router.push(`/clubs/${club.slug}`);
            }
          } else if (showList && e.key === "Escape") {
            // First Esc closes the list; the next clears the box.
            e.preventDefault();
            setOpen(false);
          } else if (!live && !showList && e.key === "ArrowDown" && matches.length === 0 && value.trim() && !open) {
            // Reopen suggestions after Esc.
            e.preventDefault();
            setOpen(true);
          } else if (e.key === "ArrowDown") {
            // Into the results (directory): ↑/↓ move between them, Esc comes back here.
            const first = document.querySelector<HTMLElement>("[data-result]");
            if (first) {
              e.preventDefault();
              first.focus();
            }
          } else if (e.key === "Escape") {
            setValue("");
            (e.target as HTMLInputElement).blur();
          }
        }}
        placeholder={placeholder}
        aria-label="Search clubs"
        autoComplete="off"
        spellCheck={false}
        className={`w-full border border-stone-300 bg-white text-stone-900 shadow-xs placeholder:text-stone-500 focus:border-accent focus:outline-none focus:ring-4 focus:ring-accent/15 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-100 ${big ? "h-13 rounded-full pl-11 pr-16 text-base" : "h-10 rounded-lg pl-9 pr-12 text-base sm:h-9 sm:text-sm"}`}
      />
      <kbd
        className={`pointer-coarse:hidden pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 rounded border border-stone-200 px-1.5 font-mono text-[10px] text-stone-500 dark:border-stone-700 ${pending || value ? "opacity-0" : ""}`}
      >
        /
      </kbd>
      {showList ? (
        <ul
          id={listId}
          role="listbox"
          aria-label="Matching clubs"
          // Keep focus in the input while a suggestion is pressed: on touch the blur can otherwise
          // close (unmount) the list before the tap becomes a click.
          onMouseDown={(e) => e.preventDefault()}
          className="absolute top-full right-0 left-0 z-40 mt-1.5 overflow-hidden rounded-xl border border-stone-200 bg-white text-left shadow-lg dark:border-stone-700 dark:bg-stone-900"
        >
          {matches.map((c, i) => (
            <li
              key={c.id}
              role="presentation"
              className={`flex items-center px-3 ${i === active ? "bg-stone-100 dark:bg-stone-800" : ""}`}
            >
              <Link
                id={optionId(i)}
                role="option"
                aria-selected={i === active}
                href={`/clubs/${c.slug}`}
                prefetch={false}
                tabIndex={-1}
                className="flex min-h-11 min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-0.5 py-1.5 text-sm"
              >
                <span className="font-medium">{c.name}</span>
                {c.acronym ? <span className="text-stone-500 dark:text-stone-400">{c.acronym}</span> : null}
                {c.currentCycle ? <RowRecruiting cycle={c.currentCycle} seasons={c.recruitingSeasons} /> : null}
              </Link>
            </li>
          ))}
        </ul>
      ) : null}
      {pending ? (
        <span
          className="absolute top-1/2 right-3 size-3 -translate-y-1/2 animate-spin rounded-full border-2 border-stone-300 border-t-stone-700"
          aria-label="Loading"
        />
      ) : null}
    </form>
  );
}
