# 0017: Links are candidates until verified

**Status:** accepted (M2)

## Context

Club websites and social accounts come from many places: official directories, the club's own pages, Wikipedia, and eventually search. Taking the first plausible URL as "official" would publish wrong links.

## Decision

Every link is a `club.link` claim with evidence (source, tier, extractor). The resolver computes a status per URL with `verifyLink` in `@hci/core`:

- **verified:** stated by a tier-1 Harvard source for this org, found on a channel established as the club's own (`source.owner_club_id`), or editorially confirmed.
- **probable:** stated by another club/official-ish source (tier ≤ 5), a reciprocal link, or a candidate site whose title/h1 names the club exactly (`site-identity` evidence).
- **unverified:** everything else, such as a link seen only on Wikipedia.

Only verified sites are crawled as tier-2 `club_website` sources, so links found there are verified in turn. Probable sites are crawled as tier-8 `public_web`. Unverified candidate sites are probed (home page only) and crawled only if their page names the club. The profile shows official and likely-official links; unconfirmed links are collapsed. Directory pages _about_ an org (PBHA, IOP, Mignone listings) are links of kind `harvard_directory` and never count as the org's own "site" in identity matching.

## Consequences

We never invent social links and never trust search-style results as official. Coverage of Instagram depends on clubs linking it from official pages.
