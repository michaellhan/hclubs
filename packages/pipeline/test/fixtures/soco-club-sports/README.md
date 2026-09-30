# Fixture: SOCO Club Sport Organizations

- Source: Harvard Club Sports Office page. It is a CampusGroups "website builder" (WSB) static page on the SOCO host, is server-rendered, and needs no login.
- URL: https://soco.college.harvard.edu/clubsports/club-sport-organizations/ (HTTP 200)
- Fetch date: 2026-09-30
- User-Agent: `HarvardClubIndexBot/0.2 (+https://github.com/michaellhan/harvardclubindex; michael.l.han@gmail.com)`
- Post-processing: `<script>`, `<style>` and inline `<svg>` blocks were stripped, and runs of 3 or more spaces were collapsed to 1. Nothing else was changed.
- Entries: 47 names in total. Names only, with no descriptions, links or IDs. " M" or " W" at the end of a name means the men's or women's team.

## robots.txt (https://soco.college.harvard.edu/robots.txt, saved as `robots.txt`)

```
User-agent: *
Disallow: /upload/
Disallow: /student_docs/
Disallow: /downloads/
Disallow: /mobile_ws/v17/
Disallow: /mobile_ws/v18/
Disallow: /*ajax_widget_new
```

`/clubsports/` is allowed.

## Selectors

- Table: `section.table-1 table.table--alternate-row` (there is exactly one)
- Entry: `table.table--alternate-row tbody td`. Skip cells that are empty after trimming, because the last row is padding.
- Name: the trimmed text of the cell. Some cells wrap it in `<p>` and some hold bare text, so use the cell's text content.
- Header `thead th` is only a legend ("*M (men's)", "*W (women's)"). Ignore it.
- Category: a constant, "Club Sports".
- Links / IDs / description: none. The only link out is "Search For a Club on SOCO" (`a[href*="club_signup?group_type=86392"]`), and it goes to a CampusGroups page that requires login.
- Pagination: none.

## Notes

- The SOCO group directory (`/club_signup`, `/groups`, `/events`) returns a 302 to `/webapp/auth/login?...msg=LOGIN_REQUIRED`, so it was not used.
- The same WSB page is mirrored at `harvard.campusgroups.com/clubsports/...`.
