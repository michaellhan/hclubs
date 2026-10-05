import type { Browser, BrowserContext } from "playwright-core";
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
  /** `responseHtml`: the main document as the server sent it, before scripts changed the DOM. */
  /**
   * `waitFor`: a CSS selector to wait for (up to `waitMs`, default 8 s) before reading the page,
   * for content that loads after the document (a signed-in Instagram profile's header). The
   * page is read either way.
   */
  render(
    url: string,
    opts?: {
      waitFor?: string;
      waitMs?: number;
      /**
       * Keep the bodies of the page's own data responses whose URL matches (no extra requests),
       * waiting up to `waitMs` until `until` is satisfied by what arrived.
       */
      captureResponses?: RegExp;
      until?: (bodies: readonly string[]) => boolean;
    },
  ): Promise<{ html: string; finalUrl: string; responseHtml?: string | null; responses?: string[] }>;
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
 *
 * `userAgent: null` keeps Chrome's own user agent (the Instagram follower reader, which
 * reads one public page at a time as a browser would; ADR 0046 amendment). `waitUntil`
 * defaults to "networkidle"; pages that never go idle (long polling) want "domcontentloaded".
 * `headless: false` opens a visible Chrome window (Instagram serves headless Chrome a login
 * wall without the profile description).
 */
export async function createChromeRenderer(
  userAgent: string | null,
  opts: {
    waitUntil?: "networkidle" | "domcontentloaded" | "load";
    locale?: string;
    headless?: boolean;
    /**
     * A Chrome profile folder to reuse (cookies kept between runs): the one the owner signs in
     * to Instagram with (`hci instagram-login`, ADR 0050 amendment). Default: a fresh, empty
     * profile per run.
     */
    profileDir?: string;
  } = {},
): Promise<PageRenderer> {
  const { chromium } = await import("playwright-core");
  const contextOpts = {
    ...(userAgent ? { userAgent } : {}),
    ...(opts.locale ? { locale: opts.locale } : {}),
    javaScriptEnabled: true,
  };
  let browser: Browser | null = null;
  let context: BrowserContext;
  if (opts.profileDir) {
    context = await chromium.launchPersistentContext(opts.profileDir, {
      channel: "chrome",
      headless: opts.headless ?? true,
      ...contextOpts,
    });
  } else {
    browser = await chromium.launch({ channel: "chrome", headless: opts.headless ?? true });
    context = await browser.newContext(contextOpts);
  }
  await context.route("**/*", (route) =>
    ["image", "media", "font"].includes(route.request().resourceType()) ? route.abort() : route.continue(),
  );
  return {
    async render(url, wait) {
      const page = await context.newPage();
      const responses: string[] = [];
      const pending: Promise<void>[] = [];
      if (wait?.captureResponses) {
        const want = wait.captureResponses;
        page.on("response", (res) => {
          if (!want.test(res.url())) return;
          pending.push(
            res
              .text()
              .then((body) => void responses.push(body))
              .catch(() => undefined),
          );
        });
      }
      try {
        const response = await page.goto(url, { waitUntil: opts.waitUntil ?? "networkidle", timeout: 30_000 });
        const responseHtml = response ? await response.text().catch(() => null) : null;
        const waitMs = wait?.waitMs ?? 8_000;
        if (wait?.waitFor)
          await page.waitForSelector(wait.waitFor, { state: "attached", timeout: waitMs }).catch(() => undefined); // not there in time: read what loaded
        if (wait?.captureResponses && wait.until) {
          const until = wait.until;
          for (const end = Date.now() + waitMs; Date.now() < end;) {
            await Promise.all(pending);
            if (until(responses)) break;
            await page.waitForTimeout(250);
          }
        }
        await Promise.all(pending);
        return {
          html: await page.content(),
          finalUrl: page.url(),
          responseHtml,
          ...(wait?.captureResponses ? { responses } : {}),
        };
      } finally {
        await page.close();
      }
    },
    async close() {
      await context.close();
      await browser?.close();
    },
  };
}
