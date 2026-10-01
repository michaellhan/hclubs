import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { and, eq, ne } from "drizzle-orm";
import { findRepoRoot, schema, type Db } from "@hci/db";

/**
 * What the site shows, as a flat comparable snapshot: every displayed value of every live
 * club (and its recruiting cycles, links and categories), with the page each value came
 * from. `projection save` writes one before a change; `projection diff` compares it with
 * now, so a resolver, ownership or extractor change can never rewrite displayed values
 * without a list of what changed and why (the source moved, the value moved, or both).
 * Read-only on the database.
 */

export interface ShownValue {
  value: string;
  source: string | null;
}
/** slug → key → shown value. Keys: field keys, "cycle <term> <field>", "link <kind> <url>", "category". */
export type ProjectionSnapshot = { takenAt: string; clubs: Record<string, Record<string, ShownValue>> };

interface StoredSource {
  url?: string;
}
interface StoredResolved {
  value: unknown;
  sources?: StoredSource[];
}
interface StoredField {
  kind: "single" | "multi";
  current?: StoredResolved | null;
  values?: StoredResolved[];
}

const IGNORED_FIELDS = new Set(["club.press_mention", "club.link", "club.alias"]);

const show = (v: unknown): string => {
  const s = typeof v === "string" ? v : JSON.stringify(v);
  return s.length > 160 ? `${s.slice(0, 157)}…` : s;
};

export async function takeProjectionSnapshot(db: Db, now = new Date()): Promise<ProjectionSnapshot> {
  const clubs = await db
    .select({
      id: schema.club.id,
      slug: schema.club.slug,
      fields: schema.club.fields,
      scope: schema.club.affiliationScope,
      activity: schema.club.activityStatus,
      joinModes: schema.club.joinModes,
    })
    .from(schema.club)
    .where(and(eq(schema.club.recordState, "active"), ne(schema.club.dataOrigin, "fixture")));
  const out: ProjectionSnapshot["clubs"] = {};
  const bySlug = new Map<string, Record<string, ShownValue>>();
  const idToSlug = new Map<string, string>();
  for (const c of clubs) {
    const row: Record<string, ShownValue> = {
      "club.affiliation_scope (shown)": { value: c.scope, source: null },
      "club.activity_status (shown)": { value: c.activity, source: null },
      "club.join_modes (shown)": { value: [...c.joinModes].sort().join(", ") || "—", source: null },
    };
    for (const [key, f] of Object.entries((c.fields ?? {}) as Record<string, StoredField>)) {
      if (IGNORED_FIELDS.has(key)) continue;
      if (f.kind === "single" && f.current)
        row[key] = { value: show(f.current.value), source: f.current.sources?.[0]?.url ?? null };
      if (f.kind === "multi" && f.values?.length)
        row[key] = {
          value: f.values
            .map((v) => show(v.value))
            .sort()
            .join(" | "),
          source: f.values[0]?.sources?.[0]?.url ?? null,
        };
    }
    out[c.slug] = row;
    bySlug.set(c.slug, row);
    idToSlug.set(c.id, c.slug);
  }
  const links = await db
    .select({
      clubId: schema.clubLink.clubId,
      kind: schema.clubLink.kind,
      url: schema.clubLink.normalizedUrl,
      status: schema.clubLink.status,
    })
    .from(schema.clubLink);
  for (const l of links) {
    const row = bySlug.get(idToSlug.get(l.clubId) ?? "");
    if (row) row[`link ${l.kind} ${l.url}`] = { value: l.status, source: null };
  }
  const cats = await db
    .select({ clubId: schema.clubCategory.clubId, slug: schema.category.slug, primary: schema.clubCategory.isPrimary })
    .from(schema.clubCategory)
    .innerJoin(schema.category, eq(schema.category.id, schema.clubCategory.categoryId));
  for (const c of cats) {
    const row = bySlug.get(idToSlug.get(c.clubId) ?? "");
    if (!row) continue;
    if (c.primary) row["category (primary)"] = { value: c.slug, source: null };
  }
  const cycles = await db.select().from(schema.recruitingCycle);
  for (const c of cycles) {
    const row = bySlug.get(idToSlug.get(c.clubId) ?? "");
    if (!row) continue;
    const p = `cycle ${c.termKey}${c.track === "main" ? "" : `/${c.track}`}`;
    const put = (k: string, v: unknown) => {
      if (v !== null && v !== undefined && v !== "") row[`${p} ${k}`] = { value: show(v), source: null };
    };
    put("opens", (c.opensValue as { at?: string } | null)?.at);
    put("deadline", (c.deadlineValue as { at?: string } | null)?.at);
    put("stated_status", c.statedStatus);
    put("application_url", c.applicationUrl);
  }
  return { takenAt: now.toISOString(), clubs: out };
}

