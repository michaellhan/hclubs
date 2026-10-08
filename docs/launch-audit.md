# Launch audit (2026-10-01)

A production-readiness review of hclubs before announcing it to Harvard College students. Scope: data correctness, static-site integrity, performance, SEO, branding and legal clarity, privacy, accessibility, devices, failure states, copy, reproducibility, git hygiene and tests.

**Verdict: no known blocking issues remain.** Every blocking issue found was fixed and is covered by a regression test. The items first left open, including the 10 unverified website links, were settled in the follow-up at the end of this document.

## Blocking issues (all fixed)

| #   | Area           | Issue                                                                                                                                                                                                                                                                                                                             | Fix                                                                                                                                                                                                                              |
| --- | -------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| B1  | Privacy        | Published pages and `/data/clubs/*.json` contained every evidence quote (verbatim page text). Some named students ("reach out to Jack (jack.weldon@…) and Alex (alex.luchtenberg@…)"), plus about 16 personal email addresses. Quotes are never shown on the site, but they shipped in the page payload.                          | `publicProfile()` (`packages/db/src/queries/public.ts`) is applied wherever a profile is published. It drops quotes and unshown competing values, and removes personal, placeholder and malformed addresses from links and text. |
| B2  | Privacy        | Displayed descriptions named people: "led by Jaeden Kinlock and Landon Elks". Eight PBHA program "descriptions" were staff contact lines ("Staff Contact Information: Kerry McGowan kerry@pbha.org").                                                                                                                             | New audit rules `description.names_people` and contact/team-page `description.junk`. Applied: 12 claims rejected with reasons; the clubs now show proper summaries.                                                              |
| B3  | Privacy / data | Email links to individuals (6) and template addresses (`info@mysite.com` ×2, `contact@example.com`).                                                                                                                                                                                                                              | `emailPublishProblem()` (core) and audit rules `link.personal_email` / `link.placeholder_email`. Applied: 9 links rejected; 2 role addresses kept with recorded dismissals (`letsgo@hsa.net`, `hpie@harvardirc.org`).            |
| B4  | Static export  | `app/clubs/loading.tsx` wrapped every `/clubs/<slug>` page in a Suspense boundary. The prerendered profile HTML showed the directory's "Loading clubs" skeleton, with the real profile in a hidden block that only JavaScript reveals. Crawlers reading raw HTML, link-preview bots and no-JS visitors never saw profile content. | The skeleton is now a plain component used only by the directory. Profiles render directly in the HTML. A test fails if any route `loading.tsx` comes back.                                                                      |
| B5  | SEO / sharing  | Every page inherited the home page's `og:url` ("/"), so a shared club link could preview, and be deduplicated, as the home page. No canonical URLs anywhere.                                                                                                                                                                      | `pageMetadata()` gives each page its own canonical URL, `og:url`, title and description. A test pins it on every content page.                                                                                                   |
| B6  | Legal clarity  | About said "Harvard's student-organization directory requires HarvardKey, so we don't use it". In fact its names and categories come from the owner's hand-saved copy (ADR 0030). It also said "we only link to a club's accounts when an official page does", but search-found accounts are shown (ADR 0028).                    | Copy rewritten to say exactly what happens (below).                                                                                                                                                                              |
| B7  | Integrity      | Student-reported values would have rendered exactly like sourced facts, although About promised they're labelled. None are live yet.                                                                                                                                                                                              | `FieldValue` adds "(student-reported)" to community values.                                                                                                                                                                      |
| B8  | Accessibility  | Light-mode secondary text (`text-zinc-400`) was 2.6:1, and dark-mode `text-zinc-500` was 4.1:1; WCAG AA needs 4.5:1. This affected every page.                                                                                                                                                                                    | Light text raised to `zinc-500` (4.8:1); a dark-mode rule maps unstyled `zinc-500` to `zinc-400` (about 7.5:1). axe-core WCAG A/AA: 0 violations on home, directory, profile, recruiting and compare, in light and dark.         |

## Important non-blocking issues

Fixed:

