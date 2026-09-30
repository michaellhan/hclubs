# Deployment: static site

Club Index is published as a **static site**: plain HTML, JS and JSON files, with no server and no hosted database (ADR 0022). Every page and data file is generated from your **local** database at build time, and the output folder can be served by any static host.

```
local PGlite DB ──(next build)──▶ apps/web/out/ ──▶ GitHub Pages / any static host
```

## What runs where

| Thing                                                         | Where                                                                                                                                           |
| ------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| Pipeline (discover, enrich, reconcile)                        | Your machine, against the local database                                                                                                        |
| Review UI (`/admin/review`)                                   | Your machine only (`pnpm dev`); it is not in the static build                                                                                   |
| Club, category and about pages                                | Prebuilt HTML                                                                                                                                   |
| Directory search, filters, sorting, recruiting board, compare | In the visitor's browser, from `/data/index.json` (about 50 KB gzipped) and `/data/clubs/<slug>.json`                                           |
| "Recruiting now", open/closed, "due in 3 days"                | Computed in the visitor's browser from the cycle dates, so it stays correct between rebuilds                                                    |
| Corrections                                                   | An email link to `CONTACT_EMAIL`, or `NEXT_PUBLIC_CORRECTIONS_FORM_URL` (e.g. a Google Form). A person records accepted ones as sourced claims. |

## Build and preview locally

```bash
pnpm db:start                       # keep running; the build reads the database
pnpm --filter @hci/web build        # → apps/web/out
pnpm --filter @hci/web preview      # http://127.0.0.1:4173 (serves out/ like a static host)
```

## Publish to GitHub Pages

The source repo stays private. Only the built files go to a separate **public** repo, because GitHub Pages on a free plan serves public repos only.

1. Create an empty public repo once, e.g. `gh repo create <you>/clubindex --public`.
2. Publish; this builds and force-pushes `out/` to that repo's `main` branch:
   ```bash
   scripts/publish-pages.sh <you>/clubindex            # served at https://<you>.github.io/clubindex/
   ```
3. Enable Pages once: repo Settings → Pages → Deploy from a branch → `main` / root.

For a custom domain, pass an empty base path (`scripts/publish-pages.sh <you>/clubindex ""`), set `NEXT_PUBLIC_SITE_URL=https://yourdomain`, and add the domain in Pages settings.

Set these in `.env` before publishing (they are baked into the build):

| Name                               | Purpose                                                                                                        |
| ---------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `CONTACT_EMAIL`                    | Corrections and takedowns on `/about`, `/about/bot` and club pages. Use a project address, not a personal one. |
| `NEXT_PUBLIC_CORRECTIONS_FORM_URL` | Optional; replaces the email link with a form.                                                                 |
| `NEXT_PUBLIC_SITE_URL`             | Origin used in the sitemap and metadata (the script defaults it to `https://<owner>.github.io`).               |

Other static hosts (Cloudflare Pages, Netlify, S3) work the same way: build with the right `NEXT_PUBLIC_BASE_PATH`, then upload `apps/web/out`.

## Refreshing the data

```bash
pnpm ingest:discover && pnpm ingest:enrich --stale-only && pnpm ingest:reconcile
scripts/publish-pages.sh <you>/clubindex
```

Between refreshes, pages keep the data as of the last build. Recruiting status still updates on its own, because it is computed from dates in the browser.

## Before announcing publicly

- [ ] Email the Harvard Trademark Program (ADR 0021; draft in `data/outreach/drafts.md`).
- [ ] Set `CONTACT_EMAIL` and check that `/about/bot` shows it.
- [ ] Go through the remaining merge candidates (`pnpm hci review`).
