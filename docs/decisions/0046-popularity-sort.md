# 0046: Popularity sort (Instagram followers), the default directory order

**Status:** accepted (owner decision, 2026-10-03)

## Context

CLAUDE.md §1 lists "ranking clubs by prestige" as a non-goal, and ADR 0039 made the default browse order neutral: clubs recruiting now, then join-anytime clubs, then a daily shuffle, never by how much is known about a club or how well known it is. The owner has decided that students expect to see the clubs everyone knows first, and that an Instagram follower count is the best public proxy for that.

This **overrides** the "no prestige ranking" non-goal and ADR 0039's neutral default for the no-search directory order. It does not change anything else in ADR 0039: "Most complete" and "Recently updated" stay retired, and search ties still go by name.

## Decision

- **Field.** `club.instagram_followers` (single, time-varying, non-negative integer, never inferred, public). The newest observation wins (`recency_then_priority`); two counts a week apart are growth, not a conflict (`flagsConflicts` off). The resolver (resolver-v8) projects it to `club.instagram_followers` (migration 0006) and the static index carries `instagramFollowers: number | null`.
- **Source and evidence.** `pnpm hci import-instagram-followers <file.json> [--dry-run]` reads `data/imports/instagram-followers.json`, an array of `{ slug, handle, url, followers, followersText, evidence, source, evidenceUrl, observedAt }` made from a search-result snippet or the public profile's own description. Instagram is never fetched by the importer (§21). An entry is written only when:
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
- Social platforms still aren't scraped: counts enter only as saved text with its source URL.
