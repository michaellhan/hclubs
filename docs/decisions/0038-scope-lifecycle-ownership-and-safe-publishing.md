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
