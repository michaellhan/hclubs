# site-finder (find-sites stage)

Not a discovery adapter: it finds websites for clubs that already exist. See ADR 0023.

- **Command:** `pnpm hci find-sites [--search] [--no-guess] [--club=slug] [--limit=N] [--concurrency=N]` (`pnpm ingest:find-sites`).
- **Guessed domains:** DNS lookup only (4 s timeout), then one home-page fetch per resolving host through `PoliteHttpFetcher` (robots.txt honored; hosts whose robots.txt disallows us are skipped). About 6–14 guesses per club; roughly 1 in 8 resolve.
- **Brave Search API:** `https://api.search.brave.com/res/v1/web/search` with `X-Subscription-Token`. The free plan allows 1 request/second (the client waits 1.1 s between calls and backs off on 429/5xx). One query per club lacking a website or an Instagram link. Responses are stored as snapshots (parsed results plus the request URL, never the key) and reused for 30 days, so reruns cost no queries. Check the plan's terms on storing results before raising volume.
- **Acceptance:** `siteIdentity`. A heading segment must _be_ the club's name (±1 word), the page must mention Harvard, parked domains are rejected, club sports need "Harvard <sport> Club" (or a page saying it's a club sport), and acronym-only matches need "Harvard" in the heading. Search results are fetched only if their title names the club or their host contains its name or acronym. The result is a `probable` website link with the matching heading as the evidence quote.
- **Recheck:** `pnpm hci find-sites --recheck [--dry-run]` re-applies the current rules to earlier finds (stored pages, no refetch).
- **First runs (2026-09-30):** guessing found 14 sites. Brave (300 queries) found 58, of which 27 were later rejected by the v2 rules; 2 more were added after v2. About 190 social links were found (unverified).
- **Social results:** only profiles whose result title names the club; stored as unverified tier-8 links. Platforms are never fetched.
- **Reviewed:** 2026-09-30.
