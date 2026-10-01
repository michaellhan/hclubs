import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Keep Zod out of the browser bundle (launch audit: it was about 90 KB gzipped on every
 * page). Walks static imports from every client component and from the browser entries of
 * @hci/core and @hci/db, and fails if any path reaches "zod" or the Zod-backed modules.
 */
const root = resolve(__dirname, "../../..");
const ALIASES: Record<string, string> = {
  "@hci/core/browser": "packages/core/src/browser.ts",
  "@hci/core": "packages/core/src/index.ts",
  "@hci/db/local": "packages/db/src/local.ts",
  "@hci/db": "packages/db/src/index.ts",
};

function resolveImport(from: string, spec: string): string | null {
  const alias = ALIASES[spec];
  if (alias) return join(root, alias);
  if (spec.startsWith("@/")) spec = join(root, "apps/web/src", spec.slice(2));
  else if (spec.startsWith(".")) spec = resolve(dirname(from), spec);
  else return null; // a package: only "zod" matters, checked by name
  for (const ext of ["", ".ts", ".tsx", "/index.ts", "/index.tsx"]) {
    const p = spec + ext;
    if (existsSync(p) && statSync(p).isFile()) return p;
  }
  return null;
}

function importsOf(file: string): string[] {
  const src = readFileSync(file, "utf8");
  // Value imports and re-exports only; `import type` / `export type` are erased.
  return [...src.matchAll(/^(?:import|export)\s+(?!type\b)(?:[^"';]*?\sfrom\s+)?["']([^"']+)["']/gm)].map(
    (m) => m[1] as string,
  );
}

function zodPath(entry: string): string[] | null {
  const seen = new Set<string>();
  const walk = (file: string, path: string[]): string[] | null => {
    if (seen.has(file)) return null;
    seen.add(file);
    for (const spec of importsOf(file)) {
      if (spec === "zod" || spec.startsWith("zod/")) return [...path, file, "zod"];
      const next = resolveImport(file, spec);
      const hit = next ? walk(next, [...path, file]) : null;
      if (hit) return hit;
    }
    return null;
  };
  return walk(entry, []);
}

function clientFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) return clientFiles(p);
    return /\.tsx?$/.test(f) && readFileSync(p, "utf8").startsWith('"use client"') ? [p] : [];
  });
}

describe("browser bundle", () => {
  it("detects Zod where it is (the full @hci/core entry uses it)", () => {
    expect(zodPath(join(root, ALIASES["@hci/core"]!))).not.toBeNull();
  });

  it("@hci/core/browser and @hci/db/local don't import Zod", () => {
    expect(zodPath(join(root, ALIASES["@hci/core/browser"]!))).toBeNull();
    expect(zodPath(join(root, ALIASES["@hci/db/local"]!))).toBeNull();
  });

  it("no client component imports Zod, directly or through a module it uses", () => {
    const files = clientFiles(join(root, "apps/web/src"));
    expect(files.length).toBeGreaterThan(10);
    for (const f of files) expect(zodPath(f), f.slice(root.length)).toBeNull();
  });
});
