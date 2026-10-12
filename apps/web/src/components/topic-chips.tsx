"use client";

import Link from "next/link";
import type { FacetCounts } from "@hci/db/local";
import { hrefWith, type DirectoryParams } from "@/lib/params";

/**
 * "What do you want to do?" as one row of chips: the intents (ADR 0034) students browse by
 * most, each a fixed rule over categories and a club's own words. Verbs, not the taxonomy:
 * "Perform" spans music, a cappella, dance and theater. Only intents that pick a useful
 * number of clubs are here (the thin ones, like "Make visual art", stay reachable by search).
 */
export const TOPIC_CHIPS: { slug: string; label: string }[] = [
  { slug: "volunteer", label: "Volunteer" },
  { slug: "perform", label: "Perform" },
  { slug: "cultural-community", label: "Cultural & identity" },
  { slug: "build-software", label: "Build software" },
  { slug: "finance-consulting", label: "Finance & consulting" },
  { slug: "prepare-for-medicine", label: "Pre-med" },
  { slug: "learn-policy", label: "Politics & policy" },
  { slug: "write-or-report", label: "Write & report" },
  { slug: "mentor-or-teach", label: "Mentor & teach" },
  { slug: "play-a-sport", label: "Sports" },
];

export const isTopicChip = (slug: string | null): boolean => TOPIC_CHIPS.some((t) => t.slug === slug);

/** One tap picks a topic, another clears it; a topic no club in the view matches is hidden unless on. */
export function TopicChips({ params, facets }: { params: DirectoryParams; facets: FacetCounts | null }) {
  const f = params.filters;
  const chips = TOPIC_CHIPS.filter((t) => f.intent === t.slug || !facets || (facets.intents[t.slug] ?? 0) > 0);
  if (!chips.length) return null;
  return (
    <div
      role="group"
      aria-label="Topics"
      className="-mx-4 flex gap-1.5 overflow-x-auto px-4 [scrollbar-width:none] sm:mx-0 sm:flex-wrap sm:overflow-visible sm:px-0 [&::-webkit-scrollbar]:hidden"
    >
      {chips.map((t) => {
        const on = f.intent === t.slug;
        const count = facets?.intents[t.slug];
        return (
          <Link
            key={t.slug}
            href={hrefWith(params, { filters: { ...f, intent: on ? null : t.slug } })}
            scroll={false}
            replace
            prefetch={false}
            aria-current={on ? "true" : undefined}
            className={`inline-flex h-11 shrink-0 items-center gap-1.5 rounded-full px-3 text-sm whitespace-nowrap transition-colors sm:h-8 ${
              on
                ? "bg-accent-soft font-medium text-accent"
                : "bg-stone-100 text-stone-700 hover:bg-stone-200 dark:bg-stone-900 dark:text-stone-300 dark:hover:bg-stone-800"
            }`}
          >
            {on ? <span aria-hidden>✓</span> : null}
            {t.label}
            <span className="sr-only">
              {on ? ". On. Remove topic" : count !== undefined ? `. ${count} ${count === 1 ? "club" : "clubs"}` : ""}
            </span>
          </Link>
        );
      })}
    </div>
  );
}
