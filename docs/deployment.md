# Deployment

The target setup is:

- **Web:** Vercel.
- **Database:** Neon Postgres 17.
- **Pipeline:** runs from a laptop or CI against the production database.
- **Snapshots:** stay on the machine running the pipeline until the S3 store exists (M3).

The web app reads only the resolved projection tables. It needs a database URL and nothing else.

## 1. Database (Neon)

1. Create a Neon project in region `us-east-1` (Postgres 17), and copy two connection strings:
   - the **pooled** one, whose host contains `-pooler`, for the web app;
   - the **direct** one for migrations and the pipeline.
2. Apply migrations and taxonomy. The seed script refuses to load demo fixtures into a non-local database:
   ```bash
   DATABASE_URL='<direct url>' pnpm db:migrate
   DATABASE_URL='<direct url>' pnpm db:seed --taxonomy-only
   ```
3. Load real data by running the pipeline against it. This takes about 5 minutes, plus crawl time:
   ```bash
   export DATABASE_URL='<direct url>'
   pnpm ingest:discover && pnpm ingest:enrich --concurrency=6 && pnpm ingest:reconcile && pnpm ingest:stats
   ```
   Set `CRAWLER_CONTACT` in `.env` first (a URL or email). The crawler's user agent must say how to reach you.
4. Replay review decisions: merges and rejections made on the local database live in `editorial_decision` there. Redo them on production with `pnpm hci merge|reject`, or through the review UI pointed at production (see below).

## 2. Web (Vercel)

1. Import the GitHub repo and set **Root Directory** to `apps/web`. Vercel detects pnpm and the workspace from the root lockfile.
2. Set these environment variables in Production:

   | Name                     | Value                                                               |
   | ------------------------ | ------------------------------------------------------------------- |
   | `DATABASE_URL`           | the Neon **pooled** URL                                             |
   | `NEXT_PUBLIC_SITE_URL`   | `https://<your domain>`                                             |
   | `CONTACT_EMAIL`          | a project address for corrections and takedowns, not a personal one |
   | `SUBMISSION_HMAC_SECRET` | output of `openssl rand -hex 32`                                    |

   **Never set `ENABLE_ADMIN`.** `/admin/review` has no authentication and returns 404 in production unless that variable is set.

3. Deploy. Then check:
   - `/about` lists the sources and `/sitemap.xml` lists clubs;
   - `/admin/review` returns 404;
   - a test correction on any club page shows "Thanks".

   Then reject the test correction from the review UI.

## 3. Reviewing in production (no admin auth yet)

Run the review UI **locally**, pointed at production:

```bash
DATABASE_URL='<direct url>' pnpm dev
```

Then open http://localhost:3000/admin/review. It covers:

- suggested corrections;
- merge candidates;
- unconfirmed links.

The CLI works the same way: `DATABASE_URL=… pnpm hci review`.

## 4. Refreshing data

- **Refresh:** `DATABASE_URL=<direct> pnpm ingest:discover && pnpm ingest:enrich --stale-only && pnpm ingest:reconcile` re-fetches only what is due. A GitHub Actions schedule for this is M3 item 6.
- **Profile updates:** pages are rendered per request (`force-dynamic`), so updated data appears immediately.

## Before announcing publicly

- [ ] Email the Harvard Trademark Program (ADR 0021).
- [ ] Choose a domain without "Harvard" in it.
- [ ] Set `CONTACT_EMAIL`, and make sure `/about/bot` shows it.
- [ ] Go through the merge-candidate queue, since visible duplicates hurt trust.
