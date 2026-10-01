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
pnpm --filter @hci/web preview                # look at http://127.0.0.1:4173
scripts/publish-pages.sh michaellhan/hci ""   # build + publish to https://hclubs.app/
```

After publishing, open a club page, the directory and `/compare` on the live site. GitHub Pages caches files for 10 minutes.
