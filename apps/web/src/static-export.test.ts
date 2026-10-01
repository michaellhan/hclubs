import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Static-export guards (launch audit 2026-10-01). A route `loading.tsx` above a page wraps
 * it in a Suspense boundary: the prerendered HTML then shows the skeleton and hides the
 * real content until JavaScript swaps it in, which crawlers, link previews and no-JS
 * visitors never see. Club, category and about pages must render in the HTML itself.
 */
const app = join(__dirname, "app");

function find(dir: string, name: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? find(p, name) : f === name ? [p] : [];
  });
}

describe("static export", () => {
  it("has no route loading.tsx above prerendered content pages", () => {
    expect(find(app, "loading.tsx").map((p) => p.slice(app.length))).toEqual([]);
  });

  it("every content page sets its own canonical metadata", () => {
    for (const page of [
      "page.tsx",
      "clubs/page.tsx",
      "clubs/[slug]/page.tsx",
      "recruiting/page.tsx",
      "compare/page.tsx",
      "about/page.tsx",
      "about/methodology/page.tsx",
      "about/bot/page.tsx",
      "contribute/page.tsx",
      "categories/[slug]/page.tsx",
    ])
      // pageMetadata()/HOME_METADATA set the canonical URL and a matching og:url; without
      // them a page inherits the home page's, and shared links preview as the home page.
      expect(readFileSync(join(app, page), "utf8"), page).toMatch(/pageMetadata\(|HOME_METADATA/);
  });
});
