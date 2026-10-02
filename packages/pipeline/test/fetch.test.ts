import { describe, expect, it } from "vitest";
import { BrowserFallbackFetcher } from "../src/fetch/browser-fetcher";
import { PoliteHttpFetcher } from "../src/fetch/http-fetcher";
import { parseRobots } from "../src/fetch/robots";
import { privateAddressReason, unsafeUrlReason } from "../src/fetch/url-safety";
import { MemorySnapshotStore } from "../src/snapshots/store";

describe("robots.txt", () => {
  const txt = `
User-agent: *
Disallow: /api/
Disallow: /*?format=json
Allow: /api/public
Crawl-delay: 5

User-agent: BadBot
Disallow: /
`;
  it("applies longest-match with Allow winning ties", () => {
    const r = parseRobots(txt, "hclubsBot/0.1");
    expect(r.allows("/programs")).toBe(true);
    expect(r.allows("/api/private")).toBe(false);
    expect(r.allows("/api/public/x")).toBe(true);
    expect(r.allows("/programs?format=json")).toBe(false);
    expect(r.crawlDelaySeconds).toBe(5);
  });
  it("uses the specific group for a matching agent", () => {
    expect(parseRobots(txt, "BadBot/1.0").allows("/programs")).toBe(false);
  });
  it("empty robots allows everything", () => {
    expect(parseRobots("", "x").allows("/anything")).toBe(true);
  });
  it("handles $ anchors", () => {
    const r = parseRobots("User-agent: *\nDisallow: /account$", "x");
    expect(r.allows("/account")).toBe(false);
    expect(r.allows("/accounts")).toBe(true);
  });
});

function fakeFetch(routes: Record<string, () => Response>): { impl: typeof fetch; calls: string[] } {
  const calls: string[] = [];
  const impl = (async (input: string | URL | Request) => {
    const url = String(input);
    calls.push(url);
    const handler = routes[url];
    if (!handler) return new Response("not found", { status: 404 });
    const res = handler();
    Object.defineProperty(res, "url", { value: url });
    return res;
  }) as typeof fetch;
  return { impl, calls };
}

const noSleep = async () => {};

