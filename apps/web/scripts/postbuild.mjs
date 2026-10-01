// Shrinks the static export after `next build` without changing what any page shows.
//
// 1. `__next._full.txt` is the whole-route RSC payload that Next writes beside every page.
//    The client router never requests it in `output: "export"` mode: prefetches fetch
//    `__next._tree.txt` + per-segment `__next.*.txt`, and unprefetched navigations fetch
//    `index.txt`, which is byte-identical. Only a server-side test hook reads `_full`.
//    Measured 2026-10-01: ~44 MB of 289 MB.
// 2. Share cards (`og/**/*.png`) are flat text on one background; a 16-colour palette is
//    visually identical and about a quarter of the size. Uses sharp through Next's own
//    optional dependency; skipped (with a warning) when sharp is unavailable.
//
// Usage: node scripts/postbuild.mjs [outDir]   (run by `pnpm build`)
import { readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { join } from "node:path";

const out = process.argv[2] ?? join(import.meta.dirname, "..", "out");

async function* walk(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(path);
    else yield path;
  }
}

function loadSharp() {
  try {
    const fromNext = createRequire(createRequire(import.meta.url).resolve("next/package.json"));
    return fromNext("sharp");
  } catch {
    return null;
  }
}

const mb = (n) => `${(n / 1e6).toFixed(1)} MB`;
let fullRemoved = 0;
let fullBytes = 0;
const pngs = [];
for await (const path of walk(out)) {
  if (path.endsWith("/__next._full.txt")) {
    fullBytes += (await stat(path)).size;
    await rm(path);
    fullRemoved++;
  } else if (path.includes("/og/") && path.endsWith(".png")) pngs.push(path);
}
console.log(`postbuild: removed ${fullRemoved} unused __next._full.txt files (${mb(fullBytes)})`);

const sharp = loadSharp();
if (!sharp) console.warn("postbuild: sharp not available; share cards left uncompressed");
else {
  let before = 0;
  let after = 0;
  // Small batches: sharp is multi-threaded already.
  for (let i = 0; i < pngs.length; i += 8) {
    await Promise.all(
      pngs.slice(i, i + 8).map(async (path) => {
        const input = await readFile(path);
        const output = await sharp(input)
          .png({ palette: true, colors: 16, effort: 10, compressionLevel: 9 })
          .toBuffer();
        before += input.length;
        if (output.length < input.length) {
          await writeFile(path, output);
          after += output.length;
        } else after += input.length;
      }),
    );
  }
  console.log(`postbuild: share cards ${mb(before)} → ${mb(after)} (${pngs.length} files)`);
}
