# Fixture: PBHA programs listing

- Source: Phillips Brooks House Association (PBHA) programs directory (Squarespace blog collection, server-rendered HTML)
- Fetch date: 2026-09-30
- User-Agent: `HarvardClubIndexBot/0.1 (research; contact michael.l.han@gmail.com)`
- No authentication required.

| File | URL | HTTP | Entries |
|---|---|---|---|
| `listing.html` | https://www.pbha.org/programs (requested as https://pbha.org/programs, redirected to www) | 200 | 18 |
| `listing-page-2.html` | https://www.pbha.org/programs?offset=1734301560265 | 200 | 18 |
| `listing-page-3.html` | https://www.pbha.org/programs?offset=1705368180217 | 200 | 18 |

Page 3 has another next link (`/programs?offset=1672608540290`), which was not fetched. PBHA says it runs "more than 80" programs, so there are about 5 pages in total.

Pagination uses opaque `?offset=<ms-timestamp>` cursors. Follow `a[rel="next"]`. Do not construct the cursors yourself.

## Selectors (all pages are identical in structure)

- Entry: `article.blog-item` (also `.blog-basic-grid--container.entry`). Some entries carry an extra `no-image-fade-in` class and have no image block.
- Name: `h1.blog-title > a` (trim the text, which has surrounding whitespace)
- Detail link: `h1.blog-title > a[href]` (relative, e.g. `/programs/alzheimersbuddies`). It is the same as `a.blog-more-link[href]`.
- Description: `.blog-excerpt .blog-excerpt-wrapper p`. It may be missing or empty (e.g. "BRYE Summer").
- Categories/tags: `.blog-meta-primary .blog-categories-list a.blog-categories`. Use only `.blog-meta-primary`, because the same list is repeated in `.blog-meta-secondary`. Tags mix program area (e.g. "Adult Services", "Mentoring", "Health"), modality ("In-Person", "virtual") and weekdays, and their case is inconsistent. Some entries have no tags.
- Image (optional): `a.image-wrapper img[data-src]`
- Ignore: `.blog-author` (always "PBHA Admin") and `time.blog-date`. These are admin-set values that only control ordering.
- Next page: `a[rel="next"][href^="/programs?offset="]`

## robots.txt excerpt (https://www.pbha.org/robots.txt, saved as `robots.txt`)

A single group covers `User-agent: *` (named AI bots are listed in the same group with the same rules):

```
User-agent: *
Disallow: /config
Disallow: /search
Disallow: /account$
Disallow: /account/
Disallow: /commerce/digital-download/
Disallow: /api/
Allow: /api/ui-extensions/
Disallow: /static/
...
Disallow:/*?format=json-pretty
Disallow:/*?reversePaginate=*
Disallow:/*&reversePaginate=*
```

The rules allow `/programs` and `/programs?offset=...`. There is no Crawl-delay.

## Trimming

To keep the repository small, `<script>`, `<style>` and inline `<svg>` blocks were removed from the saved HTML, and runs of 3+ spaces/tabs were collapsed to one space (2026-09-30). The parser does not depend on them. Everything else, including all listing markup, is byte-for-byte as fetched.
