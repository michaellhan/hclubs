# data/

Local-only artifacts. Everything here except this README is gitignored.

- `pglite/` — PGlite dev database (`pnpm db:start`)
- `snapshots/` — raw fetched source snapshots (content-addressed, gzip), written by the pipeline

Do not commit scraped datasets. See CLAUDE.md §19 and §21.
