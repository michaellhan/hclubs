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

**Audit pass (same day): 36 open findings → 1 watch item.**

- **Fetcher:** an https site with a bad certificate (wrong host name, expired, self-signed) is
  read once over http, and the profile shows the address that answered (`withWorkingHost` now
  also swaps the scheme). A refused handshake doesn't count. This fixed the Wireless Club
  (w1af.harvard.edu, confirmed in curated list v11).
- **Resolver-v13:** a registry `conflictKey` says what a value asserts. Two wordings of
  "no dues" no longer conflict, and a note that doesn't say yes or no conflicts with nothing.
  The Debating Union, the Krokodiloes and Mock Trial were missing from No dues because of
  this.
- **Extractor 1.16.21–23:** a generic form link ("this google form", "here") is a mailing list
  when its sentence asks to sign up for notices ("to be notified about future events"), but
  not when the sentence names an interest form (the first step of joining) or submitting to
  a newsletter. Math Association, River Charles, Mock Trial and Tuesday Magazine now show
  mailing lists. Kuumba keeps its interest form.
- **Audit checks:**
  - Handles an editor supplied, and Harvard-named accounts a club's own site links, are not
    "unrelated".
  - Websites on shared hosts are grouped by their real site
    (sites.google.com/view/a ≠ /view/b).
- **Data:**
  - The Band's whole "no need to sweat our auditions — anyone who wants to join the Band can
    join" sentence was recorded as an editor-read fact: an audition with no cut.
  - WISHR's committee applications rejected as a way in (membership is by attendance).
  - Three news descriptions whose relative time is now false rejected (Tibetan, HUFSI,
    Ukraine).
  - The Advocate's dead-domain comp link and two bad short descriptions rejected.
  - A Crimson news article as the Crimson's description retracted.
  - The Theatricals' history rejected as the Institute's About.
- **Reviewed and dismissed:** 19 news-sourced descriptions that are still accurate and each
  club's only one, a wordmark logo with a camera-style file name, BMES as Academic & STEM, and
  SWE's "Get Involved" form.
- **Kept as a watch item:** Sports Analysis Collective's site (HTTP 500 since 09-30).

## Amendment (2026-10-12): program applications and announced later rounds

Two findings from student testing on 2026-10-12.

**Program applications aren't how members join.**

- **The problem.** Startups at Harvard showed "Application" and "Usually recruits on a rolling basis". Its page says a student who wants to join its events fills out an interest form (a Google Form titled "Startups at Harvard Interest Form"). The "Application" came from "Apply by October 10." under `### Startup Trek` and from an older "Applications for the Spring 2026 Trek have closed." The "rolling basis" came from "Applications are reviewed on a rolling basis." under `### Member Grants`.
- **The rule.** `programApplicationProblem(sentence, pageText)` in `evidence-rules.ts` catches an application to a program the club runs (a trek, trip, retreat, grant, scholarship, funding, stipend, award or prize). The sentence can say so ("trek applications", "applications for the Spring 2026 Trek", "apply for a member grant"). Or the sentence can sit under a section heading that names the program (`headingAbove`, the nearest markdown heading in the page text the extractors read), as long as neither the sentence nor the heading talks about joining.
- **Fellowships.** A fellowship counts only beside money ("fellowships of up to $5,000"). At AISST, Effective Altruism and HCS Tech for Global Health, an intro fellowship is how members join, and those claims stay.
- **Where the rule runs.** It is part of `outsiderApplicationProblem`, so it covers join modes, recruiting seasons and recruiting dates:
  - the deterministic extractor (1.16.26);
  - LLM grounding (`g14`), which also checks recruiting seasons against the page now;
  - the audit: new `recruiting.program_application` judges join modes, process types and seasons against their pages' text, so a heading counts.
  - Application links: `OUTSIDER_LINK` adds trek, trip, retreat, stipend and funding, and the extractor also checks the heading a body link sits under (`linkHeading`).
- **The interest form.** It stays as the club's link. On the profile, an interest form that isn't tied to a live round reads "Interest form" (no longer "How to apply"). The page doesn't say whether joining is open or selective, so no join mode was recorded and no editor-read fact was added.
- **Data.** After `enrich --offline --llm` and `retract-unreproduced --extractor=site-deterministic` (fields: join mode, seasons, links and cycle fields), 3 claims were retracted:
  - Startups at Harvard's `application` join mode and its `rolling` recruiting season;
  - the Undergraduate Council's `application` join mode, read from its club-grant guide.
