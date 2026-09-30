import { describe, expect, it } from "vitest";
import { PoliteHttpFetcher } from "../src/fetch/http-fetcher";
import { parseRobots } from "../src/fetch/robots";
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
    const r = parseRobots(txt, "ClubIndexBot/0.1");
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
