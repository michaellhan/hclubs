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
