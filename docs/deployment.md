# Deployment: static site

hclubs is published as a **static site**: plain HTML, JS and JSON files, with no server and no hosted database (ADR 0022). Every page and data file is generated from your **local** database at build time, and the output folder can be served by any static host.

```
local PGlite DB ──(next build)──▶ apps/web/out/ ──▶ GitHub Pages / any static host
```

## What runs where

| Thing                                                     | Where                                                                                                                                                   |
| --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Pipeline (discover, enrich, reconcile)                    | Your machine, against the local database                                                                                                                |
| Review UI (`/admin/review`)                               | Your machine only (`pnpm dev`); it is not in the static build                                                                                           |
| Club, category and about pages                            | Prebuilt HTML                                                                                                                                           |
| Directory search, filters, sorting, compare, resume match | In the visitor's browser, from `/data/index.json` (about 135 KB gzipped) and `/data/clubs/<slug>.json`                                                  |
| "Recruiting now", open/closed, "due in 3 days"            | Computed in the visitor's browser from the cycle dates, so it stays correct between rebuilds                                                            |
| Contributions and corrections                             | Prefilled Google Form links (`NEXT_PUBLIC_CONTRIBUTE_FORM_URL`, docs/contributions.md), or an email to `CONTACT_EMAIL`. An editor reviews every answer. |

## Build and preview locally

```bash
pnpm db:start                       # keep running; the build reads the database
pnpm --filter @hci/web build        # → apps/web/out
pnpm --filter @hci/web preview      # http://127.0.0.1:4173 (serves out/ like a static host)
```

## Publish to GitHub Pages

The source repo stays private. Only the built files go to a separate **public** repo, because GitHub Pages on a free plan serves public repos only.

1. Create an empty public repo once, e.g. `gh repo create <you>/hci --public`.
2. Publish; this builds and force-pushes `out/` to that repo's `main` branch:
   ```bash
   scripts/publish-pages.sh <you>/hci            # served at https://<you>.github.io/hci/
   ```
3. Enable Pages once: repo Settings → Pages → Deploy from a branch → `main` / root.

For a custom domain, pass an empty base path (`scripts/publish-pages.sh <you>/hci ""`), set `NEXT_PUBLIC_SITE_URL=https://yourdomain` in `.env`, and add the domain in Pages settings. The script then also publishes a `CNAME` file; without it, each force-push would drop the custom domain.

**The live site** is at https://hclubs.app/ (`scripts/publish-pages.sh michaellhan/hclubs-site ""`). DNS is at Porkbun:

- the apex has `A` records `185.199.108.153`, `185.199.109.153`, `185.199.110.153`, `185.199.111.153` (and `AAAA` `2606:50c0:8000::153` through `8003::153`);
- `www` is a `CNAME` to `michaellhan.github.io`.

`.app` domains are HTTPS-only (HSTS preload), so "Enforce HTTPS" must be on in Pages settings once GitHub has issued the certificate.

Set these in `.env` before publishing (they are baked into the build):

| Name                               | Purpose                                                                                                        |
| ---------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `CONTACT_EMAIL`                    | Corrections and takedowns on `/about`, `/about/bot` and club pages. Use a project address, not a personal one. |
| `NEXT_PUBLIC_CORRECTIONS_FORM_URL` | Optional; replaces the email link with a form.                                                                 |
| `NEXT_PUBLIC_SITE_URL`             | Origin used in the sitemap and metadata (the script defaults it to `https://<owner>.github.io`).               |

Other static hosts (Cloudflare Pages, Netlify, S3) work the same way: build with the right `NEXT_PUBLIC_BASE_PATH`, then upload `apps/web/out`.

## Refreshing the data

See [`runbook.md`](runbook.md) (refresh, audit, backup). In short:

```bash
scripts/refresh.sh --no-publish && pnpm hci audit
scripts/publish-pages.sh <you>/hci
```

Each publish force-pushes a fresh commit, so the public repo doesn't grow. It re-uploads the last 14 days of hashed `_next/static` files from `data/published-next-static/`, so a visitor whose page (or 10-minute cached HTML) predates the publish doesn't hit missing chunks.

Between refreshes, pages keep the data as of the last build. Recruiting status still updates on its own, because it is computed from dates in the browser.

## Before announcing publicly

- [x] Public name without Harvard marks: **hclubs** (ADR 0021, second amendment). Emailing the Trademark Program is optional now that the name is descriptive-only.
- [x] `CONTACT_EMAIL` set (shown on `/about` and `/about/bot`).
- [x] No pending merge candidates (`pnpm hci review`).
- [ ] Run `pnpm hci audit` and read `data/reports/audit.md` before each publish.
- [ ] Back up `data/pglite`, `data/snapshots` and `data/imports` (runbook).
- See `docs/launch-audit.md` for the full launch review.
