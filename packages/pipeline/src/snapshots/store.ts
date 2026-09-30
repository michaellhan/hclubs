import { createHash } from "node:crypto";
import { mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { gunzipSync, gzipSync } from "node:zlib";

/**
 * Content-addressed raw snapshot storage (CLAUDE.md §11.2). Raw bytes live outside
 * Postgres; the database stores the key and hash. Objects are write-once.
 */
export interface SnapshotStore {
  put(bytes: Uint8Array): Promise<{ key: string; sha256: string; byteSize: number }>;
  get(key: string): Promise<Uint8Array>;
}

export function sha256Hex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function keyFor(sha: string): string {
  return `sha256/${sha.slice(0, 2)}/${sha.slice(2, 4)}/${sha}.gz`;
}

export class FsSnapshotStore implements SnapshotStore {
  constructor(private readonly root: string) {}

  async put(bytes: Uint8Array) {
    const sha256 = sha256Hex(bytes);
    const key = keyFor(sha256);
    const path = join(this.root, key);
    const exists = await stat(path).then(
      () => true,
      () => false,
    );
    if (!exists) {
      await mkdir(dirname(path), { recursive: true });
      const tmp = `${path}.${process.pid}.tmp`;
      await writeFile(tmp, gzipSync(bytes));
      await rename(tmp, path); // atomic: never a half-written snapshot
    }
    return { key, sha256, byteSize: bytes.byteLength };
  }

  async get(key: string) {
    return new Uint8Array(gunzipSync(await readFile(join(this.root, key))));
  }
}

export class MemorySnapshotStore implements SnapshotStore {
  readonly objects = new Map<string, Uint8Array>();

  async put(bytes: Uint8Array) {
    const sha256 = sha256Hex(bytes);
    const key = keyFor(sha256);
    if (!this.objects.has(key)) this.objects.set(key, bytes);
    return { key, sha256, byteSize: bytes.byteLength };
  }

  async get(key: string) {
    const v = this.objects.get(key);
    if (!v) throw new Error(`snapshot not found: ${key}`);
    return v;
  }
}
