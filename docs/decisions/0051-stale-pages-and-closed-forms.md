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

## Amendment (2026-10-11): past-cycle links and application pages

Owner: "check other clubs for outdated application links". A survey of all 185 shown
application links (65 forms, 120 pages) after re-fetching them:

- **`check-forms` also re-fetches application pages**, and a one-page fetch now stores its
  override role: every form and 17 application pages had been stored as `home` pages (summaries
  read home/about pages). 82 sources relabeled `recruiting`.
- **`application.past_cycle`** (high, fix = reject; refresh applies it): an application link
  whose own label or page title names only past terms, years or dates ("Spring 2025
  Application", "Apply here before 1/24/2024", "Spring 26 Interest Form" in October 2026),
  `pastCycleNamed`. Like the other form checks it also rejects a round linking that URL. Six
  links: CHAP, Conflux, GSAS Biotech, the Independent's spring comp form, the LowKeys' spring
  form, Capital Partners' spring application.
- **Page text is judged by hand, not by a rule.** Pages that say this fall's round is closed
  (HULR, AISST, HUGE) are current and stay. Rejected after reading: TGHI ("Fall 2025
  applications are OPEN, due Sept 13, 2025"), Glee Club Lite (2023-24 auditions), WISHR (2013
  board applications), the Math Association's 2024-25 board-associate page, and Vision GHS's
  conference application (not membership). Kept with stale text: Satire V's comp page (Spring
  2023 dates, still the comp page) and HRAAA's join page (general how-to-join).

## Amendment (2026-10-12): outdated deadlines

Owner: "check other clubs for outdated deadlines". `recruiting-review` listed 23 current-term
rounds; every date matched its 2026 page and every one is computed closed now. The one round
shown open (the Law Entrepreneurship Project, a law-school group) still says so live. Rounds
from earlier terms appear only as a collapsed "Last round" line. Fixed:

- **HRDC "Last round: Fall 2016"**: a 2016 news post's show-production and venue
  pre-application dates; rejected (not how members join).
