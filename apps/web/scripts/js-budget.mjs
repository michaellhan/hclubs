// First-load JS budget for the static export: the gzipped size of every script a page's HTML
// loads up front. Chunks loaded on demand (the search engine, pdf.js) are not counted.
//
// Measured 2026-10-13: / 203 KB, /clubs 226, /compare 222, /match 238, a profile 204.
// The budget leaves a little room; growth past it should be a decision, not drift.
//
// Usage: node scripts/js-budget.mjs [outDir] [--strict]   (postbuild runs it as a warning)
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { gzipSync } from "node:zlib";

const BUDGET_KB = 250;
const ROUTES = [
  "index.html",
  "clubs/index.html",
  "compare/index.html",
  "saved/index.html",
  "match/index.html",
  "feedback/index.html",
  "about/index.html",
  "clubs/harvard-citystep/index.html",
];

const args = process.argv.slice(2);
const strict = args.includes("--strict");
const out = args.find((a) => !a.startsWith("--")) ?? join(import.meta.dirname, "..", "out");

const sizes = new Map();
async function gzSize(src) {
  if (!sizes.has(src)) {
    const path = join(out, src.replace(/^\/+/, "").replace(/\?.*$/, ""));
    sizes.set(src, gzipSync(await readFile(path)).length);
  }
  return sizes.get(src);
}

/** Script srcs under /_next/, ignoring a configured base path before it. */
function scriptSrcs(html) {
  const srcs = new Set();
  for (const m of html.matchAll(/<script[^>]*\ssrc="([^"]*\/_next\/[^"]+\.js[^"]*)"/g)) {
    srcs.add(m[1].slice(m[1].indexOf("/_next/")));
  }
  return [...srcs];
}

let over = 0;
for (const route of ROUTES) {
  let html;
  try {
    html = await readFile(join(out, route), "utf8");
  } catch {
    console.warn(`js-budget: ${route} not built; skipped`);
    continue;
  }
  let total = 0;
  for (const src of scriptSrcs(html)) total += await gzSize(src);
  const kb = Math.round(total / 1024);
  const flag = kb > BUDGET_KB ? "  OVER BUDGET" : "";
  if (flag) over++;
  console.log(`js-budget: ${route.replace(/index\.html$/, "") || "/"} ${kb} KB gz${flag}`);
}
if (over) {
  const msg = `js-budget: ${over} page(s) over ${BUDGET_KB} KB gzipped first-load JS`;
  if (strict) {
    console.error(msg);
    process.exit(1);
  }
  console.warn(msg);
}
