# Fixture: Institute of Politics (IOP) undergraduate programs + coalitions

- URLs: https://iop.harvard.edu/programs (listing.html, HTTP 200) and https://iop.harvard.edu/programs/iop-coalitions (coalitions.html, HTTP 200). Public, server-rendered Drupal (twel_scholar theme).
- Fetch date: 2026-09-30
- User-Agent: `HarvardClubIndexBot/0.2 (+https://github.com/michaellhan/harvardclubindex; michael.l.han@gmail.com)`
- Post-processing: `<script>`, `<style>` and inline `<svg>` blocks were stripped, and runs of 3 or more spaces/tabs were collapsed to one space. Nothing else was changed.
- robots.txt (saved): standard Drupal; `User-agent: *` disallows /admin/, /search/, /user/*, /node/add/, core dirs. /programs and /programs/* allowed.

## Selectors (same on both pages)
- Container: `.text-content` inside `[data-component-id="twel_scholar:wysiwyg"]` (after the `h3` "Our Undergraduate Programs" / "Our Undergraduate Coalitions")
- Entry: each `.text-content h4` that contains `a > span > strong`
- Name: `h4 a strong` text (trim; may contain trailing `&nbsp;`; one name is missing its closing paren: "Harvard Political Union (HPU")
- Link: `h4 a[href]` — mostly root-relative `/programs/<slug>`, one is relative without slash (`programs/policy-program`), coalitions use absolute URLs. Resolve against https://iop.harvard.edu/.
- Description: the next sibling `p` after the `h4` (strip `<br>&nbsp;`)
- ID: slug from href (`/programs/<slug>` or `/programs/iop-coalitions/<slug>`)
- Category: "IOP program" vs "IOP coalition" (by page)
- Also usable: sidebar `ul.menu-in-this-section > li > a` (18 links incl. "Conferences" and "IOP Coalitions").
- Counts: listing.html = 17 programs; coalitions.html = 4 coalitions. Ignore the trailing `p > a` "Click Here to View ..." link.
