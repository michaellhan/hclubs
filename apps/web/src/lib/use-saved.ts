"use client";

import { useCallback, useSyncExternalStore } from "react";
import { createListStore } from "./local-list";

/** Clubs a visitor has saved, newest first. localStorage only: no accounts, never sent anywhere. */
export const MAX_SAVED = 100;
const store = createListStore("hclubs:saved", MAX_SAVED);
const EMPTY: string[] = [];

/** `slug` added at the front (moved there if already saved); the oldest fall off past the cap. */
export function addSaved(slugs: readonly string[], slug: string): string[] {
  return [slug, ...slugs.filter((s) => s !== slug)].slice(0, MAX_SAVED);
}

export const setSaved = store.write;

export function useSaved() {
  const slugs = useSyncExternalStore(store.subscribe, store.getSnapshot, () => EMPTY);
  // Read the stored list at click time, so two quick taps never act on a stale render.
  const toggle = useCallback((slug: string) => {
    const cur = store.read();
    setSaved(cur.includes(slug) ? cur.filter((s) => s !== slug) : addSaved(cur, slug));
  }, []);
  const remove = useCallback((slug: string) => setSaved(store.read().filter((s) => s !== slug)), []);
  return { slugs, toggle, remove, has: (slug: string) => slugs.includes(slug) };
}
