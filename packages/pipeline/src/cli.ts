import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { desc, eq, inArray } from "drizzle-orm";
import type { FieldKey } from "@hci/core";
import {
  createDb,
  findRepoRoot,
  mergeClubs,
  rejectMergeCandidate,
  resolveClubs,
  retractUnreproducedClaims,
  listPendingSubmissions,
  reviewSubmission,
  schema,
  setClubHidden,
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
import { runCategorize } from "./stages/categorize";
import { runSummarize } from "./stages/summarize";
import { PUBLISHERS, runCrimson } from "./stages/crimson";
import { runCurate } from "./stages/curate";
import { acceptSubmission, importSubmissions } from "./stages/submissions";
import { runWebDiscovery } from "./stages/web-discovery";
import { recheckFoundSites, runFindInstagram, runFindSites } from "./stages/find-sites";
import { BraveSearchProvider, DEFAULT_MAX_PAID_QUERIES, WordPressSearchProvider } from "./sites/search";
import { runReconcile } from "./stages/reconcile";
import { coverageStats } from "./stats";

const HELP = `hclubs pipeline  —  pnpm hci <command> [options]
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
      --instagram                  Only look for Instagram accounts of clubs without one: batched
                                   site:instagram.com searches, 5 clubs per paid query
      --recheck [--dry-run]        Re-test sites found earlier against the current rules (stored pages);
                                   reject those that no longer pass
      --club=<slug> --limit=N      Target one club / cap clubs
  discover-web                     Find clubs no readable directory lists (ADR 0025): candidate sites from
                                   search sweeps and links on crawled pages; kept only when the home page
                                   title names a Harvard student org
      --search                     Topic search sweeps (needs BRAVE_SEARCH_API_KEY)
      --outlinks                   Links found on pages already crawled
      --limit=N --dry-run          Cap home pages probed (default 400) / report without writing
  summarize [--budget=USD] [--refresh]
                                   One-line summaries of what each club does, from its own pages (anchored to
                                   a verbatim sentence; model SUMMARY_MODEL; ADR 0029)
  categorize [--budget=USD]        LLM categories for clubs with none (or no subcategory), each grounded in a
                                   quote from the club's description page; shown as estimates (ADR 0026)
  press [--publisher=crimson,independent,hpr] [--club=slug,...] [--limit=N]
                                   Record student-newspaper articles that name each club (headline, date,
                                   link; ADR 0026/0027). Needs BRAVE_SEARCH_API_KEY; "crimson" = Crimson only
  curate [--dry-run]               Apply the owner-curated club list (src/curated/list.ts, ADR 0024): attach
                                   editor-listed links, add missing clubs; websites must name the club
  enrich                           Find/verify club websites, shallow-crawl, extract claims
      --club=<slug,...> --limit=N  Target clubs / cap clubs
      --stale-only                 Only clubs whose site wasn't fetched within the freshness window
      --freshness-hours=H          Reuse pages fetched within H hours (default 168)
      --force                      Refetch everything (ignores freshness + conditional GET)
      --max-pages=N --max-depth=D  Crawl limits per site (default 6 / 1)
      --concurrency=N              Clubs in parallel (default 4; per-host politeness still applies)
      --llm                        Also run LLM extraction (needs Anthropic credentials)
      --llm-dry-run                Show which pages would go to the LLM + token estimate, no calls
      --budget=USD                 LLM spend cap for this run (default 1.00)
      --recruiting-freshness-hours=H  Refetch joining/recruiting pages and forms after H hours
                                   (default 20 in recruiting season: mid-Aug–Oct, mid-Jan–Feb)
      --browser                    Render JS-only pages in headless Chrome (installed Chrome, via
                                   playwright-core); robots/rate limits still apply

Reconciliation & review
  reconcile [--dry-run]            Cross-club duplicate pass (auto-merge on strong ids only) + re-resolve all
  resolve                          Re-resolve all clubs only
  review                           List open merge candidates
  merge <absorbed-slug> <survivor-slug>   Confirm a merge (reversible)
  unmerge <slug>                   Undo a merge
  hide <slug> --reason="…"         Hide a club that isn't an in-scope student org (reversible, audited)
  unhide <slug>                    Undo a hide
  reject <candidate-id>            Reject a merge candidate (never re-proposed)
  retract-unreproduced --extractor=X --version=CURRENT [--field=a,b] [--dry-run]
                                   After re-running a fixed extractor, reject claims only older versions produced

Paid search (Brave; prepaid credit)
  --max-queries=N                  Cap billed search queries for this run (default 100) — applies to
                                   find-sites --search, discover-web --search and press (Crimson).
                                   Responses are replayed from storage for 180 days (press: a year), and
                                   press skips clubs already searched, so reruns cost nothing.
  press --refresh                  Search again for clubs already searched this year

Community submissions (ADR 0027)
  submissions import <responses.csv> [--dry-run]   Queue form responses (CSV export) as pending; emails dropped
  submissions list                 Pending submissions
  submissions accept <id> --field=<key> --value=<json|text> [--reason="…"]
                                   Record it as a Community (tier-9) claim, e.g. --field=club.hours_per_week
                                   --value='{"min":5,"max":8}'
  submissions reject <id> [--spam] [--reason="…"]

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
      outlinks: { type: "boolean", default: false },
      instagram: { type: "boolean", default: false },
      reason: { type: "string" },
      publisher: { type: "string" },
      "max-queries": { type: "string" },
      "recruiting-freshness-hours": { type: "string" },
      refresh: { type: "boolean", default: false },
      value: { type: "string" },
      spam: { type: "boolean", default: false },
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
  // Paid web-search queries this run may spend (each Brave query draws prepaid credit).
  const maxQueries = num(values["max-queries"]) ?? DEFAULT_MAX_PAID_QUERIES;
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
        if (values.instagram) {
          if (!env.BRAVE_SEARCH_API_KEY) throw new Error("--instagram needs BRAVE_SEARCH_API_KEY in .env");
          const r = await runFindInstagram(
            { db, store, logger },
            {
              search: new BraveSearchProvider(env.BRAVE_SEARCH_API_KEY, logger, 1100, 20, maxQueries),
              ...(values.club ? { clubSlug: values.club } : {}),
              ...(values.limit ? { limit: Number(values.limit) } : {}),
            },
          );
          console.log(`\nRun ${r.runId}`);
          console.table(r.counters);
          if (r.errors.length) console.log(`Errors:\n  ${r.errors.slice(0, 20).join("\n  ")}`);
          break;
        }
        const result = await runFindSites(
          { db, fetcher: liveFetcher, store, logger },
          {
            ...(values.club ? { clubSlug: values.club } : {}),
            ...(values.limit ? { limit: Number(values.limit) } : {}),
            ...(values.concurrency ? { concurrency: Number(values.concurrency) } : {}),
            guess: !values["no-guess"],
            search:
              values.search && env.BRAVE_SEARCH_API_KEY
                ? new BraveSearchProvider(env.BRAVE_SEARCH_API_KEY, logger, 1100, 10, maxQueries)
                : null,
          },
        );
        console.log(`\nRun ${result.runId}: ${result.status}`);
        console.table(result.counters);
        if (result.errors.length) console.log(`Errors (first 20):\n  ${result.errors.slice(0, 20).join("\n  ")}`);
        if (result.status === "failed") process.exitCode = 1;
        break;
      }
      case "discover-web": {
        if (!values.search && !values.outlinks) throw new Error("discover-web needs --search and/or --outlinks");
        if (values.search && !env.BRAVE_SEARCH_API_KEY)
          throw new Error("--search needs BRAVE_SEARCH_API_KEY in .env (https://brave.com/search/api/)");
        const result = await runWebDiscovery(
          { db, fetcher: liveFetcher, store, logger },
          {
            search:
              values.search && env.BRAVE_SEARCH_API_KEY
                ? new BraveSearchProvider(env.BRAVE_SEARCH_API_KEY, logger, 1100, 20, maxQueries)
                : null,
            outlinks: values.outlinks,
            dryRun: values["dry-run"],
            ...(values.limit ? { maxProbes: Number(values.limit) } : {}),
            ...(values.concurrency ? { concurrency: Number(values.concurrency) } : {}),
          },
        );
        console.log(`\nRun ${result.runId}${values["dry-run"] ? " [dry-run]" : ""}`);
        console.table(result.counters);
        console.table(result.findings.map((f) => ({ ...f, root: f.root.slice(0, 50), note: f.note.slice(0, 60) })));
        if (result.errors.length) console.log(`Errors (first 20):\n  ${result.errors.slice(0, 20).join("\n  ")}`);
        break;
      }
      case "summarize": {
        const result = await runSummarize(
          { db, provider: new AnthropicProvider(env.SUMMARY_MODEL, env.EXTRACTION_EFFORT as Effort), logger },
          {
            budgetUsd: num(values.budget) ?? env.EXTRACTION_BUDGET_USD,
            refresh: values.refresh,
            ...(values.club ? { clubSlug: values.club } : {}),
            ...(values.limit ? { limit: Number(values.limit) } : {}),
          },
        );
        console.log(`\nRun ${result.runId}`);
        console.table(result.counters);
        if (result.errors.length) console.log(`Errors (first 20):\n  ${result.errors.slice(0, 20).join("\n  ")}`);
        break;
      }
      case "categorize": {
        const result = await runCategorize(
          { db, provider: new AnthropicProvider(env.EXTRACTION_MODEL, env.EXTRACTION_EFFORT as Effort), logger },
          {
            budgetUsd: num(values.budget) ?? env.EXTRACTION_BUDGET_USD,
            ...(values.club ? { clubSlug: values.club } : {}),
            ...(values.limit ? { limit: Number(values.limit) } : {}),
          },
        );
        console.log(`\nRun ${result.runId}`);
        console.table(result.counters);
        if (result.errors.length) console.log(`Errors (first 20):\n  ${result.errors.slice(0, 20).join("\n  ")}`);
        break;
      }
      case "press":
      case "crimson": {
        const wanted = (
          values.publisher ?? (command === "crimson" ? "crimson" : PUBLISHERS.map((p) => p.key).join(","))
        )
          .split(",")
          .map((k) => k.trim());
        const braveKey = () => {
          if (!env.BRAVE_SEARCH_API_KEY) throw new Error("the Crimson needs BRAVE_SEARCH_API_KEY in .env");
          return env.BRAVE_SEARCH_API_KEY;
        };
        for (const key of wanted) {
          const publisher = PUBLISHERS.find((p) => p.key === key);
          if (!publisher) throw new Error(`unknown publisher "${key}" (${PUBLISHERS.map((p) => p.key).join(", ")})`);
          const result = await runCrimson(
            { db, fetcher: liveFetcher, store, logger },
            {
              publisher,
              refresh: values.refresh,
              search: publisher.wordpressBase
                ? new WordPressSearchProvider(publisher.wordpressBase, liveFetcher)
                : new BraveSearchProvider(braveKey(), logger, 1100, 20, maxQueries),
              ...(values.club ? { clubSlug: values.club } : {}),
              ...(values.limit ? { limit: Number(values.limit) } : {}),
              ...(values.concurrency ? { concurrency: Number(values.concurrency) } : {}),
            },
          );
          console.log(`\n${publisher.name} — run ${result.runId}`);
          console.table(result.counters);
          if (result.errors.length) console.log(`Errors (first 20):\n  ${result.errors.slice(0, 20).join("\n  ")}`);
        }
        break;
      }
      case "submissions": {
        const [sub, arg] = args;
        const now = new Date();
        if (sub === "import") {
          if (!arg) throw new Error("usage: submissions import <responses.csv>");
          const r = await importSubmissions(db, readFileSync(arg, "utf8"), { dryRun: values["dry-run"], now });
          console.log(`${values["dry-run"] ? "[dry-run] " : ""}Imported ${r.imported}; ${r.duplicates} already queued`);
          if (r.droppedColumns.length) console.log(`Personal columns ignored: ${r.droppedColumns.join(", ")}`);
          if (r.unmatchedClubs.length)
            console.log(`No club match (fix before accepting): ${r.unmatchedClubs.join("; ")}`);
        } else if (sub === "list") {
          const rows = await listPendingSubmissions(db);
          for (const r of rows) {
            const p = r.payload as { message?: string; kindLabel?: string; clubText?: string };
            console.log(`\n${r.id}  ${r.clubSlug ?? `(unmatched: ${p.clubText ?? "?"})`}  [${p.kindLabel ?? r.kind}]`);
            console.log(`  ${(p.message ?? "").replace(/\s+/g, " ").slice(0, 400)}`);
            if (r.evidenceUrl) console.log(`  source: ${r.evidenceUrl}`);
          }
          console.log(`\n${rows.length} pending`);
        } else if (sub === "accept") {
          if (!arg || !values.field || values.value === undefined)
            throw new Error("usage: submissions accept <id> --field=<key> --value=<json|text>");
          let value: unknown = values.value;
          try {
            value = JSON.parse(values.value);
          } catch {
            // plain text value
          }
          const r = await acceptSubmission(db, {
            id: arg,
            fieldKey: values.field as FieldKey,
            value,
            actor: "cli",
            ...(values.reason ? { note: values.reason } : {}),
            now,
          });
          console.log(`Accepted → claim ${r.claimId}`);
        } else if (sub === "reject") {
          if (!arg) throw new Error("usage: submissions reject <id> [--spam]");
          await reviewSubmission(db, {
            id: arg,
            status: values.spam ? "spam" : "rejected",
            actor: "cli",
            ...(values.reason ? { note: values.reason } : {}),
            now,
          });
          console.log(`Marked ${values.spam ? "spam" : "rejected"}`);
        } else throw new Error("usage: submissions import|list|accept|reject");
        break;
      }
      case "curate": {
        const result = await runCurate({ db, fetcher: liveFetcher, store, logger }, { dryRun: values["dry-run"] });
        console.log(`\nRun ${result.runId}${values["dry-run"] ? " [dry-run]" : ""}`);
        console.table(result.outcomes);
        if (result.touchedSlugs.length) console.log(`Next: pnpm hci enrich --club=${result.touchedSlugs.join(",")}`);
        if (result.errors.length) {
          console.log(`Errors:\n  ${result.errors.slice(0, 20).join("\n  ")}`);
          process.exitCode = 1;
        }
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
            ...(values["recruiting-freshness-hours"]
              ? { recruitingFreshnessHours: Number(values["recruiting-freshness-hours"]) }
              : {}),
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
      case "hide":
      case "unhide": {
        const [row] = await db
          .select({ id: schema.club.id })
          .from(schema.club)
          .where(eq(schema.club.slug, args[0] ?? ""));
        if (!row) throw new Error(`usage: ${command} <slug> --reason="…"`);
        if (command === "hide" && !values.reason) throw new Error('hide needs --reason="…"');
        await setClubHidden(db, {
          clubId: row.id,
          hidden: command === "hide",
          actor: "cli",
          reason: values.reason ?? "unhide",
        });
        console.log(`${command === "hide" ? "Hid" : "Unhid"} ${args[0]}`);
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
