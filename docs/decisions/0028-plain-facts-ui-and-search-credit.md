# 0028: Plain facts in the UI, all links shown, frugal paid search

**Status:** accepted (owner decision, 2026-09-30)

## Context

The owner found the provenance-heavy UI distracting. Every value carried a badge (Verified, Reported, Estimate…), plus freshness text and a sources popover, and links were hard to find at the bottom of profiles, with unconfirmed ones collapsed. Separately, discovery runs spent about 1,000 paid Brave queries in a day and exhausted the prepaid credit.

## Decision

**UI** (supersedes the display parts of §7.4 and §15):

- **Values:** facts display plainly. `<FieldValue>` remains the single rendering path, but it shows no badge, freshness text or source popover by default.
- **Sources:** each profile keeps one collapsed "Sources" section at the bottom.
- **Categories:** shown as plain chips.
- **Links:** all links except rejected ones are shown, including unverified and probable Instagram and other social links. Profiles open with a link icon bar (website, Instagram, LinkedIn, …, plus an Apply button). The directory shows website and Instagram icons.
- **Unchanged:** the data model still records provenance (claims, evidence, tiers, confidence, resolver). Nothing is fabricated. Unknown stays "Unknown" (or the row is hidden). Fixture/demo clubs stay labeled. The methodology page still explains sourcing.

**Paid search** (Brave draws on prepaid credit):

- **Per-run cap:** every search command stops at `--max-queries` (default 100).
- **Out of credit:** HTTP 402 raises `SearchCreditError`, and the stage stops searching cleanly instead of failing club by club.
- **Replay:** responses are replayed from storage for 180 days (press: 365). `find-sites` keeps its original request shape so earlier queries replay.
- **Press:** clubs already searched for a publication within a year are skipped (`--refresh` overrides). Paid press queries batch 5 clubs per query (`"A" OR "B" …`), and each article is checked against every club in the batch.
- **Free sources first:** publications with their own WordPress search API use it and never pay.
- **Priority:** `find-sites` searches clubs missing both a site and an Instagram first.
- **Tracking:** `stats` shows `braveQueriesThisMonth`.

## Consequences

- Profiles are cleaner, and links are one tap away.
- Visitors can no longer tell a verified link from a search-matched one on the page. The owner accepts this; a rejected link is still hidden.
- The remaining Crimson coverage costs about 70 queries (about 340 clubs ÷ 5) instead of about 340.
