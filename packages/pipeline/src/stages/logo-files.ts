import { mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { eq, inArray } from "drizzle-orm";
import sharp from "sharp";
import { schema, type Db } from "@hci/db";
import type { SnapshotStore } from "../snapshots/store";
import { INSTAGRAM_IMAGE_HOST, pictureFileName } from "./instagram-picture";

/**
 * logo-files (ADR 0050): the logo images the site serves itself, written into the web app's
 * public folder (`apps/web/public/logos/ig/<name>.webp`, not in git) from our kept copies.
 * Only displayed logos whose address expires (Instagram profile pictures) are served this
 * way; `logoSrc` in the web app maps those addresses to these files. Rebuildable at any time
 * from the snapshot store; files no displayed logo uses are removed.
 */

/** Twice the largest tile (56 px) for sharp screens, with room to spare. */
const SIZE = 160;

export async function writeLogoFiles(
  db: Db,
  store: SnapshotStore,
  outDir: string,
): Promise<{ written: number; kept: number; removed: number; missing: string[] }> {
  const clubs = await db
    .select({ slug: schema.club.slug, fields: schema.club.fields })
    .from(schema.club)
    .where(eq(schema.club.recordState, "active"));
  const wanted = new Map<string, string>(); // logo URL → slug
  for (const c of clubs) {
    const v = (c.fields as Record<string, { current?: { value?: unknown } | null } | undefined> | null)?.["club.logo"]
      ?.current?.value;
    if (typeof v !== "string") continue;
    try {
      if (INSTAGRAM_IMAGE_HOST.test(new URL(v).hostname)) wanted.set(v, c.slug);
    } catch {
      /* not a URL */
    }
  }
  mkdirSync(outDir, { recursive: true });
  const existing = new Set(readdirSync(outDir).filter((f) => f.endsWith(".webp")));
  const probes = wanted.size
    ? await db
        .select()
        .from(schema.imageProbe)
        .where(inArray(schema.imageProbe.url, [...wanted.keys()]))
    : [];
  const keys = new Map(probes.map((p) => [p.url, p.storageKey]));
  const keep = new Set<string>();
  const missing: string[] = [];
  let written = 0;
  for (const [url, slug] of wanted) {
    const name = pictureFileName(url);
    const key = keys.get(url);
    if (!name || !key) {
      missing.push(slug);
      continue;
    }
    const file = `${name}.webp`;
    keep.add(file);
    if (existing.has(file)) continue;
    const bytes = await store.get(key);
    const out = await sharp(bytes)
      .resize(SIZE, SIZE, { fit: "inside", withoutEnlargement: true })
      .webp({ quality: 85 })
      .toBuffer();
    writeFileSync(join(outDir, file), out);
    written++;
  }
  let removed = 0;
  for (const f of existing)
    if (!keep.has(f)) {
      rmSync(join(outDir, f));
      removed++;
    }
  return { written, kept: keep.size - written, removed, missing };
}
