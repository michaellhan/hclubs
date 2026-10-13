# 0031: Targeted recruiting pass and recruiting quality audit

**Status:** accepted (M4 groundwork)

## Context

Recruiting information (deadlines, opening dates, application forms, stages) is the most useful and the least covered part of the index: 39 of 718 clubs had any deadline, and 10 had one still ahead (audit in `docs/recruiting.md`). The general enrichment crawl treats joining pages as one role among many, caps a site at six pages, and was built before most clubs were indexed. Two correctness gaps also showed up in the audit:

- **Wrong terms.** A deadline's term was taken from the first term mentioned anywhere on the page, so 2026 dates were filed under "Fall 2016" or "Fall 2020" cycles.
- **Guessed years.** A month and day with no year took the year nearest the crawl date, so an old "due September 18" page could produce a current deadline.

## Decision

- **`pnpm hci recruiting`** runs a recruiting-only pass with these options: `--club`, `--missing-only`, `--stale-only`, `--limit`, `--search-budget`, `--no-ai`, `--budget`, `--dry-run` and `--audit-only`. For each club it does the following, in order:
  1. **Own site.** It reads the home page and follows only links that score as joining or recruiting pages (`scoreRecruitingLink`, which weighs words like apply, comp, audition, tryout, recruiting, join and new members, minus news and archive paths). It follows them best first, to depth 2 and at most 5 pages, plus matching sitemap URLs (`crawlSite({ focus: "recruiting" })`).
  2. **Application forms.** It reads the forms those pages present as the club's application: Google Forms, Typeform, Airtable, Jotform, Microsoft Forms, Tally and similar. It reads only the title and public description (§21), and skips feedback, merch and RSVP forms.
  3. **Search fallback.** This runs only when the site has no recruiting page and `--search-budget` allows it. It sends one capped Brave query per club, either `site:<domain> (apply OR … )` or `"<name>" Harvard (apply OR …)`. Results are cached for 30 days and scored. News, social and Harvard portal hosts score 0, and a page on another host counts only if its title names the club.
  4. **Classification.** Each page is classified (`classifyRecruitingPage`) as one of `active_application`, `recruiting_info`, `historical`, `membership` or `irrelevant`. A historical page has only past years, or an explicit past term with nothing later. It keeps its snapshot but yields no cycle facts.
  5. **Extraction.** Deterministic extraction runs first, then the LLM on up to 3 active or informational recruiting pages per club, within the budget. Claims are written through the same `writeExtractedClaims` path as enrichment.
  6. **Quality audit.** `auditRecruiting` runs over all recruiting facts.
- **Date and term rules** apply to both the deterministic extractor (1.6.0) and LLM grounding (revision g4):
  - "Open until <date>" and "no later than" count as deadline cues.
  - A weekday-only phrase ("this Friday") is never resolved against the crawl date.
  - A month and day with no year is refused on a page whose latest year is already past.
  - The term comes from the sentence, else its section heading, else the date itself. An explicit term must contain the date in its recruiting window (`dateFitsTerm`). Spring recruiting may start the previous October, and fall recruiting may open in April. Otherwise the date is dropped as ambiguous.
- **Join process and stages:**
  - Join modes add `invite_only` and `attendance_based`. "No auditions", "non-auditioned" and "without a tryout" no longer read as selective processes.
  - Explicit stage lists on joining or recruiting pages become `cycle.stages`. It needs at least two named stages, each label verbatim, with one stage per phrase.
- **The quality audit rejects** (status `rejected`, with a reason; nothing is deleted):
  - dates outside their cycle's term window;
  - terms outside 2000 to next year;
  - cycle facts with no evidence;
  - application URLs that are neither an application system nor the club's own site;
  - one application URL claimed by several clubs;
  - an "open/closed" status taken only from news coverage;
  - the same date recorded under two terms (the semester it recruits for is kept).
- **Display:**
  - A past term's cycle is never "current". `computeCycleStatus` and the SQL `recruitingNowPredicate` treat a stated "open" from an earlier term, with no date ahead, as unknown, and profiles no longer feature a past term's cycle.
  - Recruiting cards show their source host and the date it was checked.
  - Deadlines within three days are amber.

## Consequences

- Recruiting facts can be refreshed on their own, without a full-site enrichment, cheaply and within explicit search and LLM caps.
- Some previously shown dates are gone because they were wrong (filed under the wrong term). Coverage numbers before and after are in `docs/recruiting.md`.
- Most clubs still have no public recruiting dates: their deadlines live on Instagram or in HarvardKey systems we don't read. Submissions remain the path for those (ADR 0027).

## Amendment (2026-10-12): scoped crawls, off-site pages and guessed years

A paid coverage pass (395 Brave queries, about $1.15 of LLM calls) found three rule-level faults. Each was fixed with a regression test, and the wrong claims were rejected with reasons:

- **The pass ignored path scoping (ADR 0040).** It crawled a club page that is one folder on someone else's host (ruf.org/ministry/hucf) across the whole host. Reformed University Fellowship's national staff-hiring dates then landed on HUCF as tier-2 club facts (13 claims). The pass now uses `pathScopedRoot` for its site crawl, its sitemap hints and its "own site" test for search results. A folder named for the club also scopes the crawl: the Institute of 1770's `hastypudding.org/hasty-pudding-club` stays off the Theatricals' `/comp` page (4 claims).
- **Search results for generic names.** A search result off the club's own site now counts only when its title names the club *and* it places the club at Harvard (`offSitePageAboutClub`): "Harvard"/"Radcliffe" in the title, or within a few words of the club's name in the text. Before this, "Summer Science" matched an admissions consultant's page about the high-school Summer Science Program (11 claims). "Sigma Chi" matched the national fraternity's scholarship portal and recruitment kit (9 claims, including a staff member's personal email).
- **Guessed years the page contradicts.** `inferredYearProblem` (shared by deterministic extractor 1.16.36 and LLM grounding g16) drops a month/day whose inferred year disagrees with the academic year the sentence names ("auditions for the 2025-2026 school year on Sept 16"). It also drops one that falls well outside a dated post URL (`/shows/2025/9/16/…`). The same release made a hackathon's attendee applications ("another participant's place") outsider applications.

## Amendment (2026-10-13, student testing round 3; extractor 1.16.38, grounding g17)

- **Conference registration pages** (`conferenceRegistrationProblem`, shared by the extractor, LLM grounding and the audit): a page where delegates or delegations register ("college students are not eligible", MUNager, per-delegate fees, or three of delegates / high school / faculty advisor / registration deadline / "university students pursuing") gives no join modes, eligibility, recruiting seasons, dates, dues or selectivity, unless it also recruits the club's own staff (IRC Common App, staff applications). Audit `recruiting.conference_registration` rejects older claims from such pages and "apply" links that lead to one. HMUN lost "Application · First-years eligible", HNMUN "rolling". No HMUN/HNMUN page says how undergraduates join their staff, so that stays unknown.
- **Applications for a named year**: "Applications for our 2026–27 season are now open! All applications are due February 6" dates a spring deadline to the spring before the season; the paragraph around the sentence counts (Fed Challenge's guessed Feb 6, 2027 dropped).
- **Past-cycle forms**: `check-forms` reports pages whose title names only a past term ("IRC Common App: Fall 2025"); the audit also reads a term code in an application link's path ("/f25") before the page is ever fetched.
- **Stage order**: stages named in one paragraph take the usual process order (info session → application → tryout), not the order of mention; separate blocks keep page order.
