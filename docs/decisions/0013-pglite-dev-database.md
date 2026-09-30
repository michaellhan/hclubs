# 0013: Zero-install development database (PGlite) alongside real Postgres

**Status:** accepted (M1)

## Context

Contributors, and this machine, may not have Docker or Postgres installed. The app and pipeline should run against real Postgres semantics (pg_trgm, tsvector, NULLS NOT DISTINCT constraints), not SQLite or mocks.

## Decision

- Application code talks to Postgres only through `postgres-js` and a `DATABASE_URL`, with `prepare: false`. There is one driver path for dev and prod.
- `pnpm db:start` runs PGlite (Postgres compiled to WASM) persisted in `data/pglite`, behind a small wire-protocol server (`packages/db/scripts/pglite-server.ts`). The server runs each connection's messages up to Sync/Query as an atomic batch and holds the single session while a connection is in a transaction. We wrote our own server because `@electric-sql/pglite-socket` multiplexes per message, which interleaves concurrent extended-protocol queries ("unnamed prepared statement does not exist").
- Integration tests use in-process PGlite (`@hci/db/testing`) with all migrations applied.
- `docker-compose.yml` provides real Postgres 17 on the same port for production-like testing.

## Consequences

- `git clone && pnpm install && pnpm db:start` gives a working database.
- The dev server serializes queries, which is fine at dev scale. It is not for production.
- `prepare: false` also keeps us compatible with transaction poolers (Neon, Supabase).
