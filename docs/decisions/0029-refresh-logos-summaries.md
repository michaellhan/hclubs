# 0029: Automatic refresh, recruiting-season rechecks, logos, one-line summaries

**Status:** accepted (2026-09-30)

## Context

The site only changed when someone ran the pipeline by hand, and it was peak fall recruiting season. Profiles also looked bare: every club had an initials placeholder, and many one-liners were raw directory text. The owner asked whether each crawl would cost money.

## Decision

- **Recruiting-season freshness.** From mid-August through October and mid-January through February (Boston time), joining, recruiting and FAQ pages and application forms are refetched after 20 hours instead of 7 days (`enrich --recruiting-freshness-hours` overrides). Conditional GETs keep unchanged pages cheap.
- **Automatic refresh** (`scripts/refresh.sh`, installed as launchd agents by `scripts/install-refresh.sh`).
  - **Daily, 6:00:** it starts the dev DB if needed, then runs `enrich` with LLM extraction capped at `REFRESH_LLM_BUDGET` (default $1) and `reconcile`. It republishes when the club count or claim total changed.
  - **Sundays (`--weekly`):** it also reads new articles from the Independent and HPR (their free site search), discovers clubs from links on crawled pages, categorizes new clubs (capped at $0.50), and always republishes.
  - **Cost:** it never spends web-search credit. Crawling is free; LLM calls happen only for changed pages, because results are cached by content.
  - **Logs:** `data/logs/`.
- **Logos** (`club.logo`). The parser collects logo candidates, and `pickLogo` prefers them in this order: JSON-LD `logo`, then a header image marked "logo", an apple-touch-icon, another logo image, a share image named "logo", and finally a favicon of 96px or more.
  - **Only club home pages** are used, never directory pages.
  - **Excluded:** Harvard marks and shields, platform and social icons, and harvard.edu images.
  - **Display:** the UI hotlinks the image and falls back to initials when it fails to load.
- **One-line summaries** (`club.summary`, inferred). `summarize` asks `SUMMARY_MODEL` (default Sonnet 5.5, cheaper than extraction) for one plain sentence about what the club does, written from the club's stored description pages.
  - **Grounding:** the model must return the sentence it relied on, which must appear verbatim in the text. Numbers not in the text are rejected, and the model may decline.
  - **Display:** the projection's short description prefers the summary.
- **Link display.** A website link that is a deep page (e.g. a cited article) is shown as its site's home page. Other pages of a site already shown are left out of "More links".

## Consequences

Profiles get a real logo and a clean one-liner when the club's site allows it. Recruiting deadlines stay current during recruiting season. The site keeps itself up to date while the owner's Mac is awake, at about $1 a day at most in LLM spend, and usually far less.
