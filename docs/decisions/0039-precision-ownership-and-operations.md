# 0039: Recruiting precision, ownership-v2, extraction passes, and safe operations

**Status:** accepted (amends ADR 0017 and 0038 on link ownership, ADR 0033 on retractions, ADR 0038 on scope and publishing)

## Context

A second $0 pass on 2026-10-01, looking for second-order problems rather than new features:

- **Recruiting dates.** Reading all 21 live cycles found three wrong ones:
  - the Crimson Business Board showed its _second-round_ due date (Sept 24) instead of the first-round application (Sept 10);
  - the Clean Energy Group showed its _priority_ deadline;
  - Fallen Angels' two audition days read as "started, no deadline".
- **Phantom cycles.** "Spring 2027" was listed on a page last updated in 2022: the dates had been rejected for their guessed year, but the stages read from the same sentence kept the cycle alive.
- **Retractions.** `retract-unreproduced` could not see a page where a newer extractor version found _nothing_, which ADR 0038 recorded as a known limitation. In the other direction, a claim rejected only as "not reproduced" stayed rejected after a later version produced it again.
- **Ownership.** 137 websites were "probable" on a title match alone. 49 of them are linked from pages we already store (the Crimson, the Independent, Wikipedia, sister clubs), many by the club's exact name.
- **Scope.** Several program pages describe their own members ("an undergraduate-run think tank"). Conversely, a choir page "open to … students from Harvard and other area universities" was read as the club's school.
- **Operations.** Maintenance had several gaps:
  - nothing listed which displayed values a resolver, ownership or extractor change rewrote;
  - there was no backup;
  - publishing force-pushed with no comparison and no way back;
  - the crawler would fetch any URL a page linked, including 127.0.0.1 and private addresses (SSRF).
- **Presentation.** Ranking and sorting carried a hidden documentation bias:
  - "Most complete" was a sort option;
  - search broke ties by completeness;
  - "Recently updated" sorted by crawl times.
- **Size.** Profiles repeated the same long class lists in the HTML and three RSC payloads.

## Decision

### Recruiting precision (extractor 1.13–1.14, audit)

- **Later steps.** A second- or final-round deadline, or a priority or early deadline, is not the application deadline (`laterStepDeadlineProblem`, shared with the audit). A form or page titled as a later round ("… Second Round Application") gives no dates and no apply link.
- **Layout.** A deadline label on its own line followed by the date on the next ("First Round Application Due" / "Thursday, September 10th") is read.
- **Auditions.** A sentence listing audition or tryout days closes the window on the last listed day.
- **Links in page bodies.** They count only on pages about the club (home, about, contact, join, recruiting, FAQ), never on articles. The club's own forms and mailing lists count on its other pages, except events, team, sponsors and projects pages. A social handle that carries the club's name counts anywhere.
- **The club's own name.** It is removed before the outsider rule reads a page title ("Capital Partners" is not a partner form). `/auditions` pages are joining pages.
- **Phantom cycles.** Audit `recruiting.term_from_rejected_dates` rejects a cycle's stages, process and form when every page they came from had its dates for that cycle rejected _for their year or term_. A later-step or event rejection doesn't count, because the term was right.
- **Former names.** A former name a club states on its own about/home page ("formerly known as …") becomes a `former` alias (1.14.0).
- **Review.** `hci recruiting-review` lists every live cycle with its board section, source page, fetch date and quote. It is meant to be read in full before publishing.

### Extraction passes (`snapshot_extraction`)

- **Recording passes.** Every (snapshot, extractor, version) pass is recorded, including one that produced nothing. `retract-unreproduced` uses it, so a page where the new version finds nothing counts as re-read.
- **Revival.** A claim whose only rejection reason is "not reproduced by X@v" comes back when a later version of X produces it again. Editorial and audit rejections always stick.
- **Amendment (2026-10-13): LLM passes.** `site-llm` records a pass only for pages every request covering them ran or replayed from the cache (`LlmCoverage`; a refused, failed, budget-skipped or dry-run chunk leaves its pages unread), and `retract-unreproduced` counts a `site-llm` page as re-read only through that pass, never through evidence alone (`requirePass`), so a replay that misses part of the cache under `HCI_PAID_APIS=off` retracts nothing on the pages it missed.
- **Offline replay.** `enrich --offline` reads all of a club's application links (stored, free) instead of the live cap of three.

### ownership-v2

A title-matched ("probable") site becomes verified when someone independent links it **under the club's own name**. Name similarity alone never promotes a site. Independent links are:

- a Harvard-related page (tier ≤ 7: the Crimson, the Independent, the HPR, Hillel) whose link text is the club's name, alias or acronym;
- Wikipedia's article on the club, through its "Website:" or "Official website" row;
- two other sites with different registrable domains, both linking it by the club's name.

