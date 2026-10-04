# Recruiting information: audit and pass

How recruiting facts (deadlines, opening dates, application forms, join process, stages, eligibility) get into hclubs, why coverage was low, and what the targeted pass (ADR 0031) changed.

## Audit (2026-09-30, before the pass)

**Coverage of the 718 real clubs:**

| Measure                                 | Clubs     |
| --------------------------------------- | --------- |
| Any deadline                            | 39 (5.4%) |
| Deadline in the current or a later term | 37        |
| Deadline still ahead                    | 10        |
| Opening date                            | 24        |
| Current application link                | 25        |
| Any recruiting cycle                    | 56        |
| Join process                            | 159       |
| Usual recruiting term                   | 44        |
| Class-year eligibility                  | 39        |
| First-year eligibility                  | 34        |

**Where clubs drop out, by cause:**

- **Source genuinely unavailable (the largest group):**
  - 479 clubs have no website we can read. Many are SOCO-only clubs whose recruiting lives on Instagram or in HarvardKey systems.
  - Of 202 crawled joining/recruiting pages, only 43 contain any date in recruiting context. Most club sites describe the process but never state dates.
- **Page not discovered:**
  - 38 of 239 sites had only their home page fetched.
  - 5 sites had never been fetched.
  - The general crawl caps a site at 6 pages, shared with About, News and team pages.
- **Discovered but not crawled:** forms linked as "here" or "this form" (not "apply") weren't read as applications.
- **Crawled but extraction missed it:** 8 of the 43 dated recruiting pages produced no deadline.
  - 6 were correct skips: old pages from 2011 to 2018, and event times.
  - 2 were misses. "The application form is open **until** October 4th, 2026" wasn't a deadline cue.
- **Extracted but wrong (the correctness problem):**
  - **Wrong term:** a date's term was taken from the first term anywhere on the page, so 17 claims at 6 clubs filed 2026 dates under 2013–2025 terms. One example is the HRDC's April 2026 deadlines under "Fall 2016".
  - **Guessed year:** a month and day with no year took the year nearest the crawl date, so old pages could yield current dates.
- **Resolver failed to surface it:** none found. One display gap: a stated "applications are open" from a past term would still show as open.

## The pass

`pnpm hci recruiting [--missing-only] [--stale-only] [--club=…] [--limit=N] [--search-budget=N] [--no-ai] [--budget=USD] [--dry-run] [--audit-only]`. Details are in ADR 0031.

Typical runs:

```
pnpm hci recruiting --missing-only --dry-run              # who would be examined; audit findings
pnpm hci recruiting --missing-only --budget=3             # sites + forms, LLM capped at $3, no paid search
pnpm hci recruiting --missing-only --search-budget=150    # add the search fallback (150 paid queries max)
pnpm hci recruiting --stale-only                          # recheck recruiting pages not seen in 72 h
pnpm hci recruiting --audit-only                          # reject suspicious recruiting facts
```

## Results of the first run (2026-09-30)

**Runs:**

- **Phase 1:** clubs with websites and no dated current cycle. 240 clubs and 191 sites, no paid search, LLM capped at $3.
- **Phase 1b:** a rerun with the stated-status rule.
- **Phase 2:** all 674 clubs without a dated current cycle, with search fallback capped at 150 paid queries.

**What the runs found:**

