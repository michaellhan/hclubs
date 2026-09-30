import { existsSync } from "node:fs";
import { resolve } from "node:path";
import type { NextConfig } from "next";
import { PHASE_PRODUCTION_BUILD } from "next/constants";

// Single .env at the repo root (shared with scripts and the pipeline).
const rootEnv = resolve(import.meta.dirname, "../../.env");
if (existsSync(rootEnv)) process.loadEnvFile(rootEnv);

/**
 * `next dev` runs normally against the local database (including the dev-only review UI
 * in `*.dev.tsx` pages). `next build` produces a fully static site in `out/`: every page
 * and data file is generated from the database at build time, and nothing needs a server
 * or a hosted database afterwards.
 */
export default function config(phase: string): NextConfig {
  const exporting = phase === PHASE_PRODUCTION_BUILD;
  const basePath = (process.env.NEXT_PUBLIC_BASE_PATH ?? "").replace(/\/$/, "");
  return {
    reactStrictMode: true,
    transpilePackages: ["@hci/core", "@hci/db"],
    poweredByHeader: false,
    typedRoutes: false,
    // Dev-only routes (admin review) use the `.dev.tsx` extension and are left out of the export.
    pageExtensions: exporting ? ["tsx", "ts"] : ["tsx", "ts", "dev.tsx"],
    ...(exporting ? { output: "export" as const, trailingSlash: true } : {}),
    ...(basePath ? { basePath } : {}),
  };
}
