"use client";

import { useEffect, useState } from "react";
import type { StaticIndex } from "@hci/db/local";
import { withBase } from "./site";

let cache: Promise<StaticIndex> | null = null;

function load(): Promise<StaticIndex> {
  cache ??= fetch(withBase("/data/index.json")).then((r) => {
    if (!r.ok) throw new Error(`index.json: HTTP ${r.status}`);
    return r.json() as Promise<StaticIndex>;
  });
  cache.catch(() => {
    cache = null; // allow a retry on the next mount
  });
  return cache;
}

/** The static club index (one small JSON file, fetched once per page load and shared). `enabled=false` defers the fetch,
 * e.g. until a search box is focused. */
export function useIndex(enabled = true): { data: StaticIndex | null; error: boolean } {
  const [state, setState] = useState<{ data: StaticIndex | null; error: boolean }>({ data: null, error: false });
  useEffect(() => {
    if (!enabled) return;
    let live = true;
    load().then(
      (data) => live && setState({ data, error: false }),
      () => live && setState({ data: null, error: true }),
    );
    return () => {
      live = false;
    };
  }, [enabled]);
  return state;
}
