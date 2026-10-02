"use client";

import { useCallback, useSyncExternalStore } from "react";
import { createListStore } from "./local-list";

/**
 * The clubs a visitor has picked to compare, kept in localStorage so "+ Compare" on any
 * directory row or profile builds one list (max 4). The /compare URL stays the shareable
 * source of truth; this is only the picking convenience.
 */
export const MAX_COMPARE = 4;
const store = createListStore("hclubs:compare", MAX_COMPARE);
const EMPTY: string[] = [];

export const setCompare = store.write;

export function useCompare() {
  const slugs = useSyncExternalStore(store.subscribe, store.getSnapshot, () => EMPTY);
  const toggle = useCallback(
    (slug: string) => setCompare(slugs.includes(slug) ? slugs.filter((s) => s !== slug) : [...slugs, slug]),
    [slugs],
  );
  return { slugs, toggle, full: slugs.length >= MAX_COMPARE };
}
