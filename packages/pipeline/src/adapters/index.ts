import type { DiscoveryAdapter } from "../types";
import { pbhaProgramsAdapter } from "./pbha-programs";

export { pbhaProgramsAdapter, parsePbhaListing } from "./pbha-programs";

/** Registered discovery adapters. Each needs docs/sources/<name>.md, fixtures, and tests. */
export const ADAPTERS: Record<string, DiscoveryAdapter> = {
  [pbhaProgramsAdapter.name]: pbhaProgramsAdapter,
};

/** Saved fixtures per adapter, for `--offline` runs (URL → file relative to test/fixtures). */
export const OFFLINE_FIXTURES: Record<string, Record<string, string>> = {
  [pbhaProgramsAdapter.name]: {
    "https://www.pbha.org/programs": "pbha-programs/listing.html",
    "https://www.pbha.org/programs?offset=1734301560265": "pbha-programs/listing-page-2.html",
    "https://www.pbha.org/programs?offset=1705368180217": "pbha-programs/listing-page-3.html",
  },
};
