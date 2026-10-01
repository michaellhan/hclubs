# 0037: Trustworthy recruiting data, sharper ranking, honest labels

**Status:** accepted (amends ADR 0034's search scoring and similar clubs; extends ADR 0033's audit)

## Context

A quality pass on 2026-10-01 asked "is what we already show right?" rather than "what is missing?". It ran a search benchmark over ~120 real queries, read every current-term recruiting date with its evidence, and grepped the crawled text for facts the extractors missed. It found:

- **Recruiting dates that weren't recruiting.** Three of six "Recruiting now" items on the home page were applications for _outsiders_: a high-school conference's scholarship forms ("Scholarship Applications are due on October 8th"), a conference's attendee rounds ("Conference Attendance Fee: $90"), and a high-school essay contest ("Entries close October 2"). Others had guessed years: a 2016 news post ("Spring ’16 PRE-APPLICATION — due 11/22") became a deadline "in 52 days", and a 2024 audition page an October 2026 deadline. A newsletter's weekly "due at 2:00 pm on Sunday" became a deadline, and a club blog's re-shared job ads ("BIT is Hiring in London, Apply by…") became its cycles.
- **Join modes that say the opposite of their quote.** "There are no tryouts" → _tryout_; "our non-audition policy" → _audition_; "we have no comp process" → _comp_ — written by older extractor versions or the LLM, never retracted.
- **Labels that claim more than the evidence.** "No comp or application" included 156 clubs whose only evidence is the College directory's _no comping requirement_ flag (dance companies and orchestras among them). "Open to first-years 37" on a 708-club site read as "only 37 do".
- **Search.** `lgbtq` and `first-gen` returned nothing; `rowing` was "corrected" to _growing_; `mun` listed Model Congress as a name match; a club whose description says "improv comedy troupe" ranked below a children's theater program.
- **Similar clubs.** Clubs with no description "matched" on the directory's category label ("creative performing arts") and were explained as "Similar description"; sparse clubs got an arbitrary list of same-category clubs.

## Decision

### Recruiting evidence (shared rules: extractors, LLM grounding, audit)

`evidence-rules.ts` gains, and every path applies:

- `outsiderApplicationProblem(sentence, pageText)`: a scholarship, financial aid, contest entries, delegates/attendees or a job posting in the sentence; or, within ±500 characters on the page, a program for high-school students, an essay contest or a conference fee — unless the page also recruits members or staff. Only nearby text counts: a club page that mentions a high-school outreach project elsewhere still recruits its own members.
- `outsiderLinkProblem(...)`: an "application" link whose label, path or host page is a scholarship, delegate or contest form. "Register" alone is not enough (club sports register for tryouts).
- `negatedProcessProblem(mode, quote)`: every mention of the process is negated ("no", "non-", "without", "don't hold").
- `pageYears` reads apostrophe terms ("Spring ’16"; never "Class of ’29") and hyphenated URL years (`/spring-2016-applications`).

New audit checks (high confidence, fixed with `--apply`): `recruiting.outsider_application`, `recruiting.outsider_link`, `recruiting.year_guessed_on_old_page` (every source page's latest year is before both the crawl year and the date's year), `recruiting.weekday_only_date`, `join.process_negated`. The audit now loads page text for active recruiting dates. Extractor `site-deterministic` 1.8.0, LLM grounding `g6` (reruns replay from cache).

Applied: 73 claims rejected (with reasons; reversible), including `retract-unreproduced` for claims that site-deterministic 1.7.2 no longer produces from the same snapshot.

### Labels say what the evidence says

- The `open=1` filter is **"No comp needed"** (it was "No comp or application"); its help says a directory flag alone doesn't rule out an audition or application. Profile alternatives say "Open membership — anyone can join" or "No comp needed, per the College directory", and list clubs that state open membership first.
- The first-year filter and preset are **"Say they take first-years"** (the category page's wording), with help text that most clubs don't say either way. Row and board pills read "Takes first-years" and use the filter's rule (`matchesFirstYears`, which includes stated class years), not only the boolean field.

### Search scoring (amends ADR 0034)

- **Abbreviations:** a related multi-word phrase in a name counts as the name itself only when the query abbreviates it (`abbreviates`: "mun", "cs", "model un"). "web development" is no longer a name match for _Computer Science_.
- **Related words in text are ranked** like related words in names (most telling first; ties only).
- **Corroborated description match:** +3 when the description says the word and a related one ("improv comedy troupe") and the club is not in the concept's category — standing in for the missing category, so it never lifts a description match above a club named for the topic. Concepts without categories get no bonus.
- A multi-word phrase listed verbatim among activities ("web development") counts like a description mention.
- **Spelling correction keeps the first letter** (or a swap of the first two). People rarely mistype it, and allowing it turned real words into others.
- New concepts: _LGBTQ+_, _First-generation & low-income_ (without "low income" as evidence: programs that serve low-income families say it too), _Mental health & wellness_ (split from _Health_, where every club named "…Health…" outranked peer counseling).

Rejected alternative: strictly ordered tiers (any literal description mention above any related name word). It surfaced passing mentions ("programming" meaning events, "manages its finances") above clubs plainly about the topic.

### Similar clubs (amends ADR 0034)

- Description-word overlap counts only between clubs that both have a description.
- Two explainable signals: a distinctive word in both names (`“Queer” in both names`) and a shared search topic (`Also software & computer science`), excluding broad topics the categories already cover.
- One shared category alone is never "similar": the list needs a name word, topic, description overlap or two shared categories.
- At most two reasons per club, most telling first.

### Maintenance tools (no network, no paid calls)

- `pnpm hci snapshots search <regex> [--missing=<field>]`: grep the latest crawled text of club pages (pages the crawler fetched for the club, and single-club official pages; never press or stored search responses).
- `pnpm hci opportunities`: clubs showing "Unknown" whose own pages have wording that often states the value. **Finding:** on 2026-10-01, among 2,500 such pages, genuine missed statements were rare (eligibility leads were mostly bios — "is a first-year in Matthews Hall" — or sub-programs). Low coverage of eligibility, hours and size is a source problem, not an extraction problem; more crawling of the same pages won't fix it.
- `pnpm hci queue` starts with deadlines in the next three weeks, to confirm on the club's page.
- `packages/db/scripts/search-report.ts`: the ranking benchmark (top results with reasons for ~120 queries over the built index), for diffing runs.

### Other

- Static 404: a `/clubs/…` link that differs only in case or separators (GitHub Pages is case-sensitive) redirects; otherwise the closest names are suggested.
- Category pages render rows from the index, like the directory (specific categories only; the directory's "No comp" flag).
- The compare summary says "open, attendance-based membership", not "an attendance-based".

## Consequences

- The home page's "Recruiting now" and the board show only member recruiting with stated or page-supported years. Fewer items; each one is safer to act on.
- "No comp needed" and "Say they take first-years" are less inviting labels than before, but true for every club they include.
- Search and similarity remain small, explainable, and covered by regression tests (`search-ranking.test.ts`, `discovery.test.ts`).
