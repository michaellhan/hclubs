import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { z } from "zod";

/** Walk up from `start` to the directory containing pnpm-workspace.yaml. */
export function findRepoRoot(start: string = process.cwd()): string {
  let dir = resolve(start);
  for (;;) {
    if (existsSync(join(dir, "pnpm-workspace.yaml"))) return dir;
    const parent = dirname(dir);
    if (parent === dir) return resolve(start);
    dir = parent;
  }
}

let loaded = false;
/** Load the repo-root .env into process.env once (existing variables win). */
export function loadRootEnv(): void {
  if (loaded) return;
  loaded = true;
  const file = join(findRepoRoot(), ".env");
  if (existsSync(file)) process.loadEnvFile(file);
}

const DbEnv = z.object({
  DATABASE_URL: z
    .string()
    .min(1, "DATABASE_URL is required — copy .env.example to .env")
    .refine((v) => /^postgres(ql)?:\/\//.test(v), "DATABASE_URL must be a postgres:// URL"),
});

export function dbEnv(): z.infer<typeof DbEnv> {
  loadRootEnv();
  const parsed = DbEnv.safeParse(process.env);
  if (!parsed.success) {
    throw new Error(`Invalid database environment:\n${z.prettifyError(parsed.error)}`);
  }
  return parsed.data;
}

/** True when a URL points at a local machine — used to guard destructive/fixture scripts. */
export function isLocalDatabaseUrl(url: string): boolean {
  try {
    const host = new URL(url).hostname;
    return ["localhost", "127.0.0.1", "::1", "[::1]"].includes(host) || host.endsWith(".localhost");
  } catch {
    return false;
  }
}
