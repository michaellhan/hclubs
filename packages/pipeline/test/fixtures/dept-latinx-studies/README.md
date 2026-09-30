# Fixture: Latinx Studies at Harvard — Student-Led Latinx Organizations

- URL: https://sites.harvard.edu/latinx/latinx-organizations/ (HTTP 200, public, server-rendered WordPress on sites.harvard.edu)
- Fetch date: 2026-09-30
- User-Agent: `HarvardClubIndexBot/0.2 (+https://github.com/michaellhan/harvardclubindex; michael.l.han@gmail.com)`
- Post-processing: `<script>`, `<style>` and inline `<svg>` blocks were stripped, and runs of 3 or more spaces/tabs were collapsed to one space. Nothing else was changed.
- robots.txt (saved): `User-agent: *` disallows /wp-admin/ only; **Crawl-delay: 30** (honoured).

## Selectors
- Container: `main#main article .entry-content`, after `h1#page-title` "Student Organizations"
- Entry heading: `p.wp-block-paragraph` whose only child is `a > strong` (11 matches: 10 student orgs + "David Rockefeller Center for Latin American Studies at Harvard", a center — filter it out)
- Name: `p > a > strong` text
- Link: `p > a[href]` (thehub.college.harvard.edu/organization/<slug> or soco.college.harvard.edu/<id>/home/ — both good IDs)
- Description: next non-empty sibling `p.wp-block-paragraph` (skip empty `<p></p>`)
- Includes grad groups (GSAS Latinx Student Association, Latinx Caucus at HKS). Category: "Cultural / Latinx". Pagination: none.