export interface ProjectionChange {
  slug: string;
  key: string;
  before: ShownValue | null;
  after: ShownValue | null;
}

/** Every displayed value that differs, plus clubs that appeared or disappeared. PURE. */
export function diffProjections(a: ProjectionSnapshot, b: ProjectionSnapshot): ProjectionChange[] {
  const out: ProjectionChange[] = [];
  const slugs = [...new Set([...Object.keys(a.clubs), ...Object.keys(b.clubs)])].sort();
  for (const slug of slugs) {
    const x = a.clubs[slug];
    const y = b.clubs[slug];
    if (!x || !y) {
      out.push({
        slug,
        key: "(club)",
        before: x ? { value: "listed", source: null } : null,
        after: y ? { value: "listed", source: null } : null,
      });
      continue;
    }
    for (const key of [...new Set([...Object.keys(x), ...Object.keys(y)])].sort()) {
      const p = x[key] ?? null;
      const q = y[key] ?? null;
      if (p?.value === q?.value && p?.source === q?.source) continue;
      out.push({ slug, key, before: p, after: q });
    }
  }
  return out;
}

const groupOf = (key: string) =>
  key.startsWith("cycle ")
    ? `cycle ${key.split(" ").slice(2).join(" ")}`
    : key.startsWith("link ")
      ? `link ${key.split(" ")[1]}`
      : key;

export function renderDiff(changes: ProjectionChange[], from: string, to: string): string {
  const counts = new Map<string, number>();
  for (const c of changes) counts.set(groupOf(c.key), (counts.get(groupOf(c.key)) ?? 0) + 1);
  const lines = [
    "# Displayed values changed",
    "",
    `From the projection saved ${from} to ${to}. Each row is a value a visitor sees. "source only"`,
    "means the same value is now backed by a different page.",
    "",
    `${changes.length} changes at ${new Set(changes.map((c) => c.slug)).size} clubs.`,
    "",
    "| What | Changes |",
    "|---|---:|",
    ...[...counts].sort((p, q) => q[1] - p[1]).map(([k, n]) => `| ${k} | ${n} |`),
    "",
    "| Club | What | Before | After | Source before → after |",
    "|---|---|---|---|---|",
  ];
  const cell = (s: string | undefined | null) => (s ?? "—").replace(/\|/g, "\\|").replace(/\n/g, " ");
  for (const c of changes) {
    const sameValue = c.before?.value === c.after?.value;
    const src =
      c.before?.source === c.after?.source ? "" : `${cell(c.before?.source ?? "—")} → ${cell(c.after?.source ?? "—")}`;
    lines.push(
      `| ${c.slug} | ${cell(c.key)} | ${sameValue ? "(source only)" : cell(c.before?.value)} | ${sameValue ? "" : cell(c.after?.value)} | ${src} |`,
    );
  }
  return lines.join("\n") + "\n";
}

export function projectionPath(name = "latest"): string {
  return join(findRepoRoot(), "data", "state", `projection-${name.replace(/[^\w-]/g, "_")}.json`);
}

export async function saveProjection(db: Db, name = "latest"): Promise<string> {
  const path = projectionPath(name);
  mkdirSync(join(findRepoRoot(), "data", "state"), { recursive: true });
  writeFileSync(path, JSON.stringify(await takeProjectionSnapshot(db)));
  return path;
}

export async function diffAgainstSaved(
  db: Db,
  name = "latest",
): Promise<{ changes: ProjectionChange[]; reportPath: string; markdown: string }> {
  const path = projectionPath(name);
  if (!existsSync(path)) throw new Error(`no saved projection at ${path}; run \`hci projection save\` first`);
  const before = JSON.parse(readFileSync(path, "utf8")) as ProjectionSnapshot;
  const after = await takeProjectionSnapshot(db);
  const changes = diffProjections(before, after);
  const markdown = renderDiff(changes, before.takenAt, after.takenAt);
  const dir = join(findRepoRoot(), "data", "reports");
  mkdirSync(dir, { recursive: true });
  const reportPath = join(dir, "projection-diff.md");
  writeFileSync(reportPath, markdown);
  return { changes, reportPath, markdown };
}