- **No other clubs affected.** The audit then found no other program-derived join mode, process or season. Harvard Model Congress Asia's scholarship quotes sit beside its own staff-application quote, so its join mode stays.

**A round the club announces for a later term outranks its usual seasons.**

- **The problem.** Radcliffe Pitches' audition page says its next audition cycle will begin in the Fall of 2027. The profile still said "Usually recruits in fall and in spring" (a tier-8 Wikipedia pattern), and Still time to join included the Pitches through the spring-pattern rule.
- **The data.** The cycle is stored as `2027-fall` with only a stages claim from pitches.org, so the static index had dropped it as a bare row.
- **The helpers.** New in `local/cycles.ts`:
  - `announcedLaterRound(cycles, now)` returns the earliest cycle in a term after `now`'s that has no opening, deadline or stated status, and whose facts a club or official page states (`lastVerifiedAt`).
  - `academicYearEndTerm` / `beyondAcademicYear` define the academic year as fall through the next summer; from June on it is the year ahead.
- **Rejected facts don't count.** A cycle whose facts were all rejected now has no `lastVerifiedAt` (`toCycleSummary`). Five emptied 2027 rows (the Independent, Crimson Business Board, Debating Union, HPAIR and WorldMUN) used to carry one.
- **Static index.** It keeps an announced later round even with no dates.
- **What uses it:**
  - **Profile.** `joinTiming` and the KeyFacts **When** cell say "Next auditions: Fall 2027", named by the round's process, else the club's single process, else "round". After a closed round, the second line is "Next auditions: …".
  - **Compare.** "Next chance" shows the same text (`announcedRoundText`).
  - **Directory rows and /saved.** `RowRecruiting` shows it as a pill.
  - **Still time to join.** `matchesStillTime` is true only when the announced round falls within this academic year. An upcoming dated round after this academic year doesn't count either.
  - **Board builders.** `buildNextChances` points to the announced term (`announced`, `nextYear`), and `buildUsuallyRecruiting` leaves the club out.
- **What doesn't change.** Live rounds, upcoming rounds and open membership still come first. The Wikipedia pattern claim stays: it is history, and it speaks again once Fall 2027 starts.
- **Affected clubs.** Only Radcliffe Pitches has an announced round beyond the next term. The other 2027 rows hold only rejected facts.

**A form that names a round already over is never "How to apply" (2026-10-12).**

- **The problem.** Live student testing found the Independent's featured "How to apply" was its "Fall 2026 Comp Interest Form" on October 12. The form's required info sessions were September 6–7 and the club has no current round on record. The link label ("Fill out the interest form here") names no term; the form's own title does. The audit's `application.past_cycle` leaves it alone, correctly: fall 2026 is the current term.
- **The rule.** `termNamedInText` (core) reads the term a hosted form's label or fetched title names ("Fall 2026", "Spring '26", "Fall Comp 2026", "2026 Fall"). It never reads a bare year or date, and never guesses a year. `namedRoundOver(term, now)` is true when that term is earlier than the current one, or is the current term and its first month has passed (fall from October 1, spring from March 1, summer from July 1, New York time). In early September a "Fall 2026" form may still be taking answers.
- **Forms only.** A club's comp or join page ("Fall Comp 2026 | The Harvard Crimson") is updated in place and stays the place to check, so only hosted forms (`isFormUrl`) get a term.
- **Data flow.** `getClubProfile` computes `term` for each application form (`applicationLinkTerms`; the title stays internal) and `LinkDisplay`/`RankableLink` carry only the term key.
- **Profile.**
  - `pickLinkBar(links, preferredApplyUrl, now)` never features such a form unless it is the current round's own link. A comp or join page is featured instead when there is one; otherwise the club's "Check how to apply at …" button takes its place.
  - The form stays under More links, tagged "Fall 2026 round" and listed after other application links (`planMoreLinks` with `now`).
  - On the reader's day (`useNow`) the featured button reads "Last round's form" once its round is over between builds (`applyLinkText`, `apps/web/src/lib/apply-link.ts`).
  - Compare's link cell uses the same `now`.
- **Effect on live data (Oct 12).** The Independent shows "Check how to apply at harvardindependent.com", with the fall form under More links. The Lampoon's button points to harvardlampoon.com/comp instead of its "Fall 2026 Comp Sign-Up Form". The Crimson's comp site (a page) is unchanged.
- **The audit.** `pastCycleNamed` already catches "Spring 2026 Comp Interest Form" by label or title on Oct 12, 2026 (new regression cases). The Independent's spring form was rejected by it earlier, and a report-mode `audit --check=links` on Oct 12 finds no other past-cycle links.