- **Extractor 1.16.19**: a dated recruiting notice ("Auditions for our fall 2026 production …
  will be held on Monday, September 14") is never the club's About text (`DATED_NOTICE`);
  the Modern Dance Company's About was one.
- **Extractor 1.16.20**: "we'll email you when Spring 2027 applications open" is a later
  opening, not "applications are open" (`OPENS_LATER`), and "Applications to this semester's
  fellowships have closed" counts as closed for the current term. AISST had been recorded
  as open for Spring 2027 from a page re-fetched the day before (it would have shown as
  recruiting now).
- Replayed offline; 7 claims no longer reproduced were retracted (also an HPR news article
  used as its About text).

## Amendment (2026-10-12): lost writes and wrongly retracted links

`retract-unreproduced --extractor=site-deterministic --field=club.link,cycle.application_url`
retracted 57 claims at 22 clubs as "not reproduced by site-deterministic@1.16.20". Among them were
Harvard Curling's two Instagram accounts and X, the Baroque Chamber Orchestra's Instagram and
AADT's YouTube; the rest were emails, forms and application pages. All of them are still on the
live pages.

**Cause.** No extractor change: 1.16.20 still emits every one of them (fixtures
`test/fixtures/club-home-links/`). The pages are stored pages the crawl no longer reaches.
For the two named sites, the identity probe no longer finds the club's current name on the page
("Harvard Curling Club", "Harvard College Baroque Chamber Orchestra"), so only the confirm-only
re-read keeps them. That re-read ran at 1.16.19/1.16.20 early on 2026-10-12. The dev database
was later repaired from a damaged copy (`data/pglite-damaged-2026-10-12`). The repair kept
those passes' `snapshot_extraction` rows (176 claiming values) but none of their claim or
evidence rows. To `pagesNotReread` the pages looked already read, and to `retract-unreproduced`
they looked re-read with nothing found. A retracted claim also could never come back: the
confirm-only re-read confirmed only active claims.

**Fix.**
- `snapshot_extraction.claims` now means the distinct claims a pass wrote evidence for, not how
  many it extracted. This holds for enrich, confirm-only re-reads and the recruiting pass. Two
  links with one normalized value count once, and dropped values (the site's own website link,
  cycle facts without a term) don't count. A pass that claims more than the evidence it left
  has lost its writes.
- A pass that lost its writes doesn't count as a read. `pagesNotReread` reads the page again
  (once: the new pass records honest counts). `retract-unreproduced` no longer treats it as
  "re-read, found nothing", so this incident can't repeat even if enrich hasn't run.
- Confirm-only re-reads also confirm claims rejected only as "not reproduced by"
  site-deterministic or scope-statements. Those revive, as they already do through
  `upsertClaim`. Audit and editorial rejections still stick.

**Data.** `enrich --offline` re-read 179 stored pages and revived all 57 claims. No new values
were created. A second run re-read 1 page and a third none. `projection diff` shows exactly those 57 links back and nothing else changed. A
retract dry run now finds 0 links to retract. One `club.long_description` would still be retracted:
the Modern Dance Company's dated audition notice. Its 1.16.19 rejection was also lost in the
repair; it is left for review.

**Linked sites that no longer confirmed by name.** Before the fix, 17 of the 355 linked sites
were skipped every run as unconfirmed, because the club's current name differed from the
site's own title. Enrich now also accepts the site's own spellings, but only when re-confirming a
site already linked to the club (`linkedSiteNameVariants`). Accepted:
- a colon subtitle dropped
- a leading "PBHA's" dropped
- a trailing "Club", "A Cappella", "Program" or "Inc." dropped
- "College" and "Undergraduate" swapped

Each variant needs two words, one distinctive. Dropping "Undergraduate" altogether is never a
variant (§3), so Harvard Technology Review stays unconfirmed. A site root whose registered name
spells the club's name exactly also counts (`hostSpellsClubName`: harvardundergraduatethinktank.org,
apichorus.org). This is never applied to a page deeper in a site. Finder, curate and recruiting
keep the strict rule.

A browser re-fetch of the JS-only sites confirmed the Hasty Pudding Institute's shared site for
both the Club and the Theatricals, and crawled the Theatricals' comp into the Club. Rejected for
the Club, each with its reason:
- the Theatricals' join modes, forms, comp page and spring recruiting
- the Institute and Theatricals descriptions
- "had only been open to Juniors and Seniors" as eligibility (past tense)

Also rejected:
- the shared root and old Joomla URLs as either club's website (their own sections stay)
- the Theatricals' awards blurb
- three Radcliffe Choral Society subpages recorded as websites, and its dead .org domain

The audit's duplicate candidate for the two Hasty Pudding clubs is dismissed (different
organizations). Still unconfirmed and left as they are:
- Harvard Model Congress and the Veritones (the browser re-fetch still yields no title)
- Harvard Technology Review (§3, see above)
- the Orthodox Student Minyan (its site uses another name, "Harvard Hillel Orthodox Minyan")

**Also retracted** (`retract-unreproduced`, the intended 1.16.19/1.16.20 changes the repair had
undone): the Modern Dance Company's dated audition notice as its About text, and the Technology
Review's "application" join mode read from its 2022 summer-fellowship page.

**Follow-up (same day).**
- The Harvard Advocate moved to harvardadvocate.org (theharvardadvocate.com no longer resolves).
  Curated list v11 and its editor-read comp facts now point there: same sentences, re-verified.
  The old site is rejected as a website.
- The Veritones' site is private (HTTP 401): rejected as a website.
- Harvard Model Congress's robots.txt disallows our crawler, so its site stays unconfirmed.
- The Orthodox Minyan's site has no readable text, and Harvard Technology Review never says it
  is undergraduate. Both stay unconfirmed until there is evidence.
