import type { Logger } from "../logger";
import type { FetchResult, SourceCandidate, SourceFetcher } from "../types";
import { parseRobots, type RobotsRules } from "./robots";
import { systemResolver, unsafeTargetReason, type HostResolver } from "./url-safety";

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
  /**
   * Where a host name resolves, to refuse names that point at private addresses. Defaults to
   * the system resolver with the real network, and to none with an injected `fetchImpl`.
   */
  resolveHost?: HostResolver | null;
  /** Content types accepted (default: pages and data). The logos stage fetches images. */
  allowedContentTypes?: readonly string[];
  /** The request's Accept header, to match `allowedContentTypes`. */
  accept?: string;
}

const MAX_REDIRECTS = 5;

const ALLOWED_CONTENT_TYPES = [
  "text/html",
  "application/xhtml+xml",
  "text/plain",
  "application/json",
  "application/ld+json",
  "application/xml",
  "text/xml",
];
/** A TLS failure about the certificate itself, not the connection. */
const TLS_CERTIFICATE_ERROR = /certificate|altnames|self[- ]signed|ERR_TLS_CERT|CERT_HAS_EXPIRED|UNABLE_TO_VERIFY/i;

const ROBOTS_TTL_MS = 24 * 3600 * 1000;
const RETRYABLE = new Set([408, 425, 429, 500, 502, 503, 504]);

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export class PoliteHttpFetcher implements SourceFetcher {
  private readonly robots = new Map<string, { rules: RobotsRules; fetchedAt: number; unreachable: string | null }>();
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
      resolveHost: options.fetchImpl ? null : systemResolver,
      allowedContentTypes: ALLOWED_CONTENT_TYPES,
      accept: "text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.5",
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
    return (await this.robotsFor(url)).rules;
  }

  /**
   * robots.txt rules, and whether the host answered at all. An unreachable host (DNS
   * failure, refused connection) is treated as disallowing everything (RFC 9309), but
   * reported as unreachable so a dead domain shows up as a network error, not as a site
   * that opted out.
   */
  private async robotsFor(url: URL): Promise<{ rules: RobotsRules; unreachable: string | null }> {
    const cached = this.robots.get(url.origin);
    if (cached && Date.now() - cached.fetchedAt < ROBOTS_TTL_MS)
      return { rules: cached.rules, unreachable: cached.unreachable ?? null };
    let rules: RobotsRules;
    let unreachable: string | null = null;
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
    } catch (error) {
      rules = parseRobots("User-agent: *\nDisallow: /", this.opts.userAgent); // unreachable ⇒ assume disallow
      unreachable =
        error instanceof Error ? (error.cause instanceof Error ? error.cause.message : error.message) : String(error);
    }
    this.robots.set(url.origin, { rules, fetchedAt: Date.now(), unreachable });
    return { rules, unreachable };
  }

  private async fetchNow(
    candidate: SourceCandidate & { altHostTried?: boolean; httpTried?: boolean; requestedUrl?: string },
    conditional?: { etag?: string | null; lastModified?: string | null },
  ): Promise<FetchResult> {
    const started = Date.now();
    const url = new URL(candidate.url);
    const base: Omit<FetchResult, "status"> = {
      requestedUrl: candidate.requestedUrl ?? candidate.url,
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

    // Never this machine or the local network, whatever a page links to (SSRF; ADR 0039).
    const unsafe = await unsafeTargetReason(candidate.url, this.opts.resolveHost);
    if (unsafe) {
      this.opts.logger?.warn({ url: candidate.url, reason: unsafe }, "unsafe target; not fetched");
      return { ...base, status: "http_error", error: `unsafe target: ${unsafe}`, durationMs: Date.now() - started };
    }

    const robots = await this.robotsFor(url);
    if (robots.unreachable) {
      // A site whose https certificate is wrong (another host's name, expired, self-signed)
      // often still answers over plain http (the Wireless Club's w1af.harvard.edu). Read it
      // there once rather than lose the club's site; a refused handshake isn't such a case.
      if (url.protocol === "https:" && !candidate.httpTried && TLS_CERTIFICATE_ERROR.test(robots.unreachable)) {
        const plain = new URL(url.toString());
        plain.protocol = "http:";
        if ((await this.robotsFor(plain)).unreachable === null)
          return this.fetchNow(
            {
              ...candidate,
              url: plain.toString(),
              httpTried: true,
              requestedUrl: candidate.requestedUrl ?? candidate.url,
            },
            conditional,
          );
      }
      // "example.org" and "www.example.org" are one site to us (normalizeUrl drops "www."),
      // but some sites answer on only one of them. Try the other host once.
      const alt = new URL(url.toString());
      alt.hostname = url.hostname.startsWith("www.") ? url.hostname.slice(4) : `www.${url.hostname}`;
      if (!candidate.altHostTried && (await this.robotsFor(alt)).unreachable === null)
        return this.fetchNow(
          { ...candidate, url: alt.toString(), altHostTried: true, requestedUrl: candidate.url },
          conditional,
        );
      this.opts.logger?.info({ url: candidate.url, error: robots.unreachable }, "host unreachable; skipping");
      return {
        ...base,
        status: "network_error",
        error: `host unreachable: ${robots.unreachable}`,
        durationMs: Date.now() - started,
      };
    }
    const rules = robots.rules;
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
          accept: this.opts.accept,
        };
        if (conditional?.etag) headers["if-none-match"] = conditional.etag;
        if (conditional?.lastModified) headers["if-modified-since"] = conditional.lastModified;
        // Redirects are followed by hand so every hop gets the same safety check.
        let target = candidate.url;
        let res: Response;
        for (let hop = 0; ; hop++) {
          res = await this.opts.fetchImpl(target, {
            headers,
            redirect: "manual",
            signal: AbortSignal.timeout(this.opts.timeoutMs),
          });
          const location = res.status >= 300 && res.status < 400 ? res.headers.get("location") : null;
          if (!location) break;
          if (hop >= MAX_REDIRECTS) throw new Error(`more than ${MAX_REDIRECTS} redirects`);
          const next = new URL(location, target).toString();
          const why = await unsafeTargetReason(next, this.opts.resolveHost);
          if (why)
            return {
              ...base,
              finalUrl: next,
              status: "http_error",
              error: `unsafe redirect target: ${why}`,
              durationMs: Date.now() - started,
            };
          target = next;
        }
        const common = {
          ...base,
          finalUrl: res.url || target,
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
          const failed: FetchResult = {
            ...common,
            status: "http_error",
            error: `HTTP ${res.status}`,
            durationMs: Date.now() - started,
          };
          return (await this.wwwTwinAfter404(candidate, res.status, conditional)) ?? failed;
        }
        const type = (common.contentType ?? "").split(";")[0]?.trim().toLowerCase() ?? "";
        if (type && !this.opts.allowedContentTypes.includes(type)) {
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

  /**
   * normalizeUrl drops "www.", but some hosts serve pages only there (Substack custom
   * domains: harvardsalient.com/about 404s, www.harvardsalient.com/about answers). After a
   * 404 (also one reached through redirects) on a bare host, try the www twin once. The
   * requested URL is kept; finalUrl shows the twin. Null when there is nothing to try or the
   * twin failed too, so the caller reports the original 404.
   */
  private async wwwTwinAfter404(
    candidate: SourceCandidate & { altHostTried?: boolean; httpTried?: boolean; requestedUrl?: string },
    status: number,
    conditional?: { etag?: string | null; lastModified?: string | null },
  ): Promise<FetchResult | null> {
    if (status !== 404 || candidate.altHostTried) return null;
    const url = new URL(candidate.url);
    // Only a bare registrable host ("example.org"); subdomains and IPs have no www twin.
    if (url.hostname.split(".").length !== 2 || /^[\d.]+$/.test(url.hostname)) return null;
    url.hostname = `www.${url.hostname}`;
    const twin = await this.fetchNow(
      {
        ...candidate,
        url: url.toString(),
        altHostTried: true,
        requestedUrl: candidate.requestedUrl ?? candidate.url,
      },
      conditional,
    );
    return twin.status === "ok" || twin.status === "not_modified" ? twin : null;
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
