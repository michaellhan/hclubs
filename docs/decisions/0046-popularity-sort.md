# 0046: Popularity sort (Instagram followers), the default directory order

**Status:** accepted (owner decision, 2026-10-03)

## Context

CLAUDE.md §1 lists "ranking clubs by prestige" as a non-goal, and ADR 0039 made the default browse order neutral: clubs recruiting now, then join-anytime clubs, then a daily shuffle, never by how much is known about a club or how well known it is. The owner has decided that students expect to see the clubs everyone knows first, and that an Instagram follower count is the best public proxy for that.

This **overrides** the "no prestige ranking" non-goal and ADR 0039's neutral default for the no-search directory order. It does not change anything else in ADR 0039: "Most complete" and "Recently updated" stay retired, and search ties still go by name.

## Decision

- **Field.** `club.instagram_followers` (single, time-varying, non-negative integer, never inferred, public). The newest observation wins (`recency_then_priority`); two counts a week apart are growth, not a conflict (`flagsConflicts` off). The resolver (resolver-v8) projects it to `club.instagram_followers` (migration 0006) and the static index carries `instagramFollowers: number | null`.
- **Source and evidence.** `pnpm hci import-instagram-followers <file.json> [--dry-run]` reads `data/imports/instagram-followers.json`, an array of `{ slug, handle, url, followers, followersText, evidence, source, evidenceUrl, observedAt }` made from a search-result snippet or the public profile's own description. The importer itself fetches nothing; since the amendment below, the profile descriptions are read by `instagram-followers`. An entry is written only when:
  - the URL is an Instagram profile whose handle matches `handle`;
  - `followersText` is a follower count ("1,234 Followers", "1.2K followers") and `followers` is inside what that text says (a "1.2K" allows 1,150-1,249);
  - `followersText` appears in `evidence` verbatim (whitespace and case folded);
  - `observedAt` is not in the future.
  
  The claim is `stated`, evidenced by an immutable snapshot of the saved snippet (`fetch_method = manual_upload`, `extraction_method = manual`) with the snippet as the quote. The source is the Instagram profile URL: `club_social` (owned by the club) only when that account is a verified link of the club, otherwise `public_web` (§7.1). Slugs that don't exist are skipped and logged; merged clubs follow the merge chain; clubs that are hidden are skipped. Re-running with the same file adds nothing; a newer observation of the same account supersedes through the resolver's recency rule.
- **Sort.** `popularity` joins the sort keys. Clubs with a count come first, most followers first (ties by name); clubs without a count follow in the Suggested order (`featuredCompare`), then by name. An unknown count is "not counted", never zero. It is the default directory order when there is no search text and no ranked intent. With search text (or a ranked intent) relevance still comes first and is the default. "Suggested" and "Name" stay selectable (and old `sort=featured` links keep working); the select labels the new order "Popularity". The Postgres provider orders by the stored count, uncounted clubs after, then by name.
- **Not shown.** Follower counts are never displayed on profiles, cards or the compare page; they only order the list. The number is in the public index and in the profile's resolved fields, as any public claimed value is. Nothing about the account's owner is stored.

## Consequences

- Popular clubs surface first; clubs with no Instagram, or a private or unmatched one, sit below every counted club until a count is found. That is a known bias of the proxy and the owner's call; the Suggested and Name sorts remain one click away.
- Counts go stale. They are recounted by re-running the collector and importer; the newest observation wins, so there is nothing to clean up.
- Counts enter only as saved text with its source URL; see the amendment for how that text is now read.

## Amendment (2026-10-03): reading public profile pages, the account check, and freshness

**Context.** The first counts came from search-result snippets, which lag the profile by weeks or months. Plain HTTP fetches of a profile get a login wall with no description, and Instagram rate-limits fast requests (a redirect to `/accounts/login/?…is_from_rle`). A real browser reading one profile every ~10 s gets the profile's `og:description` ("12K Followers, 250 Following, 282 Posts - See Instagram photos and videos from The Harvard-Radcliffe Veritones (@veritones)").

