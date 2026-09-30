# 0027: Application forms, sitemaps, WordPress publications, community submissions

**Status:** accepted (M3)

## Context

Recruiting data (deadlines, stages, eligibility) was the thinnest part of the index (under 10% of clubs). Clubs publish it in places the shallow crawler didn't reach: application forms they link, pages only in their sitemap, and student-newspaper coverage. The static site's new "Share what you know" and "Run this club?" buttons also needed a path into the data.

## Decision

1. **Application forms** (`parse/forms.ts`). During enrichment, each club's verified or probable `application_form` and `application_page` links are fetched (up to 3, robots honored) and extracted as `recruiting` pages.
   - Form pages (Google Forms, Typeform, Airtable, Jotform, Tally, MS Forms) are reduced to **title + public description only** before any extractor sees them, never questions or responses (§21). Many Harvard forms require sign-in (401); those are skipped.
   - A verified link's page is tier 4 (`club_recruiting_material`).
2. **Sitemap hints** (`crawl/sitemap.ts`). Before crawling a club site, its `sitemap.xml` is read through the polite fetcher, following up to 3 child sitemaps and preferring page sitemaps. Up to 12 same-site join, recruiting, FAQ and about URLs seed the crawl. Page budgets and priorities are unchanged.
3. **WordPress publications.** The Harvard Independent and the Harvard Political Review are searched through their own public `/wp-json/wp/v2/search` endpoints (`WordPressSearchProvider`, polite fetcher; robots allow). This needs no web-search credit. Article dates come from JSON-LD `datePublished`.
4. **Community submissions** (`stages/submissions.ts`).
   - **Import:** `submissions import <csv>` queues form responses as `pending` `student_submission` rows. Imports are idempotent by a content key.
   - **Personal data:** email, name, phone, NetID and HUID columns are ignored, and no submitter reference is stored.
   - **Review:** `submissions list | accept <id> --field --value | reject <id> [--spam]`.
   - **Accepting:** the editor picks the field and value (text is never parsed automatically). This writes a `user_reported` tier-9 claim evidenced by the submission, shown with the Community badge. It is audited in `editorial_decision`.

## Consequences

- Recruiting facts from forms carry verbatim evidence and are as current as the form.
- Sitemap reads add one or two requests per site per run.
- Student-contributed facts enter only through a person, and stay distinguishable from sourced ones.
