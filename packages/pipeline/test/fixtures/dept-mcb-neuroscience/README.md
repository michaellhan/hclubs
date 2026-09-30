# Fixture: MCB / Neuroscience concentration — Student Groups and Events

- URL: https://www.mcb.harvard.edu/undergraduate/neuroscience/student-groups-resources/ (HTTP 200, public, server-rendered WordPress)
- Fetch date: 2026-09-30
- User-Agent: `HarvardClubIndexBot/0.2 (+https://github.com/michaellhan/harvardclubindex; michael.l.han@gmail.com)`
- Post-processing: `<script>`, `<style>` and inline `<svg>` blocks were stripped, and runs of 3 or more spaces/tabs were collapsed to one space. Nothing else was changed.
- robots.txt (saved): `User-agent: *` / `Disallow:` (empty — everything allowed).

## Selectors (messy WYSIWYG markup)
- Container: `ul.accordion[data-category="groupsandevents"] .accordion__content-wrapper`
- Org block: the first `p` after `h3` "Science Student Groups…" (`.accordion__content-wrapper > h3:first-of-type + p`)
- Entry: each `a` in that `p` (entries are separated by `<br />`, not elements) — 12 entries
- Name: `a` text (trim; the first two anchors contain a trailing `<br />`)
- Link: `a[href]` (one is a `mailto:`; two point to thehub.college.harvard.edu)
- Description: optional plain text between `</strong>` and the next `<br />` (e.g. "Undergraduate research journal"); split the `p` innerHTML on `<br`.
- Everything after the second `h3` ("Harvard Neuro Mailing Lists…") is NOT orgs.
- Category: "Neuroscience / life sciences". IDs: none. Pagination: none.
