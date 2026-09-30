import { readFile } from "node:fs/promises";
import { normalizeUrl } from "@hci/core";
import type { FetchResult, SourceCandidate, SourceFetcher } from "../types";

/**
 * Serves saved fixture files instead of the network. Used by tests and `--offline` runs
 * so adapters can be exercised end-to-end without touching live sites.
 */
export class FixtureFetcher implements SourceFetcher {
  private readonly files: Map<string, string>;

  constructor(
    files: Record<string, string>,
    private readonly fetchedAt: Date = new Date(),
  ) {
    this.files = new Map(Object.entries(files).map(([url, path]) => [normalizeUrl(url) ?? url, path]));
  }

  async fetch(candidate: SourceCandidate): Promise<FetchResult> {
    const key = normalizeUrl(candidate.url) ?? candidate.url;
    const path = this.files.get(key);
    const base = {
      requestedUrl: candidate.url,
      finalUrl: candidate.url,
      etag: null,
      lastModified: null,
      fetchedAt: this.fetchedAt,
      attempts: 1,
      durationMs: 0,
      method: "fixture" as const,
    };
    if (!path) {
      return {
        ...base,
        status: "http_error",
        httpStatus: 404,
        contentType: null,
        body: null,
        error: "no fixture for URL",
      };
    }
    const body = new Uint8Array(await readFile(path));
    return { ...base, status: "ok", httpStatus: 200, contentType: "text/html; charset=utf-8", body, error: null };
  }
}
