import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { desc } from "drizzle-orm";
import { createDb, resolveClubs, schema } from "@hci/db";
import { ADAPTERS, OFFLINE_FIXTURES } from "./adapters";
import { pipelineEnv } from "./env";
import { FixtureFetcher } from "./fetch/fixture-fetcher";
import { PoliteHttpFetcher } from "./fetch/http-fetcher";
import { createLogger } from "./logger";
import { FsSnapshotStore } from "./snapshots/store";
import { runDiscovery } from "./stages/discover";

const HELP = `Harvard Club Index pipeline

Usage: pnpm pipeline <command> [options]

Commands:
  adapters                      List discovery adapters
  discover <adapter>            Run a discovery adapter end-to-end
      --offline                 Use saved fixtures instead of the network
      --max-pages <n>           Cap pages fetched
      --limit <n>               Cap organizations processed
  parse <adapter>               Parse saved fixtures and print results (no DB, no network)
  resolve                       Re-run the resolver for all clubs (rebuild projections)
  runs                          Show recent ingestion runs
`;

const FIXTURE_ROOT = fileURLToPath(new URL("../test/fixtures", import.meta.url));

async function main() {
  const { positionals, values } = parseArgs({
    allowPositionals: true,
    options: {
      offline: { type: "boolean", default: false },
      "max-pages": { type: "string" },
      limit: { type: "string" },
      help: { type: "boolean", short: "h", default: false },
    },
  });
  const [command, arg] = positionals;
  if (!command || values.help) {
    console.log(HELP);
    return;
  }
  const env = pipelineEnv();
  const logger = createLogger(env.LOG_LEVEL);

  if (command === "adapters") {
    for (const a of Object.values(ADAPTERS)) console.log(`${a.name}@${a.version}  ${a.description}`);
    return;
  }

  const adapterFor = (name: string | undefined) => {
    const adapter = name ? ADAPTERS[name] : undefined;
    if (!adapter) throw new Error(`Unknown adapter "${name ?? ""}". Available: ${Object.keys(ADAPTERS).join(", ")}`);
    return adapter;
  };
  const offlineFetcher = (name: string) =>
    new FixtureFetcher(
      Object.fromEntries(Object.entries(OFFLINE_FIXTURES[name] ?? {}).map(([u, f]) => [u, join(FIXTURE_ROOT, f)])),
    );

  if (command === "parse") {
    const adapter = adapterFor(arg);
    const fetcher = offlineFetcher(adapter.name);
    for (const url of Object.keys(OFFLINE_FIXTURES[adapter.name] ?? {})) {
      const res = await fetcher.fetch({ url, sourceType: adapter.sourceType });
      if (!res.body) continue;
      const parsed = adapter.parse({
        url,
        finalUrl: url,
        body: new TextDecoder().decode(res.body),
        fetchedAt: res.fetchedAt,
      });
      console.log(
        `\n${url}: ${parsed.organizations.length} organizations, next: ${parsed.nextUrls.join(", ") || "none"}`,
      );
      for (const w of parsed.warnings) console.log(`  ⚠ ${w}`);
      for (const o of parsed.organizations) console.log(`  • ${o.name}  [${o.claims.length} claims]`);
    }
    return;
  }

  const { db, close } = createDb(undefined, { max: 2 });
  try {
    if (command === "discover") {
      const adapter = adapterFor(arg);
      const fetcher = values.offline
        ? offlineFetcher(adapter.name)
        : new PoliteHttpFetcher({ userAgent: env.userAgent, minIntervalMs: env.CRAWLER_MIN_INTERVAL_MS, logger });
      const result = await runDiscovery({ db, fetcher, store: new FsSnapshotStore(env.snapshotDir), logger }, adapter, {
        ...(values["max-pages"] ? { maxPages: Number(values["max-pages"]) } : {}),
        ...(values.limit ? { limit: Number(values.limit) } : {}),
      });
      console.log(`\nRun ${result.runId}: ${result.status}`);
      console.table(result.counters);
      if (result.errors.length > 0) console.log(`Errors:\n  ${result.errors.slice(0, 20).join("\n  ")}`);
      if (result.status === "failed") process.exitCode = 1;
    } else if (command === "resolve") {
      const stats = await resolveClubs(db, {
        onError: (id, e) => logger.error({ clubId: id, error: String(e) }, "resolve failed"),
      });
      console.log(`Resolved ${stats.clubs} clubs (${stats.failed} failed)`);
      if (stats.failed > 0) process.exitCode = 1;
    } else if (command === "runs") {
      const runs = await db.select().from(schema.ingestionRun).orderBy(desc(schema.ingestionRun.startedAt)).limit(15);
      console.table(
        runs.map((r) => ({
          started: r.startedAt.toISOString(),
          job: r.job,
          adapter: r.adapter,
          status: r.status,
          counters: JSON.stringify(r.counters).slice(0, 120),
        })),
      );
    } else {
      console.log(HELP);
      process.exitCode = 1;
    }
  } finally {
    await close();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
