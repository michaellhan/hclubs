import { existsSync } from "node:fs";
import { resolve } from "node:path";
import type { NextConfig } from "next";

// Single .env at the repo root (shared with scripts and the pipeline).
const rootEnv = resolve(import.meta.dirname, "../../.env");
if (existsSync(rootEnv)) process.loadEnvFile(rootEnv);

const nextConfig: NextConfig = {
  reactStrictMode: true,
  transpilePackages: ["@hci/core", "@hci/db"],
  poweredByHeader: false,
  typedRoutes: false,
};

export default nextConfig;
