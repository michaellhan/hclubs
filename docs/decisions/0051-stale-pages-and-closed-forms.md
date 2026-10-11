# 0051 — Re-reading pages the crawl stopped reaching, and checking forms

Date: 2026-10-11 · Status: accepted (owner: "why does hsa link to a outdated coffee chat form? fix that and similar issues")

Amends ADR 0039 (`snapshot_extraction`, revivable retractions) and ADR 0033 (audit).

## Context

Harvard Student Agencies' profile linked "Coffee Chat Sign Up", a Google Form that had stopped
taking responses. Three gaps kept it there:

- **The page was never re-read.** The link came from `hsa.net/hiring-process`, fetched once
  (2026-09-30) and read by extractor versions up to 1.14.0. Later crawls (6 pages per site, best
  roles first) no longer reached it, so no newer version read it, and `retract-unreproduced`
  only judges claims whose own snapshot the current version read. About 155 active claims (72
  links) sat on such pages.
- **A changed page didn't count.** When a page was re-fetched with new content and the new copy
  no longer had a form, the old copy's claim stayed: the retraction looked only at the old
  snapshot. Mock Trial (3 forms), the Islamic Society and the Technology Review kept forms
  their pages had dropped.
- **Forms were never fetched.** Enrichment reads a club's top three verified forms; 53 shown
  forms had no stored copy at all, so the audit's `application.form_closed` (which reads the
  stored text) never saw them. Deleted forms (404) had no rule.

## Decision

- **Enrich re-reads stored pages it no longer reaches** (step 4, `pagesNotReread`): the latest
  copy of every page backing an active deterministic claim that the current version never read.
  They're read from storage only (no request), keep their role and source type, and are
  **confirm-only**: a claim is written only when it repeats an active claim that page already
  supports (same value hash, term and assertion kind), and the LLM pass skips them. A re-read never adds new values from an old page the crawl chose to skip (the first
  run without this created 37 such claims, e.g. a hiring page's "first-years eligible"; they
  were rejected with a reason).
- **`retract-unreproduced` judges every page that said it**: a claim is not reproduced when the
  current version read, for every page backing it, that snapshot or a newer copy of the same
  page, and none of them produced it. One page never re-read keeps the claim. Former names
  (`club.alias` kind `former`) are never retracted this way: a former name stays true after a
  page stops mentioning it. A newer copy less than half the old one's text (a maintenance page,
  a JS shell) doesn't count. `--version` defaults to the checkout's extractor version.
- **`hci check-forms`** re-fetches every form a profile shows (any status but rejected) or a
  round links as its application, last requested over 7 days ago, one polite request each, through the crawler (robots,
  SSRF guard, fetch attempts). It writes no claims. A Google Form behind sign-in (401) or
  robots is left alone; it says nothing about the form.
- **Audit:** `application.form_closed` also fires when the stored copy's final URL is
  `/closedform`; new `application.form_deleted` (404/410 from Google Forms, or two in a row
  elsewhere; high confidence, fix = reject). Both also reject a round's `cycle.application_url`
  to that form, read from the claims (the form's own link may be rejected already).
  `audit --apply-only=<checks>` applies only those checks' fixes, and only they take part in
  the one-rejection-per-claim ranking.
- **Refresh** (`refresh.sh`) runs `check-forms`, applies only the two form checks, and retracts
  links and application URLs that re-read pages no longer carry. Other fields are retracted
  by hand after reading the dry run (an extractor regression must not empty profiles
  unattended). Refresh now also publishes when the projection diff shows displayed changes:
  claim counts include rejected claims, so a day whose only change is a closed form looked
  unchanged.

## Results (2026-10-11, $0)

194 stored pages re-read; 15 claims retracted (Mock Trial ×3, Technology Review ×2 and Islamic
Society forms, HUA grant-application "recruiting seasons", HSA hiring-page eligibility, a
"liberal arts" fragment as HODP's one-liner…); 84 forms checked: 16 closed (HSA, the Crimson,
Debating Union ×3, Signet, HUCBE ×2, Lowell House Opera ×2, …) and 3 deleted forms rejected;
17 sign-in-only forms kept; then 6 rounds' application links to closed forms (Charles River
Economics Labs, Crimson Business Board, HDAG, HUEA, Marketing Group, HURJ). The offline pass also read 10-08 home-page copies `curate` had
fetched but enrich hadn't read, so 59 descriptions (36 long, 20 short, 3 missions) moved to the newer page text.
