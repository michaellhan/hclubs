# 0038: School scope, organization endings, site ownership, free source discovery, safe publishing

**Status:** accepted (amends ADR 0017's link verification, ADR 0020's activity heuristic, ADR 0029's refresh, ADR 0033's audit and ADR 0034's category ordering)

## Context

A coverage-and-correctness pass on 2026-10-01, run with a $0 external-service budget, started from two reported bugs and found the classes behind them:

- **Scope.** The Harvard Law Entrepreneurship Project showed under "Recruiting now". Its scope was `unknown`: only the College directory (SOCO) ever stated a scope, and the recruiting board, unlike the directory, never filtered graduate-school groups anyway. 159 of 708 clubs had no scope.
- **Endings.** The Undergraduate Council (replaced by the Harvard Undergraduate Association in 2022) was "active". No source in the corpus said it ended, and the activity heuristic counted its **rejected** 2020 election dates as "recruiting within 8 months": `resolveClub` built activity and source signals from every claim, whatever its status.
- **Sparse clubs.** 150 clubs were known by name only and 197 were sparse. A link-graph analysis of 3,110 stored pages showed most name-only clubs come from the owner's text copy of SOCO, which has no links: mining our own pages can find sites for roughly ten of them, not a hundred. The gap is a source gap.
- **Ownership.** 131 clubs' websites were "probable" (the page title names the club), so their pages stayed tier-8 public web. Independent ownership evidence is rare offline: only one such club also had an independently confirmed social account. `verifyLink` accepted a reciprocity signal that the projection never computed.
- **Presentation bias.** Category pages listed "most complete profiles first". Completeness mostly measures how readable a club's sources are, which buried cultural, religious and service groups.
- **Build size.** 289 MB on disk, of which 44 MB was `__next._full.txt` (byte-identical to `index.txt` and never requested by the client in `output: "export"`) and 41 MB was share cards.
- **Publishing and cost.** `publish-pages.sh` force-pushed whatever repo it was given and checked neither the audit nor the privacy scan. `refresh.sh` had no lock. An unpriced model counted as free against LLM budgets, and concurrent enrichment workers could all pass the budget check at once. There was no way to run the CLI with the paid keys in `.env` switched off.

## Decision

### School scope from statements, not names

- A new extractor, `scope-statements`, reads **self-describing** sentences on a club's own pages and on directory pages about it: "X is a GSAS student organization", "membership is open to all HLS students", "a student organization at Harvard Law School", "open to all Harvard undergraduates", "undergraduate and graduate students". Mentions ("featuring HBS students") and audiences ("Events are open to…", "the competition is open to…") don't count. A page that points at two different scopes states nothing. Names are never evidence (CLAUDE.md §3).
- A site the school itself hosts for its groups (`orgs.law.harvard.edu`, `clinics.law.harvard.edu`, HBS student-club pages, …) implies the school as an `inferred` claim.
- New field `club.school` (multi; College or a graduate school). A non-College group gets a header pill ("Harvard Law School group"); College groups get none and unknown says nothing.
- The recruiting board (static and Postgres, kept in parity) leaves out graduate-school groups unless the reader picks "graduate", and never shows inactive or ended organizations (`boardEligible`). Unknown scope stays in: unknown is not "graduate".
- Directory browsing already hid graduate groups and ended organizations. A **search that names** such a club (its acronym, an alias, or a phrase of at least two words from its name) still finds it, labeled.

Result: HLEP is an HLS group (its own page says "membership is open to all HLS students") and is off the board. Unknown scope fell from 159 to 151; 38 clubs gained a sourced or school-hosted scope.

### Endings are sourced, and a successor is not a merge

- `club.lifecycle` (`dissolved` | `replaced`, year, successor) is written only by `pnpm hci lifecycle`. It reads the editor's list in `packages/pipeline/src/curated/lifecycle.ts`, fetches each evidence page politely, and records the ending only if every listed quote appears verbatim. The page is the evidence, at its own tier, so `explain` shows what says the club ended.
- A replaced organization keeps its own page (search finds it, old links work) with a notice: "No longer active. … was replaced by [successor] in 2022. This page is kept for reference." It also shows the source. Joining actions, how-to-join and alternatives are hidden.
- A rename of the **same** organization is a merge, as before. The HSPDS→HCDU and SEDS→HUAC duplicates were merged; their pages say "formerly".
- `activity-v3`: a stated `defunct` never wears off with age, unlike a stated "active".
- `resolver-v3`: activity signals, source counts and "last observed" use **live claims only**. Copyright footers ("© 2026") no longer count as a recent year on the club's site.

### Site ownership (ownership-v1, amends ADR 0017)

A site whose own title names the club ("probable") becomes the club's verified site when a second, independent signal agrees:

- it links to an account that Harvard or an editor confirmed for the club, or
- Harvard hosts it as a student-group site (`hcs.harvard.edu/~x`, `*.hcs.harvard.edu`, `orgs.law.harvard.edu`).

Name similarity alone never promotes a site. Promotion upgrades the site's pages to tier 2 at the next crawl (`upsertSource` never downgrades). Few sites qualify today; independent ownership evidence is itself a source gap.

### Free source discovery: the link graph

`pnpm hci link-graph [--dry-run] [--fetch=N]` reads the latest snapshot of every stored HTML page:

- **Anchors:** links whose text is exactly a club's name, alias or acronym. Keys shared by two clubs and one-word names are dropped.
- **Orphans:** stored home pages no club owns, whose title names a site-less club **and** whose domain carries its name or initials (`hulr.org`, `harvardgaasa.com`). A title alone matched athletics and shop pages to "Harvard Crimson".

A site is attached (probable, like the finder's) only when its home page passes `siteIdentity`. The referring page is kept as extra evidence, so a Harvard page that links it by name verifies it. Social accounts come only from tier-1 pages or from handles that carry the club's name ("harvardlacrosse" isn't the women's club team). `--fetch=N` politely fetches unstored home pages; it never searches. Everything else goes to `data/reports/link-candidates.md` with a reason.

`siteIdentity` fixes found on the way:

- acronym matches respect case ("New" is not "NeW");
- dropping "Undergraduate" to match a heading needs a page about undergraduates ("Harvard Law Review" is not the "Harvard Undergraduate Law Review").

### Sparse clubs, presentation and categories

- **One-line descriptions.** When no one-liner exists, the long description's own first sentence is used verbatim (`leadSentence`), only if it is a plain description: 40–220 characters, says what the group is or does, with no application talk, links or dates.
- **Name-only profiles** say where the name comes from ("It appears in the College's student-organization directory (checked …)"). They state that no description or link has been found, and that this isn't a sign the club is inactive. Four prefilled asks follow: website or Instagram, what it does, how to join, inactive or renamed. Directory and category text says "with no description or link yet", not "known only by name", because these clubs often have directory facts.
- **Category pages are A–Z** over the same index and rules as the directory. Overview counts link to matching lists. Completeness stays a maintenance metric and an explicit sort.
- **Primary category** is the one the most independent sources agree on, then tier, then stated over inferred. The career center's blanket "pre-professional" no longer headlines a robotics club.
- **Name rules v3** add academic disciplines and health/peer-counseling words. SOCO's "Health and Wellness" maps to Health & Medicine. Uncategorized clubs fell from 54 to 36. The rest are SOCO "College Life", pre-orientation and department-sponsored entries with no topical evidence, and stay unknown.

### Honest wording

- "Join" only when a club says anyone can join. The no-comp flag never implies "no application".
- Upcoming cycles never read "Recruiting now".
- Dues read "No dues required" (the directory's words). Unknown dues are "Unknown", and verbatim dues notes are not published.
- Home counts are explained as clubs a source says this about.
- Compare's "differences only" compares shown values, not provenance.

### Audit

- Network failures are classified: DNS, TLS (wrong certificate), incomplete TLS chain (our client's limit) and timeout. One failure is `medium`; a week-long failure streak is `high`; TLS problems are `low`.
- `logo.photo_like` matches whole filename words ("Firefly_RemoveBackground.png" is a logo).
- "N global members" counts a network, not the membership.
- Recruiting: a national organization's program deadline ("for US chapters"), startup-program context ("tech transfer offices") and alumni, partner, sponsor, donation or judge forms are not club recruiting.
- Extractor 1.9.0: sentences no longer split after abbreviations ("Sep. 14" was cut in two). A stated window ("comp will run from Sep. 14 to Sep. 22") yields both ends.
- `--fail-on=critical|high` exits non-zero for scripts.

### Build

`apps/web/scripts/postbuild.mjs` runs after `next build`:

- It removes `__next._full.txt` (verified in the browser: prefetches use `_tree`/segment files, and unprefetched navigations use `index.txt`).
- It quantizes share cards to a 16-colour palette, using sharp through Next's own optional dependency; the cards look the same.

On-disk size went from 289 MB to 202 MB (file bytes: 243 to 165 MB). What remains is inherent to static RSC export: each profile's HTML carries an inline RSC payload, plus `index.txt` and a segment payload. Removing more would mean a client-rendered SPA, which ADR 0022 rejects.

### Safe publishing and zero-cost operation

- `publish-pages.sh`:
  - pushes only to `PAGES_REPO` (default `michaellhan/hclubs-site`), never to the source repo;
  - requires the base path;
  - rebuilds projections and stops on critical audit findings;
  - checks the build looks whole;
  - runs `privacy-scan`;
  - refuses a custom-domain push without CNAME;
  - marks dirty builds;
  - prunes empty archive folders.
- `privacy-scan` now reads JS chunks and source maps too, and finds escaped RSC quote fields, API keys, DB URLs and build-machine paths.
- `refresh.sh`:
  - one run at a time (a lock with stale-PID recovery);
  - the failing line is logged;
  - the budget is validated, and can be read from `.env`;
  - `REFRESH_LLM_BUDGET=0` makes the run free;
  - the DB server is stopped by process group;
  - `reconcile` exits non-zero unless every club resolved.
- `HCI_PAID_APIS=off` (or 0/false/no) makes the Anthropic and Brave providers refuse before any request. Cached LLM results still replay.
- LLM budgets reserve each attempt's worst-case cost before awaiting, so concurrent workers can't overspend. Unpriced models are refused rather than counted as free.
- `enrich --offline` replays extraction from stored snapshots with a fetcher that throws if called, so extractor changes can be applied for free.

## Consequences

- Graduate-school and ended organizations are discoverable by name but don't pollute browsing or recruiting. Scope relies on statements a few clubs make, so most clubs still rely on SOCO's College listing.
- Endings need an editor and a quotable source. That is slow by design; inferring death from silence remains forbidden (ADR 0020).
- Ownership promotion is conservative. Most found sites stay "probable" until a Harvard page, an editor or a confirmed account vouches for them.
- `retract-unreproduced` cannot see pages where a new extractor version produced _nothing_ (no evidence row marks the re-run). Narrow extractors (scope) need a review or a targeted `reject-value` instead.

## Amendment (2026-10-12): scope from listings, a club's chapter, stored renders

Two graduate groups were reported in undergraduate results: HIVE (an HGSE group) and the Harvard
Chinese Students & Scholars Association (HCSSA).

- **HIVE.** Its own site (hive.gse.harvard.edu) answers 403. The only text we have is the Innovation
  Labs listing description "HIVE (Harvard GSE Innovation and Ventures in Education) is dedicated to …",
  which no extractor scope-scanned. `listedOrg` (adapters/common.ts) now runs the scope-statement
  rules over each listing description (`listingScopeClaims`). Each statement becomes a `stated` claim
  quoting the sentence verbatim at the listing's tier, and a description with two scopes states nothing.
  Every adapter that passes descriptions moved to 1.1.0: the SEAS ×2, IOP, CS, MCB, Latinx, Math,
  Mignone, Innovation Labs, Hillel and Wikipedia adapters. SOCO and club sports pass none.
- **HCSSA is not a GSAS group.** The diagnosis was wrong. Its pages aren't JS-only: the stored static
  copies hold the text. Its site describes a university-wide association ("the largest student group
  at Harvard University", "for Chinese students and scholars at Harvard University and for other
  interested members of Harvard community"). The "– Graduate School of Arts and Sciences Chapter"
  pages describe "a subsidiary organization under the HCSSA". scope-statements **v9** therefore
  reads no scope from such pages:
  - a page that says it is about a subsidiary unit ("is a subsidiary", "shall be a subsidiary to
    the …") yields no scope at all;
  - a "<Parent> – <School> Chapter" name whose parent is one of the club's own names (enrich now
    passes names, aliases and acronyms) is the club's chapter, not the club.

  HCSSA keeps an unknown scope and stays in browse, which is correct for a Harvard-wide group.

- **Mixed audiences and cross-school (v9).** An "open to" list runs from "open to" to the end of
  its clause. "open to undergraduates, and eligibility for graduate students … follows …" lists
  only undergraduates and still reads as College.
  - **Not College.** A list that names anyone besides College students is never a College-only
    group: graduate students, "graduates", faculty, staff, alumni, friends, anyone.
  - **Cross-school.** A sentence naming undergraduates and graduate students reads as cross-school,
    whatever the order, with or without "both" or "as well as", and also for "Harvard College
    students" or "undergrads".
  - **Neither.** A list with people beyond Harvard's students gives no scope at all: "community
    members, and anyone in between" (a Hillel listing), "alumni, and friends", "graduates of any
    concentration" (which may mean alumni).
  - **Kept rejected.** An AI club's /fellowship page says "Open to all Harvard undergrads and
    graduate students." That is the program's audience, so the cross_school claim it gives stays
    rejected (`reject-value`, reason recorded).
- **Listing claims are versioned by the scope rules.**
  - **Evidence.** Listing scope claims carry `scope-statements@<version>` in their evidence, not
    the adapter's name. `discover` honors a claim's own `extractor`.
  - **Passes.** Each listing page records a scope-statements pass in `snapshot_extraction`, even
    an empty one (`DiscoveredOrganization.scannedBy`). So a scope-rule bump followed by
    `discover --stored` lets `retract-unreproduced --extractor=scope-statements` act on listings.
- **Stored browser renders.** A page flagged `needs_browser` may have a static newest copy that is
  an actual JS shell (`looksJsRendered`). Then the crawler reads the newest browser render whenever
  it reuses a stored copy (offline replays, fresh pages, 304s).
  - **Flag and date.** That keeps `needs_browser` set, and on a 304 the render's own date.
  - **Content wins.** A newer static copy with real content wins over an old render, and reading
    it clears the flag. Other jobs fetch statically without clearing it.
  - **Before.** The newer shell was replayed and the page's claims looked unreproduced. Six pages
    were affected, e.g. hcsproductlab.org/apply and /getinvolved.
- **Replaying discovery for free.** `discover --stored` re-parses each page's latest stored
  snapshot. It makes no request, creates no source row and writes no fetch-attempt row, and claims
  keep the snapshot's observation time.
- **Merged records keep their claims.** A mention seen before now files its claims under the club
  it was resolved to, even if that club was later merged (`MentionResolution.subjectClubId`, §12);
  `web-discovery` does the same.
  Filing them under the survivor created new claims there that skipped the merged record's
  rejections. The first replay brought back six rejected websites this way, e.g. the HCS
  /initiatives page on the Computing Contest Club. Those 83 duplicate claims were rejected with
  that reason, and the replay was run again.

## Amendment (2026-10-12): one-liners from cut-off and over-long sources (resolver-v14)

- A source's short description ending in "..." is a cut-off excerpt, like "…" and "[…]": HRMDC's "…welcomes a wide variety of dance..." gives way to its first describing sentence, "Established in 1976, The Harvard-Radcliffe Modern Dance Company (HRMDC) is the oldest dance organization at Harvard College."
- When the shown short description is over-long with no describing sentence, a competing short description from a source of the same or a better tier that reads as a one-liner is used, verbatim (`oneLineFromResolved`). The Computing Contest Club's 300-character CS-advising paragraph gives way to SEAS's one sentence. A lower tier never replaces it, and a shown one-liner is kept.
- Profiles label another club's own page as a Harvard-related publication, not "Club website" (`sourceTypeForClub`): the Harvard Independent's article about live theater on HRDC's profile.
- Displayed Google Docs and Forms links drop Google's share marker (`usp=sharing`, `sf_link`, `publish-editor`…, never `pp_url`); `normalizeUrl` keeps it, so stored identities don't change.

## Amendment (2026-10-12): excerpt headings (resolver-v15)

- A site's automatic excerpt can glue its first section heading to the first sentence (WordPress `og:description` on hutapas.org/about: "About Us Founded in 2016, TAPAS is …"). When an excerpt gives way to its first describing sentence, a leading "About Us", "Who We Are", "Our Mission" or "Our Story" (case-sensitive, before a capitalized word) is dropped first. Bare "About"/"Mission" stay, since they begin names ("About Face Theater", "Mission Hill …"). Regression fixtures in `packages/core/test/lead-sentence.test.ts`.

## Amendment (2026-10-12): home-page announcements (resolver-v17)

- A recrawl of club home pages put news where the one line should be. Examples: "Harvard Polo Club is excited to welcome Team Oxford for the 2025 International Invitational!", "HMCA 2027 will take place from January 11-13, 2027 … Registration is now open." and "Come to our Fall 2026 Jam!!! Tickets …".
- Text like that no longer counts as a one-liner: "come to/see/join", "save the date", "(we're) excited/thrilled/proud to welcome/announce", "will take place", "registration is now open", "tickets are available/can be purchased".
- When such text is the shown short description, the club's first describing sentence is used, or a competing short description of the same or a better tier that reads as one. With neither, the club keeps the text it has.
- Long descriptions and missions have no such rule: the bad ones found in this pass were rejected by hand. Regression fixtures are in `packages/core/test/lead-sentence.test.ts`.
