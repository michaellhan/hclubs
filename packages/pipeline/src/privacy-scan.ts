import { readFileSync, readdirSync, statSync } from "node:fs";
import { extname, join, relative } from "node:path";
import { emailPublishProblem } from "@hci/core";

/**
 * `pnpm hci privacy-scan [dir]`: scans the built static site (default `apps/web/out`) for
 * personal data that must never ship (CLAUDE.md §21, launch audit): email addresses that
 * aren't a club's role address, phone numbers, evidence quotes (verbatim page text that can
 * name people), raw snapshot files, and personal details in link query strings. Read-only;
 * prints findings and exits non-zero when there are any. Run after a build, before publishing.
 */

export interface PrivacyFinding {
  file: string;
  kind: "email" | "phone" | "evidence_quote" | "snapshot_file" | "query_pii";
  detail: string;
}

const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
/** US-style numbers: (617) 495-1000, 617-495-1000, 617.495.1000, +1 617 495 1000. */
const PHONE = /(?<![\d.])(?:\+1[\s.-]?)?\(?\b[2-9]\d{2}\)?[\s.-]\d{3}[\s.-]\d{4}\b(?![\d.])/g;
/** Query parameters that carry a person's details in a link. */
const QUERY_PII = /[?&](email|e-mail|phone|tel|firstname|first_name|lastname|last_name|fullname|name)=([^&"'\s<]+)/gi;
const TEXT = new Set([".html", ".json", ".txt", ".xml", ".js", ".rsc"]);
/** Addresses the site itself publishes on purpose. */
const SITE_ADDRESSES = new Set(["hclubsapp@gmail.com"]);

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

/** The club names a profile JSON vouches for, so its own role address passes. */
function clubNamesIn(text: string): string[] {
  try {
    const d = JSON.parse(text) as { name?: string; acronym?: string; aliases?: { alias: string }[] };
    return [d.name ?? "", d.acronym ?? "", ...(d.aliases ?? []).map((a) => a.alias)].filter(Boolean);
  } catch {
    return [];
  }
}

/** The club a built file is about (its profile page, OG image text or JSON), by slug. */
function namesFor(dir: string, rel: string, text: string): string[] {
  if (rel.startsWith("data/clubs/")) return clubNamesIn(text);
  const slug = rel.match(/^clubs\/([a-z0-9-]+)[/.]/)?.[1];
  if (!slug) return [];
  try {
    return clubNamesIn(readFileSync(join(dir, "data", "clubs", `${slug}.json`), "utf8"));
  } catch {
    return [];
  }
}

export function scanText(file: string, text: string, clubNames: string[] = []): PrivacyFinding[] {
  const out: PrivacyFinding[] = [];
  const seen = new Set<string>();
  const add = (f: PrivacyFinding) => {
    const key = `${f.kind}|${f.detail}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push(f);
  };
  for (const m of text.matchAll(EMAIL)) {
    const addr = m[0].replace(/\.$/, "");
    if (SITE_ADDRESSES.has(addr.toLowerCase())) continue;
    // Asset names like "logo@2x.png" aren't addresses.
    if (/\.(png|jpe?g|svg|webp|gif|js|css)$/i.test(addr)) continue;
    const problem = emailPublishProblem(addr, clubNames);
    if (problem) add({ file, kind: "email", detail: `${addr} (${problem})` });
  }
  for (const m of text.matchAll(PHONE)) add({ file, kind: "phone", detail: m[0] });
  for (const m of text.matchAll(/"quote":"([^"]{1,80})/g)) add({ file, kind: "evidence_quote", detail: m[1] ?? "" });
  for (const m of text.matchAll(QUERY_PII)) {
    const value = decodeURIComponent((m[2] ?? "").replace(/\+/g, " "));
    // Placeholders in prefilled form links ("{club}") and empty values are fine.
    if (!value || /^\{.*\}$/.test(value)) continue;
    add({ file, kind: "query_pii", detail: `${m[1]}=${value.slice(0, 60)}` });
  }
  return out;
}

export function privacyScan(dir: string): { files: number; findings: PrivacyFinding[] } {
  const files = walk(dir);
  const findings: PrivacyFinding[] = [];
  for (const path of files) {
    const rel = relative(dir, path);
    if (/(^|\/)(snapshots?|pglite)\//.test(rel) || /\.(gz|zst|warc)$/.test(rel)) {
      findings.push({ file: rel, kind: "snapshot_file", detail: "raw snapshot data in the build" });
      continue;
    }
    if (!TEXT.has(extname(path)) || rel.startsWith("_next/static/chunks")) continue;
    const text = readFileSync(path, "utf8");
    // Prefilled Google Form links carry the club's name on purpose ("entry.123=Harvard+…").
    const scrubbed = text.replace(/docs\.google\.com\/forms\/[^"'\s<]+/g, "");
    findings.push(...scanText(rel, scrubbed, namesFor(dir, rel, text)));
  }
  return { files: files.length, findings };
}