- **Search-API URLs as sources.** 324 profiles listed `api.search.brave.com/res/v1/…` URLs (which need an API key) as sources. They now link to the public search page (`search.brave.com/search?q=…`).
- **Compare with a merged or renamed club.** Old links silently dropped that club. Retired slugs now publish `{redirect}` JSON that compare follows, and missing clubs are reported ("One club in this link wasn't found").
- **Republishing broke open tabs.** Each force-push deleted the previous build's hashed JS. `publish-pages.sh` now keeps 14 days of `_next/static` files, so pages that are open or cached (for Pages' 10 minutes) keep working.
- **Logo weight.** Hot-linked logos totalled 8.8 MB, and one Squarespace original was 1.5 MB. Squarespace logos now request `format=300w` (1.5 MB → 20 KB), and the profile-header logo loads eagerly.
- **Directory without JavaScript.** It had no `<h1>` and showed nothing. Now it has a screen-reader `<h1>` and a `<noscript>` list of category pages.
- **No skip link.** Added "Skip to content".
- **404 page.** Its title was the home title; it is now "Page not found" and noindex.
- **"In the news".** It lists articles that only mention a club (e.g. a 1991 class-marshal candidate list). A note now says so.
- **Methodology described UI that doesn't exist.** It said values show badges and alternatives appear under "Other versions". It now says how values are actually shown, and where a language model is used. The duplicate "Summary" row is disambiguated.
- **Crawler page.** "It doesn't collect … personal email addresses" was untrue: snapshots keep whole pages. It now says these are never _published_.
- **Local export (`ingest:export`).** It wrote student-submission text and personal addresses despite its "public data only" docstring. Both are now removed.
- **Reproducibility.** There was no documented order for a full rebuild, and no backup procedure for `data/pglite` (the only copy of every editorial decision). Added `docs/runbook.md`; refreshed `docs/contributions.md`, `docs/deployment.md` and the README.
- **Home page.** It now shows the independence notice in the hero: "An independent, student-built index, not affiliated with Harvard University. Built from public pages and reviewed student contributions."

Remaining:

- **Client JavaScript is about 280 KB gzipped on every page.** About 90 KB of it is Zod (classic, including JSON-schema code), pulled in by the URL-filter schema and core enums. Moving client code to plain parsers or `zod/mini` would cut about a third. It isn't urgent: pages are static, search is fast, and the code is cached after the first visit.
- **10 website links unverified.** These club websites failed DNS from this machine, and the crawler's robots check also failed on 30 Sep: `theharvardadvocate.com`, `harvardewb.org`, `huaero.org`, `harvardcollegelawreview.org`, `harvardbigdata.com`, `harvardhits.com`, `hc3.seas.harvard.edu`, `harvardseasshpe.com`, `digammaclub.org`, `harvardrobotics.com`. The network here was unreliable during the audit (public resolvers also failed), so they may be fine. Re-check them from a normal connection and reject dead ones with `pnpm hci reject-link`. `harvardsportsanalysis.org` returns HTTP 500 (an existing watch item).
- **Category data.** 16 medium-severity audit findings (`category.listing_only`, `category.overclassified`) from moving Technology to the top level remain for review. Visible effect: HCS's share card shows "Entrepreneurship", its first category.
- **News matches** are name mentions, not topical matches. A sample of 25 found several tangential or decades-old articles. The new note sets expectations, but a recency or relevance filter would help.

## Nice to have

