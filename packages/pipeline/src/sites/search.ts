import { z } from "zod";
import type { Logger } from "../logger";
import type { SearchResult } from "./candidates";

/**
 * Official web-search APIs (CLAUDE.md §10: "via an official search API, not SERP
 * scraping"). A provider returns parsed results plus the raw response, which the stage
 * stores as an immutable snapshot so every search-derived claim has evidence.
 */
export interface SearchResponse {
  results: SearchResult[];
  raw: Uint8Array;
  /** The request URL without credentials: the snapshot's source URL. */
  requestUrl: string;
}

export interface WebSearchProvider {
  name: string;
  /** The request URL for a query, without credentials (stable source identity). */
  requestUrl(query: string): string;
  search(query: string): Promise<SearchResponse>;
}

const BraveResponse = z.object({
  web: z
    .object({
      results: z
        .array(z.object({ url: z.string(), title: z.string(), description: z.string().optional() }))
        .default([]),
    })
    .optional(),
});

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const stripTags = (s: string) =>
  s
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .trim();

/** Brave Search API (https://api.search.brave.com). Key from BRAVE_SEARCH_API_KEY. */
export class BraveSearchProvider implements WebSearchProvider {
  readonly name = "brave";
  private last = 0;

  constructor(
    private readonly apiKey: string,
    private readonly logger: Logger,
    // The free plan allows 1 request/second.
    private readonly minIntervalMs = 1100,
    /** Results per query (Brave allows up to 20). */
    private readonly count = 10,
  ) {}

  requestUrl(query: string): string {
    const params = new URLSearchParams({ q: query, count: String(this.count), country: "us", safesearch: "moderate" });
    return `https://api.search.brave.com/res/v1/web/search?${params.toString()}`;
  }

  async search(query: string): Promise<SearchResponse> {
    const requestUrl = this.requestUrl(query);
    for (let attempt = 1; ; attempt++) {
      const wait = this.last + this.minIntervalMs - Date.now();
      if (wait > 0) await sleep(wait);
      this.last = Date.now();
      let res: Response;
      try {
        res = await fetch(requestUrl, {
          headers: { Accept: "application/json", "X-Subscription-Token": this.apiKey },
          signal: AbortSignal.timeout(20_000),
        });
      } catch (error) {
        // Network errors (reset, DNS, timeout) are transient: retry with backoff.
        if (attempt >= 4) throw error;
        await sleep(2000 * attempt);
        continue;
      }
      if (res.status === 429 || res.status >= 500) {
        if (attempt >= 4) throw new Error(`brave search ${res.status} after ${attempt} attempts`);
        const retryAfter = Number(res.headers.get("retry-after"));
        await sleep(Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 2000 * attempt);
        continue;
      }
      if (!res.ok) throw new Error(`brave search HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
      const raw = new Uint8Array(await res.arrayBuffer());
      const parsed = BraveResponse.parse(JSON.parse(new TextDecoder().decode(raw)));
      const results = parsed.web?.results ?? [];
      this.logger.debug({ query, results: results.length }, "search");
      return {
        // Brave highlights query terms with <strong>; keep plain text only.
        results: results.map((r) => ({
          url: r.url,
          title: stripTags(r.title),
          ...(r.description ? { description: stripTags(r.description) } : {}),
        })),
        raw,
        requestUrl,
      };
    }
  }
}

const WpSearchResponse = z.array(z.object({ url: z.string(), title: z.string() }));

/**
 * A WordPress site's own public search API (`/wp-json/wp/v2/search`), fetched through the
 * polite fetcher (robots.txt and rate limits apply). Used for student publications that
 * run WordPress, so reading them needs no web-search credit (ADR 0027).
 */
export class WordPressSearchProvider implements WebSearchProvider {
  readonly name: string;
  constructor(
    private readonly base: string,
    private readonly fetcher: { fetch: SourceFetcherLike["fetch"] },
  ) {
    this.name = `wordpress:${new URL(base).hostname}`;
  }

  requestUrl(query: string): string {
    const q = query.replace(/\bsite:\S+\s*/g, "").trim();
    const params = new URLSearchParams({ search: q, type: "post", per_page: "20" });
    return `${this.base.replace(/\/$/, "")}/wp-json/wp/v2/search?${params.toString()}`;
  }

  async search(query: string): Promise<SearchResponse> {
    const requestUrl = this.requestUrl(query);
    const res = await this.fetcher.fetch({ url: requestUrl, sourceType: "public_web" });
    if (res.status !== "ok" || !res.body) throw new Error(`wordpress search ${res.status} ${res.httpStatus ?? ""}`);
    const parsed = WpSearchResponse.parse(JSON.parse(new TextDecoder().decode(res.body)));
    return {
      results: parsed.map((r) => ({ url: r.url, title: stripTags(r.title) })),
      raw: res.body,
      requestUrl,
    };
  }
}

interface SourceFetcherLike {
  fetch(candidate: { url: string; sourceType: "public_web" }): Promise<{
    status: string;
    httpStatus: number | null;
    body: Uint8Array | null;
  }>;
}
