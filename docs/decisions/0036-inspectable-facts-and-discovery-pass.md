# 0036: Inspectable facts, honest joining state, and a discovery/maintenance pass

**Status:** accepted (amends ADR 0028's "no source popovers on values")

## Context

A product pass on 2026-10-01 looked at hclubs through the jobs students bring to it: find clubs for an interest, find what they can still join, check whether a fact is trustworthy. It found:

- **Search:** no match for a club's initials ("hccg"); "theatre" ≠ "theater"; "robot" ≠ "robots"; "math" matched _Mather_ House; "hiking" matched every sports _team_ (the sports concept listed "team"); "gaming" matched beekeeping through the _Hobbies & Games_ category name; acronym-word matching silently never fired on real data (the index ships acronyms uppercase); explanations said "name" for a related-word hit, which read as false.
- **Honesty bugs:** the profile's coral **Apply** button pointed at last cycle's closed Google Form; a "Decision Released: Nov 16" date was stored as an _opening_ date; times on DST-change days got the wrong UTC offset; timed dates never showed a year; "tomorrow" was computed from elapsed hours, not campus days; a February deadline counted as "recruiting now" in October; old "closed" cycles with no date appeared as "recently closed".
- **Filters:** checkboxes were uncontrolled, so removing a chip or pressing Back left them checked; "Open to first-years" ignored stated eligible class years; no counts; empty groups shown.
- **Trust:** ADR 0028 removed every per-value badge and popover. Facts were clean but uninspectable short of opening a collapsed list of every source.

## Decision

### Facts open to their sources (amends ADR 0028)

Values still display plainly — no badges, no freshness text. Each fact in _At a glance_ (and recruiting-season and cycle facts) is a native `<details>` disclosure: tapping it shows the source kind in human terms ("Club website", "Harvard page", "Student report"), the site, and when we last saw it there. No JavaScript, no confidence numbers. When the resolver flagged a conflict, the fact says "sources differ" and, for structured fields only (`PUBLIC_ALTERNATIVES`: member count, hours, first-year eligibility, class years, recruiting seasons, org type), lists what each source says. Free-text alternatives stay internal (they can name people; launch audit).

### Unknown is shown, not hidden

The core glance rows — joining, first-years, time, members, dues — always appear. Unknown reads "Unknown" with a prefilled, field-specific contribution link ("Know the time commitment?"); "Not eligible" is a stated fact and never looks like unknown. A club with none of them known shows one plain sentence instead of five Unknown rows.

### Joining state is computed live and never oversells

- A one-line status under the description ("Fall 2026 applications due Oct 2 (tomorrow)", "…closed Sep 5 · usually recruits in fall", "Usually recruits in fall · no current dates on record") is computed in the browser.
- The featured application link is primary ("Apply · due tomorrow") only while its dated cycle is open, or "Join" for open-membership clubs. A link tied to a closed cycle reads "Fall 2026 application (closed)"; an undated application page reads "How to apply".
- `computeCycleStatus` ignores an opening date that falls after the deadline (contradictory sources; the deadline is the actionable fact), and treats a later term's deadline more than `FAR_DEADLINE_DAYS` (75) away as `upcoming`, not recruiting now.
- The recruiting board adds "Started this term, no deadline listed" (opened within 60 days, no deadline) with a warning that it may have closed.

### Search: typed reasons, initials, word variants, narrower concepts

`MatchReason` is a typed union rendered by `reasonText` ("Description mentions “trading”", "Music: “orchestra” in the name", "Initials HCCG", "Also known as …", "Category: A cappella"). Initials of the canonical name match as a search-only signal (never displayed as an acronym). `wordVariants` adds plural/singular and US/UK spellings without a stemmer. Only the last query word matches as a prefix. Concepts were split (software vs technology, robotics vs engineering, music vs singing, games vs hobbies) and gained math, economics, data, film, outdoors. A multi-word query with no full match shows clubs matching part of it, labelled as such.

### Filters, facets, alternatives, compare

- Facet counts per option (`facetCounts`, standard OR-within-group semantics); zero-count options and empty groups hide; zero results suggest the single filter whose removal helps (`relaxations`).
- New **No dues** filter: 307 clubs have "no dues" stated by the College directory (coverage 44%); unknown dues never match. Hours (2%) and member counts (5%) stay out of the filters.
- Profiles of selective or closed-cycle clubs show similar clubs still recruiting or open to anyone ("Missed this deadline?"), picked by the existing similarity rule and filtered live.
- Similar clubs keep one club per look-alike name family. Compare adds a deterministic summary of structured facts, "only rows that differ", and "Unknown" instead of "—".

### Maintainer tools

`pnpm hci explain <slug> [field…]` (every claim, its evidence, and which is shown), `coverage` (field coverage overall and by category), `queue` (missing facts most worth finding), `privacy-scan` (personal data in the built site), and an `invariants` audit group (opens after deadline, admits > applicants, implausible numbers, empty values, non-web link protocols, tracking parameters).

## Consequences

- Profiles are longer by one status line and a fixed glance box, but every fact is one tap from its source.
- `deterministic` extractor 1.7.1 (results dates are not openings); the time parser's DST fix changes stored values only for times on clock-change days.
- Static index: written aliases and `noDues` added (~1.5 KB gzipped); rows list specific categories only (the broad parent stays searchable).
