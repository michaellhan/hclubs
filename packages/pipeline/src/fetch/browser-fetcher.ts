import type { Logger } from "../logger";
import { htmlToDocument } from "../parse/document";
import type { FetchResult, SourceCandidate, SourceFetcher } from "../types";

/**
 * Browser fallback for JS-rendered pages (M3 item 5, CLAUDE.md §11.1: Playwright only
 * where required, behind a flag). Every request goes through the polite static fetcher
 * first, so robots.txt, rate limits and conditional GET still apply. Only when the static
 * HTML is an empty app shell (`looksJsRendered`) is the same URL rendered in headless
 * Chrome, after another politeness interval. The rendered HTML is what gets snapshotted,
 * with `fetch_method = browser`.
 */
export interface PageRenderer {
  render(url: string): Promise<{ html: string; finalUrl: string }>;
  close(): Promise<void>;
}

export class BrowserFallbackFetcher implements SourceFetcher {
  rendered = 0;
  renderFailures = 0;

  constructor(
    private readonly inner: SourceFetcher,
    private readonly renderer: PageRenderer,
    private readonly opts: {
      minIntervalMs: number;
      maxBytes?: number;
      logger?: Logger;
      sleep?: (ms: number) => Promise<void>;
    },
  ) {}

  async fetch(
    candidate: SourceCandidate,
    conditional?: { etag?: string | null; lastModified?: string | null },
  ): Promise<FetchResult> {
    const res = await this.inner.fetch(candidate, conditional);
    if (res.status !== "ok" || !res.body || !/html/i.test(res.contentType ?? "")) return res;
    const html = new TextDecoder().decode(res.body);
    const before = htmlToDocument(html, res.finalUrl);
    if (!before.looksJsRendered) return res;
    const sleep = this.opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
    await sleep(this.opts.minIntervalMs);
    const started = Date.now();
    try {
      const out = await this.renderer.render(res.finalUrl);
      const bytes = new TextEncoder().encode(out.html);
      // Same size cap as static fetches; and a render that reveals no more text than the
      // static HTML (canvas/animation pages) isn't worth storing.
      if (bytes.byteLength > (this.opts.maxBytes ?? 10 * 1024 * 1024)) throw new Error("rendered page too large");
      if (htmlToDocument(out.html, out.finalUrl).text.length <= before.text.length)
        throw new Error("render revealed no additional text");
      this.rendered++;
      return {
        ...res,
        finalUrl: out.finalUrl,
        body: bytes,
        // A rendered DOM has no stable validators.
        etag: null,
        lastModified: null,
        durationMs: res.durationMs + (Date.now() - started),
        method: "browser",
      };
    } catch (error) {
      this.renderFailures++;
      this.opts.logger?.warn({ url: res.finalUrl, error: String(error) }, "browser render failed; keeping static HTML");
      return res;
    }
  }
}

/**
 * Headless Chrome via playwright-core, using the locally installed Chrome (no browser
 * download). Images, media and fonts are not loaded. Imported lazily so the pipeline
 * runs without it unless `--browser` is passed.
 */
export async function createChromeRenderer(userAgent: string): Promise<PageRenderer> {
  const { chromium } = await import("playwright-core");
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  const context = await browser.newContext({ userAgent, javaScriptEnabled: true });
  await context.route("**/*", (route) =>
    ["image", "media", "font"].includes(route.request().resourceType()) ? route.abort() : route.continue(),
  );
  return {
    async render(url) {
      const page = await context.newPage();
      try {
        await page.goto(url, { waitUntil: "networkidle", timeout: 30_000 });
        return { html: await page.content(), finalUrl: page.url() };
      } finally {
        await page.close();
      }
    },
    async close() {
      await context.close();
      await browser.close();
    },
  };
}
