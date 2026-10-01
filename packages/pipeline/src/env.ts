import { isAbsolute, join } from "node:path";
import { findRepoRoot, loadRootEnv } from "@hci/db";
import { z } from "zod";

const PipelineEnv = z.object({
  SNAPSHOT_DIR: z.string().default("data/snapshots"),
  CRAWLER_USER_AGENT: z.string().default("hclubsBot/0.1"),
  CRAWLER_CONTACT: z.string().optional(),
  CRAWLER_MIN_INTERVAL_MS: z.coerce.number().int().min(1000).default(2000),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace"]).default("info"),
  EXTRACTION_MODEL: z.string().default("claude-opus-5-5"),
  EXTRACTION_EFFORT: z.enum(["low", "medium", "high", "xhigh", "max"]).default("low"),
  /** Model for one-line club summaries (cheaper than extraction; ADR 0029). */
  SUMMARY_MODEL: z.string().default("claude-sonnet-5-5"),
  EXTRACTION_BUDGET_USD: z.coerce.number().nonnegative().default(1),
  // A blank key means "no key" (e.g. `BRAVE_SEARCH_API_KEY= pnpm hci …` to keep a run free).
  BRAVE_SEARCH_API_KEY: z.preprocess((v) => (v === "" ? undefined : v), z.string().min(1).optional()),
  /** `off` disables every billable API call (src/paid.ts). */
  HCI_PAID_APIS: z.enum(["on", "off"]).default("on"),
});

export function pipelineEnv() {
  loadRootEnv();
  const env = PipelineEnv.parse(process.env);
  const snapshotDir = isAbsolute(env.SNAPSHOT_DIR) ? env.SNAPSHOT_DIR : join(findRepoRoot(), env.SNAPSHOT_DIR);
  const userAgent = env.CRAWLER_CONTACT
    ? `${env.CRAWLER_USER_AGENT} (+${env.CRAWLER_CONTACT})`
    : env.CRAWLER_USER_AGENT;
  return { ...env, snapshotDir, userAgent };
}