describe("PoliteHttpFetcher", () => {
  it("skips URLs disallowed by robots.txt without fetching them", async () => {
    const { impl, calls } = fakeFetch({
      "https://example.org/robots.txt": () => new Response("User-agent: *\nDisallow: /private"),
    });
    const f = new PoliteHttpFetcher({ userAgent: "TestBot/1", fetchImpl: impl, sleep: noSleep, minIntervalMs: 1000 });
    const r = await f.fetch({ url: "https://example.org/private/page", sourceType: "public_web" });
    expect(r.status).toBe("robots_disallowed");
    expect(calls).toEqual(["https://example.org/robots.txt"]);
  });

  it("retries retryable statuses then succeeds", async () => {
    let n = 0;
    const { impl } = fakeFetch({
      "https://example.org/robots.txt": () => new Response("", { status: 404 }),
      "https://example.org/list": () =>
        ++n < 3
          ? new Response("busy", { status: 503 })
          : new Response("<html>ok</html>", { headers: { "content-type": "text/html" } }),
    });
    const f = new PoliteHttpFetcher({ userAgent: "TestBot/1", fetchImpl: impl, sleep: noSleep, minIntervalMs: 1000 });
    const r = await f.fetch({ url: "https://example.org/list", sourceType: "public_web" });
    expect(r.status).toBe("ok");
    expect(r.attempts).toBe(3);
    expect(new TextDecoder().decode(r.body!)).toBe("<html>ok</html>");
  });

  it("reports http errors without throwing and rejects unsupported content types", async () => {
    const { impl } = fakeFetch({
      "https://example.org/robots.txt": () => new Response("", { status: 404 }),
      "https://example.org/gone": () => new Response("gone", { status: 410 }),
      "https://example.org/file.zip": () => new Response("zip", { headers: { "content-type": "application/zip" } }),
    });
    const f = new PoliteHttpFetcher({ userAgent: "TestBot/1", fetchImpl: impl, sleep: noSleep, minIntervalMs: 1000 });
    expect((await f.fetch({ url: "https://example.org/gone", sourceType: "public_web" })).status).toBe("http_error");
    expect((await f.fetch({ url: "https://example.org/file.zip", sourceType: "public_web" })).error).toMatch(
      /content-type/,
    );
  });

  it("treats an unreachable robots.txt (5xx) as disallow-all", async () => {
    const { impl } = fakeFetch({ "https://down.example/robots.txt": () => new Response("", { status: 500 }) });
    const f = new PoliteHttpFetcher({ userAgent: "TestBot/1", fetchImpl: impl, sleep: noSleep, minIntervalMs: 1000 });
    expect((await f.fetch({ url: "https://down.example/x", sourceType: "public_web" })).status).toBe(
      "robots_disallowed",
    );
  });

  it("reports a host that doesn't resolve as a network error, not a robots opt-out", async () => {
    const impl = (async () => {
      throw new TypeError("fetch failed", { cause: new Error("getaddrinfo ENOTFOUND gone.example") });
    }) as typeof fetch;
    const f = new PoliteHttpFetcher({ userAgent: "TestBot/1", fetchImpl: impl, sleep: noSleep, minIntervalMs: 1000 });
    const r = await f.fetch({ url: "https://gone.example/", sourceType: "club_website" });
    expect(r.status).toBe("network_error");
    expect(r.error).toMatch(/host unreachable: getaddrinfo ENOTFOUND/);
  });

  it("falls back to the www host when the bare domain is unreachable (and keeps the requested URL)", async () => {
    const calls: string[] = [];
    const impl = (async (input: string | URL | Request) => {
      const url = String(input);
      calls.push(url);
      if (url.startsWith("https://advocate.example/")) throw new TypeError("fetch failed");
      const res = url.endsWith("robots.txt")
        ? new Response("", { status: 404 })
        : new Response("<html><title>Advocate</title></html>", { headers: { "content-type": "text/html" } });
      Object.defineProperty(res, "url", { value: url });
      return res;
    }) as typeof fetch;
    const f = new PoliteHttpFetcher({ userAgent: "TestBot/1", fetchImpl: impl, sleep: noSleep, minIntervalMs: 1000 });
    const r = await f.fetch({ url: "https://advocate.example/", sourceType: "club_website" });
    expect(r).toMatchObject({
      status: "ok",
      requestedUrl: "https://advocate.example/",
      finalUrl: "https://www.advocate.example/",
    });
    expect(calls).toEqual([
      "https://advocate.example/robots.txt",
      "https://www.advocate.example/robots.txt",
      "https://www.advocate.example/",
    ]);
  });

  it("sends conditional headers and reports not_modified", async () => {
    let seen: Headers | null = null;
    const impl = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("robots.txt")) return new Response("", { status: 404 });
      seen = new Headers(init?.headers);
      return new Response(null, { status: 304 });
    }) as typeof fetch;
    const f = new PoliteHttpFetcher({ userAgent: "TestBot/1", fetchImpl: impl, sleep: noSleep, minIntervalMs: 1000 });
    const r = await f.fetch({ url: "https://example.org/list", sourceType: "public_web" }, { etag: '"abc"' });
    expect(r.status).toBe("not_modified");
    expect(seen!.get("if-none-match")).toBe('"abc"');
  });
});

describe("snapshot store", () => {
  it("is content-addressed and write-once", async () => {
    const store = new MemorySnapshotStore();
    const a = await store.put(new TextEncoder().encode("hello"));
    const b = await store.put(new TextEncoder().encode("hello"));
    expect(a.key).toBe(b.key);
    expect(a.sha256).toBe("2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824");
    expect(store.objects.size).toBe(1);
  });
});

