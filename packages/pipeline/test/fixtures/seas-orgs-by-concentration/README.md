# Fixture: SEAS "Find a SEAS-Affiliated Student Organization"

- URL: https://seas.harvard.edu/office-student-organizations/find-seas-affiliated-student-organization (HTTP 200, public, server-rendered Drupal)
- Fetch date: 2026-09-30
- User-Agent: `HarvardClubIndexBot/0.2 (+https://github.com/michaellhan/harvardclubindex; michael.l.han@gmail.com)`
- Post-processing: `<script>`, `<style>` and inline `<svg>` blocks were stripped, and runs of 3 or more spaces/tabs were collapsed to one space. Nothing else was changed.
- robots.txt: standard Drupal file (saved). `User-agent: *` disallows only /admin/, /search/, /user/*, /node/add/, core dirs etc. This path is allowed.
- Companion of `seas-student-organizations` (the canonical 23-org list). This page is older and partly stale (e.g. SEDS, "Harvard College Clean Energy Group"), but it adds categories and one-line descriptions.

## Structure
Three Foundation accordion items: `.accordion-item` with title `a.accordion-title` = "Community-Focused" / "Project-Focused" / "All Student Groups Organized By Concentration".

- Community/Project sections: entries are `.accordion-content .field-item > p > a[href]` (skip the first `p`, which is the section blurb, and empty `&nbsp;` paragraphs). Name = anchor text; link = href. No description. 10 + 9 entries (overlapping).
- By-concentration section: `.accordion-content .field-item h2` (text e.g. "APPLIED MATHEMATICS", "COMPUTER SCIENCE", "ENGINEERING") followed by `ul > li`.
  - Entry: `h2 + ul > li` (5 + 7 + 53 = 65 entries; many repeat across categories/sections)
  - Name: `li > a > span` text (usually ends with acronym in parentheses)
  - Link: `li > a[href]` (some are proofpoint urldefense-wrapped; unwrap `u=` param)
  - Description: `li > span` (the sibling span after the anchor), strip the leading "&nbsp;- "
  - Category: preceding `h2` text (concentration)
- Pagination: none. IDs: none (use normalized name/URL).
