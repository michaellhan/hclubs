import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * <Fact> and <DerivedFact> render a <details> with block content. Inside a <p> the browser
 * closes the paragraph early, so the server HTML no longer matches React's tree and the page
 * fails to hydrate (React error #418, every profile until 2026-10-02). Wrap them in a div.
 */
function tsxFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return tsxFiles(path);
    return path.endsWith(".tsx") ? [path] : [];
  });
}

describe("facts are never inside a <p>", () => {
  it("no <p>…</p> in the app wraps <Fact> or <DerivedFact>", () => {
    const offenders: string[] = [];
    for (const file of tsxFiles(join(__dirname, ".."))) {
      const src = readFileSync(file, "utf8");
      for (const m of src.matchAll(/<p[\s>][\s\S]*?<\/p>/g)) {
        if (/<(?:Derived)?Fact[\s>]/.test(m[0])) offenders.push(`${file}: ${m[0].slice(0, 80)}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