- **`eslint-config-next`** is an unused dev dependency.
- **Structured data:** only a `WebSite` JSON-LD on the home page. Per-club `Organization` markup could come later, but it risks implying official data.
- **Logo hosts:** Wix and WordPress logos could also be resized through their CDNs.
- **GoatCounter site code is `hclubs`** (moved off the owner's `mhan` handle 2026-10-08): cookie-free and consistent with the privacy copy.
- **Publish size:** each publish pushes about 263 MB (6,077 files). This is within GitHub Pages limits, but RSC `.txt` payloads triple each profile's footprint.

## Measurements (final build)

|                       | Result                                                                                                                                              |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| Static export         | **263 MB**, 6,077 files, 897 HTML pages (2,471 routes generated); text assets 29 MB gzipped                                                         |
| Biggest parts         | `clubs/` 180 MB (HTML plus RSC payloads), `og/` 54 MB (share images), `data/` 13 MB                                                                 |
| HTML (gzip)           | home 8 KB · directory 6 KB · profile 16 KB · recruiting 5 KB · compare 4 KB                                                                         |
| JS (gzip, per page)   | 268–285 KB                                                                                                                                          |
| `data/index.json`     | 793 KB raw / 131 KB gzip; parse 1.7 ms                                                                                                              |
| Search (708 clubs)    | first query 15 ms (warm-up); median 0.8 ms, p95 1.4 ms, max 3.4 ms                                                                                  |
| Internal links        | 0 broken across 897 pages                                                                                                                           |
| Domain                | HTTP, `www` and `michaellhan.github.io/hci` → 301 `https://hclubs.app/`; missing trailing slash → 301; unknown path → 404 page; JSON served gzipped |
| Narrow phone (320 px) | no horizontal scroll on home, directory, profile, recruiting, compare, about, methodology, contribute or category pages                             |

## Verified

- **Privacy:** no officer or member names (pattern scan of every published string), no personal or placeholder emails, no evidence quotes, no form-response data, and no cookies (GoatCounter counts paths and event names only).
- **Branding:**
  - The not-affiliated notice is in the footer of every page, in the home hero, and in a callout on About.
  - Share images and the logo use no Harvard marks or crimson.
  - "Harvard" appears only descriptively.
- **Failure states:**
  - **Missing logo:** initials are shown instead.
  - **No description or no links:** those sections are hidden.
  - **Stale deadlines:** recomputed in the browser.
  - **Invalid search:** script-like input renders as text.
  - **Zero results:** help is shown.
  - **Bogus URL parameters:** ignored.
  - **Malformed slug:** the 404 page explains renames and merges.
  - **Merged slug:** client redirect.
  - **Compare with a deleted or merged club:** handled, as above.
  - **Broken external link:** opens in a new tab, and the rest of the site is unaffected.
- **Git hygiene:**
  - No secrets in tracked files or history.
  - No snapshots, database or build output tracked; the largest tracked file is a 200 KB test fixture.
  - No TODO/FIXME or stray `console.log`.

## Tests

411 tests pass (35 files); lint, typecheck and the production export pass. New regression tests:

- `packages/db/test/public-profile.test.ts`: quotes, alternatives, emails and API URLs are stripped from published profiles.
- `packages/core/test/contribute.test.ts`: which email addresses may be published.
- `packages/pipeline/test/audit.test.ts`: `names_people`, contact-page junk (and its false positives) and the email-link checks.
- `apps/web/src/static-export.test.ts`: no route `loading.tsx`; every content page sets canonical metadata.

## Follow-up (2026-10-01, later the same day)

The open items above were worked through.

- **10 unverified links: settled.**
  - 6 domains don't exist (NXDOMAIN from the local resolver, 1.1.1.1 and 8.8.8.8): `harvardewb.org`, `huaero.org`, `harvardcollegelawreview.org`, `harvardbigdata.com`, `harvardhits.com`, `hc3.seas.harvard.edu`.
  - 3 are parked, for sale, or serve unrelated pages: `harvardrobotics.com`, `digammaclub.org`, `harvardseasshpe.com`.
  - All 9 were rejected with reasons.
  - `theharvardadvocate.com` itself fails (SERVFAIL), but `www.theharvardadvocate.com` works; the profile now links there.
- **Why the crawler missed them.** It reported an unreachable host as "robots.txt disallows", which looks like an opt-out. It now reports `network_error: host unreachable`, and tries the `www.`/bare twin once before giving up. A new audit rule, `link.unreachable`, lists such sites for review. A profile shows whichever of the two hosts last fetched successfully (`withWorkingHost`).
- **Zod removed from the browser bundle.**
  - The browser needs only constants, labels and pure helpers from `@hci/core`. These moved into Zod-free modules behind `@hci/core/browser` (`enum-values.ts`, `term-utils.ts`, `fields/value-utils.ts`), and the Zod schemas re-export them.
  - Directory filters and URL params are now validated by hand, with the same strictness.
  - JS per page went from about 280 KB to about **190 KB gzipped (−32%)**. `apps/web/src/client-bundle.test.ts` fails if any client component or browser entry reaches Zod again.
- **Categories: 16 findings settled.**
  - 7 wrong categories rejected with the new `pnpm hci reject-value`. Among them, HCS is no longer "Entrepreneurship", and career-center "Pre-professional" labels were removed from two science and health groups.
  - 6 kept with recorded dismissals: department and i-lab listings that fit the club.
  - The audit is back to one low-severity watch item: `harvardsportsanalysis.org` returns HTTP 500.
- **News.** Headlines that name the club are listed first (`rankPressMentions`).
- **Logos.** WordPress/Jetpack and Sanity logos request a 300 px rendition; for example, HPR's goes from 163 KB to 34 KB.
- **Structured data.** Each club page has `Organization` JSON-LD: name, summary, and the club's own verified website and accounts. There is no parent organization, so nothing implies Harvard affiliation.
- **Dependencies.** Removed the unused `eslint-config-next`.

Not changed, by decision or because they need the owner:

- **Navigation payload files.** The `.txt` files (most of `clubs/`' 180 MB) are written by `output: export` for client-side navigation and fetched only when someone navigates in the app. They cost upload volume, not page weight; removing them would break in-app navigation.
- ~~**GoatCounter site code `mhan`.**~~ Done 2026-10-08: `NEXT_PUBLIC_GOATCOUNTER_CODE=hclubs`.
- **Google Form options.** The form still lacks exact options for Instagram, application link, eligibility, renamed and listed-twice; links preselect the closest existing option. Adding options is done in the Form's editor by its owner; then update `formOption` in `packages/core/src/contribute.ts`.

Tests: 423 pass (38 files); lint, typecheck and the static export pass.
