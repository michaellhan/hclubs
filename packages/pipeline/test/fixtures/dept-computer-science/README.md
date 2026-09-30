# Fixture: Harvard CS Concentration advising — Clubs and Activities

- URL: https://csadvising.seas.harvard.edu/opportunities/clubs/ (HTTP 200, public, static Hugo site "Relearn" theme, server-rendered)
- Fetch date: 2026-09-30
- User-Agent: `HarvardClubIndexBot/0.2 (+https://github.com/michaellhan/harvardclubindex; michael.l.han@gmail.com)`
- Post-processing: `<script>`, `<style>` and inline `<svg>` blocks were stripped, and runs of 3 or more spaces/tabs were collapsed to one space. Nothing else was changed.
- robots.txt: https://csadvising.seas.harvard.edu/robots.txt returned 404 (no restrictions). A placeholder note is saved as robots.txt.

## Selectors
- Entry: `main#R-body-inner article > ul > li` (15 entries)
- Name: `li > p > a:first-child` text
- Link: `li > p > a:first-child[href]` (external; some http://)
- Description: text of `li > p` after the first anchor, strip leading " - " (some entries have no dash, e.g. "HSBSE ...", "Quantum Computing Association ...")
- Extra links inside the description (e.g. "See also Harvard SWE") are secondary `a` elements — ignore or treat as related.
- Category: constant "Computer Science". IDs: none. Pagination: none.