|                                                             |                                                                           |
| ----------------------------------------------------------- | ------------------------------------------------------------------------- |
| Pages read                                                  | 402 (21 newly fetched; 386 reused from this week's crawls)                |
| Recruiting pages found                                      | 100 (24 active application pages, 76 recruiting-info pages)               |
| Membership pages                                            | 112                                                                       |
| Historical recruiting pages kept but given no current facts | 57                                                                        |
| Application forms read (title + description)                | 23                                                                        |
| Paid Brave queries                                          | 150 (cap reached)                                                         |
| Search results fetched                                      | 63, all naming the club or on its own site                                |
| LLM calls                                                   | 67 new, about $1.25; 64 replayed from cache                               |
| Quality audit                                               | 18 misfiled facts rejected; 5 more claims retired as no longer reproduced |
| Errors                                                      | 0                                                                         |

**Coverage before and after (718 clubs):**

| Measure                                  | Before | After |
| ---------------------------------------- | ------ | ----- |
| Any deadline                             | 39     | 40    |
| Deadline in current or later term        | 37     | 38    |
| Deadline still ahead                     | 10     | 11    |
| Opening date (current term or later)     | 22     | 21    |
| Application link (current term or later) | 23     | 24    |
| Current cycle with any recruiting fact   | 44     | 46    |
| Stages                                   | 30     | 32    |
| Join process                             | 159    | 165   |
| Usual recruiting term                    | 44     | 46    |
| Class-year eligibility                   | 39     | 41    |
| First-year eligibility                   | 34     | 37    |

**Reading the results:**

- **Coverage barely moved.** Club websites that publish dates were already being read. Most other sites describe the process but give no dates, or show last year's cycle. The pass now refuses to surface those last-year cycles; the 57 historical pages were previously a source of wrong "current" dates.
- **The 18 rejected facts were real errors.** They were 2026 dates filed under 2013–2025 terms at six clubs, including the HRDC, the Undergraduate Council, Tech & Global Health and WiSHR.
- **The search fallback found the club's own recruiting pages but rarely a date.** Google Forms and Instagram, where most clubs post deadlines, aren't indexed or can't be read.

## Remaining gaps

- **Clubs with no public recruiting source:** about 480 clubs have no website, and their dates are on Instagram or in HarvardKey systems. Submissions (ADR 0027) and a sanctioned College export are the only routes.
- **Undated application forms:** Google Forms often state deadlines in their description. Forms are only read when a club page links them; the 23 read so far rarely include dates.
- **Event dates:** comp kickoffs and info sessions ("Comp Kickoff: Sept 9") are read as events, never as deadlines. They could become dated stages (`StageValue.startsAt`).
- **Rechecks:** deadlines move during recruiting season. `recruiting --stale-only` should run daily from mid-August to October and mid-January to February.

## The recruiting board (2026-10-02)

`/recruiting` and the home page's "Recruiting now" box are computed in the browser from the static index and `useNow`, so open/closed is right on the day a student visits. All section logic is pure and lives in `packages/db/src/local/board.ts` (tests: `packages/db/test/recruiting-board.test.ts`); row wording is `nextStepText` in `packages/core/src/recruiting.ts`.

**Sections, in order** (empty ones are hidden):

| Section                        | What's in it                                                                                                                                                                                                                             |
| ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Due in the next 7 days         | Open or deadline-ahead rounds whose deadline ends within 7 days                                                                                                                                                                          |
| Open now (due later)           | Other open rounds, including an undated "applications are open" seen in the last 21 days                                                                                                                                                 |
| Opening soon                   | Rounds with a future opening date, and next-term deadlines more than 75 days off                                                                                                                                                         |
| Started, no deadline listed    | An opening date with nothing else: 10 days for auditions/tryouts (held over a weekend), 30 for comps and applications                                                                                                                    |
| Join anytime                   | `joining.access = open` (ADR 0041): a source says anyone can join. Ranked active first, then first-years welcome, then with a description, then by name. Clubs with no description and no links are left out                             |
| Usually recruits this term     | A `club.recruiting_seasons` pattern for the current season, with no round on record this term (any status) and not open membership; empty from Oct 1 / Mar 1                                                                             |
| Missed fall/spring recruiting? | Rolling recruiters first, then clubs whose round closed this term and that usually recruit next term, then next-term-only recruiters. Patterns, never dates. Titled "Rolling and next-term recruiting" while dated rounds are still open |
| Closed in the last 30 days     | Collapsed; each row says when it closed and the club's other usual term                                                                                                                                                                  |

When no dated round is ahead, a notice says so and points to Join anytime and the next chances. The home box then shows up to three clubs each from "Started, no deadline listed", "Join anytime" and "Just closed" instead of an empty state.

**Row wording** follows the process, never implying selectivity (CLAUDE.md §9): "Apply by Oct 9, 11:59 PM EDT", "Comp deadline Sep 12", "Auditions start Oct 5", "Comp started Sep 6 · no deadline listed", "Closed Sep 10". A date-only deadline stays date-only. The Apply button appears only while a round is open.

**Public index:** cycle dates in the static index carry only `at`, `precision` and `label` (`listedDate`); the source text a date was read from and the parser's confidence stay internal.

**One section per club:** `buildBoardSections` lists each club in at most one of the "what can I do" sections, in priority order: a dated or started round, then join anytime, then usually recruits this term, then next chances. Closed rounds keep their own collapsed list. Rolling recruiters are never "usually recruits this term". The home box, profiles' "Missed this deadline?" (`components/profile/alternatives.tsx`, over similar clubs plus the club's own next round) and the compare table's "Next chance" row (`nextChanceText` in `apps/web/src/lib/compare-summary.ts`) use the same rules, so the three never disagree.

**Late in the term (2026-10-04).** From **Oct 1** (fall) and **Mar 1** (spring), campus time, a seasonal pattern with no round on record this term no longer reads as "still coming" (`usualRoundLikelyPast`, `usualNextRound` in `board.ts`). Harvard's fall term starts in the first week of September and spring in the last week of January, and club rounds open and close in the first three to four weeks: every dated fall-2026 opening on record is in Aug–Sep and every deadline in September. From the cutoff, "Usually recruits this term" is empty and those clubs move to "Missed fall recruiting?" as "Usually recruits in fall and spring · next likely in spring" (fall-only clubs: "again next fall", listed last; a pattern with rolling gets no "next likely" line; a this-term round on record, even stages only, keeps the club out, while a start date older than the Started window lets the pattern speak). The profile's "When" keeps the pattern as its headline with "Next round likely in spring · no date yet" underneath (computed only after mount; the prebuilt HTML says "No date on record yet", so it never depends on the build day), and compare's Next chance says "Usually recruits in fall and spring; next likely in spring". A closed fall-only round now points to "Usually recruits again next fall" instead of "No next round known". All recomputed on the reader's day (`useNow`); a pattern, never a date.

**Past rounds on profiles.** A round from an earlier term is never shown as current recruiting: How to join lists it only under a collapsed "Last round: Spring 2026" (cards titled "Spring 2026 round (past)", stages "as the club listed them then"), via `splitCycles` (`apps/web/src/lib/cycle-history.ts`), even if the build had picked it as the current cycle.
