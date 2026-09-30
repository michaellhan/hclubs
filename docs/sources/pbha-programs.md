# Source: PBHA programs directory

|                    |                                                                                                                                      |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------ |
| Adapter            | `pbha-programs` (`packages/pipeline/src/adapters/pbha-programs`)                                                                     |
| URL                | https://www.pbha.org/programs (paginated via `?offset=<cursor>`)                                                                     |
| Publisher          | Phillips Brooks House Association: Harvard's student-run public service association                                                  |
| Source type / tier | `harvard_official` / tier 1. PBHA's own listing is the authoritative public record of its programs. See the CLAUDE.md §7.1 examples. |
| Auth               | None. Public, server-rendered HTML (Squarespace blog collection).                                                                    |
| Reviewed           | 2026-09-30                                                                                                                           |
| Cadence            | Weekly. Conditional GET means unchanged pages cost a 304.                                                                            |

## robots.txt (reviewed 2026-09-30)

`User-agent: *` disallows `/config`, `/search`, `/account`, `/api/`, `/static/`, a few `?format=` variants and `?reversePaginate=`. `/programs` and `/programs?offset=` are allowed. There is no `Crawl-delay`; our default is ≥2s between requests. The fetcher re-checks robots.txt at run time, so this note is informational only.

## Structure

- Entry: `article.blog-item`, 18 per page. The last page has fewer.
- Name: `h1.blog-title > a` (text). Program link: its `href`, e.g. `/programs/alzheimersbuddies`.
  - **Quirk:** at least one entry links to `/programs/programs/<slug>`. The parser accepts this, and a fixture test covers it.
- Description: `.blog-excerpt .blog-excerpt-wrapper p`. It is sometimes empty; in that case no claim is made.
- Tags: `.blog-meta-primary a.blog-categories`. The list is repeated in `.blog-meta-secondary`, so we ignore that copy.
- Pagination: follow `a[rel="next"]`. The cursors are opaque timestamps; never construct them.
- Ignored: `.blog-author` (always "PBHA Admin") and `time.blog-date` (an ordering value, not a meaningful date).

## What we extract

| Field                                                  | Assertion    | Notes                                                                               |
| ------------------------------------------------------ | ------------ | ----------------------------------------------------------------------------------- |
| `club.name`                                            | stated       | verbatim                                                                            |
| `club.link` (`harvard_directory`, "PBHA program page") | stated       | canonical program URL                                                               |
| `club.short_description` / `club.long_description`     | stated       | Excerpt, with a verbatim quote. Up to 400 chars goes to short, longer goes to long. |
| `club.tag`                                             | stated       | Topical and location tags only. Weekday, format and frequency tags are dropped.     |
| `club.category`                                        | **inferred** | `public-service` plus a mapping from tags (see `TAG_CATEGORY`)                      |
| `club.org_type` = `public_service_program`             | **inferred** | From being listed in PBHA's directory                                               |

Nothing else is claimed: no membership, hours, eligibility, recognition or activity status. The listing doesn't state them.

Entity identity: `externalIds: [{ system: "pbha", id: <slug> }]`. Two programs with different PBHA slugs are different organizations, even when their names are similar (e.g. BRYE Teen and BRYE Extension).

## Fixtures

`packages/pipeline/test/fixtures/pbha-programs/`: three listing pages fetched 2026-09-30, with scripts and styles trimmed. The live site had 4 pages (60 programs) on that date.

## Known limitations

- The per-program detail pages (`/programs/<slug>`) are not fetched yet. They probably hold richer descriptions, contacts and schedules. Adding them is a separate `Extractor`.
- Programs removed from the listing are not retracted. They go stale, because `observedAt` stops advancing.
