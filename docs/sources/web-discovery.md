# web-discovery (discover-web stage)

Not a directory adapter: it finds organizations that no readable directory lists. See ADR 0025.

- **Command:** `pnpm hci discover-web --search --outlinks [--limit=N] [--dry-run] [--concurrency=N]`.
- **Search:** Brave Search API, 20 results per query, 1 request/second. The queries are `Harvard undergraduate <topic>` over the topic list in `packages/pipeline/src/sites/sweep-queries.ts`. Responses are stored as snapshots (results plus request URL, never the key) and replayed for 30 days.
- **Outlinks:** the latest snapshot of every non-fixture HTML source already stored, so no extra fetches until candidates are probed.
- **Probing:** one home page per candidate through `PoliteHttpFetcher` (robots honored). Pages fetched within 14 days are reused.
- **Acceptance:** `harvardOrgFromPage` (org-name heading + students + not parked/platform/office/grad/alumni). New orgs become clubs with probable websites; anything merely similar to an indexed club is reported, not created.
- **False positives found and fixed:** a town of Harvard, MA historical society (rule: "members" no longer counts as a student signal), a site tagline used as a name (rule: "X at Harvard" needs the domain to spell it), a GSD club and the Harvard Law Review (graduate hosts/names), and summer programs and conference spin-offs.
- **Blocked, not bypassed:** `dso.college.harvard.edu/list-student-organizations`, `publicservice.fas.harvard.edu/studentorganizations` and `/psn-student-groups` (Akamai 403). `studentaffairs.harvard.edu` disallows crawlers in robots.txt.
- **Reviewed:** 2026-09-30.
