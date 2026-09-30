# Fixture: Harvard Library research guide — Student Publications (University Archives)

- URL: https://guides.library.harvard.edu/c.php?g=898871&p=7529970 (HTTP 200, public, server-rendered LibGuides)
- Fetch date: 2026-09-30
- User-Agent: `HarvardClubIndexBot/0.2 (+https://github.com/michaellhan/harvardclubindex; michael.l.han@gmail.com)`
- Post-processing: `<script>`, `<style>` and inline `<svg>` blocks were stripped, and runs of 3 or more spaces/tabs were collapsed to one space. Nothing else was changed.
- robots.txt (saved): `User-agent: *` has **Crawl-delay: 10** and disallows /az.php?, /er.php, /go.php, /srch.php etc. c.php allowed.
- LOW VALUE: mostly historical titles (1810–1949). Only Harvard Advocate, Harvard Lampoon and The Harvard Crimson are current orgs.

## Selectors
- Section: `div.s-lib-box` with category `h2.s-lib-box-title` ("Student Magazines", "Student Newspapers", "Yearbooks", "Student Directories")
- Entry: `.s-lib-box-content p` containing `em` (≈17 entries)
- Name: first `em` text (strip trailing ".")
- Link: `p a[href]` wrapping the `em` (HOLLIS/HathiTrust catalog links, not org sites); "journal website" anchor when present gives the current site
- Description: the parenthetical publisher/date text inside `strong` (e.g. "(Cambridge, MA : Harvard Advocate, 1866-)")
