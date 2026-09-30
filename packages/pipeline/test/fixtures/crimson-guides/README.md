# The Harvard Crimson fixtures: comp / club articles

Fetched 2026-09-30 with User-Agent
`HarvardClubIndexBot/0.2 (+https://github.com/michaellhan/harvardclubindex; michael.l.han@gmail.com)`, >=3 s between requests.
Post-processing: removed `<script>`, `<style>`, `<svg>` elements; collapsed runs of 3+ spaces to one. No paywall encountered.

robots.txt (https://www.thecrimson.com/robots.txt, fetched 2026-09-30):
```
# allow crawling everything by default
User-agent: *
Disallow:
```

Copyright: articles are (c) The Harvard Crimson. Stored only as local test fixtures; do not redistribute.
Source tier: historical/secondary evidence (tier 6) — mentions of an org confirm it existed at publication date only.

## Files

| File | URL | Published | Orgs named |
|---|---|---|---|
| `2017-11-02-comping-harvard.html` | https://www.thecrimson.com/article/2017/11/2/comping-harvard/ | 2017-11-02 | ~6 (Crimson Key Society, Harvard Financial Analysts Club, Harvard Investment Association, Harvard Lampoon, The Crimson, Undergraduate Council) |
| `2023-05-25-harvard-clubs-feature.html` | https://www.thecrimson.com/article/2023/5/25/harvard-clubs-feature/ ("When Harvard's Clubs Become Companies") | 2023-05-25 | ~12 (Harvard College Consulting Group, Harvard Student Agencies, International Relations Council / HMUN, Harvard Debate Council, Krokodiloes, Lampoon, Undergraduate Foreign Policy Initiative, HUCBE, ...) |
| `2026-01-12-jam-packed-feature.html` | https://www.thecrimson.com/article/2026/1/12/jam-packed-feature/ ("'Jam Packed!': Harvard A Cappella Takes Center Stage") | 2026-01-13 (UTC) | ~6 a cappella groups (Callbacks, LowKeys, Fallen Angels, Radcliffe Pitches, Din & Tonics, ...) |

## Markup
- Metadata: `<title>`, `meta[property="article:published_time"]`.
- Body paragraphs: each is `div.mx-auto.mb-4.max-w-2xl.px-4 > p` (Tailwind classes; Vue/Nuxt SSR with `<!---->` / `<!--[-->` comment markers).
  Section subheads (2023 feature) are `h2`/`h3` inside the same wrapper.
- Clubs are NOT marked up: they appear as plain prose names (sometimes preceded by "the"), with occasional inline `<a>`
  links to other Crimson articles, not to club pages. No lists, tables, or bold names. Extraction requires NER/dictionary
  matching against a known org list; comp-process info is in surrounding sentences.

## Caveats
- No recent Crimson article found that systematically enumerates many clubs with comp processes. The closest true
  enumeration is the 1967 "You'll Probably Want to Join Some Group; Here's The Full Guide To Organizations"
  (https://www.thecrimson.com/article/1967/9/25/youll-probably-want-to-join-some/) — historical only, not saved.
- 2013 Flyby "Which Club Should You Comp?" is an image flowchart (text not in HTML). 2023/2026 Flyby "how to comp" /
  "what kind of comper" pieces name almost no clubs.
