# Fixture: SEAS-Affiliated Student Organizations

- Source: the "Student Organizations" page of the Harvard John A. Paulson School of Engineering and Applied Sciences. It is a Drupal page, is server-rendered, and needs no login.
- URL: https://seas.harvard.edu/student-organizations (HTTP 200)
- Fetch date: 2026-09-30
- User-Agent: `HarvardClubIndexBot/0.2 (+https://github.com/michaellhan/harvardclubindex; michael.l.han@gmail.com)`
- Post-processing: `<script>`, `<style>` and inline `<svg>` blocks were stripped, and runs of 3 or more spaces were collapsed to 1. Nothing else was changed.
- Entries: 22. 21 of them link to an external website. "Harvard Undergraduate Combat Robotics Club (HUCRC)" has no link.

## robots.txt (https://seas.harvard.edu/robots.txt, saved as `robots.txt`)

This is the standard Drupal robots.txt. The `User-agent: *` group disallows `/admin/`, `/comment/reply/`, `/filter/tips`, `/node/add/`, `/search/`, `/search?`, `/user/*` and `/media/oembed`, along with the core and profiles asset directories. `/student-organizations` is allowed. (The www host redirects with a 301 to the apex domain.)

## Selectors

- Entry: `.office-service__summary h4 + ul > li`. The `h4` reads "Below is the list of current SEAS-Affiliated Student Organizations:".
- Name: the trimmed text of the `li`. Replace `&nbsp;` with a space. The text often ends in an acronym in parentheses, e.g. "(HCS)". For one entry the parenthetical sits outside the anchor: `<a>Harvard Undergraduate Aerospace Collective</a> (HUAC formerly SEDS)`.
- Website link: `li > a[href]` (absolute and external). It may be missing.
- Category: a constant, "SEAS-affiliated" (academic / engineering).
- Description / IDs: none.
- Pagination: none.
