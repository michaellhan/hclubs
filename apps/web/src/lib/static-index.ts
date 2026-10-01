import { getStaticIndex, type StaticIndex } from "@hci/db";
import { db } from "./db";

let cached: Promise<StaticIndex> | null = null;

/**
 * The static index, built once per build process and shared by every page that needs
 * whole-index answers at build time (home-page counts, "similar clubs"). Same data the
 * browser downloads as /data/index.json.
 */
export function buildTimeIndex(): Promise<StaticIndex> {
  cached ??= getStaticIndex(db(), new Date());
  return cached;
}
