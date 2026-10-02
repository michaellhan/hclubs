import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { resolveClubs, seedFixtures, seedTaxonomy, type Db } from "@hci/db";
import { createTestDb } from "@hci/db/testing";
import { backupDatabase, restoreDatabase, tablesInDependencyOrder } from "../src/backup";

const dirs: string[] = [];
const closers: (() => Promise<void>)[] = [];
afterAll(async () => {
  for (const c of closers) await c();
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

const count = async (db: Db, table: string) => {
  const r = (await db.execute(sql`select count(*)::int as n from ${sql.identifier(table)}`)) as unknown;
  return ((Array.isArray(r) ? r : (r as { rows: { n: number }[] }).rows) as { n: number }[])[0]?.n;
};

describe("backup and restore (ADR 0039)", () => {
  it("restores a fixture database into an empty one, row for row", async () => {
    const a = await createTestDb();
    closers.push(a.close);
    await seedTaxonomy(a.db);
    await seedFixtures(a.db, new Date("2026-09-30T16:00:00Z"));
    await resolveClubs(a.db, { now: new Date("2026-09-30T16:00:00Z") });
    const dir = mkdtempSync(join(tmpdir(), "hci-backup-"));
    dirs.push(dir);
    const manifest = await backupDatabase(a.db, dir);
    const order = await tablesInDependencyOrder(a.db);
    expect(order.indexOf("club")).toBeLessThan(order.indexOf("claim"));
    expect(order.indexOf("claim")).toBeLessThan(order.indexOf("claim_evidence"));

    const b = await createTestDb();
    closers.push(b.close);
    await restoreDatabase(b.db, dir);
    for (const t of manifest.tables) expect(await count(b.db, t.name), t.name).toBe(t.rows);
    expect(manifest.tables.find((t) => t.name === "claim")?.rows).toBeGreaterThan(50);

    // Never on top of existing data, and never from a tampered file.
    await expect(restoreDatabase(b.db, dir)).rejects.toThrow(/already has/);
    const c = await createTestDb();
    closers.push(c.close);
    writeFileSync(join(dir, "club.ndjson.gz"), "tampered");
    await expect(restoreDatabase(c.db, dir)).rejects.toThrow(/checksum/);
  }, 60_000);
});
