import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";

/**
 * Page-weight budgets for the static build (CLAUDE.md §13: the index stays small enough to
 * filter instantly). Runs against apps/web/out when a build is present; skipped otherwise,
 * since tests never build the site.
 */
const OUT = join(__dirname, "..", "out");
const built = existsSync(join(OUT, "index.html"));

const gz = (path: string) => gzipSync(readFileSync(path)).length;
const KB = 1024;

function initialJsGz(page: string): number {
  const html = readFileSync(join(OUT, page), "utf8");
  const scripts = new Set([...html.matchAll(/src="\/(_next\/static\/[^"]+\.js)"/g)].map((m) => m[1]!));
  let total = 0;
  for (const s of scripts) total += gz(join(OUT, s));
  return total;
}

describe.skipIf(!built)("static build budgets", () => {
  it("the club index stays under 300 KB gzipped", () => {
    expect(gz(join(OUT, "data", "index.json"))).toBeLessThan(300 * KB);
  });

  it.each(["index.html", "clubs/index.html", "recruiting/index.html", "about/index.html"])(
    "%s loads under 230 KB of gzipped JS up front",
    (page) => {
      expect(initialJsGz(page)).toBeLessThan(230 * KB);
    },
  );
});
