import { createHash } from "node:crypto";
import { readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { and, desc, eq, gte, inArray, sql } from "drizzle-orm";
import { isFieldKey, normalizeUrl, parseFieldValue, siteKey, stableStringify } from "@hci/core";
import {
  clubFamily,
  createDb,
  findRepoRoot,
  mergeClubs,
  rejectMergeCandidate,
  resolveClubs,
  retractUnreproducedClaims,
  submissionKindLabel,
  rejectClaims,
  restoreClaims,
  disownSite,
  schema,
  setClubHidden,
  undoMerge,
} from "@hci/db";
import { ADAPTERS, ADAPTER_ORDER, OFFLINE_FIXTURES, SOCO_DIRECTORY_URL, socoDirectoryAdapter } from "./adapters";
import { pipelineEnv } from "./env";
import { exportData } from "./export";
import { AnthropicProvider, type Effort } from "./extract/llm/anthropic";
import { FixtureFetcher } from "./fetch/fixture-fetcher";
import { BrowserFallbackFetcher, createChromeRenderer } from "./fetch/browser-fetcher";
import { PoliteHttpFetcher } from "./fetch/http-fetcher";
import { NoNetworkFetcher } from "./fetch/no-network-fetcher";
import { IMAGE_CONTENT_TYPES, runLogos } from "./stages/logos";
import { writeLogoFiles } from "./stages/logo-files";

/** Where the site's own logo copies go (served at /logos/ig/; not in git). */
const logoFilesDir = () => join(findRepoRoot(), "apps", "web", "public", "logos", "ig");
/** The Chrome profile the owner signs in to Instagram with (local only: data/ is not in git). */
const instagramProfileDir = () => join(findRepoRoot(), "data", "chrome-instagram");
import { createLogger } from "./logger";
import { FsSnapshotStore } from "./snapshots/store";
import { runDiscovery } from "./stages/discover";
import { runEnrichment } from "./stages/enrich";
import { runCheckForms } from "./stages/check-forms";
import { DETERMINISTIC_EXTRACTOR } from "./extract/deterministic";
import { SCOPE_EXTRACTOR } from "./extract/scope";
import { runCategorize } from "./stages/categorize";
import { runNameCategories } from "./stages/name-categories";
import { runSummarize } from "./stages/summarize";
import { PUBLISHERS, rescorePressMentions, runCrimson } from "./stages/crimson";
import { runCurate } from "./stages/curate";
import type { CuratedFactsEntry } from "./curated/facts";
import { runFacts } from "./stages/facts";
import { collectInstagramFollowers } from "./stages/instagram-collect";
import { runInstagramFollowers } from "./stages/instagram-followers";
import { parseRobots } from "./fetch/robots";
import { systemResolver, unsafeTargetReason } from "./fetch/url-safety";
import { htmlToDocument } from "./parse/document";
import { runLifecycle } from "./stages/lifecycle";
import { runLinkGraph } from "./stages/link-graph";
import {
  SubmissionReviewError,
  acceptProposal,
  shortId,
  importSubmissions,
  listSubmissions,
  matchSubmission,
  rejectProposal,
  rejectSubmission,
  showSubmission,
  submissionStats,
} from "./stages/submissions";
import { runWebDiscovery } from "./stages/web-discovery";
import { recheckFoundSites, runFindInstagram, runFindSites } from "./stages/find-sites";
import { BraveSearchProvider, DEFAULT_MAX_PAID_QUERIES, WordPressSearchProvider } from "./sites/search";
import { runReconcile } from "./stages/reconcile";
import { runRecruiting } from "./stages/recruiting";
import { runNameOnly } from "./stages/name-only";
import { auditRecruiting } from "./recruiting/audit";
import { dismissFinding, politeUrlStatus, runAudit } from "./audit/run";
import { recruitingCoverage } from "./recruiting/coverage";
import { coverageStats } from "./stats";
import { explainClub } from "./explain";
import { privacyScan } from "./privacy-scan";
import { recruitingReview } from "./recruiting/review";
import { lifecycleCandidates } from "./lifecycle-candidates";
import { backupDatabase, restoreDatabase, verifySnapshots } from "./backup";
import { diagnoseNameOnly } from "./name-only/diagnose";
import { diffAgainstSaved, saveProjection } from "./projection-diff";
import { coverageReport, missingQueue } from "./coverage";
import { opportunitiesReport, snapshotSearch } from "./snapshot-search";

const HELP = `hclubs pipeline  —  pnpm hci <command> [options]
(root shortcuts: pnpm ingest:discover | ingest:enrich | ingest:reconcile | ingest:export | ingest:stats)

Discovery
  adapters                         List discovery adapters (run order)
  discover [--source=a,b]          Run discovery adapters (default: all, official first)
      --offline                    Use saved fixtures instead of the network
      --stored                     Replay each page's latest stored snapshot (no requests): re-apply a
                                   parser change after a version bump for free
      --max-pages=N --limit=N      Cap pages / organizations per adapter
  parse <adapter>                  Parse saved fixtures only (no DB, no network)

Enrichment
  find-sites                       Find websites for clubs that have none: guessed domains + web search,
                                   accepted only when the fetched home page names the club (ADR 0023)
      --search                     Also query the Brave Search API (needs BRAVE_SEARCH_API_KEY)
      --no-guess                   Skip domain guessing
      --loose                      Looser, unquoted search phrasing for clubs the exact search missed
      --instagram                  Only look for Instagram accounts of clubs without one: one
                                   site:instagram.com search per club (paid; cap with --limit)
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
      --from-names [--dry-run]     Instead: categories the club's own name settles (explicit rules, no LLM;
                                   estimates; ADR 0034)
  press --rescore [--dry-run]       Re-judge stored mentions with the current rules (no network, no credit);
                                   restores mentions an earlier rescore rejected that now pass
  press [--publisher=crimson,independent,hpr] [--club=slug,...] [--limit=N]
                                   Record student-newspaper articles that name each club (headline, date,
                                   link; ADR 0026/0027). Needs BRAVE_SEARCH_API_KEY; "crimson" = Crimson only
  recruiting                       Targeted recruiting pass (ADR 0031): each club's joining/recruiting pages
                                   (scored links, sitemap, linked application forms), search fallback for
                                   clubs whose site has none, extraction, then the recruiting quality audit
      --club=<slug,...> --limit=N  Target clubs / cap clubs
      --missing-only               Only clubs without a dated current/upcoming cycle
      --stale-only                 Only clubs whose recruiting pages weren't checked in 72 h
      --search-budget=N            Paid search queries this run may spend (default 0 = no search)
      --no-ai                      Deterministic extraction only (default: LLM on recruiting pages)
      --budget=USD                 LLM spend cap (default 1.00)
      --dry-run                    List targets, planned searches and audit findings; fetch nothing
      --audit-only                 Run only the recruiting quality audit (rejects what fails)
  name-only --diagnose             Why each name-only club has no details, grouped, from stored data (no network)
  name-only                        Name-only campaign (ADR 0032): duplicates → merge candidates, then free
                                   evidence (cached searches, stored pages), then capped paid searches; writes
                                   data/reports/name-only-review.{json,md} for manual review
      --search-budget=N            Paid search queries (default 0) --limit=N --dry-run
  import-soco <file.txt>           Import the owner's saved copy of the SOCO org directory (ADR 0030; never
                                   fetched: it needs HarvardKey). Prints the new clubs' slugs for find-sites
  link-graph [--dry-run] [--fetch=N]
                                   Websites and accounts for site-less clubs from pages already stored (no
                                   search): links whose text is the club's exact name, and unowned stored home
                                   pages titled with it; attached only when the home page names the club
                                   (ADR 0038). --fetch=N politely fetches up to N unstored home pages (free).
                                   Report: data/reports/link-candidates.md
  instagram-login                  Open Chrome with the saved Instagram profile for the owner to sign in by hand
  instagram-followers [--limit=N] [--club=a,b] [--missing-logo] [--signed-in] [--dry-run] [--out=file.json]
                                   Read each club's public Instagram profile in installed Chrome (one page per
                                   10-15 s; stops at any login/rate-limit sign; owner exception, ADR 0046) and save
                                   the og:description follower count to data/imports/instagram-followers.json, then
                                   import it. --dry-run lists the profiles (no network). HCI_INSTAGRAM=off disables it
  import-instagram-followers <file.json> [--dry-run]
                                   Instagram follower counts (ADR 0046): each count must appear in its own
                                   saved snippet text; written as stated claims (data/imports/instagram-followers.json).
                                   Account check: the text names the handle, and the account is a verified/probable
                                   link or its display name names the club. Orders "Popularity"; never displayed. No fetching
  facts [--dry-run] [--club=a,b]   Editor-read facts (src/curated/facts.ts, ADR 0044): each page fetched, every
                                   quote verified verbatim and against the extractors' evidence rules
      --file=batch.json            Check (with --dry-run) or write entries from a JSON file instead
  logo-files                       Write the logo images the site serves itself (Instagram profile pictures)
                                   to apps/web/public/logos/ig/ from kept copies (ADR 0050); run before a build
  logos [--club=a,b] [--offline] [--reprobe] [--dry-run]
                                   Each club's logo from its website's root page: candidate images measured
                                   once (image_probe), white/tiny/too-wide/template/third-party ones skipped,
                                   earlier site logos that no longer qualify rejected. --offline: stored
                                   measurements only, no requests
  page-text <url>                  Print a page's text as the pipeline reads it (robots checked): copy quotes from here
  lifecycle [--dry-run]            Record organizations that ended (src/curated/lifecycle.ts, ADR 0038):
                                   fetches each evidence page, requires its quotes verbatim, then marks the
                                   club defunct and links its successor
  curate [--dry-run]               Apply the owner-curated club list (src/curated/list.ts, ADR 0024): attach
                                   editor-listed links, add missing clubs; websites must name the club
  enrich                           Find/verify club websites, shallow-crawl, extract claims
      --club=<slug,...> --limit=N  Target clubs / cap clubs
      --offline                    Stored pages only, no requests: replay extraction after an
                                   extractor change (free; with --llm only cached results replay)
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

Data quality
  audit                            Hostile data-quality audit (ADR 0033): links, social handles, descriptions,
                                   summaries, categories, duplicates, counts/dues/hours, recruiting, logos,
                                   news mentions, source consistency. Writes data/reports/audit.{json,md}
      --apply                      Fix high-confidence findings (reject claims with a reason; reversible
                                   merges; re-resolve). Without it, report only
      --check=links,content,…      Only these check groups
      --apply-only=check.a,check.b Apply only these checks' fixes (e.g. application.form_closed)
      --check-urls                 Also request each shown logo (politely) and reject ones that 404
      --fail-on=critical|high      Exit 1 when a finding at or above that severity remains (publish gate)
  check-forms [--club=a,b] [--stale-days=7] [--limit=N] [--dry-run]
                                   Re-fetch the application forms and pages profiles show (politely, no claims)
                                   so the audit rejects forms no longer accepting responses; run audit after
  audit-dismiss <slug> <check> [subject] --reason="…"
                                   Keep data a finding questioned (audited; the finding stops reappearing)

Reconciliation & review
  reconcile [--dry-run]            Cross-club duplicate pass (auto-merge on strong ids only) + re-resolve all
  resolve [--diff]                 Re-resolve all clubs only; --diff lists every displayed value that changed
  review                           List open merge candidates
  merge <absorbed-slug> <survivor-slug>   Confirm a merge (reversible)
  unmerge <slug>                   Undo a merge
  hide <slug> --reason="…"         Hide a club that isn't an in-scope student org (reversible, audited)
  reject-link <slug> <url> --reason="…"   Reject a wrong link (every claim of that URL for the club; audited)
  reject-value <slug> <field> <json|text> --reason="…"   Reject every active claim of that value, e.g.
                                   reject-value harvard-computer-society club.category entrepreneurship
  restore-value <slug> <field> <json|text> --reason="…"   Undo reject-value (rejected claims of that value active again; audited)
  unhide <slug>                    Undo a hide
  reject <candidate-id>            Reject a merge candidate (never re-proposed)
  retract-unreproduced --extractor=X [--version=CURRENT] [--field=a,b] [--dry-run]
                                   After re-running a fixed extractor, reject claims only older versions produced

Paid search (Brave; prepaid credit)
  --max-queries=N                  Cap billed search queries for this run (default 100) — applies to
                                   find-sites --search, discover-web --search and press (Crimson).
                                   Responses are replayed from storage for 180 days (press: a year), and
                                   press skips clubs already searched, so reruns cost nothing.
  press --refresh                  Search again for clubs already searched this year

Community submissions (ADRs 0027, 0035). <id> may be the last 8 characters, as listed.
  submissions import <responses.csv> [--dry-run]   Queue form responses (CSV export) as pending, one proposed
                                   field per answered template line; personal columns, emails and phones dropped
  submissions list [--status=pending|accepted|partially_accepted|rejected|spam|all]
  submissions show <id>            Answers, proposed values, what the profile shows now, source checks
  submissions accept <id>          Accept every pending proposed field that has a value
  submissions accept-field <id> <field|#> [--value=<json|text>] [--term=2026-fall] [--override] [--no-fetch]
                                   Accept one field as a Community (tier-9) claim. --value replaces the parsed
                                   value (or adds a field the text mentions). The source link, if any, is
                                   fetched; a page that states the value adds a sourced claim. --override lets a
                                   community value replace one shown from a real source.
  submissions reject-field <id> <field|#> --reason="…"
  submissions reject <id> --reason="…" [--spam]    Reject every pending field (nothing is deleted)
  submissions match <id> <club-slug>               Point an unmatched submission at a club
  submissions stats                Pending/accepted/rejected/partial, fields contributed, clubs improved

Inspection
  runs                             Recent ingestion runs and counters
  stats                            Coverage report
  explain <slug> [field…]          Every claim behind a club's fields, its evidence, and which one is shown
  coverage                         Field coverage overall and by category: data/reports/coverage.md
  projection save|diff [--name=N]  Save what the site shows, then list every displayed value that changed since (data/reports/projection-diff.md)
  backup [--out=DIR]               Database backup: one gzipped NDJSON file per table + manifest (data/backups/<time>/db)
  restore <dir>                    Load a backup into an EMPTY migrated database (refuses one with clubs)
  snapshots verify                 Every snapshot file exists, decompresses and matches its hash
  recruiting-review                Every live recruiting date with its source and quote: data/reports/recruiting-review.md
  privacy-scan [dir]               Scan the built site (apps/web/out) for personal data before publishing
  queue [--limit=N]                Most valuable missing facts to find next: data/reports/queue.md
  snapshots search <regex> [--missing=<field>] [--limit=N]
                                   Grep the latest crawled text of every club page (no network), e.g.
                                   snapshots search "hours (a|per) week" --missing=club.hours_per_week
  opportunities [--field=<field>]  Clubs showing "Unknown" whose own crawled pages likely state the value:
                                   data/reports/opportunities.md (leads for extractor fixes; never applied)
  export [--out=dir] [--include-fixtures]   Write JSON/CSV exports (default data/exports)
`;

const FIXTURE_ROOT = fileURLToPath(new URL("../test/fixtures", import.meta.url));

async function main() {
  const { positionals, values } = parseArgs({
    allowPositionals: true,
    options: {
      offline: { type: "boolean", default: false },
      stored: { type: "boolean", default: false },
      reprobe: { type: "boolean", default: false },
      "missing-logo": { type: "boolean", default: false },
      "signed-in": { type: "boolean", default: false },
      source: { type: "string" },
      "max-pages": { type: "string" },
      "max-depth": { type: "string" },
      limit: { type: "string" },
      club: { type: "string" },
      file: { type: "string" },
      "stale-only": { type: "boolean", default: false },
      "freshness-hours": { type: "string" },
      force: { type: "boolean", default: false },
      concurrency: { type: "string" },
      llm: { type: "boolean", default: false },
      "llm-dry-run": { type: "boolean", default: false },
      budget: { type: "string" },
      "dry-run": { type: "boolean", default: false },
      diff: { type: "boolean", default: false },
      diagnose: { type: "boolean", default: false },
      candidates: { type: "boolean", default: false },
      name: { type: "string" },
      fetch: { type: "string" },
      "fail-on": { type: "string" },
      "saved-at": { type: "string" },
      out: { type: "string" },
      extractor: { type: "string" },
      version: { type: "string" },
      "include-fixtures": { type: "boolean", default: false },
      search: { type: "boolean", default: false },
      outlinks: { type: "boolean", default: false },
      instagram: { type: "boolean", default: false },
      loose: { type: "boolean", default: false },
      reason: { type: "string" },
      publisher: { type: "string" },
      "max-queries": { type: "string" },
      "recruiting-freshness-hours": { type: "string" },
      refresh: { type: "boolean", default: false },
      rescore: { type: "boolean", default: false },
      value: { type: "string" },
      spam: { type: "boolean", default: false },
      field: { type: "string" },
      term: { type: "string" },
      status: { type: "string" },
      override: { type: "boolean", default: false },
      "no-fetch": { type: "boolean", default: false },
      recheck: { type: "boolean", default: false },
      browser: { type: "boolean", default: false },
      "no-guess": { type: "boolean", default: false },
      "missing-only": { type: "boolean", default: false },
      "only-restated": { type: "boolean", default: false },
      "search-budget": { type: "string" },
      "no-ai": { type: "boolean", default: false },
      "audit-only": { type: "boolean", default: false },
      apply: { type: "boolean", default: false },
      missing: { type: "string" },
      "from-names": { type: "boolean", default: false },
      "check-urls": { type: "boolean", default: false },
      "stale-days": { type: "string" },
      "apply-only": { type: "string" },
      check: { type: "string" },
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
  // Numeric options fail loudly: a typo must never become NaN, which disables every cap.
  const req = (v: string): number => {
    const n = Number(v);
    if (!Number.isFinite(n) || n < 0) throw new Error(`expected a non-negative number, got "${v}"`);
    return n;
  };
  const num = (v: string | undefined) => (v === undefined ? undefined : req(v));

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
            {
              db,
              fetcher: values.stored
                ? new NoNetworkFetcher()
                : values.offline
                  ? offlineFetcher(adapter.name)
                  : liveFetcher,
              store,
              logger,
            },
            adapter,
            {
              ...(values.stored ? { stored: true } : {}),
              ...(values["max-pages"] ? { maxPages: req(values["max-pages"]) } : {}),
              ...(values.limit ? { limit: req(values.limit) } : {}),
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
              ...(values.limit ? { limit: req(values.limit) } : {}),
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
            ...(values.limit ? { limit: req(values.limit) } : {}),
            ...(values.concurrency ? { concurrency: req(values.concurrency) } : {}),
            guess: !values["no-guess"],
            looseQuery: values.loose,
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
            ...(values.limit ? { maxProbes: req(values.limit) } : {}),
            ...(values.concurrency ? { concurrency: req(values.concurrency) } : {}),
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
            ...(values.limit ? { limit: req(values.limit) } : {}),
          },
        );
        console.log(`\nRun ${result.runId}`);
        console.table(result.counters);
        if (result.errors.length) console.log(`Errors (first 20):\n  ${result.errors.slice(0, 20).join("\n  ")}`);
        break;
      }
      case "categorize": {
        if (values["from-names"]) {
          const { added } = await runNameCategories(db, { dryRun: values["dry-run"] });
          console.table(added);
          console.log(`${values["dry-run"] ? "[dry-run] would add" : "Added"} ${added.length} name-settled categories`);
          break;
        }
        const result = await runCategorize(
          { db, provider: new AnthropicProvider(env.EXTRACTION_MODEL, env.EXTRACTION_EFFORT as Effort), logger },
          {
            budgetUsd: num(values.budget) ?? env.EXTRACTION_BUDGET_USD,
            ...(values.club ? { clubSlug: values.club } : {}),
            ...(values.limit ? { limit: req(values.limit) } : {}),
          },
        );
        console.log(`\nRun ${result.runId}`);
        console.table(result.counters);
        if (result.errors.length) console.log(`Errors (first 20):\n  ${result.errors.slice(0, 20).join("\n  ")}`);
        break;
      }
      case "press":
      case "crimson": {
        if (values.rescore) {
          // Stored mentions only: no search, no fetch, no credit.
          const r = await rescorePressMentions(db, { dryRun: values["dry-run"] });
          const dry = values["dry-run"];
          console.log(
            `${dry ? "[dry-run] would reject" : "Rejected"} ${r.rejected.length} and ${dry ? "would restore" : "restored"} ${r.restored.length} of ${r.checked} mentions`,
          );
          for (const m of r.rejected) console.log(`  - ${m.slug}\t${m.publishedOn}\t${m.title.slice(0, 60)}\t${m.why}`);
          for (const m of r.restored)
            console.log(
              `  + ${m.slug}\t${m.publishedOn}\t${m.publisher}\t${m.title.slice(0, 60)}\t${m.quote.slice(0, 90)}`,
            );
          break;
        }
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
              ...(values.limit ? { limit: req(values.limit) } : {}),
              ...(values.concurrency ? { concurrency: req(values.concurrency) } : {}),
            },
          );
          console.log(`\n${publisher.name} — run ${result.runId}`);
          console.table(result.counters);
          if (result.errors.length) console.log(`Errors (first 20):\n  ${result.errors.slice(0, 20).join("\n  ")}`);
        }
        break;
      }
      case "submissions": {
        const [sub, arg, arg2] = args;
        const now = new Date();
        const actor = "cli";
        const parseValue = (raw: string | undefined): unknown => {
          if (raw === undefined) return undefined;
          try {
            return JSON.parse(raw);
          } catch {
            return raw; // plain text value
          }
        };
        const show = (v: unknown) => (typeof v === "string" ? v : JSON.stringify(v));
        if (sub === "import") {
          if (!arg) throw new Error("usage: submissions import <responses.csv> [--dry-run]");
          const file = resolve(process.env.INIT_CWD ?? process.cwd(), arg);
          const r = await importSubmissions(db, readFileSync(file, "utf8"), { dryRun: values["dry-run"], now });
          console.log(
            `${values["dry-run"] ? "[dry-run] " : ""}Imported ${r.imported} (${r.proposals} proposed fields); ${r.duplicates} already imported; ${r.nearDuplicates} repeat an earlier submission`,
          );
          if (r.siteFeedback) console.log(`Site feedback skipped (not club data): ${r.siteFeedback}`);
          if (r.droppedColumns.length) console.log(`Personal columns ignored: ${r.droppedColumns.join(", ")}`);
          if (r.redactions) console.log(`Email addresses / phone numbers removed from answers: ${r.redactions}`);
          for (const u of r.unmatched)
            console.log(`No club match for "${u.text}"${u.suggestion ? ` — did you mean ${u.suggestion}?` : ""}`);
        } else if (sub === "list") {
          const statuses = ["pending", "accepted", "partially_accepted", "rejected", "spam", "all"] as const;
          const status = statuses.find((x) => x === (values.status ?? "pending"));
          if (!status) throw new Error(`--status must be one of ${statuses.join(", ")}`);
          const rows = await listSubmissions(db, { status });
          for (const r of rows) {
            const p = r.payload as { message?: string; clubText?: string; duplicateOf?: string };
            const counts = Object.entries(r.proposals)
              .map(([k, n]) => `${n} ${k}`)
              .join(", ");
            console.log(
              `\n${shortId(r.id)}  ${r.clubSlug ?? `(unmatched: ${p.clubText || "?"})`}  [${submissionKindLabel(r.kind)}]  ${r.status}${counts ? `  · fields: ${counts}` : ""}${p.duplicateOf ? `  · repeats ${shortId(p.duplicateOf)}` : ""}`,
            );
            console.log(`  ${(p.message ?? "").replace(/\s+/g, " ").slice(0, 300)}`);
            if (r.evidenceUrl) console.log(`  source: ${r.evidenceUrl}`);
          }
          console.log(`\n${rows.length} ${values.status ?? "pending"}`);
        } else if (sub === "show") {
          if (!arg) throw new Error("usage: submissions show <id>");
          const v = await showSubmission(db, arg);
          const s = v.submission;
          const p = s.payload as {
            submittedAt?: string;
            message?: string;
            raw?: Record<string, string>;
            clubText?: string;
            formAnswer?: string;
            duplicateOf?: string;
            redactions?: number;
          };
          console.log(`${s.id}  ${s.status}  [${submissionKindLabel(s.kind)}]`);
          console.log(
            `Club: ${v.club ? `${v.club.name} (${v.club.slug})` : `unmatched — "${p.clubText ?? ""}"; run submissions match ${shortId(s.id)} <slug>`}`,
          );
          console.log(`Submitted: ${p.submittedAt ?? s.createdAt.toISOString()}   Form answer: ${p.formAnswer ?? "?"}`);
          if (s.evidenceUrl) console.log(`Source link: ${s.evidenceUrl} (checked when a field is accepted)`);
          if (p.duplicateOf) console.log(`Repeats submission ${p.duplicateOf}`);
          if (p.redactions) console.log(`(${p.redactions} email address/phone number removed on import)`);
          console.log(`\n${p.message ?? ""}\n`);
          if (!v.proposals.length)
            console.log("No template answers. Accept with: submissions accept-field <id> <field> --value=…");
          for (const q of v.proposals) {
            console.log(
              `#${q.number} ${q.fieldKey}${q.termKey ? ` (${q.termKey})` : ""}  ${q.status}${q.origin === "editor" ? " (editor)" : ""}`,
            );
            console.log(`   answer: ${q.rawText.replace(/\s+/g, " ").slice(0, 200)}`);
            console.log(`   value:  ${q.value === null ? "— (couldn't read; give --value)" : show(q.value)}`);
            if (q.parseNote) console.log(`   note:   ${q.parseNote}`);
            if (q.current)
              console.log(
                `   shown now: ${show(q.current.value)} — ${q.current.community ? "community" : `${q.current.sourceType ?? "source"}, tier ${q.current.tier}`}${q.status === "pending" && q.value !== null && show(q.value) !== show(q.current.value) ? "  ⚠ differs" : ""}`,
              );
            if (q.decisionReason) console.log(`   reason: ${q.decisionReason}`);
            const ev = q.evidenceCheck as { status?: string; reason?: string } | null;
            if (ev?.status) console.log(`   source check: ${ev.status} — ${ev.reason ?? ""}`);
          }
        } else if (sub === "accept" || sub === "accept-field") {
          if (!arg)
            throw new Error(
              `usage: submissions ${sub} <id>${sub === "accept-field" ? " <field|#>" : ""} [--value=…] [--term=…] [--override] [--no-fetch]`,
            );
          // Legacy form: accept <id> --field=<key> --value=<v>.
          const selectors =
            sub === "accept-field"
              ? [arg2 ?? ""]
              : values.field
                ? [values.field]
                : (await showSubmission(db, arg)).proposals
                    .filter((q) => q.status === "pending")
                    .map((q) => String(q.number));
          if (!selectors.length || !selectors[0])
            throw new Error("nothing pending to accept; use accept-field <id> <field> --value=…");
          if (sub === "accept" && !values.field && values.value !== undefined)
            throw new Error("--value applies to one field: use accept-field <id> <field> --value=…");
          for (const selector of selectors) {
            try {
              const r = await acceptProposal(db, {
                submissionId: arg,
                selector,
                ...(values.value !== undefined ? { value: parseValue(values.value) } : {}),
                ...(values.term ? { termKey: values.term } : {}),
                ...(values.override ? { override: true } : {}),
                ...(values.reason ? { reason: values.reason } : {}),
                actor,
                now,
                ...(values["no-fetch"] ? {} : { fetcher: liveFetcher, store }),
              });
              const what = {
                shown: "now shown on the profile",
                added: "added",
                kept_competing: `kept as a competing claim; still showing ${show(r.current?.value)} (${r.current?.sourceType ?? "source"}, tier ${r.current?.tier})`,
                merge_proposed: "merge proposed for review (pnpm hci review)",
                merge_exists: "already proposed as a merge",
              }[r.outcome];
              console.log(`✓ ${r.fieldKey}: ${what}`);
              if (r.evidence) console.log(`  source check: ${r.evidence.status} — ${r.evidence.reason}`);
              if (r.claimIds.length) console.log(`  claims: ${r.claimIds.join(", ")}`);
              console.log(`  submission: ${r.submissionStatus}`);
            } catch (e) {
              if (e instanceof SubmissionReviewError) console.log(`✗ ${selector}: ${e.message}`);
              else throw e;
            }
          }
        } else if (sub === "reject-field") {
          if (!arg || !arg2 || !values.reason)
            throw new Error('usage: submissions reject-field <id> <field|#> --reason="…"');
          const r = await rejectProposal(db, { submissionId: arg, selector: arg2, reason: values.reason, actor, now });
          console.log(`Rejected ${arg2}; submission ${r.submissionStatus}`);
        } else if (sub === "reject") {
          if (!arg || !values.reason) throw new Error('usage: submissions reject <id> --reason="…" [--spam]');
          const r = await rejectSubmission(db, {
            submissionId: arg,
            reason: values.reason,
            ...(values.spam ? { spam: true } : {}),
            actor,
            now,
          });
          console.log(`Marked ${r.status} (${r.proposalsRejected} pending fields rejected)`);
        } else if (sub === "match") {
          if (!arg || !arg2) throw new Error("usage: submissions match <id> <club-slug>");
          await matchSubmission(db, { submissionId: arg, slug: arg2, actor, now });
          console.log(`Matched to ${arg2}`);
        } else if (sub === "stats") {
          const s = await submissionStats(db);
          console.log("Submissions:", s.submissions);
          console.log("Proposed fields:", s.proposals);
          console.log("Accepted by field:", s.fieldsAccepted);
          console.table({
            "partial accepts": s.submissions.partially_accepted ?? 0,
            "clubs improved": s.clubsImproved,
            "accepted fields a source link confirmed": s.corroboratedBySource,
            "profile fields showing a community value": s.communityClaimsShown,
            "pending, no club match": s.unmatched,
          });
        } else
          throw new Error("usage: submissions import|list|show|accept|accept-field|reject-field|reject|match|stats");
        break;
      }
      case "import-soco": {
        if (!args[0]) throw new Error("usage: import-soco <file.txt>");
        // pnpm runs the CLI from the package directory; paths are relative to where it was invoked.
        const file = resolve(process.env.INIT_CWD ?? process.cwd(), args[0]);
        const started = new Date();
        // The directory was observed when the owner saved the copy, not when it's imported:
        // re-importing a file must not make its facts look fresher than other sources' (that
        // flipped names on recency tie-breaks). The same content as a stored snapshot keeps
        // that snapshot's time; a new copy uses the file's save time. --saved-at overrides.
        const sha = createHash("sha256").update(readFileSync(file)).digest("hex");
        const [same] = await db
          .select({ at: schema.sourceSnapshot.fetchedAt })
          .from(schema.sourceSnapshot)
          .where(eq(schema.sourceSnapshot.contentSha256, sha))
          .limit(1);
        const savedAt = values["saved-at"]
          ? new Date(`${values["saved-at"]}T12:00:00Z`)
          : (same?.at ?? statSync(file).mtime);
        if (Number.isNaN(savedAt.getTime())) throw new Error("--saved-at expects YYYY-MM-DD");
        const fetcher = new FixtureFetcher(
          { [SOCO_DIRECTORY_URL]: file },
          savedAt,
          "manual_upload",
          "text/plain; charset=utf-8",
        );
        const result = await runDiscovery({ db, fetcher, store, logger }, socoDirectoryAdapter, {
          ...(values.limit ? { limit: req(values.limit) } : {}),
        });
        const created = await db
          .select({ slug: schema.club.slug })
          .from(schema.club)
          .where(and(eq(schema.club.recordState, "active"), gte(schema.club.createdAt, started)));
        console.log(`Run ${result.runId}: ${result.status}`, result.counters);
        if (result.errors.length) console.log(`Errors:\n  ${result.errors.slice(0, 20).join("\n  ")}`);
        if (created.length) {
          const out = join(dirname(file), `soco-new-slugs-${started.toISOString().slice(0, 10)}.txt`);
          writeFileSync(out, created.map((c) => c.slug).join("\n") + "\n");
          console.log(`${created.length} new clubs; slugs written to ${out}`);
        } else console.log("0 new clubs");
        break;
      }
      case "name-only": {
        // --diagnose: why each name-only club is still name-only, from stored data only.
        if (values.diagnose) {
          const { rows, path } = await diagnoseNameOnly(db);
          const counts = new Map<string, number>();
          for (const r of rows) counts.set(r.group, (counts.get(r.group) ?? 0) + 1);
          console.table(Object.fromEntries(counts));
          console.log(`Report: ${path}`);
          break;
        }
        const searchBudget = num(values["search-budget"]) ?? 0;
        const search =
          searchBudget > 0 && env.BRAVE_SEARCH_API_KEY
            ? new BraveSearchProvider(env.BRAVE_SEARCH_API_KEY, logger, 1100, 20, searchBudget)
            : null;
        const reportPath = join(findRepoRoot(), "data", "reports", "name-only-review");
        const result = await runNameOnly(
          { db, fetcher: liveFetcher, store, logger },
          {
            searchBudget,
            search,
            dryRun: values["dry-run"],
            reportPath,
            ...(values.limit ? { limit: req(values.limit) } : {}),
          },
        );
        console.table(result.counters);
        const byBucket: Record<string, { total: number; resolved: number; review: number }> = {};
        for (const e of result.entries) {
          const b = (byBucket[e.bucket] ??= { total: 0, resolved: 0, review: 0 });
          b.total++;
          if (e.resolved) b.resolved++;
          if (e.manualReview) b.review++;
        }
        console.table(byBucket);
        console.log(`Report: ${reportPath}.md / .json`);
        break;
      }
      case "recruiting": {
        const before = await recruitingCoverage(db, new Date());
        if (values["audit-only"]) {
          const issues = await auditRecruiting(db, { now: new Date(), apply: !values["dry-run"] });
          const affected = [...new Set(issues.map((i) => i.clubId))];
          if (affected.length && !values["dry-run"]) await resolveClubs(db, { clubIds: affected, now: new Date() });
          console.table(issues.map((i) => ({ kind: i.kind, club: i.slug, term: i.termKey, detail: i.detail })));
          console.log(`${issues.length} issue(s)${values["dry-run"] ? " [dry-run: nothing rejected]" : " rejected"}`);
          break;
        }
        const searchBudget = num(values["search-budget"]) ?? 0;
        const search =
          searchBudget > 0 && env.BRAVE_SEARCH_API_KEY
            ? new BraveSearchProvider(env.BRAVE_SEARCH_API_KEY, logger, 1100, 20, searchBudget)
            : null;
        if (searchBudget > 0 && !search) console.log("No BRAVE_SEARCH_API_KEY: search fallback disabled.");
        const provider = values["no-ai"]
          ? null
          : new AnthropicProvider(env.EXTRACTION_MODEL, env.EXTRACTION_EFFORT as Effort);
        const result = await runRecruiting(
          { db, fetcher: liveFetcher, store, logger },
          {
            ...(values.club ? { clubSlug: values.club } : {}),
            ...(values.limit ? { limit: req(values.limit) } : {}),
            missingOnly: values["missing-only"],
            staleOnly: values["stale-only"],
            searchBudget,
            search,
            llm: provider ? { provider, budgetUsd: num(values.budget) ?? 1, dryRun: false } : null,
            dryRun: values["dry-run"],
            ...(values.concurrency ? { concurrency: req(values.concurrency) } : {}),
          },
        );
        if (values["dry-run"]) {
          console.table(result.planned.slice(0, 60));
          console.log(
            `${result.planned.length} club(s) would be examined; ${result.issues.length} audit issue(s) found`,
          );
          break;
        }
        const after = await recruitingCoverage(db, new Date());
        console.log(`\nRun ${result.runId}`);
        console.table(result.counters);
        console.log(
          `Paid searches: ${result.counters.searches} (cache hits ${result.counters.searchCacheHits}); LLM: ${result.counters.llmCalls} calls, $${result.counters.llmCostUsd}`,
        );
        console.table(
          Object.fromEntries(
            Object.keys(before).map((k) => [
              k,
              { before: before[k as keyof typeof before], after: after[k as keyof typeof after] },
            ]),
          ),
        );
        if (result.issues.length)
          console.table(
            result.issues.slice(0, 40).map((i) => ({ kind: i.kind, club: i.slug, term: i.termKey, detail: i.detail })),
          );
        if (result.errors.length) console.log(`Errors (first 20):\n  ${result.errors.slice(0, 20).join("\n  ")}`);
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
      case "link-graph": {
        const result = await runLinkGraph(
          { db, fetcher: liveFetcher, store, logger },
          { dryRun: values["dry-run"], fetch: num(values.fetch) ?? 0 },
        );
        console.table(result.counters);
        for (const a of result.accepted) console.log(`  + ${a.slug}: ${a.site}  ("${a.quote}")`);
        for (const s of result.socials) console.log(`  @ ${s.slug}: ${s.url}`);
        console.log(`${result.review.length} lead(s) for review. Report: ${result.reportPath}`);
        break;
      }
      case "page-text": {
        // A page's text exactly as the pipeline reads it (ADR 0044): copy quotes for
        // curated/facts.ts from here. One request; robots.txt and the SSRF guard apply.
        const url = positionals[1];
        if (!url) throw new Error("usage: page-text <url>");
        const unsafe = await unsafeTargetReason(url, systemResolver);
        if (unsafe) throw new Error(`refusing ${url}: ${unsafe}`);
        const u = new URL(url);
        const headers = { "user-agent": env.userAgent };
        const robots = await fetch(`${u.origin}/robots.txt`, { headers }).then(
          (r) => (r.ok ? r.text() : ""),
          () => "",
        );
        if (!parseRobots(robots, env.CRAWLER_USER_AGENT).allows(u.pathname + u.search)) {
          console.error(`robots.txt disallows ${url}`);
          process.exitCode = 2;
          break;
        }
        const res = await fetch(url, { headers, redirect: "follow", signal: AbortSignal.timeout(20_000) });
        console.error(`${res.status} ${res.url}`);
        console.log(htmlToDocument(await res.text(), res.url).text);
        break;
      }
      case "instagram-login": {
        // Opens a visible Chrome window with the saved profile on Instagram's login page. The
        // owner signs in there by hand (we never see or type the password) and closes the window;
        // `instagram-followers --signed-in` then reuses the session.
        const { chromium } = await import("playwright-core");
        const ctx = await chromium.launchPersistentContext(instagramProfileDir(), {
          channel: "chrome",
          headless: false,
        });
        const page = ctx.pages()[0] ?? (await ctx.newPage());
        await page.goto("https://www.instagram.com/accounts/login/");
        console.log(`Sign in to Instagram in the Chrome window, then close it. Profile: ${instagramProfileDir()}`);
        await new Promise<void>((done) => ctx.on("close", () => done()));
        console.log("Saved. Run: pnpm hci instagram-followers --signed-in [--missing-logo]");
        break;
      }
      case "instagram-followers": {
        // Owner exception to §21 (ADR 0046 amendment): public follower counts only, read slowly
        // from public profile pages in installed Chrome, stopping at the first block.
        if (/^(off|0|false|no)$/i.test((env.HCI_INSTAGRAM ?? "").trim())) {
          console.log("HCI_INSTAGRAM=off: Instagram profiles are not read");
          break;
        }
        const file = values.out
          ? resolve(process.env.INIT_CWD ?? process.cwd(), values.out)
          : join(findRepoRoot(), "data", "imports", "instagram-followers.json");
        const clubs = values.club
          ?.split(",")
          .map((c) => c.trim())
          .filter(Boolean);
        const limit = num(values.limit);
        const c = await collectInstagramFollowers(
          {
            db,
            logger,
            // --signed-in: the Chrome profile the owner signed in to (`instagram-login`; ADR 0050
            // amendment). Same pace and the same stop at any login, challenge or rate-limit sign.
            openReader: () =>
              createChromeRenderer(null, {
                waitUntil: "domcontentloaded",
                locale: "en-US",
                ...(values["signed-in"] ? { profileDir: instagramProfileDir(), headless: false } : {}),
              }),
            store,
          },
          {
            file,
            missingLogo: values["missing-logo"],
            ...(limit !== undefined ? { limit } : {}),
            ...(clubs?.length ? { clubs } : {}),
            dryRun: values["dry-run"],
          },
        );
        for (const o of c.outcomes) console.log(`${o.slug} @${o.handle}  ${o.result}`);
        console.log(
          `${values["dry-run"] ? "[dry-run] " : ""}${c.targets.length} profiles planned, ${c.outcomes.length} ${values["dry-run"] ? "listed" : "read"}, ${c.saved} counts saved to ${file}`,
        );
        if (c.stopped) {
          console.error(`Stopped: ${c.stopped}. Nothing was retried; run again another day.`);
          process.exitCode = 2;
        }
        const r = await runInstagramFollowers({ db, store, logger }, { file, dryRun: values["dry-run"] });
        const skipped = r.outcomes.filter((o) => o.result.startsWith("skipped") || o.result.startsWith("error"));
        for (const o of skipped) console.log(`import: ${o.slug} @${o.handle}  ${o.result}`);
        console.log(
          `import${values["dry-run"] ? " [dry-run]" : ""}: ${r.written} claims written or confirmed, ${r.skipped} skipped, ${r.rejected} earlier claim(s) rejected by the account check`,
        );
        if (!values["dry-run"]) {
          // Profile pictures the import made logos are served from our own copies (ADR 0050).
          const f = await writeLogoFiles(db, store, logoFilesDir());
          console.log(`logo files: ${f.written} written, ${f.kept} kept, ${f.removed} removed`);
        }
        if (r.outcomes.some((o) => o.result.startsWith("error"))) process.exitCode = 1;
        break;
      }
      case "import-instagram-followers": {
        if (!args[0]) throw new Error("usage: import-instagram-followers <file.json> [--dry-run]");
        const file = resolve(process.env.INIT_CWD ?? process.cwd(), args[0]);
        const r = await runInstagramFollowers({ db, store, logger }, { file, dryRun: values["dry-run"] });
        const skipped = r.outcomes.filter((o) => o.result.startsWith("skipped") || o.result.startsWith("error"));
        for (const o of skipped) console.log(`${o.slug} @${o.handle}  ${o.result}`);
        console.log(
          `${values["dry-run"] ? "[dry-run] " : ""}Run ${r.runId}: ${r.outcomes.length} entries, ${r.written} claims written or confirmed, ${r.skipped} skipped, ${r.rejected} earlier claim(s) ${values["dry-run"] ? "would be " : ""}rejected by the account check`,
        );
        const pictures = r.outcomes.filter((o) => o.result.includes("; picture ")).length;
        if (pictures) console.log(`${pictures} profile picture(s) considered as logos`);
        if (!values["dry-run"]) {
          const f = await writeLogoFiles(db, store, logoFilesDir());
          console.log(`logo files: ${f.written} written, ${f.kept} kept, ${f.removed} removed`);
        }
        if (r.outcomes.some((o) => o.result.startsWith("error"))) process.exitCode = 1;
        break;
      }
      case "logo-files": {
        const f = await writeLogoFiles(db, store, logoFilesDir());
        console.log(
          `logo files in ${logoFilesDir()}: ${f.written} written, ${f.kept} kept, ${f.removed} removed${f.missing.length ? `; no kept copy for ${f.missing.join(", ")}` : ""}`,
        );
        break;
      }
      case "facts": {
        const slugs = values.club
          ?.split(",")
          .map((s) => s.trim())
          .filter(Boolean);
        const result = await runFacts(
          { db, fetcher: liveFetcher, store, logger },
          {
            dryRun: values["dry-run"],
            ...(slugs?.length ? { slugs } : {}),
            // --file=batch.json: entries to check (or write) instead of the committed list.
            ...(values.file ? { entries: JSON.parse(readFileSync(values.file, "utf8")) as CuratedFactsEntry[] } : {}),
          },
        );
        for (const o of result.outcomes) console.log(`${o.slug}  ${o.result}`);
        if (result.errors.length) process.exitCode = 1;
        break;
      }
      case "logos": {
        const slugs = values.club
          ?.split(",")
          .map((s) => s.trim())
          .filter(Boolean);
        const imageFetcher = new PoliteHttpFetcher({
          userAgent: env.userAgent,
          minIntervalMs: env.CRAWLER_MIN_INTERVAL_MS,
          logger,
          allowedContentTypes: IMAGE_CONTENT_TYPES,
          accept: "image/avif,image/webp,image/png,image/svg+xml,image/*;q=0.8",
          maxBytes: 8 * 1024 * 1024,
        });
        const result = await runLogos(
          { db, fetcher: values.offline ? new NoNetworkFetcher() : imageFetcher, store, logger },
          {
            offline: values.offline,
            reprobe: values.reprobe,
            dryRun: values["dry-run"],
            ...(slugs?.length ? { slugs } : {}),
          },
        );
        for (const o of result.outcomes)
          if (o.changed || slugs?.length) {
            console.log(`${o.changed ? "*" : " "} ${o.slug.padEnd(50)} ${o.kind ?? "-"}  ${o.logo ?? "(none)"}`);
            if (slugs?.length) for (const s of o.skipped) console.log(`      passed over: ${s}`);
          }
        const withLogo = result.outcomes.filter((o) => o.logo).length;
        console.log(
          `${withLogo}/${result.outcomes.length} club sites have a logo; ${result.outcomes.filter((o) => o.changed).length} changed; ${result.probed} images measured`,
        );
        for (const e of result.errors) console.log(`  ✗ ${e}`);
        if (result.errors.length) process.exitCode = 1;
        break;
      }
      case "lifecycle": {
        // --candidates: sentences on stored pages that say a club ended or was renamed (no network).
        if (values.candidates) {
          const { leads, path } = await lifecycleCandidates(db);
          console.log(`${leads.length} leads. Report: ${path}`);
          break;
        }
        const result = await runLifecycle({ db, fetcher: liveFetcher, store, logger }, { dryRun: values["dry-run"] });
        console.table(result.outcomes);
        if (result.errors.length) process.exitCode = 1;
        break;
      }
      case "enrich": {
        const llmEnabled = values.llm || values["llm-dry-run"];
        const provider = llmEnabled
          ? new AnthropicProvider(env.EXTRACTION_MODEL, env.EXTRACTION_EFFORT as Effort)
          : null;
        const offline = values.offline;
        if (offline && values.browser) throw new Error("--offline reads stored pages only; drop --browser");
        const renderer = values.browser ? await createChromeRenderer(env.userAgent) : null;
        const fetcher = offline
          ? new NoNetworkFetcher()
          : renderer
            ? new BrowserFallbackFetcher(liveFetcher, renderer, { minIntervalMs: env.CRAWLER_MIN_INTERVAL_MS, logger })
            : liveFetcher;
        const result = await runEnrichment(
          { db, fetcher, store, logger },
          {
            ...(values.club ? { clubSlug: values.club } : {}),
            ...(values.limit ? { limit: req(values.limit) } : {}),
            staleOnly: values["stale-only"],
            force: values.force,
            ...(values["freshness-hours"] ? { freshnessHours: req(values["freshness-hours"]) } : {}),
            ...(values["max-pages"] ? { maxPages: req(values["max-pages"]) } : {}),
            ...(values["max-depth"] ? { maxDepth: req(values["max-depth"]) } : {}),
            ...(values.concurrency ? { concurrency: req(values.concurrency) } : {}),
            llm: provider
              ? { provider, dryRun: values["llm-dry-run"], budgetUsd: num(values.budget) ?? env.EXTRACTION_BUDGET_USD }
              : null,
            browser: renderer !== null,
            offline,
            ...(values["recruiting-freshness-hours"]
              ? { recruitingFreshnessHours: req(values["recruiting-freshness-hours"]) }
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
      case "check-forms": {
        const result = await runCheckForms(
          { db, fetcher: liveFetcher, store, logger },
          {
            ...(values.club ? { clubSlug: values.club } : {}),
            ...(values["stale-days"] ? { staleDays: req(values["stale-days"]) } : {}),
            ...(values.limit ? { limit: req(values.limit) } : {}),
            dryRun: values["dry-run"],
          },
        );
        console.log(
          `${values["dry-run"] ? "[dry-run] would check" : "Checked"} ${result.fetched} of ${result.considered} forms` +
            (values["dry-run"] ? "" : ` (${result.failed} unreachable)`),
        );
        for (const c of result.closed) console.log(`  closed: ${c.slug}  ${c.url}`);
        if (result.closed.length) console.log("Run `pnpm hci audit --apply` to reject the closed forms.");
        break;
      }
      case "reconcile": {
        const result = await runReconcile({ db, logger }, { dryRun: values["dry-run"] });
        console.log(`\nRun ${result.runId}: ${result.status}`);
        console.table(result.counters);
        for (const m of result.merges.slice(0, 50)) console.log(`  ${m}`);
        // Scripts must not publish a half-resolved database (refresh.sh runs under set -e).
        if (result.status !== "succeeded") process.exitCode = 1;
        break;
      }
      case "resolve": {
        // --diff: list every displayed value the re-resolve changes (data/reports/projection-diff.md).
        if (values.diff) await saveProjection(db, "pre-resolve");
        const stats = await resolveClubs(db, {
          onError: (id, e) => logger.error({ clubId: id, error: String(e) }, "resolve failed"),
        });
        console.log(`Resolved ${stats.clubs} clubs (${stats.failed} failed)`);
        if (stats.failed > 0) process.exitCode = 1;
        if (values.diff) {
          const { changes, reportPath } = await diffAgainstSaved(db, "pre-resolve");
          console.log(`${changes.length} displayed values changed. Report: ${reportPath}`);
        }
        break;
      }
      case "projection": {
        const name = values.name ?? "latest";
        if (args[0] === "save") console.log(`Saved ${await saveProjection(db, name)}`);
        else if (args[0] === "diff") {
          const { changes, reportPath, markdown } = await diffAgainstSaved(db, name);
          console.log(markdown.split("\n| Club |")[0]);
          console.log(`${changes.length} changes. Report: ${reportPath}`);
        } else throw new Error("usage: projection save|diff [--name=latest]");
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
      case "audit": {
        const reportPath = join(findRepoRoot(), "data", "reports", "audit");
        const result = await runAudit(db, {
          now: new Date(),
          apply: values.apply || Boolean(values["apply-only"]),
          ...(values["apply-only"] ? { applyOnly: values["apply-only"].split(",").map((c) => c.trim()) } : {}),
          reportPath,
          ...(values["check-urls"] ? { urlStatus: politeUrlStatus(env.userAgent) } : {}),
          ...(values.check ? { only: values.check.split(",").map((c) => c.trim()) } : {}),
        });
        const m = result.metrics;
        console.table({
          ...m,
          completeness: JSON.stringify(m.completeness),
          bySeverity: JSON.stringify(m.bySeverity),
          byArea: JSON.stringify(m.byArea),
        });
        const byCheck: Record<string, { findings: number; highConfidence: number; fixable: number }> = {};
        for (const f of result.findings) {
          const c = (byCheck[f.check] ??= { findings: 0, highConfidence: 0, fixable: 0 });
          c.findings++;
          if (f.confidence === "high") c.highConfidence++;
          if (f.fix && f.confidence === "high") c.fixable++;
        }
        console.table(byCheck);
        if (result.applied) console.log("Applied:", result.applied);
        else console.log("Report only (pass --apply to fix high-confidence findings).");
        console.log(`Report: ${reportPath}.md / .json`);
        // --fail-on=critical|high: exit 1 when a finding at or above that severity remains
        // (publish-pages.sh gates on critical; a dead link alone never blocks a publish).
        if (values["fail-on"]) {
          const order = ["low", "medium", "high", "critical"];
          const min = order.indexOf(values["fail-on"]);
          if (min < 0) throw new Error(`--fail-on expects one of ${order.join(", ")}`);
          const blocking = result.findings.filter((f) => order.indexOf(f.severity) >= min);
          if (blocking.length) {
            console.log(`${blocking.length} finding(s) at or above "${values["fail-on"]}":`);
            for (const f of blocking.slice(0, 20)) console.log(`  ${f.severity} ${f.check} ${f.slug}: ${f.detail}`);
            process.exitCode = 1;
          }
        }
        break;
      }
      case "audit-dismiss": {
        const [slug, check, ...rest] = args;
        const subject = rest.join(" ") || "*";
        if (!slug || !check || !values.reason)
          throw new Error('usage: audit-dismiss <slug> <check> [subject] --reason="…"');
        const [row] = await db.select({ id: schema.club.id }).from(schema.club).where(eq(schema.club.slug, slug));
        if (!row) throw new Error(`no club ${slug}`);
        await dismissFinding(db, { clubId: row.id, check, subject, reason: values.reason, actor: "cli" });
        console.log(`Dismissed ${check} on ${slug}${subject === "*" ? "" : ` (${subject})`}`);
        break;
      }
      case "reject-link": {
        const [slug, url] = args;
        if (!slug || !url || !values.reason) throw new Error('usage: reject-link <slug> <url> --reason="…"');
        const [row] = await db.select({ id: schema.club.id }).from(schema.club).where(eq(schema.club.slug, slug));
        if (!row) throw new Error(`no club ${slug}`);
        const target = normalizeUrl(url) ?? url;
        const claims = await db
          .select({ id: schema.claim.id, value: schema.claim.value })
          .from(schema.claim)
          .where(
            and(
              // Claims stay on the club that made them; include clubs merged into this one.
              inArray(schema.claim.clubId, await clubFamily(db, row.id)),
              eq(schema.claim.fieldKey, "club.link"),
              eq(schema.claim.status, "active"),
            ),
          );
        const ids = claims
          .filter((c) => {
            const u = (c.value as { url?: string }).url ?? "";
            return (normalizeUrl(u) ?? u) === target;
          })
          .map((c) => c.id);
        if (ids.length === 0) throw new Error(`no active link ${url} on ${slug}`);
        await rejectClaims(db, { claimIds: ids, actor: "cli", reason: values.reason });
        console.log(`Rejected ${ids.length} claim(s) for ${url} on ${slug}`);
        // A website that isn't the club's: what its pages said about the club goes too.
        const site = siteKey(url);
        const isWebsite = claims.some((c) => ids.includes(c.id) && (c.value as { kind?: string }).kind === "website");
        if (isWebsite && site) {
          const r = await disownSite(db, {
            clubIds: await clubFamily(db, row.id),
            site,
            actor: "cli",
            reason: `from ${site}, which is not this club's site: ${values.reason}`,
          });
          console.log(
            `  ${r.sources} page(s) of ${site} no longer count as the club's; ${r.claimsRejected} claim(s) only they supported rejected`,
          );
        }
        await resolveClubs(db, { clubIds: [row.id] });
        break;
      }
      case "reject-value": {
        const [slug, field, raw] = args;
        if (!slug || !field || raw === undefined || !values.reason)
          throw new Error('usage: reject-value <slug> <field> <json|text> --reason="…"');
        if (!isFieldKey(field)) throw new Error(`unknown field ${field}`);
        let value: unknown = raw;
        try {
          value = JSON.parse(raw);
        } catch {
          // plain text value
        }
        const parsed = parseFieldValue(field, value);
        if (!parsed.ok) throw new Error(`${field}: ${parsed.error}`);
        const [row] = await db.select({ id: schema.club.id }).from(schema.club).where(eq(schema.club.slug, slug));
        if (!row) throw new Error(`no club ${slug}`);
        const want = stableStringify(parsed.normalized);
        const claims = await db
          .select({ id: schema.claim.id, normalized: schema.claim.normalizedValue })
          .from(schema.claim)
          .where(
            and(
              inArray(schema.claim.clubId, await clubFamily(db, row.id)),
              eq(schema.claim.fieldKey, field),
              eq(schema.claim.status, "active"),
            ),
          );
        const ids = claims.filter((c) => stableStringify(c.normalized) === want).map((c) => c.id);
        if (ids.length === 0) throw new Error(`no active ${field} = ${raw} on ${slug}`);
        await rejectClaims(db, { claimIds: ids, actor: "cli", reason: values.reason });
        await resolveClubs(db, { clubIds: [row.id] });
        console.log(`Rejected ${ids.length} claim(s) of ${field} = ${raw} on ${slug}`);
        break;
      }
      case "restore-value": {
        // Undo reject-value: rejected claims of one value become active again (audited).
        const [slug, field, raw] = args;
        if (!slug || !field || raw === undefined || !values.reason)
          throw new Error('usage: restore-value <slug> <field> <json|text> --reason="…"');
        if (!isFieldKey(field)) throw new Error(`unknown field ${field}`);
        let value: unknown = raw;
        try {
          value = JSON.parse(raw);
        } catch {
          // plain text value
        }
        const parsed = parseFieldValue(field, value);
        if (!parsed.ok) throw new Error(`${field}: ${parsed.error}`);
        const [row] = await db.select({ id: schema.club.id }).from(schema.club).where(eq(schema.club.slug, slug));
        if (!row) throw new Error(`no club ${slug}`);
        const want = stableStringify(parsed.normalized);
        const claims = await db
          .select({ id: schema.claim.id, normalized: schema.claim.normalizedValue })
          .from(schema.claim)
          .where(
            and(
              inArray(schema.claim.clubId, await clubFamily(db, row.id)),
              eq(schema.claim.fieldKey, field),
              eq(schema.claim.status, "rejected"),
            ),
          );
        const ids = claims.filter((c) => stableStringify(c.normalized) === want).map((c) => c.id);
        if (ids.length === 0) throw new Error(`no rejected ${field} = ${raw} on ${slug}`);
        await restoreClaims(db, { claimIds: ids, actor: "cli", reason: values.reason });
        await resolveClubs(db, { clubIds: [row.id] });
        console.log(`Restored ${ids.length} claim(s) of ${field} = ${raw} on ${slug}`);
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
        // Default: the version this checkout's extractor is at.
        const current: Record<string, string> = {
          [DETERMINISTIC_EXTRACTOR.name]: DETERMINISTIC_EXTRACTOR.version,
          [SCOPE_EXTRACTOR.name]: SCOPE_EXTRACTOR.version,
        };
        const version = values.version ?? (extractor ? current[extractor] : undefined);
        if (!extractor || !version)
          throw new Error(
            "usage: retract-unreproduced --extractor=<name> [--version=<current-version>] [--field=a,b] [--only-restated] [--dry-run]",
          );
        const { claimIds } = await retractUnreproducedClaims(db, {
          extractorName: extractor,
          currentVersion: version,
          actor: "cli",
          reason: `not reproduced after re-running ${extractor} with a newer version`,
          dryRun: values["dry-run"],
          ...(values.field ? { fieldKeys: values.field.split(",").map((f) => f.trim()) } : {}),
          onlyRestated: values["only-restated"],
        });
        console.log(`${values["dry-run"] ? "[dry-run] would retract" : "Retracted"} ${claimIds.length} claims`);
        // Each one, so a dry run can be read before the real run (§23 rule 10).
        if (claimIds.length) {
          const listed = (await db.execute(sql`
            select c.slug, cl.field_key as field, left(cl.value::text, 120) as value
            from claim cl join club c on c.id = cl.club_id
            where cl.id in (${sql.join(
              claimIds.map((i) => sql`${i}`),
              sql`, `,
            )})
            order by c.slug, cl.field_key`)) as unknown as { slug: string; field: string; value: string }[];
          for (const r of listed) console.log(`  ${r.slug}  ${r.field}  ${r.value}`);
        }
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
      case "coverage": {
        const { markdown, path } = await coverageReport(db);
        console.log(markdown);
        console.log(`Report: ${path}`);
        break;
      }
      case "recruiting-review": {
        const { rows, path } = await recruitingReview(db, new Date());
        const warned = rows.filter((r) => r.warnings.length);
        console.log(`${rows.length} live cycles, ${warned.length} with warnings`);
        for (const r of warned) console.log(`  ${r.slug} ${r.term}: ${r.warnings.join("; ")}`);
        console.log(`Report: ${path}`);
        break;
      }
      case "backup": {
        // Logical database backup (gzipped NDJSON per table + manifest); no network, read-only.
        const dir =
          values.out ??
          join(findRepoRoot(), "data", "backups", new Date().toISOString().slice(0, 19).replace(/:/g, ""), "db");
        const m = await backupDatabase(db, dir);
        console.log(`Backed up ${m.tables.length} tables (${m.tables.reduce((n, t) => n + t.rows, 0)} rows) to ${dir}`);
        break;
      }
      case "restore": {
        if (!args[0]) throw new Error("usage: restore <backup-dir>   (into an EMPTY, migrated database only)");
        const done = await restoreDatabase(db, resolve(process.env.INIT_CWD ?? process.cwd(), args[0]));
        console.log(`Restored ${done.length} tables (${done.reduce((n, t) => n + t.rows, 0)} rows)`);
        break;
      }
      case "queue": {
        const { markdown, path } = await missingQueue(db, values.limit ? { limit: req(values.limit) } : {});
        console.log(markdown.split("\n## ")[0]);
        console.log(`Full list: ${path}`);
        break;
      }
      case "snapshots": {
        if (args[0] === "verify") {
          const r = await verifySnapshots(db, env.snapshotDir);
          console.log(
            `${r.checked} snapshot files checked: ${r.missing.length} missing, ${r.corrupt.length} unreadable, ${r.hashMismatch.length} with a wrong hash, ${r.orphanFiles.length} files no row refers to (kept)`,
          );
          for (const k of [...r.missing, ...r.corrupt, ...r.hashMismatch].slice(0, 20)) console.log(`  ✗ ${k}`);
          if (r.missing.length || r.corrupt.length || r.hashMismatch.length) process.exitCode = 1;
          break;
        }
        if (args[0] !== "search" || !args[1])
          throw new Error(
            'usage: snapshots search <regex> [--missing=<field>] [--limit=N]   e.g. snapshots search "first-years"',
          );
        console.log(
          await snapshotSearch(db, new RegExp(args[1], "i"), {
            ...(values.missing ? { missing: values.missing } : {}),
            ...(values.limit ? { limit: req(values.limit) } : {}),
          }),
        );
        break;
      }
      case "opportunities": {
        const { markdown, path } = await opportunitiesReport(db, values.field ? { field: values.field } : {});
        console.log(markdown.split("\n## ")[0]);
        console.log(`Report: ${path}`);
        break;
      }
      case "privacy-scan": {
        // Relative paths are the caller's (pnpm runs this from packages/pipeline).
        const dir = args[0]
          ? resolve(process.env.INIT_CWD ?? process.cwd(), args[0])
          : join(findRepoRoot(), "apps", "web", "out");
        const { files, findings } = privacyScan(dir);
        for (const f of findings) console.log(`${f.kind.padEnd(15)} ${f.file}  ${f.detail}`);
        console.log(`${findings.length} finding(s) in ${files} files under ${dir}`);
        if (findings.length) process.exitCode = 1;
        break;
      }
      case "explain": {
        if (!args[0])
          throw new Error("usage: explain <slug> [field…]   e.g. explain harvard-lampoon club.member_count");
        console.log(await explainClub(db, args[0], args.slice(1)));
        break;
      }
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
