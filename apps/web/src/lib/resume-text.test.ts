import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * pdf.js's modern build calls Uint8Array#toHex, Math.sumPrecise and Map#getOrInsertComputed
 * with no fallback, so /match couldn't open resumes in Safari or older Chrome. The legacy
 * build polyfills them; every pdfjs-dist path in the resume reader must be a legacy one.
 */
describe("resume PDF reader", () => {
  it("loads only pdf.js's legacy build", () => {
    const src = readFileSync(resolve(__dirname, "resume-text.ts"), "utf8");
    const paths = [...src.matchAll(/["'](pdfjs-dist[^"']*)["']/g)].map((m) => m[1]);
    expect(paths.length).toBeGreaterThan(0);
    for (const p of paths) expect(p).toMatch(/^pdfjs-dist\/legacy\/build\//);
  });
});
