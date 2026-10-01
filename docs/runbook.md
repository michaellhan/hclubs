# Maintainer runbook

Everything a maintainer needs to rebuild, refresh and publish hclubs from a fresh checkout. The command reference is in `CLAUDE.md` §19; this page gives the order and the things that aren't in git.

## What lives outside git

| Path                                           | What                                                                                                                 | Back it up?                     |
| ---------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- | ------------------------------- |
| `data/pglite/`                                 | **The database**: every claim, source, merge, rejection and editorial decision. The site is built from it.           | **Yes, this is the only copy.** |
| `data/snapshots/`                              | Raw fetched pages (immutable evidence). Rebuildable only by re-crawling, and pages change.                           | Yes                             |
| `data/imports/soco.txt`                        | The owner's hand-saved copy of the College directory (ADR 0030). Never fetched; can't be re-created by the pipeline. | Yes, privately                  |
| `data/published-next-static/`                  | JS/CSS from recent publishes, re-uploaded so open tabs keep working (launch audit).                                  | No                              |
| `.env`                                         | Contact email, form URLs, analytics code, API keys.                                                                  | Yes, privately (secrets)        |
| `data/reports/`, `data/exports/`, `data/logs/` | Generated output.                                                                                                    | No                              |

### Backup and restore

Stop `pnpm db:start` first; PGlite writes its files while running.

```bash
tar czf hclubs-data-$(date +%F).tgz data/pglite data/snapshots data/imports .env
```

To restore on another machine: check out the repo, `pnpm install`, unpack the archive at the repo root, then `pnpm db:start` and `pnpm db:migrate` (applies any newer migrations).

## Working without spending money

`.env` holds real Anthropic and Brave keys, and some commands spend them. For development, inspection and source work, switch every paid API off for the whole shell:

```bash
export HCI_PAID_APIS=off        # Anthropic and Brave providers refuse before any request
```

With the switch off, cached LLM results still replay, cache misses fail cleanly, and search stages stop as if credit ran out. `REFRESH_LLM_BUDGET=0 scripts/refresh.sh` also makes a refresh free.

| Free (local or polite public fetches)                                                                      | May spend Brave credit                                        | May spend Anthropic credit                     |
| ---------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- | ---------------------------------------------- |
| `pnpm check`, `pnpm test`, builds, `privacy-scan`                                                          | `find-sites --search`, `find-sites --instagram`               | `enrich --llm` (budget `--budget`, default $1) |
| `stats`, `coverage`, `audit` (`--apply` too), `explain`, `queue`, `opportunities`, `snapshots search`      | `discover-web --search`                                       | `recruiting` without `--no-ai`                 |
| `enrich --offline` (stored pages only, no requests)                                                        | `press` with `--publisher=crimson` (the default includes it)  | `summarize`, `categorize` (not `--from-names`) |
| `link-graph` (`--fetch=N` fetches home pages politely)                                                     | `name-only --search-budget=N`, `recruiting --search-budget=N` |                                                |
| `lifecycle`, `curate`, `import-soco`, `categorize --from-names`                                            |                                                               |                                                |
| `enrich` without `--llm`, `press --publisher=independent,hpr`, `discover-web --outlinks` (polite crawling) |                                                               |                                                |

Every Brave command is capped by `--max-queries` (default 100); every Anthropic command by its `--budget`. Each attempt is reserved at its worst-case cost before it is sent, and unpriced models are refused.

### Improving sources for free

1. `pnpm hci link-graph --dry-run`: website and account leads from pages already stored; read `data/reports/link-candidates.md`, then run without `--dry-run` (add `--fetch=20` to check unstored home pages).
2. `pnpm hci enrich --club=<slugs>`: crawl newly attached sites (no `--llm`).
3. After an extractor change: bump its version, `pnpm hci enrich --offline`, then `pnpm hci retract-unreproduced --extractor=… --version=…`.
4. An organization that ended: add it to `packages/pipeline/src/curated/lifecycle.ts` with a page and verbatim quotes, then `pnpm hci lifecycle`.
5. `pnpm hci audit`, then `--apply` for the high-confidence fixes.

## Fresh setup without a backup

This rebuilds the index from public sources. Editorial decisions (merges, rejections, dismissals, accepted submissions) are **not** recoverable this way.

```bash
pnpm install
cp .env.example .env              # fill in CONTACT_EMAIL, NEXT_PUBLIC_SITE_URL, form URLs
pnpm db:start                     # keep running in its own terminal
pnpm db:migrate
pnpm db:seed --taxonomy-only      # categories only; never demo clubs in a real database
pnpm ingest:discover              # 13 source adapters, official Harvard pages first
pnpm hci import-soco data/imports/soco.txt   # only if you have the owner's saved copy
pnpm hci curate                   # the editor's club list (packages/pipeline/src/curated/list.ts)
pnpm ingest:find-sites            # add --search to spend Brave credit (capped by --max-queries)
pnpm ingest:enrich                # verify sites, crawl, extract; --llm --budget=N for the LLM pass
pnpm hci recruiting               # targeted recruiting pass
pnpm hci press                    # student-newspaper mentions
pnpm hci summarize --budget=2     # one-line summaries (Anthropic credentials)
pnpm hci categorize --budget=1 && pnpm hci categorize --from-names
pnpm ingest:reconcile             # cross-club duplicates + full re-resolve
pnpm hci audit                    # read data/reports/audit.md; then --apply for high-confidence fixes
pnpm ingest:stats
```

## Routine refresh

```bash
scripts/refresh.sh --no-publish   # crawl what's due, LLM on changed pages ($1 cap), reconcile
pnpm hci audit                    # review; pnpm hci audit --apply for high-confidence fixes
pnpm hci submissions import ~/Downloads/responses.csv && pnpm hci submissions list   # docs/contributions.md
```

## Check, build, publish

```bash
pnpm check                                    # lint, typecheck, tests, build
pnpm hci privacy-scan                         # no personal data in apps/web/out (must print 0 findings)
pnpm --filter @hci/web preview                # look at http://127.0.0.1:4173
scripts/publish-pages.sh michaellhan/hclubs-site ""   # build + publish to https://hclubs.app/
```

`publish-pages.sh` refuses to push unless all of these hold (ADR 0038):

- the target is `PAGES_REPO` (default `michaellhan/hclubs-site`);
- projections rebuild;
- the audit has no critical finding;
- the build has its pages;
- `privacy-scan` is clean.

After publishing, open a club page, the directory and `/compare` on the live site. GitHub Pages caches files for 10 minutes.
