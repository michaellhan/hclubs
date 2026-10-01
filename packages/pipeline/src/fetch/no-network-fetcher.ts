import type { FetchResult, SourceCandidate, SourceFetcher } from "../types";

/**
 * A fetcher for runs that must not touch the network (`enrich --offline`). Stages in
 * offline mode read stored snapshots and never call it; a call is a bug, so it throws
 * instead of quietly reporting a failure the audit could mistake for a dead link.
 */
export class NoNetworkFetcher implements SourceFetcher {
  fetch(candidate: SourceCandidate): Promise<FetchResult> {
    return Promise.reject(new Error(`offline run tried to fetch ${candidate.url}`));
  }
}
