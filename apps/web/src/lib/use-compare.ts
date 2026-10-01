"use client";

import { useCallback, useSyncExternalStore } from "react";

/**
 * The clubs a visitor has picked to compare, kept in localStorage so "+ Compare" on any
 * directory row or profile builds one list (max 4). The /compare URL stays the shareable
 * source of truth; this is only the picking convenience.
 */
export const MAX_COMPARE = 4;
const KEY = "hclubs:compare";
const EVENT = "hclubs:compare";

function read(): string[] {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? "[]") as unknown;
    return Array.isArray(raw) ? raw.filter((s): s is string => typeof s === "string").slice(0, MAX_COMPARE) : [];
  } catch {
    return [];
  }
}

let snapshot: string[] = [];
let snapshotKey = "";
function getSnapshot(): string[] {
  const next = read();
  const key = next.join(",");
  if (key !== snapshotKey) {
    snapshotKey = key;
    snapshot = next;
  }
  return snapshot;
}
const EMPTY: string[] = [];

function subscribe(cb: () => void): () => void {
  window.addEventListener(EVENT, cb);
  window.addEventListener("storage", cb);
  return () => {
    window.removeEventListener(EVENT, cb);
    window.removeEventListener("storage", cb);
  };
}

export function setCompare(slugs: string[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify([...new Set(slugs)].slice(0, MAX_COMPARE)));
  } catch {
    /* storage blocked: the URL still works */
  }
  window.dispatchEvent(new Event(EVENT));
}

export function useCompare() {
  const slugs = useSyncExternalStore(subscribe, getSnapshot, () => EMPTY);
  const toggle = useCallback(
    (slug: string) => setCompare(slugs.includes(slug) ? slugs.filter((s) => s !== slug) : [...slugs, slug]),
    [slugs],
  );
  return { slugs, toggle, full: slugs.length >= MAX_COMPARE };
}
