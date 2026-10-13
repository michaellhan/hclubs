"use client";

import { useEffect, useState } from "react";
import type * as Impl from "./search-engine-impl";

/**
 * The search engine (search, facets, relaxations, similar clubs) as a chunk of its own, loaded
 * on first use alongside `/data/index.json` (Round 12 build budget: the directory had grown
 * past 230 KB of gzipped JavaScript up front). Nothing can be searched before the index
 * arrives anyway, so the two load in parallel and the directory waits on both.
 */
export type SearchEngine = typeof Impl;

let engine: Promise<SearchEngine> | null = null;
/** Start (or reuse) the engine's download. */
export const loadSearchEngine = (): Promise<SearchEngine> => (engine ??= import("./search-engine-impl"));

let loaded: SearchEngine | null = null;

/** The engine once loaded (null until then); starts loading on mount. */
export function useSearchEngine(): SearchEngine | null {
  const [e, setE] = useState<SearchEngine | null>(loaded);
  useEffect(() => {
    if (loaded) return;
    let live = true;
    void loadSearchEngine().then((m) => {
      loaded = m;
      if (live) setE(m);
    });
    return () => {
      live = false;
    };
  }, []);
  return e;
}