**Decision (owner).** This is an explicit exception to CLAUDE.md §21's "we do not scrape social platforms", for this one purpose:

- **What is read.** Only the follower count in the public profile page's `og:description`, for the Instagram account each active, non-hidden club's profile links to (best link: verified, then probable, then unverified). Nothing else on the page is read or stored; the description text is kept as the claim's evidence. Never a login, a session or cookies from a person's browser.
- **How.** `pnpm hci instagram-followers [--limit=N] [--club=a,b] [--dry-run] [--out=file]` (`src/stages/instagram-collect.ts`) loads each profile in installed Chrome through `playwright-core` (the `enrich --browser` helper, `createChromeRenderer`, with Chrome's own user agent, `en-US`, no images/media/fonts) and reads the description from the HTML the server sent (falling back to the DOM). Profiles are at least 10 s apart plus 0-5 s of jitter, never concurrent. Clubs never read from the profile, then those read longest ago, go first. Each count is written to the import file (replacing that club's entry) right after it is read, then the importer runs. `--dry-run` lists the profiles without any request and dry-runs the importer.
- **Stopping.** The first login or challenge redirect, `is_from_rle` flag, suspension page or redirect off Instagram stops the whole run (exit 2); so do three profiles in a row without a count or that fail to load. Nothing is retried, nothing is rotated (no user agents, addresses or accounts). What was read before the stop is kept.
- **robots.txt.** Instagram's robots.txt disallows all crawlers not named in it (`User-agent: *` / `Disallow: /`). The command does not consult it; reading these pages at all is the owner's exception, recorded here, and §11.1's robots rule still holds for every other source.
- **Switch.** `HCI_INSTAGRAM=off` (or 0/false/no) makes the command do nothing.
- **Freshness.** `scripts/refresh.sh --weekly` runs it on the first Sunday of each month with `--limit=$REFRESH_INSTAGRAM_LIMIT` (default 110: about 290 linked accounts are re-read within 90 days). A stop doesn't fail the refresh. The registry gives `club.instagram_followers` `maxAgeDays: 90` (a new, general registry option, resolver-v10): a count last observed more than 90 days ago is unknown, so it stops ranking the directory instead of ranking it on old numbers.

**Account check (importer v2).** A count protects the ranking only if it belongs to the club. An entry is accepted only when:
1. its saved text names the entry's handle as `(@handle)`, in either the profile-description or the search-snippet form; and
2. the account is a verified or probable link of the club, or the display name (the text before `(@handle)`) plainly names the club: every distinctive word of the club's name or an alias appears in it (boilerplate such as Harvard/Club/Society ignored, 5+-letter shortenings like "Microbio" allowed), or all of its own two-plus distinctive words appear in a club name that has no men's/women's word it lacks, or one of its words is the club's acronym or the initials of the club's name, with or without a leading "Harvard (Undergraduate)" (`displayNameMatchesClub`; name words from the matcher's `distinctiveTokens`). The bio is not read.
3. An account linked (not rejected) to another active club as well, or filed under two slugs in the file, is accepted only for a club whose link to it is verified (e.g. one handle on both the men's and women's club soccer teams). A rejected link always fails.

A failing entry is skipped with its reason. Earlier claims it no longer supports are rejected through the normal claim status path (`rejectClaims`, audited, never deleted): every claim only that account supported when the account itself failed, or only the failing value when just the saved text failed to name the account. The rejection reason ends "(not reproduced by instagram-followers@2)", so a later entry that passes revives the claim.

**Consequences.** Counts can be as fresh as a month, and a wrong or ambiguous account no longer ranks a club. Clubs whose account is linked but unconfirmed and named only by an unusual short form (e.g. "BASHA") drop out of the ranking until their link is confirmed. The owner accepts Instagram's terms risk for this narrow use; if Instagram blocks the reader, the command stops and counts age out after 90 days, leaving those clubs in the Suggested order.

**Amendment (owner, 2026-10-04).** "Suggested" is removed from the directory's Sort menu; old `sort=featured` links open in Popularity. `featuredCompare` stays as the order of clubs without a follower count inside Popularity.
