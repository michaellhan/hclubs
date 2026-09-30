# 0022: Publish as a static site; no hosted server or database

**Status:** accepted (launch prep). This supersedes the Vercel + Neon plan.

## Context

The data changes only when the pipeline runs, and the owner prefers not to run hosted infrastructure. The site is small: about 360 clubs, and the index is about 50 KB gzipped. CLAUDE.md §13 already allows a compact client-side index.

## Decision

`next build` produces a static export (`output: "export"`, `trailingSlash`, optional `basePath`), generated from the local database.

- **Prebuilt pages:** club profiles (including retired and merged slugs, which redirect in the browser), categories and the about pages.
- **Data files:** `/data/index.json`, the directory index with search fields and all dated cycles, and `/data/clubs/<slug>.json`, one full profile per club for compare.
- **In the browser:** search, filters, sort, the recruiting board, compare and "recruiting now". This logic lives in `@hci/db/local`, a pure module with no database driver. Parity tests pin it to the Postgres provider and board.
- **Anything depending on "now"** (cycle status, relative dates) is recomputed after mount through `useNow()`, so prebuilt pages never show a stale open/closed state.
- **Corrections** go by email or an external form instead of the `student_submission` server action. The table and `createSubmission` remain as the foundation for M5, when a server exists.
- **Admin review** is dev-only through the `.dev.tsx` page extension, so it is absent from the export.
- **Dev database fix:** the PGlite dev server copies each output chunk before `socket.write`. A backpressured write could see WASM memory reused for the next chunk, which corrupted large responses under the parallel load of the export build.

## Consequences

- Publishing is `scripts/publish-pages.sh` (GitHub Pages on a separate public repo), or an upload of `apps/web/out` to any static host.
- `pnpm build` needs `pnpm db:start` running.
- Profile data is as of the last build. Recruiting status is live.
- Adding M5 (submissions, auth) later means adding a server again: Next.js can go back to server rendering without changing the data layer.
