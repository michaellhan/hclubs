# 0032: Completeness tiers and the name-only campaign

**Status:** accepted

## Context

After the SOCO import (ADR 0030), 217 clubs had no description, website or Instagram (`isSparseClub`, the /contribute list). "Name-only" had no precise definition beyond that UI rule. Many of these clubs do have public traces: news coverage, Facebook or LinkedIn pages, Harvard House or office pages, or an Instagram handle built from their initials. Some are duplicates of indexed clubs.

## Decision

- **Completeness tiers** (`completenessTier`, `@hci/db/local`) are computed from public facts only. These are a description, an official channel (website or Instagram), how to join or a current recruiting cycle, size or time, a logo, and news coverage. Inherited index data never counts: category, SOCO tags and flags, recognition, dues and affiliation.
  - `name_only`: none of those facts.
  - `sparse`: one kind of fact, or no description and no channel.
  - `partial`: a description or a channel, plus more.
  - `rich`: description, channel and how to join.

  The tiers are used by `pnpm hci stats` (`tier*`), by `/contribute` (name-only clubs, plus sparse clubs with no description or channel) and by the campaign report.

- **`pnpm hci name-only [--search-budget=N] [--limit=N] [--dry-run]`** runs these steps:
  1. **Recheck.** It re-scores every link earlier runs wrote, from the full search result they were written on, and rejects (with reasons) whatever today's rules don't accept.
  2. **Duplicates and renames.** It looks for the same Instagram or website, the same distinctive acronym, the same distinctive name words (spelling variants such as "Latines"/"Latinos" count only next to an exact match, one-to-one), and a name that is another club's initialism ("WISHR"). Each finding becomes a merge candidate, never an automatic merge. Pairs already rejected in review don't count.
  3. **Buckets.** Each club is placed in one: `likely_duplicate`, `college_program`, `pbha_program`, `invitation_only_social`, `other_school`, `possible_artifact`, `distinctive_acronym`, `distinctive_name` or `generic_name`.
  4. **Free evidence.** It re-scores stored search responses (the site finder's two phrasings and the recruiting pass), then the links on stored pages whose anchor text is the club's name.
  5. **Paid search.** For searchable buckets only, it runs an adaptive query plan: `"<name without Harvard boilerplate>" Harvard instagram`, then `"<acronym>" Harvard club` only if the first query is inconclusive. It stops at the first strong match. Results are cached for 180 days and replayed for free when there is no budget.
  6. **Scoring** (`scoreCandidate`, 0–100: accept ≥ 60, ambiguous 35–59, reject < 35):
     - **Points for:** the exact name (more in a title than in a snippet), every distinctive word, the acronym or an initialism of the name in the handle or domain, "hoco" for a House Committee, and Harvard in the title, handle or domain.
     - **Websites:** a website must be a site root whose domain carries the name. It still has to name the club when fetched (ADR 0023).
     - **Social profiles:** a social profile must carry the name (or part of it plus "harvard") in its handle.
     - **Penalties or rejection:** Harvard portals, news and research hosts; articles and inner pages; graduate-school, alumni-club and other-university organizations; national organizations whose name lacks "Harvard"; one-word names shared by many groups; companies, aggregators and spam; links rejected before.
     - **Harvard pages:** a page on a Harvard office or House site whose last path segment carries every distinctive word becomes a `harvard_directory` link.
  7. **Report.** It writes `data/reports/name-only-review.{json,md}` (gitignored), with every candidate, its score, its verdict, the reasons, dormancy signals, and a manual-review flag.
- **Dormancy signals** are reported only: not registered in the College directory, latest news mention more than 3 years old, a candidate site that doesn't load. Activity status is never inferred from a missing website.
- **Enrichment** now reads Harvard office and House pages linked as directory pages (portals are excluded). Most such hosts currently return 403 to our crawler; they are not bypassed.

## Results (2026-09-30)

- **Clubs:** 217 on /contribute before (old rule); 198 after.
- **Name-only tier:** 164 before; 153 after.
- **Links added** to 41 clubs: 17 Instagram accounts, 15 Harvard page links, 11 Facebook pages, 4 LinkedIn pages and 1 website.
- **Duplicates:** one confirmed pair, "WISHR" = Women in Science at Harvard–Radcliffe, merged reversibly.
- **Rejected:** 51 weaker links written mid-campaign, rejected when the rules tightened, plus about 2,700 candidates rejected outright during scoring.
- **Spend:** 178 paid Brave queries (cap respected) and about $0.10 of LLM.
- **Unresolved: 152.**
  - 77 have only ambiguous candidates and are flagged for manual review.
  - 63 were searched with no matching candidate.
  - 10 are College programs whose Harvard pages block crawlers.
  - 2 are invitation-only.

## Consequences

- Uncertain matches go to people (review report, /contribute), not into the data.
- The scorer's failure modes are covered by regression tests (`packages/pipeline/test/name-only.test.ts`).
- Most remaining clubs have no public web presence we can confirm. Student submissions, and Instagram handles typed in by people who know the club, are the realistic path.
