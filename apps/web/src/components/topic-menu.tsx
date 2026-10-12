"use client";

import { useRouter } from "next/navigation";
import type { FacetCounts } from "@hci/db/local";
import { hrefWith, type DirectoryParams } from "@/lib/params";
import { SelectMenu } from "./select-menu";

/**
 * "What do you want to do?" as a Topic dropdown: the intents (ADR 0034) students browse by
 * most, each a fixed rule over categories and a club's own words. Verbs, not the taxonomy:
 * "Perform" spans music, a cappella, dance and theater. Only intents that pick a useful
 * number of clubs are here (the thin ones, like "Make visual art", stay reachable by search).
 */
export const TOPICS: { slug: string; label: string }[] = [
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

export const isTopic = (slug: string | null): boolean => TOPICS.some((t) => t.slug === slug);

/** The directory's Topic dropdown: one pill that opens the topics; picking "Any topic" clears it. */
export function TopicMenu({ params, facets }: { params: DirectoryParams; facets: FacetCounts | null }) {
  const router = useRouter();
  const f = params.filters;
  const current = TOPICS.find((t) => t.slug === f.intent);
  // A topic no club in the view matches is left out, unless it's the one picked.
  const topics = TOPICS.filter((t) => t.slug === f.intent || !facets || (facets.intents[t.slug] ?? 0) > 0);
  const options = [{ value: "", label: "Any topic" }, ...topics.map((t) => ({ value: t.slug, label: t.label }))];
  return (
    <SelectMenu
      label="Topic"
      value={current?.slug ?? ""}
      buttonLabel={current?.label ?? "Topic"}
      options={options}
      onChange={(slug) =>
        router.replace(hrefWith(params, { filters: { ...f, intent: slug || null } }), { scroll: false })
      }
      className={`h-11 rounded-full border px-3 text-sm font-medium whitespace-nowrap transition-colors sm:h-8 ${
        current
          ? "border-accent bg-accent-soft text-accent"
          : "border-stone-200 text-stone-700 hover:border-stone-400 hover:bg-stone-50 dark:border-stone-700 dark:text-stone-300 dark:hover:border-stone-500 dark:hover:bg-stone-900"
      }`}
    />
  );
}
