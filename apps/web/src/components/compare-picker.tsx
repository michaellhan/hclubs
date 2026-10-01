"use client";

import { useRouter } from "next/navigation";
import { useId, useMemo, useRef, useState } from "react";
import { MAX_COMPARE, setCompare } from "@/lib/use-compare";

type Option = { slug: string; name: string; acronym: string | null; description: string | null };

const norm = (s: string) => s.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase();

/** Rank: acronym match, then name prefix, then word prefix, then substring. */
function rank(o: Option, q: string): number {
  const name = norm(o.name);
  const acr = norm(o.acronym ?? "");
  if (acr && acr === q) return 0;
  if (name.startsWith(q)) return 1;
  const stripped = name.replace(/^(the |harvard |undergraduate |college |radcliffe )+/g, "");
  if (stripped.startsWith(q)) return 2;
  if (name.split(/[\s\-:'’]+/).some((w) => w.startsWith(q))) return 3;
  if (name.includes(q) || (acr && acr.startsWith(q))) return 4;
  return -1;
}

function go(router: ReturnType<typeof useRouter>, slugs: string[]) {
  setCompare(slugs);
  router.push(slugs.length ? `/compare?clubs=${slugs.join(",")}` : "/compare");
}

/** Type-to-search club picker (combobox) for the compare page. */
export function ComparePicker({ options, selected }: { options: Option[]; selected: string[] }) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const listId = useId();
  const matches = useMemo(() => {
    const query = norm(q.trim());
    if (!query) return [];
    return options
      .filter((o) => !selected.includes(o.slug))
      .map((o) => ({ o, r: rank(o, query) }))
      .filter((x) => x.r >= 0)
      .sort((a, b) => a.r - b.r || a.o.name.length - b.o.name.length)
      .slice(0, 8)
      .map((x) => x.o);
  }, [q, options, selected]);

  const add = (slug: string) => {
    go(router, [...selected, slug]);
    setQ("");
    setActive(0);
    input.current?.focus();
  };

  if (selected.length >= MAX_COMPARE) {
    return (
      <div className="flex items-center gap-3 text-sm text-stone-500">
        Comparing the maximum of {MAX_COMPARE}.
        <ClearButton onClear={() => go(router, [])} />
      </div>
    );
  }

  return (
    <div className="flex w-full items-center gap-2 sm:w-auto">
      <div className="relative min-w-0 flex-1 sm:w-80 sm:flex-none">
        <input
          ref={input}
          type="search"
          role="combobox"
          aria-expanded={open && matches.length > 0}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-label="Add a club to compare"
          placeholder={
            selected.length ? `Add another club (${selected.length}/${MAX_COMPARE})` : "Search for a club to compare"
          }
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setActive(0);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 120)}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setActive((i) => Math.min(i + 1, matches.length - 1));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setActive((i) => Math.max(i - 1, 0));
            } else if (e.key === "Enter" && matches[active]) {
              e.preventDefault();
              add(matches[active].slug);
            } else if (e.key === "Escape") {
              setQ("");
            }
          }}
          className="h-10 w-full rounded-lg border border-stone-300 bg-white px-3 text-base outline-none placeholder:text-stone-500 focus:border-accent focus:ring-4 focus:ring-accent/15 sm:text-sm dark:border-stone-700 dark:bg-stone-900"
        />
        {open && matches.length > 0 ? (
          <ul
            id={listId}
            role="listbox"
            className="absolute inset-x-0 top-full z-30 mt-1 max-h-80 overflow-y-auto rounded-lg border border-stone-200 bg-white py-1 shadow-lg dark:border-stone-800 dark:bg-stone-900"
          >
            {matches.map((o, i) => (
              <li
                key={o.slug}
                role="option"
                aria-selected={i === active}
                onMouseDown={(e) => {
                  e.preventDefault();
                  add(o.slug);
                }}
                onMouseEnter={() => setActive(i)}
                className={`cursor-pointer px-3 py-2 ${i === active ? "bg-stone-100 dark:bg-stone-800" : ""}`}
              >
                <div className="truncate text-sm font-medium">
                  {o.name}
                  {o.acronym ? <span className="ml-1.5 font-normal text-stone-500">{o.acronym}</span> : null}
                </div>
                {o.description ? <div className="truncate text-xs text-stone-500">{o.description}</div> : null}
              </li>
            ))}
          </ul>
        ) : null}
      </div>
      {selected.length > 0 ? <ClearButton onClear={() => go(router, [])} /> : null}
    </div>
  );
}

function ClearButton({ onClear }: { onClear: () => void }) {
  return (
    <button
      type="button"
      onClick={onClear}
      className="h-10 shrink-0 rounded-md px-2 text-sm text-stone-500 hover:text-stone-900 dark:hover:text-stone-100"
    >
      Clear
    </button>
  );
}

export function RemoveFromCompare({ slug, selected }: { slug: string; selected: string[] }) {
  const router = useRouter();
  return (
    <button
      type="button"
      onClick={() =>
        go(
          router,
          selected.filter((s) => s !== slug),
        )
      }
      className="-my-1.5 py-1.5 text-xs text-stone-500 hover:text-stone-900 dark:text-stone-400 dark:hover:text-stone-100"
      aria-label="Remove from comparison"
    >
      Remove
    </button>
  );
}
