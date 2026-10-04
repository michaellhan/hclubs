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

const groupId = (g: string) => `cat-${g.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;

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
        className="h-10 w-full max-w-md rounded-lg border border-stone-300 bg-white px-3 text-base outline-none placeholder:text-stone-500 focus:border-accent focus:ring-4 focus:ring-accent/15 sm:text-sm dark:border-stone-700 dark:bg-stone-900"
      />
      {groups.length > 1 ? (
        <nav aria-label="Jump to a category" className="-mt-4 flex gap-2 overflow-x-auto pb-1">
          {groups.map(([group, clubs]) => (
            <a
              key={group}
              href={`#${groupId(group)}`}
              className="inline-flex min-h-8 shrink-0 items-center rounded-full border border-stone-200 px-3 text-sm hover:border-stone-400 dark:border-stone-800 dark:hover:border-stone-600"
            >
              {group} <span className="tabular ml-1.5 text-stone-500">{clubs.length}</span>
            </a>
          ))}
        </nav>
      ) : null}
      {groups.length === 0 ? <p className="text-sm text-stone-500">No club by that name here.</p> : null}
      {groups.map(([group, clubs]) => (
        <section key={group} id={groupId(group)}>
          <SectionHeading aside={<span className="text-xs text-stone-500">{clubs.length}</span>}>
            {group}
          </SectionHeading>
          <ul className="divide-y divide-stone-100 rounded-lg border border-stone-200 dark:divide-stone-800 dark:border-stone-800">
            {clubs.map((c) => (
              <li key={c.slug} className="flex items-center justify-between gap-3 px-3 py-2">
                <div className="min-w-0" data-tip={c.name}>
                  <Link href={`/clubs/${c.slug}`} className="block truncate text-sm font-medium hover:underline">
                    {c.name}
                  </Link>
                  <p className="text-xs text-stone-500 dark:text-stone-400">
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
                    className="inline-flex h-11 shrink-0 items-center rounded-md border border-stone-200 px-2.5 text-xs font-medium text-stone-700 hover:border-stone-400 hover:bg-stone-50 sm:h-7 dark:border-stone-700 dark:text-stone-300 dark:hover:bg-stone-900"
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
