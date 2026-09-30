# 0025: Discovering clubs on the open web (search sweeps + link snowballing)

**Status:** accepted (M3)

## Context

Every club in the index came from a Harvard page we can read (PBHA, SEAS, club sports, IOP, departments, Hillel) or Wikipedia. Those pages rarely list pre-professional, cultural, religious, debate or hobby clubs, and `find-sites` (ADR 0023) only looks for websites of clubs already indexed. The complete directory (SOCO) is HarvardKey-only, and the DSO and Center for Public Service lists return 403 to our crawler. We don't bypass either (§10, §21).

We weighed five ideas: search sweeps, link snowballing, deeper enrichment, Crimson name-mining, and domain enumeration (Common Crawl / certificate logs). Probes showed the Common Crawl index had one HCS-hosted host and crt.sh timed out, so enumeration was dropped for now. Crimson mining gives corroboration more than new websites and remains M3 item 4.

## Decision

A `discover-web` stage (`packages/pipeline/src/stages/web-discovery.ts`) collects **candidate** sites from:

1. **Search sweeps** (`--search`): one Brave Search API query per topic (`Harvard undergraduate <topic>`, about 130 topics in `sites/sweep-queries.ts`, 20 results each). Results count only when their title names a Harvard org (`orgNameFromTitle`), and they are reduced to site roots. Responses are stored as snapshots and replayed for 30 days.
2. **Link snowballing** (`--outlinks`): links on the latest snapshot of every page already crawled. A link counts when its anchor text names a Harvard org or its host carries "harvard"/"radcliffe"/"crimson" or is HCS-hosted.

Each candidate's home page is fetched politely. `harvardOrgFromPage` must accept it:

- The title, og:title or h1 has a segment that is an org name: Harvard or Radcliffe plus an org noun, the College naming style, or "X at Harvard" when the domain spells it.
- The page talks about students.
- It isn't parked, and it isn't a platform, news, Harvard-office, graduate-school or alumni page.

The matcher then decides:

- **new:** create the club through ordinary entity resolution, with a stated `club.name` claim and a **probable** website (tier-8 site-identity evidence).
- **definite:** add the website to that club.
- **probable/ambiguous:** skip and report. The editor resolves these through the curated list (ADR 0024).

The matcher (v3) now computes fuzzy name similarity on the distinctive words only (`blockingKey`), plus a containment check for partial names. Before this, shared boilerplate made "Harvard Undergraduate Poker Club" look like "…Robotics Club".

## Consequences

- The first run (2026-09-30, 132 queries plus 1,145 crawled pages) probed 222 candidate sites. It created 19 clubs; 2 were false positives and were hidden: a town historical society and a site tagline. It reported 12 for review. The rules were tightened after each false positive, and the tests cover them.
- Discovered clubs are tier-8 "Reported" until an official source links them.
- Query volume is bounded by the topic list and the 30-day replay. Brave's free plan allows 2,000 queries a month.