## Amendment (2026-10-13): last rounds, bare rounds, undated closes and August dates

Student testing round 5 (a finance persona and a first-year musician).

- **When a club last recruited.** Harvard Investment Association's only round is an undated `2026-spring` cycle whose one stage the club labels "Spring 2026 Comp". It has no `club.recruiting_seasons`, so the profile had no When line and compare's Next chance was Unknown. One past round is evidence of when the club recruited, not of a pattern (§2.2), so it never becomes "usually recruits in spring" and feeds neither the season filter nor Still time to join. Instead `lastPastRound(cycles, now)` (`local/cycles.ts`) returns the newest *evidenced* round (`roundEvidenced`: a date, a stated status, or a stage that names the term or carries a date) from an earlier term no more than a year back (`isRecentPastTerm`). A round whose only facts are a process and the term we read it in is not evidence. It reads "Last comp: Spring 2026" (`lastRoundText`, named like an announced round) after every better answer: a live round, open membership, an announced later round, rolling, the usual seasons. The profile's When line adds "Next round not announced yet"; rows and /saved show the same words; compare's Next chance adds "; no next round known" and its summary "HIA (last comp: Spring 2026)". The static index drops undated cycles, so it carries the newest undated evidenced one as `IndexClub.lastRound` (stage labels are now read for the index). Everything is re-checked on the reader's day.
- **Bare rounds.** VCG's `2026-fall` cycle holds only a stages claim whose one stage is "Comp" (Comp period), with the term taken from the day the recruitment page was read. The profile showed a "Fall 2026 recruiting" block while compare said Recruiting: Unknown. `isBareRound(cycle, now)`: no date, stated status, form, counts or class list, in this or an earlier term, and at most stages that only restate the process ("Comp", "Auditions", "Application", undated). How to join lists the process and no round block, so profile and compare agree. A later-term round or a stage naming its term is never bare.
- **Closed without a date.** Product Lab's apply page says "Applications for the Fall 2026 semester have closed." (a stated status, §8), so the round is closed with no date. It now reads "Fall 2026 applications closed" (When, the round's pill, compare's Recruiting cell, rows during the term), and the When line's second line says "The club says so; no closing date given" when there is no next round to point to.
- **August is the fall round's.** Collegium Musicum's audition form says auditions run "Monday, August 31 through Friday, September 4". The opening was filed under `2026-summer` and the deadline under `2026-fall`, so the profile showed a past "Summer 2026 round · Opens Aug 31". `recruitingTermForDate` (core) is `termForDate` except that August belongs to the fall; extractors use it for a dated step's term when no term is named (deterministic 1.16.43, LLM grounding `g20`, community deadline proposals). `termForDate` itself is unchanged: August is still summer for "the current term".
- **Open through a no-cut process (joining-v5).** The Band's open quote explains its audition ("There's no need to sweat our auditions — anyone who wants to join the Band can join."). joining-v2 had made that `access: process` with `noCuts`, so the Band showed "Audition (no cuts)" and "Next round likely next fall", sat outside Open membership and Still time to join, and compare said it "uses an audition". It is now `access: open` with the audition kept in `general` and `noCuts: true`; `comp` stays false unless the no-cut process is a comp. It reads "Open membership (audition, no cuts)" and When "Anytime · Audition, no cuts"; How to join marks any no-cut comp, audition or tryout "(no cuts)".
- **Compare's summary leads with who can join now.** "Can join now: Kuumba (open membership); Band (open membership, an audition with no cuts)." lists open clubs and live rounds first (a live round is no longer repeated in the dates sentence); clubs that join the same way are named together ("HRO and Pitches both use an audition").
- **Announced rounds hide the pattern in How to join too.** The Pitches' How to join no longer says "Usually recruits in fall and spring" beside the announced Fall 2027 round.
- **Data.** Live values change after `pnpm hci resolve` (joining-v5) and, for Collegium, `enrich --offline` plus `retract-unreproduced --extractor=site-deterministic --field=cycle.opens_at` (the Aug 31 opening is re-read under 2026-fall; the summer claim is retracted as not reproduced), then a rebuild. Tests: `packages/db/test/past-rounds.test.ts`, `packages/pipeline/test/august-term.test.ts`, `packages/core/test/joining.test.ts`, `apps/web/src/lib/{join-timing,row-status,compare-summary,joining}.test.ts`.
