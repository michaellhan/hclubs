import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { desc, eq, inArray } from "drizzle-orm";
import {
  createDb,
  findRepoRoot,
  mergeClubs,
  rejectMergeCandidate,
  resolveClubs,
  retractUnreproducedClaims,
  schema,
  undoMerge,
} from "@hci/db";
import { ADAPTERS, ADAPTER_ORDER, OFFLINE_FIXTURES } from "./adapters";
import { pipelineEnv } from "./env";
import { exportData } from "./export";
import { AnthropicProvider, type Effort } from "./extract/llm/anthropic";
import { FixtureFetcher } from "./fetch/fixture-fetcher";
import { BrowserFallbackFetcher, createChromeRenderer } from "./fetch/browser-fetcher";
import { PoliteHttpFetcher } from "./fetch/http-fetcher";
import { createLogger } from "./logger";
import { FsSnapshotStore } from "./snapshots/store";
import { runDiscovery } from "./stages/discover";
import { runEnrichment } from "./stages/enrich";
import { recheckFoundSites, runFindSites } from "./stages/find-sites";
import { BraveSearchProvider } from "./sites/search";
import { runReconcile } from "./stages/reconcile";
import { coverageStats } from "./stats";

const HELP = `Harvard Club Index pipeline  —  pnpm hci <command> [options]
(root shortcuts: pnpm ingest:discover | ingest:enrich | ingest:reconcile | ingest:export | ingest:stats)

Discovery
  adapters                         List discovery adapters (run order)
  discover [--source=a,b]          Run discovery adapters (default: all, official first)
      --offline                    Use saved fixtures instead of the network
      --max-pages=N --limit=N      Cap pages / organizations per adapter
  parse <adapter>                  Parse saved fixtures only (no DB, no network)

Enrichment
  find-sites                       Find websites for clubs that have none: guessed domains + web search,
                                   accepted only when the fetched home page names the club (ADR 0023)
      --search                     Also query the Brave Search API (needs BRAVE_SEARCH_API_KEY)
      --no-guess                   Skip domain guessing
      --recheck [--dry-run]        Re-test sites found earlier against the current rules (stored pages);
                                   reject those that no longer pass
      --club=<slug> --limit=N      Target one club / cap clubs
  enrich                           Find/verify club websites, shallow-crawl, extract claims
      --club=<slug> --limit=N      Target one club / cap clubs
      --stale-only                 Only clubs whose site wasn't fetched within the freshness window
      --freshness-hours=H          Reuse pages fetched within H hours (default 168)
      --force                      Refetch everything (ignores freshness + conditional GET)
      --max-pages=N --max-depth=D  Crawl limits per site (default 6 / 1)
      --concurrency=N              Clubs in parallel (default 4; per-host politeness still applies)
      --llm                        Also run LLM extraction (needs Anthropic credentials)
      --llm-dry-run                Show which pages would go to the LLM + token estimate, no calls
      --budget=USD                 LLM spend cap for this run (default 1.00)
      --browser                    Render JS-only pages in headless Chrome (installed Chrome, via
                                   playwright-core); robots/rate limits still apply

Reconciliation & review
  reconcile [--dry-run]            Cross-club duplicate pass (auto-merge on strong ids only) + re-resolve all
  resolve                          Re-resolve all clubs only
  review                           List open merge candidates
  merge <absorbed-slug> <survivor-slug>   Confirm a merge (reversible)
  unmerge <slug>                   Undo a merge
  reject <candidate-id>            Reject a merge candidate (never re-proposed)
  retract-unreproduced --extractor=X --version=CURRENT [--field=a,b] [--dry-run]
                                   After re-running a fixed extractor, reject claims only older versions produced

Inspection
  runs                             Recent ingestion runs and counters
  stats                            Coverage report
  export [--out=dir] [--include-fixtures]   Write JSON/CSV exports (default data/exports)
`;

const FIXTURE_ROOT = fileURLToPath(new URL("../test/fixtures", import.meta.url));

