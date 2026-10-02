import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { gunzipSync, gzipSync } from "node:zlib";
import { sql } from "drizzle-orm";
import type { Db } from "@hci/db";

/**
 * Zero-dependency backup of the database and integrity checks of the snapshot archive
 * (ADR 0039). The dev database is PGlite (no pg_dump), so the backup is logical: one
 * gzipped NDJSON file per table plus a manifest with row counts and SHA-256 checksums.
 * Restore loads the files into an empty, migrated database in foreign-key order. Snapshot
 * blobs are content-addressed files and are copied as they are (scripts/backup.sh).
 */

const SCHEMA_TABLES = sql`select table_name as name from information_schema.tables
  where table_schema = 'public' and table_type = 'BASE TABLE' order by table_name`;

/** Rows from a raw query: an array with postgres-js, `{ rows }` with in-process PGlite. */
async function rows<T>(db: Db, q: ReturnType<typeof sql>): Promise<T[]> {
  const r = (await db.execute(q)) as unknown;
  return (Array.isArray(r) ? r : ((r as { rows?: T[] }).rows ?? [])) as T[];
}

/** Tables ordered so that every table comes after the tables it references. */
export async function tablesInDependencyOrder(db: Db): Promise<string[]> {
  const tables = (await rows<{ name: string }>(db, SCHEMA_TABLES)).map((t) => t.name);
  const deps = await rows<{ child: string; parent: string }>(
    db,
    sql`select tc.table_name as child, ccu.table_name as parent
        from information_schema.table_constraints tc
        join information_schema.constraint_column_usage ccu on ccu.constraint_name = tc.constraint_name
        where tc.constraint_type = 'FOREIGN KEY' and tc.table_schema = 'public'`,
  );
  const needs = new Map(tables.map((t) => [t, new Set<string>()]));
  for (const d of deps) if (d.child !== d.parent) needs.get(d.child)?.add(d.parent);
  const out: string[] = [];
  const visit = (t: string, path: Set<string>) => {
    if (out.includes(t) || path.has(t)) return;
    path.add(t);
    for (const p of needs.get(t) ?? []) visit(p, path);
    out.push(t);
  };
  for (const t of tables) visit(t, new Set());
  return out;
}

export interface BackupManifest {
  createdAt: string;
  tables: { name: string; rows: number; file: string; sha256: string }[];
}

export async function backupDatabase(db: Db, dir: string, now = new Date()): Promise<BackupManifest> {
  mkdirSync(dir, { recursive: true });
  const manifest: BackupManifest = { createdAt: now.toISOString(), tables: [] };
  for (const name of await tablesInDependencyOrder(db)) {
    const data = await rows<Record<string, unknown>>(
      db,
      sql`select row_to_json(t) as r from ${sql.identifier(name)} t`,
    );
    const body = gzipSync(data.map((d) => JSON.stringify(d.r)).join("\n"));
    const file = `${name}.ndjson.gz`;
    writeFileSync(join(dir, file), body);
    manifest.tables.push({ name, rows: data.length, file, sha256: createHash("sha256").update(body).digest("hex") });
  }
  writeFileSync(join(dir, "manifest.json"), JSON.stringify(manifest, null, 2));
  return manifest;
}

/**
 * Load a backup into an EMPTY, migrated database. Refuses a database that already has
 * clubs, so it can never be pointed at the working database by mistake.
 */
export async function restoreDatabase(db: Db, dir: string): Promise<{ table: string; rows: number }[]> {
  const manifest = JSON.parse(readFileSync(join(dir, "manifest.json"), "utf8")) as BackupManifest;
  const [{ n } = { n: 0 }] = await rows<{ n: number }>(db, sql`select count(*)::int as n from club`);
  if (n > 0) throw new Error(`refusing to restore into a database that already has ${n} clubs`);
  const order = await tablesInDependencyOrder(db);
  const out: { table: string; rows: number }[] = [];
  for (const name of order) {
    const entry = manifest.tables.find((t) => t.name === name);
    if (!entry) continue;
    const body = readFileSync(join(dir, entry.file));
    if (createHash("sha256").update(body).digest("hex") !== entry.sha256)
      throw new Error(`${entry.file}: checksum mismatch`);
    const lines = gunzipSync(body).toString("utf8").split("\n").filter(Boolean);
    // Self-referencing tables (club.merged_into_club_id, category.parent_id) go in one
    // statement: foreign keys are checked at its end. Others in chunks.
    const chunk = name === "club" || name === "category" ? lines.length || 1 : 2000;
    for (let i = 0; i < lines.length; i += chunk) {
      const json = `[${lines.slice(i, i + chunk).join(",")}]`;
      await db.execute(
        sql`insert into ${sql.identifier(name)} select * from json_populate_recordset(null::${sql.identifier(name)}, ${json}::json)`,
      );
    }
    out.push({ table: name, rows: lines.length });
  }
  return out;
}

export interface SnapshotCheck {
  checked: number;
  missing: string[];
  corrupt: string[];
  hashMismatch: string[];
  orphanFiles: string[];
}

/** Every snapshot row has its file, the file decompresses, and its bytes hash to the row's sha. */
export async function verifySnapshots(db: Db, root: string): Promise<SnapshotCheck> {
  const snaps = await rows<{ key: string; sha: string }>(
    db,
    sql`select distinct storage_key as key, content_sha256 as sha from source_snapshot where fetch_method <> 'fixture'`,
  );
  const result: SnapshotCheck = { checked: 0, missing: [], corrupt: [], hashMismatch: [], orphanFiles: [] };
  const known = new Set<string>();
  for (const s of snaps) {
    known.add(s.key);
    const path = join(root, s.key);
    if (!existsSync(path)) {
      result.missing.push(s.key);
      continue;
    }
    result.checked++;
    let bytes: Buffer;
    try {
      bytes = gunzipSync(readFileSync(path));
    } catch {
      result.corrupt.push(s.key);
      continue;
    }
    if (createHash("sha256").update(bytes).digest("hex") !== s.sha) result.hashMismatch.push(s.key);
  }
  const walk = (dir: string) => {
    if (!existsSync(dir)) return;
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) walk(p);
      else if (name.endsWith(".gz") && !known.has(relative(root, p))) result.orphanFiles.push(relative(root, p));
    }
  };
  walk(join(root, "sha256"));
  return result;
}
