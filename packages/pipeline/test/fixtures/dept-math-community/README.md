# Fixture: Harvard Math Community — Community Groups

- URL: https://sites.harvard.edu/math-community/community-groups/ (HTTP 200, public, server-rendered WordPress)
- Fetch date: 2026-09-30
- User-Agent: `HarvardClubIndexBot/0.2 (+https://github.com/michaellhan/harvardclubindex; michael.l.han@gmail.com)`
- Post-processing: `<script>`, `<style>` and inline `<svg>` blocks were stripped, and runs of 3 or more spaces/tabs were collapsed to one space. Nothing else was changed.
- robots.txt (saved): `User-agent: *` disallows /wp-admin/ only; Crawl-delay: 30 (honoured).
- Note: www.math.harvard.edu/undergraduate/student-groups/ (the dept's own page) is behind a Cloudflare challenge — not fetched.

## Selectors
- Entry: `.entry-content h3:first-of-type + ul.wp-block-list > li` (h3 "At Harvard") — 4 entries (GIIM, Real Representations, Math Includes, HUMA). Only GIIM and HUMA are undergraduate student orgs.
- Name: `li > strong` text
- Description: `li` text after `strong`, strip leading ":" and the trailing "For more information, email …" sentence
- Contact: `li a[href^="mailto:"]` (no websites)
- Ignore the "Outside Harvard" and "Broader Community Groups" lists.
