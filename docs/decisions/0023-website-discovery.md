# 0023: Finding club websites (guessed domains + official search API)

**Status:** accepted (M3)

## Context

Most of what the index knows about joining and recruiting comes from clubs' own websites, but in September 2026 only 96 of 370 clubs (26%) had a known site. Harvard directories rarely link club sites, the official College directory is behind HarvardKey (excluded, ADR 0016, §21), and the model's own knowledge is not a source (§23.8).

## Decision

A `find-sites` stage (`packages/pipeline/src/stages/find-sites.ts`) collects **candidate** sites for clubs with no verified/probable website from two places:

1. **Guessed domains.** `guessDomains` builds a short list from the name (`harvard<core>.org/.com`, `<core>harvard.org`, `harvard<initials>.org`, and the club's own `h…` acronym). Only hosts that resolve in DNS are fetched, at one home page each, through the polite fetcher (robots, rate limits).
2. **An official search API** (Brave Search, `BRAVE_SEARCH_API_KEY`, opt-in with `--search`). One query per club: `"<name>"`, plus `Harvard` when the name lacks it. Results are reduced to site roots (so a news article naming a club never makes the news site "its" site). The response is stored as an immutable snapshot (`fetch_method = api`) and reused for 30 days. We never scrape search-result pages (§10).

A candidate becomes a `club.link` website claim only when `siteIdentity` accepts its fetched home page: the title/h1/og:title names the club (club sports: "Harvard <sport> Club"), the page mentions Harvard/Radcliffe, it isn't a parked or for-sale domain, and an acronym-only match also needs "Harvard" in the title. The claim uses the existing site-identity evidence, so the resolver marks it **probable** (ADR 0017), never verified. A site already attached to another club is skipped.

Social profiles in search results are recorded only when the result title names the club, as tier-8 `public_web` claims. They stay **unverified** (collapsed on the profile) until an official channel links them. Instagram and other platforms are never fetched (§21).

## Consequences

- Enrichment crawls the new probable sites as tier-8 public web; facts from them show as "Reported", not "Verified".
- Guessing is free but finds only clubs whose domains follow the common patterns; search finds the rest when a key is configured.
- False positives need a page that names the club _and_ mentions Harvard. A wrong site can be rejected editorially, and claims are reversible via `retract-unreproduced` (extractor `site-identity`, version `finder-1`) or editorial rejection.

## Update (2026-09-30): stricter matching after the first search run (finder v2)

The first Brave run (300 queries) showed that "the title contains the club's name" was too loose. It accepted PBHA program pages as program websites, a Bandcamp album as the University Choir's site, an unrelated "Harvard Crimson Global Essay Comp" site as The Crimson's, and varsity-team accounts ("Harvard Baseball", "Harvard Squash") for club sports. Finder v2 changes four things:

- **Heading match:** one heading segment (title/h1/og:title split on `|`, `—`, `:`, `,` …) must _be_ the club's name, give or take one word (two for names of 3+ words). "College", "University", "Undergraduate" and "the" are ignored on both sides.
- **Club sports:** all aliases of a club sport are treated as sport names, so only "Harvard <sport> Club" counts. A bare "Harvard <sport>" counts only when the page says it is a club sport.
- **Excluded hosts:** `pbha.org` and `bandcamp.com` never count as a club's own site. PBHA program pages remain `harvard_directory` links.
- **Recheck:** `find-sites --recheck [--dry-run]` re-tests previously accepted sites (from their stored snapshots) and search-found social links against the current rules. It rejects the failures (audited, reversible) when no other source supports them. The first recheck rejected 35 claims: 24 PBHA pages, the essay competition, Bandcamp, varsity squash, and 8 ambiguous club-sport social accounts.
