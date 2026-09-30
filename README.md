# Harvard Club Index

A searchable, evidence-backed index of Harvard student organizations: what they do, how to join, when applications close, and how much time they take. Every fact links to its source and shows how fresh it is. Missing information is shown as **Unknown**, never guessed.

> Independent student project; not affiliated with Harvard University.
> Product and engineering spec: [`CLAUDE.md`](CLAUDE.md). Internals: [`docs/architecture.md`](docs/architecture.md), [`docs/data-model.md`](docs/data-model.md).

## Stack

- **Web:** Next.js 16 (App Router, Server Components), React 19, TypeScript (strict), Tailwind CSS 4
- **Database:** PostgreSQL (`pg_trgm` + full-text search), Drizzle ORM, `postgres-js`
- **Validation:** Zod at every boundary (env, URL params, fetched data, claim values)
- **Ingestion:** TypeScript pipeline with native `fetch`, Cheerio, pino logging, and a content-addressed snapshot store
- **Tests:** Vitest. Integration tests run against real Postgres semantics via in-process PGlite.
- **Tooling:** pnpm workspaces, ESLint (typescript-eslint + Next), Prettier

## Repository layout

```
apps/web/                  Next.js app: /, /clubs, /clubs/[slug], /compare
packages/core/             Pure domain logic: field registry, value schemas, normalization,
                           entity matching, confidence, resolver, recruiting status, selectivity
packages/db/               Drizzle schema + migrations, claim/source writers, projection writer,
                           search provider, display queries, taxonomy + fixture seed, dev DB server
packages/pipeline/         Ingestion: adapters, polite fetcher, robots.txt, snapshot store,
                           entity resolution, discovery orchestration, CLI
  src/adapters/<name>/     One folder per source (see docs/sources/<name>.md)
  test/fixtures/           Saved pages for offline, deterministic adapter tests
docs/                      architecture, data model, source notes, decision records (ADRs)
data/                      Local-only: dev database, raw snapshots (gitignored)
```

## Local setup

Requirements: **Node 24+** and **pnpm** (`corepack enable pnpm`). Docker is optional.

```bash
pnpm install
cp .env.example .env
```

### Database

**Option A: zero-install (default).** PGlite (Postgres compiled to WASM) is exposed on `127.0.0.1:54320` and its data is stored in `data/pglite/`. Keep this running in its own terminal:

```bash
pnpm db:start
```

**Option B: Docker Postgres.** Start it, then set `DATABASE_URL=postgres://postgres:postgres@127.0.0.1:54320/postgres` in `.env`:

```bash
docker compose up -d
```

Then apply the migrations and load the seed data:

```bash
pnpm db:migrate
pnpm db:seed
```

`db:seed` loads the category taxonomy plus **21 fictional demo clubs**. Demo clubs have slugs starting with `fixture-`, carry a "Demo data" label in the UI, and use sources on the reserved `.invalid` domain. They are loaded through the same claims → resolver path as real data. The script refuses to load fixtures into non-local databases; `pnpm db:seed --taxonomy-only` is the production-safe variant.

To drop everything and re-run the migrations (local databases only):

```bash
pnpm db:reset
```

### Run the app

```bash
pnpm dev
```

Then open http://localhost:3000.

### Ingest real data

```bash
pnpm hci adapters                          # list discovery adapters
pnpm hci parse pbha-programs               # parse saved fixtures only (no DB, no network)
pnpm hci discover pbha-programs --offline  # full pipeline against saved fixtures
pnpm hci discover pbha-programs            # live, polite crawl of pbha.org/programs
pnpm hci resolve                           # rebuild all projections from claims
pnpm hci runs                              # recent ingestion runs and counters
```

Live runs honor robots.txt, identify themselves (`CRAWLER_USER_AGENT` / `CRAWLER_CONTACT`), wait at least 2s between requests to a host, and use conditional GETs. Re-running is idempotent. Raw snapshots go to `data/snapshots/`.

> The script is `hci`, not `pipeline`, because pnpm 12 has a built-in `pnpm pipeline` command.

## Environment variables

See [`.env.example`](.env.example). Env is validated with Zod at startup.

| Variable                                | Used by    | Purpose                                                 |
| --------------------------------------- | ---------- | ------------------------------------------------------- |
| `DATABASE_URL`                          | all        | Postgres connection string (required)                   |
| `PGLITE_PORT`                           | `db:start` | Port for the PGlite dev server (default 54320)          |
| `SNAPSHOT_DIR`                          | pipeline   | Raw snapshot store directory (default `data/snapshots`) |
| `CRAWLER_USER_AGENT`, `CRAWLER_CONTACT` | pipeline   | Honest crawler identification                           |
| `CRAWLER_MIN_INTERVAL_MS`               | pipeline   | Minimum delay per host (≥1000, default 2000)            |
| `LOG_LEVEL`                             | pipeline   | pino log level                                          |

## Migrations

After changing `packages/db/src/schema/index.ts`, generate a migration, review the SQL and commit it, then apply it:

```bash
pnpm db:generate
pnpm db:migrate
```

Never edit a migration that has already been applied.

## Tests and checks

| Command          | What it runs                                                                            |
| ---------------- | --------------------------------------------------------------------------------------- |
| `pnpm test`      | All Vitest suites: unit, fixture and integration (in-process Postgres, no setup needed) |
| `pnpm typecheck` | `tsc` in every package                                                                  |
| `pnpm lint`      | ESLint with zero warnings allowed                                                       |
| `pnpm build`     | Next.js production build                                                                |
| `pnpm check`     | All of the above                                                                        |

The tests cover:

- normalization, URL and social handles, entity matching edge cases
- resolver rules (conflicts, staleness, inference, editorial overrides), cycle status and time zones, selectivity
- the robots.txt parser and polite fetcher (retries, 304s, blocks)
- the PBHA adapter against saved pages
- end-to-end ingestion idempotency, and search, filters and profiles against real SQL

## Principles (short version)

- **Evidence first.** Every fact is a claim with provenance: source, snapshot, quote, observed date, method, confidence.
- **Missing means unknown.** No invented member counts, acceptance rates, deadlines or time commitments.
- **Raw data is immutable.** Snapshots are write-once. Display tables are rebuilt from claims.
- **Computed ≠ stated ≠ derived,** and the UI labels each one.
- **Time matters.** Recruiting facts belong to a term (`2026-fall`), not to the club forever.

See [`CLAUDE.md`](CLAUDE.md) for the full specification and roadmap.
