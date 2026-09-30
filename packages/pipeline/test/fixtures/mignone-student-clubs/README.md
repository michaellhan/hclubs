# Fixture: Mignone Center for Career Success — Organizations filtered to "Student Clubs & Organizations"

- URLs (HTTP 200, public, server-rendered WordPress):
  - listing.html: https://careerservices.fas.harvard.edu/organizations/?ctag%5B%5D=student-clubs
  - listing-page-2.html: https://careerservices.fas.harvard.edu/organizations/page/2/?ctag%5B0%5D=student-clubs
  - listing-page-3.html: https://careerservices.fas.harvard.edu/organizations/page/3/?ctag%5B0%5D=student-clubs
- Pagination: 8 pages total for this filter (9 entries/page ≈ 70 clubs); only 3 saved. Unfiltered /organizations/ has 25 pages (mixed offices/alumni/professional groups).
- Fetch date: 2026-09-30
- User-Agent: `HarvardClubIndexBot/0.2 (+https://github.com/michaellhan/harvardclubindex; michael.l.han@gmail.com)`
- Post-processing: `<script>`, `<style>` and inline `<svg>` blocks were stripped, and runs of 3 or more spaces/tabs were collapsed to one space. Nothing else was changed.
- robots.txt (saved): `User-agent: *` disallows /admin/, /search/ and document file extensions. /organizations/ allowed.

## Selectors
- Entry: `.post-wrapper > div.entry.type-organization` (9 per page); ID = `id="post-NNNNN"`
- Name: `h2.entry-title > a` text (trim)
- Detail link: `h2.entry-title > a[href]` (/organizations/<slug>/ — slug is a stable ID; external website only on the detail page)
- Logo: `h2.entry-title .logo[style]` background-image URL
- Categories: `.categories-list > span` (one or more, e.g. "Student Clubs & Organizations", "Harvard Alumni Organizations", "Professional & Industry Groups")
- Description: `.entry-summary p` (truncated with "&hellip;")
- Next page: `a[href*="/organizations/page/"]`
- Mix of College, GSAS and HES clubs (names often say "GSAS"/"HES").
