# Application forms and sitemaps (enrich)

- **Forms:** clubs' own `application_form` / `application_page` links (verified or probable), up to 3 per club.
  - Google Forms robots.txt allows `/forms`. Many Harvard forms need sign-in (401) and are skipped.
  - Only a form's **title and public description** are read (§21), never questions or responses. We never submit.
  - In a 2026-09-30 sample of 50 Google Forms, about two-thirds were public, and their descriptions often gave deadlines, comp overviews and eligibility.
- **Sitemaps:** `<site>/sitemap.xml` (plus up to 3 child sitemaps), read through the polite fetcher. Only same-site join, recruiting, FAQ and about pages are used as crawl seeds.
- **Reviewed:** 2026-09-30.
