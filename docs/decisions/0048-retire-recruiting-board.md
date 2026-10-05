# 0048 — Retire the `/recruiting` board

Date: 2026-10-04 · Status: accepted (owner request: "very bad rn, no use, maybe even delete it")

## Context

The board (ADR 0031, 0036, 0041) sorted clubs into "what can I do" sections: due this week, open
now, opening soon, started, join anytime, usually recruits this term, missed/next round, closed.
On 2026-10-04 the live board opened with "No deadlines ahead that we know of", then 1 started
comp, 29 join-anytime clubs and 41 "usually recruits in fall and spring · next likely in
spring" lines. Of 692 clubs only 29 had any dated round and 50 a season pattern: most club
pages describe a process but never state dates (`docs/recruiting.md`). Outside the few weeks
of fall and spring rush the page was a list of patterns, not rounds, and every section repeated
something the directory already filters for (Recruiting now, Join anytime) or the profile
already says ("Missed this deadline?", When).

## Decision

- `/recruiting` is no longer a page or a nav tab. The static route remains as a noindex
  client redirect to `/clubs?recruiting=1` (amended 2026-10-05: the "Soonest deadline" sort was removed), keeping `category`, `join` and
  `class=first_year` (→ `freshmen=1`) so old links and shares still land somewhere sensible.
  Removed from the sitemap.
- The home page link reads the index on the reader's day: "N clubs recruiting now" when a
  round is open, else "Clubs you can join anytime" (`JoinNowLink`). It never links to an
  empty list. Amended 2026-10-05 (owner): the fallback is "Browse N clubs" instead, because
  the join-anytime list held 29 of 692 clubs and read as "only these"; the home page's
  /match link was dropped (it stays in the header nav).
- The directory's empty state for "Recruiting now" says "No open applications we know of
  right now" and offers the join-anytime clubs under the same other filters.
- Header nav: Directory, Match, Compare, Saved (Compare no longer hides below `sm`).
- Kept: the pure section builders (`buildBoardSections`, `buildNextChances`) still drive the
  profile's "Missed this deadline?" and compare's "Next chance"; category pages keep their
  "Recruiting now in <category>" list, shown only when non-empty.

## Consequences

During rush the directory with "Recruiting now" + "Soonest deadline" covers what the board's
top sections did. What's lost is the one-page "next likely in spring" list; it was a pattern
students can read on each profile. Revisit a dedicated page only when dated coverage is real
(e.g. club officers submitting deadlines through `/for-clubs`).
