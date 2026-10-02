#!/usr/bin/env node
// Compare a built site with the last one published, before it replaces it (ADR 0039).
//
//   node scripts/publish-check.mjs <out-dir> <state-file> [--record]
//
// Prints what changed (pages, files, bytes, clubs, websites, live recruiting cycles) and
// exits 3 when a change looks like breakage rather than data: club pages or clubs in the
// index down by more than 10%, the index shrinking by more than 30%, websites halving, or
// every recruiting cycle vanishing. PUBLISH_ALLOW_DROP=1 overrides after a deliberate change
// (e.g. a bulk hide). --record saves this build as the new baseline (after a successful push).
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";

const [outDir, stateFile, flag] = process.argv.slice(2);
if (!outDir || !stateFile) {
  console.error("usage: publish-check.mjs <out-dir> <state-file> [--record]");
  process.exit(2);
}

function walk(dir, files = new Map()) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const s = statSync(p);
    if (s.isDirectory()) walk(p, files);
    else files.set(relative(outDir, p), s.size);
  }
  return files;
}

const files = walk(outDir);
const index = JSON.parse(readFileSync(join(outDir, "data", "index.json"), "utf8"));
const summary = {
  at: new Date().toISOString(),
  files: files.size,
  bytes: [...files.values()].reduce((a, b) => a + b, 0),
  clubPages: [...files.keys()].filter((f) => /^clubs\/[^/]+\/index\.html$/.test(f)).length,
  indexBytes: files.get("data/index.json") ?? 0,
  clubs: index.clubs.length,
  websites: index.clubs.filter((c) => c.quickLinks?.website).length,
  cycles: index.clubs.reduce((n, c) => n + (c.cycles?.length ?? 0), 0),
};

const mb = (b) => `${(b / 1e6).toFixed(1)} MB`;
const prev = existsSync(stateFile) ? JSON.parse(readFileSync(stateFile, "utf8")) : null;
const line = (k, fmt = (x) => x) =>
  `${k.padEnd(11)} ${prev ? `${fmt(prev.summary[k])} → ` : ""}${fmt(summary[k])}${
    prev
      ? ` (${summary[k] - prev.summary[k] >= 0 ? "+" : ""}${k.endsWith("ytes") ? mb(summary[k] - prev.summary[k]) : summary[k] - prev.summary[k]})`
      : ""
  }`;
console.log("Publish check" + (prev ? ` (vs ${prev.summary.at})` : " (no earlier publish recorded)"));
for (const k of ["clubPages", "clubs", "websites", "cycles", "files"]) console.log("  " + line(k));
console.log("  " + line("bytes", mb));
console.log("  " + line("indexBytes", mb));
if (prev) {
  const before = new Set(prev.files);
  const added = [...files.keys()].filter((f) => !before.has(f) && !f.startsWith("_next/")).length;
  const removed = prev.files.filter((f) => !files.has(f) && !f.startsWith("_next/")).length;
  console.log(`  pages/data files added ${added}, removed ${removed}`);
}

const problems = [];
if (prev) {
  const p = prev.summary;
  if (summary.clubPages < p.clubPages * 0.9) problems.push(`club pages ${p.clubPages} → ${summary.clubPages}`);
  if (summary.clubs < p.clubs * 0.9) problems.push(`clubs in the index ${p.clubs} → ${summary.clubs}`);
  if (summary.indexBytes < p.indexBytes * 0.7) problems.push(`index ${mb(p.indexBytes)} → ${mb(summary.indexBytes)}`);
  if (summary.websites < p.websites * 0.5) problems.push(`websites ${p.websites} → ${summary.websites}`);
  if (p.cycles > 5 && summary.cycles === 0) problems.push("every recruiting cycle disappeared");
}
if (problems.length && process.env.PUBLISH_ALLOW_DROP !== "1") {
  console.error(`error: this build looks broken, not updated: ${problems.join("; ")}`);
  console.error("Set PUBLISH_ALLOW_DROP=1 to publish anyway after checking it was deliberate.");
  process.exit(3);
}
if (flag === "--record") writeFileSync(stateFile, JSON.stringify({ summary, files: [...files.keys()] }));