async function main() {
  const { positionals, values } = parseArgs({
    allowPositionals: true,
    options: {
      offline: { type: "boolean", default: false },
      source: { type: "string" },
      "max-pages": { type: "string" },
      "max-depth": { type: "string" },
      limit: { type: "string" },
      club: { type: "string" },
      "stale-only": { type: "boolean", default: false },
      "freshness-hours": { type: "string" },
      force: { type: "boolean", default: false },
      concurrency: { type: "string" },
      llm: { type: "boolean", default: false },
      "llm-dry-run": { type: "boolean", default: false },
      budget: { type: "string" },
      "dry-run": { type: "boolean", default: false },
      out: { type: "string" },
      extractor: { type: "string" },
      version: { type: "string" },
      "include-fixtures": { type: "boolean", default: false },
      search: { type: "boolean", default: false },
      field: { type: "string" },
      recheck: { type: "boolean", default: false },
      browser: { type: "boolean", default: false },
      "no-guess": { type: "boolean", default: false },
      help: { type: "boolean", short: "h", default: false },
    },
  });
  const [command, ...args] = positionals;
  if (!command || values.help) {
    console.log(HELP);
    return;
  }
  const env = pipelineEnv();
  const logger = createLogger(env.LOG_LEVEL);
  const num = (v: string | undefined) => (v === undefined ? undefined : Number(v));

  if (command === "adapters") {
    for (const a of ADAPTER_ORDER) console.log(`${a.name.padEnd(32)} ${a.sourceType.padEnd(17)} ${a.description}`);
    return;
  }
  const offlineFetcher = (name: string) =>
    new FixtureFetcher(
      Object.fromEntries(Object.entries(OFFLINE_FIXTURES[name] ?? {}).map(([u, f]) => [u, join(FIXTURE_ROOT, f)])),
    );

  if (command === "parse") {
    const adapter = ADAPTERS[args[0] ?? ""];
    if (!adapter) throw new Error(`Unknown adapter. Available: ${Object.keys(ADAPTERS).join(", ")}`);
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
      console.log(`\n${url}: ${parsed.organizations.length} organizations`);
      for (const w of parsed.warnings) console.log(`  ⚠ ${w}`);
      for (const o of parsed.organizations)
        console.log(`  • ${o.name}${o.acronym ? ` (${o.acronym})` : ""}  [${o.claims.length} claims]`);
    }
    return;
  }

  const { db, close } = createDb(undefined, { max: 6 });
  const liveFetcher = new PoliteHttpFetcher({
    userAgent: env.userAgent,
    minIntervalMs: env.CRAWLER_MIN_INTERVAL_MS,
    logger,
  });
  const store = new FsSnapshotStore(env.snapshotDir);
  try {
    switch (command) {
      case "discover": {
        const wanted = (values.source ?? args.join(","))
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean);
        const unknown = wanted.filter((w) => !ADAPTERS[w]);
        if (unknown.length)
          throw new Error(`Unknown adapter(s): ${unknown.join(", ")}. Available: ${Object.keys(ADAPTERS).join(", ")}`);
        const adapters = wanted.length ? ADAPTER_ORDER.filter((a) => wanted.includes(a.name)) : ADAPTER_ORDER;
        const totals: Record<string, number> = {};
        const summary: Record<string, unknown>[] = [];
        for (const adapter of adapters) {
          const result = await runDiscovery(
            { db, fetcher: values.offline ? offlineFetcher(adapter.name) : liveFetcher, store, logger },
            adapter,
            {
              ...(values["max-pages"] ? { maxPages: Number(values["max-pages"]) } : {}),
              ...(values.limit ? { limit: Number(values.limit) } : {}),
            },
          );
          for (const [k, v] of Object.entries(result.counters)) totals[k] = (totals[k] ?? 0) + v;
          summary.push({
            adapter: adapter.name,
            status: result.status,
            orgs: result.counters.orgsSeen,
            new: result.counters.clubsCreated,
            matched: result.counters.clubsMatched,
            review: result.counters.probableDuplicates + result.counters.ambiguousMatches,
            pages: result.counters.pagesFetched + result.counters.pagesNotModified,
            failed: result.counters.pagesFailed,
            errors: result.errors.slice(0, 2).join(" | "),
          });
        }
        console.table(summary);
        console.log("Totals:", totals);
        break;
      }
      case "find-sites": {
        if (values.recheck) {
          const r = await recheckFoundSites({ db, store, logger }, { dryRun: values["dry-run"] });
          console.log(
            `${values["dry-run"] ? "[dry-run] " : ""}Checked ${r.checked} found sites; rejecting ${r.rejected.length}`,
          );
          console.table(r.rejected);
          break;
        }
        if (values.search && !env.BRAVE_SEARCH_API_KEY)
          throw new Error("--search needs BRAVE_SEARCH_API_KEY in .env (https://brave.com/search/api/)");
        const result = await runFindSites(
          { db, fetcher: liveFetcher, store, logger },
          {
            ...(values.club ? { clubSlug: values.club } : {}),
            ...(values.limit ? { limit: Number(values.limit) } : {}),
            ...(values.concurrency ? { concurrency: Number(values.concurrency) } : {}),
            guess: !values["no-guess"],
            search:
              values.search && env.BRAVE_SEARCH_API_KEY
                ? new BraveSearchProvider(env.BRAVE_SEARCH_API_KEY, logger)
                : null,
          },
        );
        console.log(`\nRun ${result.runId}: ${result.status}`);
        console.table(result.counters);
        if (result.errors.length) console.log(`Errors (first 20):\n  ${result.errors.slice(0, 20).join("\n  ")}`);
        if (result.status === "failed") process.exitCode = 1;
        break;
      }
      case "enrich": {
        const llmEnabled = values.llm || values["llm-dry-run"];
        const provider = llmEnabled
          ? new AnthropicProvider(env.EXTRACTION_MODEL, env.EXTRACTION_EFFORT as Effort)
          : null;
        const renderer = values.browser ? await createChromeRenderer(env.userAgent) : null;
        const fetcher = renderer
          ? new BrowserFallbackFetcher(liveFetcher, renderer, { minIntervalMs: env.CRAWLER_MIN_INTERVAL_MS, logger })
          : liveFetcher;
        const result = await runEnrichment(
          { db, fetcher, store, logger },
          {
            ...(values.club ? { clubSlug: values.club } : {}),
            ...(values.limit ? { limit: Number(values.limit) } : {}),
            staleOnly: values["stale-only"],
            force: values.force,
            ...(values["freshness-hours"] ? { freshnessHours: Number(values["freshness-hours"]) } : {}),
            ...(values["max-pages"] ? { maxPages: Number(values["max-pages"]) } : {}),
            ...(values["max-depth"] ? { maxDepth: Number(values["max-depth"]) } : {}),
            ...(values.concurrency ? { concurrency: Number(values.concurrency) } : {}),
            llm: provider
              ? { provider, dryRun: values["llm-dry-run"], budgetUsd: num(values.budget) ?? env.EXTRACTION_BUDGET_USD }
              : null,
            browser: renderer !== null,
          },
        ).finally(() => renderer?.close());
        if (fetcher instanceof BrowserFallbackFetcher)
          console.log(`Browser: ${fetcher.rendered} pages rendered, ${fetcher.renderFailures} failed`);
        console.log(`\nRun ${result.runId}: ${result.status}`);
        console.table(result.counters);
        if (result.errors.length) console.log(`Errors (first 20):\n  ${result.errors.slice(0, 20).join("\n  ")}`);
        if (result.status === "failed") process.exitCode = 1;
        break;
      }
      case "reconcile": {
        const result = await runReconcile({ db, logger }, { dryRun: values["dry-run"] });
        console.log(`\nRun ${result.runId}: ${result.status}`);
        console.table(result.counters);
        for (const m of result.merges.slice(0, 50)) console.log(`  ${m}`);
        break;
      }
      case "resolve": {
        const stats = await resolveClubs(db, {
          onError: (id, e) => logger.error({ clubId: id, error: String(e) }, "resolve failed"),
        });
        console.log(`Resolved ${stats.clubs} clubs (${stats.failed} failed)`);
        if (stats.failed > 0) process.exitCode = 1;
        break;
      }
      case "review": {
        const rows = await db
          .select()
          .from(schema.mergeCandidate)
          .where(eq(schema.mergeCandidate.status, "proposed"))
          .orderBy(desc(schema.mergeCandidate.score));
        const ids = [...new Set(rows.flatMap((r) => [r.clubAId, r.clubBId]))];
        const clubs = ids.length
          ? await db
              .select({ id: schema.club.id, slug: schema.club.slug, state: schema.club.recordState })
              .from(schema.club)
              .where(inArray(schema.club.id, ids))
          : [];
        const slug = new Map(clubs.map((c) => [c.id, c.slug]));
        const active = new Set(clubs.filter((c) => c.state === "active").map((c) => c.id));
        console.table(
          // A pair involving an already-merged club is moot.
          rows
            .filter((r) => active.has(r.clubAId) && active.has(r.clubBId))
            .map((r) => ({
              id: r.id,
              a: slug.get(r.clubAId),
              b: slug.get(r.clubBId),
              score: r.score,
              reason: r.reason,
              why: (r.explanation ?? "").slice(0, 90),
            })),
        );
        console.log(
          "Confirm: pnpm hci merge <absorbed> <survivor>   Reject: pnpm hci reject <id>   (or use /admin/review in dev)",
        );
        break;
      }
      case "merge": {
        const [absorbed, survivor] = args;
        const rows = await db
          .select({ id: schema.club.id, slug: schema.club.slug })
          .from(schema.club)
          .where(inArray(schema.club.slug, [absorbed ?? "", survivor ?? ""]));
        const a = rows.find((r) => r.slug === absorbed);
        const s = rows.find((r) => r.slug === survivor);
        if (!a || !s) throw new Error("usage: merge <absorbed-slug> <survivor-slug>");
        await mergeClubs(db, { absorbedId: a.id, survivorId: s.id, actor: "cli" });
        console.log(`Merged ${absorbed} into ${survivor} (undo: pnpm hci unmerge ${absorbed})`);
        break;
      }
      case "unmerge": {
        const [row] = await db
          .select({ id: schema.club.id })
          .from(schema.club)
          .where(eq(schema.club.slug, args[0] ?? ""));
        if (!row) throw new Error("usage: unmerge <slug>");
        await undoMerge(db, { clubId: row.id, actor: "cli" });
        console.log(`Unmerged ${args[0]}`);
        break;
      }
      case "reject": {
        if (!args[0]) throw new Error("usage: reject <candidate-id>");
        await rejectMergeCandidate(db, { candidateId: args[0], actor: "cli" });
        console.log("Rejected.");
        break;
      }
      case "retract-unreproduced": {
        const extractor = values.extractor;
        const version = values.version;
        if (!extractor || !version)
          throw new Error("usage: retract-unreproduced --extractor=<name> --version=<current-version> [--dry-run]");
        const { claimIds } = await retractUnreproducedClaims(db, {
          extractorName: extractor,
          currentVersion: version,
          actor: "cli",
          reason: `not reproduced after re-running ${extractor} with a newer version`,
          dryRun: values["dry-run"],
          ...(values.field ? { fieldKeys: values.field.split(",").map((f) => f.trim()) } : {}),
        });
        console.log(`${values["dry-run"] ? "[dry-run] would retract" : "Retracted"} ${claimIds.length} claims`);
        if (!values["dry-run"] && claimIds.length) await resolveClubs(db, {});
        break;
      }
      case "runs": {
        const runs = await db.select().from(schema.ingestionRun).orderBy(desc(schema.ingestionRun.startedAt)).limit(20);
        console.table(
          runs.map((r) => ({
            started: r.startedAt.toISOString(),
            job: r.job,
            adapter: r.adapter,
            status: r.status,
            counters: JSON.stringify(r.counters).slice(0, 110),
            error: (r.errorSummary ?? "").slice(0, 60),
          })),
        );
        break;
      }
      case "stats":
        console.table(await coverageStats(db));
        break;
      case "export": {
        const outDir = values.out ?? join(findRepoRoot(), "data", "exports");
        const counts = await exportData(db, { outDir, includeFixtures: values["include-fixtures"] });
        console.log(`Exported to ${outDir}:`, counts);
        break;
      }
      default:
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
