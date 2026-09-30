import type { Logger } from "../logger";
import type { FetchResult, SourceCandidate, SourceFetcher } from "../types";
import { parseRobots, type RobotsRules } from "./robots";

/**
 * Polite static fetcher. CLAUDE.md §11.1:
 *  - honest User-Agent; robots.txt honored (cached per origin, 24h) incl. Crawl-delay
 *  - one request at a time per host, ≥ minIntervalMs apart (+ jitter)
 *  - conditional GET, bounded retries with exponential backoff, Retry-After honored
 *  - size limit, timeout, content-type allowlist
 * Never logs in, solves CAPTCHAs, or evades blocks: a block is recorded and we move on.
 */
export interface PoliteFetcherOptions {
  userAgent: string;
  minIntervalMs?: number;
  maxRetries?: number;
  timeoutMs?: number;
  maxBytes?: number;
  logger?: Logger;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
}

const ALLOWED_CONTENT_TYPES = [
  "text/html",
  "application/xhtml+xml",
  "text/plain",
  "application/json",
  "application/ld+json",
  "application/xml",
  "text/xml",
];
const ROBOTS_TTL_MS = 24 * 3600 * 1000;
const RETRYABLE = new Set([408, 425, 429, 500, 502, 503, 504]);

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export class PoliteHttpFetcher implements SourceFetcher {
  private readonly robots = new Map<string, { rules: RobotsRules; fetchedAt: number }>();
  private readonly nextAllowedAt = new Map<string, number>();
  private readonly hostQueues = new Map<string, Promise<unknown>>();
  private readonly opts: Required<Omit<PoliteFetcherOptions, "logger">> & { logger: Logger | undefined };

  constructor(options: PoliteFetcherOptions) {
    this.opts = {
      minIntervalMs: 2000,
      maxRetries: 3,
      timeoutMs: 20_000,
      maxBytes: 10 * 1024 * 1024,
      fetchImpl: fetch,
      sleep: defaultSleep,
      ...options,
      logger: options.logger,
    };
  }

  fetch(
    candidate: SourceCandidate,
    conditional?: { etag?: string | null; lastModified?: string | null },
  ): Promise<FetchResult> {
    const host = new URL(candidate.url).host;
    // Serialize requests per host.
    const previous = this.hostQueues.get(host) ?? Promise.resolve();
    const run = previous.catch(() => undefined).then(() => this.fetchNow(candidate, conditional));
    this.hostQueues.set(host, run);
    return run;
  }

  private async throttle(host: string, crawlDelaySeconds: number | null): Promise<void> {
    const interval = Math.max(this.opts.minIntervalMs, (crawlDelaySeconds ?? 0) * 1000);
    const wait = (this.nextAllowedAt.get(host) ?? 0) - Date.now();
    if (wait > 0) await this.opts.sleep(wait);
    this.nextAllowedAt.set(host, Date.now() + interval + Math.floor(Math.random() * 500));
  }

  private async rulesFor(url: URL): Promise<RobotsRules> {
    const cached = this.robots.get(url.origin);
    if (cached && Date.now() - cached.fetchedAt < ROBOTS_TTL_MS) return cached.rules;
    let rules: RobotsRules;
    try {
      await this.throttle(url.host, null);
      const res = await this.opts.fetchImpl(`${url.origin}/robots.txt`, {
        headers: { "user-agent": this.opts.userAgent },
        signal: AbortSignal.timeout(this.opts.timeoutMs),
      });
      if (res.ok) rules = parseRobots(await res.text(), this.opts.userAgent);
      else if (res.status >= 500)
        rules = parseRobots("User-agent: *\nDisallow: /", this.opts.userAgent); // RFC 9309 §2.3.1.4
      else rules = parseRobots("", this.opts.userAgent); // 4xx: no restrictions
    } catch {
      rules = parseRobots("User-agent: *\nDisallow: /", this.opts.userAgent); // unreachable ⇒ assume disallow
    }
    this.robots.set(url.origin, { rules, fetchedAt: Date.now() });
    return rules;
  }

  private async fetchNow(
    candidate: SourceCandidate,
    conditional?: { etag?: string | null; lastModified?: string | null },
  ): Promise<FetchResult> {
    const started = Date.now();
    const url = new URL(candidate.url);
    const base: Omit<FetchResult, "status"> = {
      requestedUrl: candidate.url,
      finalUrl: candidate.url,
      httpStatus: null,
      contentType: null,
      etag: null,
      lastModified: null,
      body: null,
      fetchedAt: new Date(),
      attempts: 0,
      durationMs: 0,
      error: null,
      method: "static",
    };

    const rules = await this.rulesFor(url);
    if (!rules.allows(url.pathname + url.search)) {
      this.opts.logger?.info({ url: candidate.url }, "robots.txt disallows; skipping");
      return { ...base, status: "robots_disallowed", durationMs: Date.now() - started };
    }

    let lastError: string | null = null;
    for (let attempt = 1; attempt <= this.opts.maxRetries + 1; attempt++) {
      await this.throttle(url.host, rules.crawlDelaySeconds);
      try {
        const headers: Record<string, string> = {
          "user-agent": this.opts.userAgent,
          accept: "text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.5",
        };
        if (conditional?.etag) headers["if-none-match"] = conditional.etag;
        if (conditional?.lastModified) headers["if-modified-since"] = conditional.lastModified;
        const res = await this.opts.fetchImpl(candidate.url, {
          headers,
          redirect: "follow",
          signal: AbortSignal.timeout(this.opts.timeoutMs),
        });
        const common = {
          ...base,
          finalUrl: res.url || candidate.url,
          httpStatus: res.status,
          contentType: res.headers.get("content-type"),
          etag: res.headers.get("etag"),
          lastModified: res.headers.get("last-modified"),
          fetchedAt: new Date(),
          attempts: attempt,
        };
        if (res.status === 304) return { ...common, status: "not_modified", durationMs: Date.now() - started };
        if (RETRYABLE.has(res.status) && attempt <= this.opts.maxRetries) {
          const retryAfter = Number(res.headers.get("retry-after"));
          const backoff =
            Number.isFinite(retryAfter) && retryAfter > 0 ? Math.min(retryAfter, 60) * 1000 : 2 ** attempt * 1000;
          this.opts.logger?.warn(
            { url: candidate.url, status: res.status, attempt },
            "retryable HTTP status; backing off",
          );
          await this.opts.sleep(backoff + Math.floor(Math.random() * 250));
          continue;
        }
        if (!res.ok) {
          return { ...common, status: "http_error", error: `HTTP ${res.status}`, durationMs: Date.now() - started };
        }
        const type = (common.contentType ?? "").split(";")[0]?.trim().toLowerCase() ?? "";
        if (type && !ALLOWED_CONTENT_TYPES.includes(type)) {
          return {
            ...common,
            status: "http_error",
            error: `unsupported content-type ${type}`,
            durationMs: Date.now() - started,
          };
        }
        const body = await readLimited(res, this.opts.maxBytes);
        return { ...common, status: "ok", body, durationMs: Date.now() - started };
      } catch (error) {
        lastError = error instanceof Error ? error.message : String(error);
        if (attempt <= this.opts.maxRetries) {
          this.opts.logger?.warn({ url: candidate.url, attempt, error: lastError }, "network error; backing off");
          await this.opts.sleep(2 ** attempt * 1000);
        }
      }
    }
    return {
      ...base,
      status: "network_error",
      attempts: this.opts.maxRetries + 1,
      error: lastError,
      durationMs: Date.now() - started,
    };
  }
}

async function readLimited(res: Response, maxBytes: number): Promise<Uint8Array> {
  if (!res.body) return new Uint8Array();
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw new Error(`response exceeds ${maxBytes} bytes`);
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.byteLength;
  }
  return out;
}