`link-graph` v2 records these references as evidence on the existing website claim. The signal is visible in `club_link.signals` ("names the club, and harvardindependent.com links it by the club's name"). Result: 16 sites promoted, each checked by hand.

The re-crawl that upgraded their pages to tier 2 changed 133 displayed values. Each was reviewed in the projection diff:

- 109 of the clubs' own accounts and forms went from unverified to verified;
- 10 one-liners moved from Wikipedia list fragments to the clubs' own text;
- 7 statuses went from "likely active" to "active".

A stored home page whose main heading _is_ a long (4+ word) club name is that club's site even when the domain uses the club's own short name (harvardicmun.com).

### Scope (scope-statements v3–v5)

- **Who may join is not where a group belongs.** A sentence opening membership beyond Harvard ("other area universities", "recent graduates") states no school.
- **Program pages.** Statements of their own members count: "an undergraduate-run think tank", "spearheaded/run/staffed by undergraduate students", "a hub for all Harvard College students", "Harvard College students only".
- **Still not evidence:** "student-run" alone (graduate groups are student-run too) and "led by Harvard undergraduates <names>".

**Unknown-scope policy (ADR 0038 kept, now with data).** Of 21 live cycles:

- both graduate groups with dates already had sourced scope and were excluded;
- all 7 unknown-scope clubs with dates are undergraduate groups by their own sites.

Requiring positive undergraduate evidence would remove 7 genuine entries to prevent no observed false positives, so unknown stays on the board.

**Listing semantics.** Presence in a listing implies only what the listing states:

| Listing                                                  | Implies                                                                               |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| SOCO                                                     | College scope, recognition and existence at that date                                 |
| PBHA / IOP / career-services / SEAS / Hillel / Wikipedia | Nothing about scope, except through statements on the club's own page in that listing |

### Tools

| Command                                   | What it does                                                                                                        |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `hci projection save` / `projection diff` | Saves what the site shows; later lists every displayed value that changed, with source before and after             |
| `hci resolve --diff`                      | The same, around a re-resolve                                                                                       |
| `hci name-only --diagnose`                | Groups name-only clubs by why they are name-only, with the next action                                              |
| `hci lifecycle --candidates`              | Leads for the editor's list of organizations that ended or were renamed                                             |
| `hci backup` / `restore`                  | Logical backup: gzipped NDJSON per table plus a checksummed manifest; restore only into an empty, migrated database |
| `hci snapshots verify`                    | Checks every snapshot blob exists, decompresses and matches its hash                                                |
| `scripts/backup.sh`                       | Database plus incremental snapshot copy, to any folder or drive                                                     |
| `scripts/rollback-pages.sh`               | Re-publishes the previous build                                                                                     |

### Safety

- **Crawler.** It refuses:
  - non-http(s) schemes and URLs with credentials;
  - local host names;
  - private, loopback, link-local and metadata addresses, including public names that resolve to them.

  It follows redirects itself (at most five), checking every hop.

- **Publishing.** `publish-pages.sh` compares the build with the last publish:
  - club pages, clubs, websites, cycles and file and byte counts;
  - files added or removed.

  It refuses a collapse: more than 10% fewer pages or clubs, the index 30% smaller, websites halved, or every cycle gone (`PUBLISH_ALLOW_DROP=1` overrides). It keeps the current and previous trees so `rollback-pages.sh` can restore the previous site in one push.

- **Refresh.** `refresh.sh` saves the projection first and logs what the run changed.
- **Public profiles.** `publicProfile()` publishes field values and sources from an explicit allowlist. Confidence, best tier and source ids are withheld.

### Presentation

- **Sorts.** "Recently updated" (crawl times) and "Most complete" are no longer offered. Old links get the default order.
- **Search ties** go by name, not completeness.
- **Natural queries.** Request words ("learn", "want", "join", "find") are filler: "learn to code" finds coding clubs.
- **Home.** The static chip goes to the recruiting board. An empty "Recruiting now" box points to what's opening soon and who usually recruits this season.
- **Compare** says once that Unknown means no source was found.
- **Name-only profiles** say when the links shown are unconfirmed.
- **Build size.** The 12 longest repeated class lists became named Tailwind utilities with the same CSS. The build went from 204 to 183 MB on disk (file bytes 169 → 152 MB), and the largest profile's HTML from 159 to 138 KB. `index.txt` and the page-segment payload both stay: the router requests each.

## Consequences

- **Reviewable changes.** A trust or extractor change can now be inspected before publishing, value by value. Retractions are complete in both directions.
- **Replays are free but not neutral.** Reading 40 pages per site once pulled other organizations' links from a publication's articles into its profile. The projection diff caught it, and the body-link rule now prevents it. Run a diff after every replay.
- **Ownership stays conservative.** 121 sites remain probable; most have no independent named reference yet.
- **Backups and rollback are local.** The owner chooses a destination (`scripts/backup.sh /Volumes/…`) to survive losing the laptop.
