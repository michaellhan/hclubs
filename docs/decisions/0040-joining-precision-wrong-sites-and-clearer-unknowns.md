# 0040: Joining-mode precision, wrong-site cleanup, path-scoped crawls, clearer unknowns

**Status:** accepted (amends ADR 0036 on "At a glance", ADR 0039 on link-graph anchors, ADR 0034 on intents and presets)

## Context

A third $0 pass on 2026-10-01 to 02 looked for the few problems that most affect what a student reads, rather than for new features:

- **"Open membership" was often wrong.** Of 43 clubs tagged open, 24 also stated a comp, audition, application or tryout. Reading every quote showed three misreadings:
  - an open audition ("Everyone is welcome to audition");
  - events ("Our events are open to all students regardless of membership status", "FREE & OPEN TO ALL");
  - eligibility rather than selection ("Open to all Harvard College undergraduates" from clubs that comp).

  Separately, applications for **leadership roles** were read as how members join: "Apply to Join HUMA Board", "Board Applications", "To apply for a staff role", a show's venue application.

- **Wrong websites fed whole profiles.** A Harvard listing linking a national parent organization made it the chapter's site:
  - swe.org for Harvard SWE: 115 pages, with the national society's description, accounts and scholarship forms;
  - bestbuddies.org for PBHA's Best Buddies.

  Rejecting the link left everything those pages said active.

- **Shared hosts were crawled whole.** When a club's site was one page on someone else's host, every page on that host counted as the club's own:
  - an HBS club page on hbs.edu, so MBA admissions pages ("application-dates") were the club's;
  - a chapter page on a national foundation's site, so the other chapters' pages were Harvard's.
- **Ownership-v2 missed exact references.** It missed "Crimson Key Society (Key)", "The Harvard Din & Tonics official website", and a Harvard publication's "Black Students Association". References also attached to whichever website claim loaded first, sometimes a deep link a Wikipedia citation produced.
- **Undated posts produced dated deadlines.** "Applications are due by the time of the last exam on Dec. 21", on a news post that states no year, became a 2026 deadline.
- **Presentation:**
  - Natural queries required verbs ("play poker", "perform theater", "meet other Chinese students" found nothing or missed the obvious club).
  - Several intents matched on ambiguous words ("social and intellectual programming" → Build software; "drawing from backgrounds" → Make visual art).
  - The home page repeated topics three times (presets, intents, categories).
  - Profiles showed four identical "Unknown · Know …?" rows without saying why.

## Decision

### Joining modes

- **Open membership** (`openMembershipProblem`, `explicitlyOpen`):
  - "welcome to audition / apply" is a selective process anyone may enter;
  - "free & open to all", "registration required" and events "regardless of membership status" are events.
- **Club-level check.** Audit `join.open_beside_process`: when a club also states a selective mode, "open" needs a quote saying there is no selection. Examples that count: "no comp process", "anyone who wants to join can join", "no cuts".
  - On the club's own audition or comp page, only the strongest wording counts. "Just show up" on an audition page describes the audition.
- **Leadership applications.** `leadershipApplicationProblem` covers board, executive, officer, representative and staff-role applications, and a show's venue or production application. An application reviewed _by_ the board still counts. Shared by the deterministic extractor (1.15.0), LLM grounding (`g7`) and the audit.
- **Negation.** "does not have a comp process" is negated, like "doesn't require".
- **Range read as one number.** "generally with 40-50 members" read as exactly 50 is rejected (`member_count_range_read_as_one`).
- **Result:** 20 wrong "open" tags, 5 leadership applications, 1 negated comp and 1 misread member count were rejected, each read by hand first.

### Wrong sites (`disownSite`)

`hci reject-link <slug> <website>` now also:

- releases that site's pages (owner cleared, public-web tier);
- rejects, with a reason, every claim about the club that only those pages support.

Claims another source also supports stay. All of it is reversible.

Applied to swe.org (12 claims) and bestbuddies.org (45 claims).

### Path-scoped crawls

`pathScopedRoot` makes a club site that is one page or folder on someone else's host crawl only under that path. Two cases count as someone else's host:

- the host doesn't carry the club's name, acronym or initials;
- the path is a chapter page (".../harvard.html").

Exceptions:

- a generic first page ("/about") on the club's own host stays whole;
- shared hosts already keyed by path (Google Sites, HCS "~name", Wix) keep their rule.

A one-off rescope released the out-of-scope pages already owned: 146 hbs.edu pages, 61 Scientista foundation pages, and 2 others.

### Ownership-v2 anchors

`anchorForms` reads the club's full name out of three wordings:

- "Name (Acronym)";
- "Name official website";
- on Harvard-related pages only, a name missing its leading "Harvard" / "Harvard College" / "Harvard Undergraduate".

It never reads a part of the name or a looser match. Wikipedia's "<club> official website" counts like its infobox row. References land on the site's home-page claim (the shortest URL).

Result: Crimson Key Society, Black Students Association and Din & Tonics are verified; OAASIS's site was added through the curated list.

### Dates

- No year is inferred for a date on a news or blog post that states no year anywhere.
- No dates are read from a page titled as a production or venue application.
- The audit applies the same rule to existing claims (deterministic 1.15.1).

### Presentation

- **"At a glance"** (amends ADR 0036): Joining always shows. The other core facts show when known; the unknown ones share one "Not known yet: first-year eligibility, time commitment, size, dues" line, each a contribution link. The reason is said once:
  - "Not stated on the _site_ pages we've read" when the club's confirmed site was read;
  - otherwise "No source we've found says yet".

  It never claims an exhaustive search.