describe("BrowserFallbackFetcher", () => {
  const shell = `<html><head><title>App</title><script src="a.js"></script><script src="b.js"></script><script src="c.js"></script></head><body><div id="root"></div></body></html>`;
  const full = `<html><head><title>Club</title></head><body><main><p>${"Real server-rendered content about the club. ".repeat(10)}</p></main></body></html>`;
  const make = (html: string, status: "ok" | "robots_disallowed" = "ok") => ({
    fetch: async (c: { url: string }) => ({
      status,
      requestedUrl: c.url,
      finalUrl: c.url,
      httpStatus: status === "ok" ? 200 : null,
      contentType: status === "ok" ? "text/html" : null,
      etag: '"v1"',
      lastModified: null,
      body: status === "ok" ? new TextEncoder().encode(html) : null,
      fetchedAt: new Date(),
      attempts: 1,
      durationMs: 1,
      error: null,
      method: "static" as const,
    }),
  });
  const renderer = () => {
    const calls: string[] = [];
    return {
      calls,
      render: async (url: string) => {
        calls.push(url);
        return { html: full, finalUrl: url };
      },
      close: async () => undefined,
    };
  };
  const noSleep = { minIntervalMs: 0, sleep: async () => undefined };

  it("renders only pages whose static HTML is an empty app shell", async () => {
    const r = renderer();
    const f = new BrowserFallbackFetcher(make(shell), r, noSleep);
    const res = await f.fetch({ url: "https://club.test/", sourceType: "public_web" });
    expect(res.method).toBe("browser");
    expect(new TextDecoder().decode(res.body ?? new Uint8Array())).toContain("server-rendered");
    expect(res.etag).toBeNull();
    expect(r.calls).toEqual(["https://club.test/"]);

    const r2 = renderer();
    const plain = await new BrowserFallbackFetcher(make(full), r2, noSleep).fetch({
      url: "https://club.test/",
      sourceType: "public_web",
    });
    expect(plain.method).toBe("static");
    expect(r2.calls).toEqual([]);
  });

  it("never renders what the static fetcher was not allowed to fetch", async () => {
    const r = renderer();
    const res = await new BrowserFallbackFetcher(make(shell, "robots_disallowed"), r, noSleep).fetch({
      url: "https://club.test/",
      sourceType: "public_web",
    });
    expect(res.status).toBe("robots_disallowed");
    expect(r.calls).toEqual([]);
  });
});

describe("URL safety (SSRF, ADR 0039)", () => {
  it("refuses this machine, the local network and odd schemes", () => {
    for (const u of [
      "http://localhost:54320/",
      "http://127.0.0.1/",
      "http://2130706433/", // 127.0.0.1 as one number
      "http://0x7f.1/",
      "http://[::1]/",
      "http://[::ffff:192.168.1.1]/",
      "http://10.0.0.5/admin",
      "http://172.20.1.1/",
      "http://192.168.1.1/",
      "http://169.254.169.254/latest/meta-data/",
      "http://[fd00::1]/",
      "http://printer.local/",
      "http://intranet/",
      "file:///etc/passwd",
      "ftp://example.org/",
      "javascript:alert(1)",
      "https://user:pass@example.org/",
      "not a url",
    ])
      expect(unsafeUrlReason(u), u).not.toBeNull();
    for (const u of [
      "https://example.org/x",
      "http://hcs.harvard.edu/~club",
      "https://93.184.216.34/",
      "https://[2606:4700::1111]/",
    ])
      expect(unsafeUrlReason(u), u).toBeNull();
    expect(privateAddressReason("172.32.0.1")).toBeNull();
    expect(privateAddressReason("100.64.0.1")).not.toBeNull();
  });

  it("refuses a public name that resolves to a private address, and a redirect into the network", async () => {
    const { impl, calls } = fakeFetch({
      "https://example.org/robots.txt": () => new Response(""),
      "https://example.org/go": () =>
        new Response(null, { status: 302, headers: { location: "http://127.0.0.1:54320/" } }),
      "https://example.org/hop": () => new Response(null, { status: 301, headers: { location: "/final" } }),
      "https://example.org/final": () => new Response("<html>ok</html>", { headers: { "content-type": "text/html" } }),
    });
    const resolveHost = async (host: string) => (host === "rebind.example" ? ["10.1.2.3"] : ["93.184.216.34"]);
    const f = new PoliteHttpFetcher({ userAgent: "t", fetchImpl: impl, sleep: noSleep, minIntervalMs: 0, resolveHost });
    const rebind = await f.fetch({ url: "https://rebind.example/", sourceType: "public_web" });
    expect(rebind.error).toMatch(/unsafe target: rebind\.example resolves to a private address/);
    const redirect = await f.fetch({ url: "https://example.org/go", sourceType: "public_web" });
    expect(redirect.error).toMatch(/unsafe redirect target: loopback/);
    expect(calls).not.toContain("http://127.0.0.1:54320/");
    const ok = await f.fetch({ url: "https://example.org/hop", sourceType: "public_web" });
    expect(ok).toMatchObject({ status: "ok", finalUrl: "https://example.org/final" });
  });
});
