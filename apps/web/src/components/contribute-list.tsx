"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { SectionHeading } from "./ui";

export interface ContributeItem {
  slug: string;
  name: string;
  category: string;
  nameOnly: boolean;
  hasNews: boolean;
  href: string | null;
  external: boolean;
}

const norm = (s: string) => s.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase();

/** The clubs that need help, filterable by name, grouped by category. */
export function ContributeList({ items }: { items: ContributeItem[] }) {
  const [q, setQ] = useState("");
  const groups = useMemo(() => {
    const query = norm(q.trim());
    const shown = query ? items.filter((i) => norm(i.name).includes(query)) : items;
    const m = new Map<string, ContributeItem[]>();
    for (const i of shown) m.set(i.category, [...(m.get(i.category) ?? []), i]);
    return [...m.entries()].sort(([a], [b]) => (a === "Other" ? 1 : b === "Other" ? -1 : a.localeCompare(b)));
  }, [items, q]);

  return (
    <div className="space-y-8">
      <input
        type="search"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Find a club you know…"
        aria-label="Filter clubs by name"
        className="h-10 w-full max-w-md rounded-lg border border-zinc-300 bg-white px-3 text-base outline-none placeholder:text-zinc-400 focus:border-zinc-500 focus:ring-2 focus:ring-zinc-200 sm:text-sm dark:border-zinc-700 dark:bg-zinc-900 dark:focus:ring-zinc-800"
      />
      {groups.length === 0 ? <p className="text-sm text-zinc-500">No club by that name here.</p> : null}
      {groups.map(([group, clubs]) => (
        <section key={group}>
          <SectionHeading aside={<span className="text-xs text-zinc-500">{clubs.length}</span>}>{group}</SectionHeading>
          <ul className="divide-y divide-zinc-100 rounded-lg border border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800">
            {clubs.map((c) => (
              <li key={c.slug} className="flex items-center justify-between gap-3 px-3 py-2">
                <div className="min-w-0">
                  <Link
                    href={`/clubs/${c.slug}`}
                    className="block truncate text-sm font-medium hover:underline"
                    title={c.name}
                  >
                    {c.name}
                  </Link>
                  <p className="text-xs text-zinc-500 dark:text-zinc-400">
                    {c.nameOnly
                      ? "Only the name is known"
                      : c.hasNews
                        ? "In the news, but no website or description"
                        : "No website or description"}
                  </p>
                </div>
                {c.href ? (
                  <a
                    href={c.href}
                    {...(c.external ? { target: "_blank", rel: "noopener noreferrer" } : {})}
                    className="inline-flex h-9 shrink-0 items-center rounded-md border border-zinc-200 px-2.5 text-xs font-medium text-zinc-700 hover:border-zinc-400 hover:bg-zinc-50 sm:h-7 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-900"
                  >
                    Add info
                  </a>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