- **Search.** Request verbs and people words (play, build, make, perform, meet, other, people) are filler, except in a query made only of them. "website(s)" is a software term.
- **Intents.**
  - Ambiguous words are dropped (programming, lab, design, drawing, artists, jazz). Make visual art falls below the four-club minimum and is hidden, which is honest about thin data.
  - The cultural intent reads "Find a cultural or identity community", because its category also holds identity groups.
- **Home presets** are only the joining facts. Topics live in the intents and categories.
- **Category pages** hide "good to know" counts under five clubs ("Say they take first-years: 2 of 123" said more about missing data than about the clubs).
- **Aliases.** Profiles don't repeat the name and acronym as an alias.

### Public data boundary

- **The leak.** A hand check of the built pages found recruiting-cycle values (dates, stages, links) published with their internal confidence, best tier and source ids (86 profiles), and link verification scores in the compare data files. `publicProfile()` sent only the club's own fields through the allowlist, not each cycle's or the selectivity counts.
- **The fix.** Every resolved value now goes through `publicFields` / `publicValue`.
- **The guard.** The privacy scan gains `internal_score` (a non-zero confidence or best tier, or a source id, anywhere in the build), so the next value that skips the allowlist fails the publish.

### Operations

- `refresh.sh` runs `audit --check=facts,recruiting --apply` before reconciling. Error classes a new crawl or LLM run can bring back are rejected automatically (reversible, logged, and listed in the refresh's change summary). Link checks still only report.
- Name categories v4 settle 10 more clubs from unambiguous names: Blockchain, American Chemical Society, Pasifika, UNICEF, CrimsonEMS, College Bowl, Fed Challenge, "Business Association".
- PBHA's CHANCE (SOCO) merged into CHANCE (PBHA).

## Considered and not built

- **A new high-value-page discovery pass.** Club home pages link only 8 joining, recruiting or FAQ pages that weren't already stored; the crawler's role priority already finds them.
- **`hci next`.** `hci queue` already lists deadlines to confirm, fall recruiters without dates, missing application links, conflicts and uncategorized clubs. A second report would duplicate it.
- **Build size.** 178 MB, essentially all of it the HTML and RSC payload of 706 profile pages (see ADR 0039). There is no low-risk 10% left.
- **Description quality.** A pattern scan of all 418 one-liners found no junk classes, only a few long but accurate ones.
- **Ending Harvard Undergraduate Television.** Its stored article only calls its predecessor (HRTV) defunct, so there is no quotable ending.

## Consequences

- **Fewer false "anyone can join" answers.** "Open" now means a source says there is no selection. Some genuinely open clubs that only state eligibility lose the tag; unknown beats guessed.
- **One step to undo a wrong site.** Rejecting a wrong website is one step that also undoes what the site said.
- **Withheld data is checked.** Internal scoring is withheld everywhere a value is published, and the build is checked for it.
- **Unknowns are compact.** Sparse profiles no longer read as walls of "Unknown", and the reason distinguishes "not stated on its site" from "no source".

## Amendment (2026-10-13): club sites on Harvard hosts

**Problem.** `crawlableClubSite` never crawled six verified club websites. Its portal pattern matched every `*.seas.harvard.edu` host, so the Engineering Society (hces.seas) and the Photonics Club (photonics.seas) were treated as SEAS office pages. Its four-label rule skipped every three-label host, which dropped the sites.harvard.edu folders of the Classical Club, the Undergraduate Foreign Policy Initiative and STAHR, and the Wireless Club's w1af.harvard.edu.

**Decision.** These hosts count as a club's own site only when the link is verified, meaning a Harvard page listed it for the club:
- **SEAS subdomains.** A `<name>.seas.harvard.edu` host is the club's own unless it is a SEAS office or service host (`SEAS_OFFICE_HOST`: csadvising, events, news, www and similar).
- **sites.harvard.edu.** A folder there is a site of its own. `pathScopedRoot` always scopes it, and a scoped crawl stays in the first path segment even when the first page is deeper (`/foreign-policy/join-our-policy-program` → `/foreign-policy`). The bare host is never a club's site. Stored pages there that aren't the club's own (`/latinx`, `/math-community` listings) stay with the directory pass.
- **Other three-label hosts.** Every other three-label `harvard.edu` host we hold is an office, House, center or school, so a club's host must be listed (`CLUB_HARVARD_HOSTS`: w1af.harvard.edu, the Wireless Club's call sign).

Portals (thehub.college, engage.*, soco, careerservices.fas, other `fas`/`college` subdomains) stay excluded. `directorySourceType` is unchanged. Websites that a directory page newly lists during a run now go through the same rule.

**Not changed.** iop.harvard.edu is the Institute of Politics' own host. It is also listed for the IOP's index entry, but it stays a directory page and is not crawled as a club site.

**Effect on the live data.** Live enrich for the six clubs fetched 22 pages. The Classical Club, the Foreign Policy Initiative, STAHR and the Wireless Club gained:
- open membership for the Classical Club,
- College scope for two clubs,
- HUFPI's "over 100 active members",
- club emails, Instagram, Facebook and mailing-list links.

Six values were rejected after review because they came from history pages or said something else:
- the Wireless Club's 1909 professor paragraph as its description, and "averaged about 25 members" as its size;
- STAHR's logbook note as its description and its "Our Mission … &#8217; …" excerpt as its one-liner;
- STAHR's eligibility, from a telescope remark;
- STAHR's "open", from a mailing list and a discussion event.

hces.seas and photonics.seas answer our crawler with HTTP 403. They are not bypassed (§11.1), so those two clubs remain uncrawled until the block lifts.
