# Wikipedia fixtures: Harvard undergraduate student organizations

Fetched 2026-09-30 via the MediaWiki Action API with User-Agent
`HarvardClubIndexBot/0.2 (+https://github.com/michaellhan/harvardclubindex; michael.l.han@gmail.com)`,
>=2 s between requests.

License: Wikipedia text is CC BY-SA 4.0 (https://creativecommons.org/licenses/by-sa/4.0/).
Attribution: "List of Harvard College undergraduate organizations" and "Harvard College social clubs",
Wikipedia contributors. Keep this notice with the fixtures; any derived data shipped publicly must be
attributed and shared alike.

Note: `Category:Harvard University student organizations` does NOT exist (0 members). No Harvard-specific
category exists for a cappella groups, student newspapers, or clubs/societies generally; the three categories
below are the only clearly-student-org Harvard categories found (allcategories prefix=Harvard + category search).

## Files

| File | Source URL | Revision |
|---|---|---|
| `list.html` | https://en.wikipedia.org/w/api.php?action=parse&page=List_of_Harvard_College_undergraduate_organizations&prop=text\|revid\|sections&format=json&formatversion=2&redirects=1 | revid 1376179019 |
| `social-clubs.html` | https://en.wikipedia.org/w/api.php?action=parse&page=Harvard_College_social_clubs&prop=text\|revid\|sections&format=json&formatversion=2&redirects=1 | revid 1374125309 |
| `category-harvard-college-social-clubs.json` | https://en.wikipedia.org/w/api.php?action=query&list=categorymembers&cmtitle=Category:Harvard_College_social_clubs&cmlimit=500&cmprop=ids\|title\|type\|sortkeyprefix&format=json&formatversion=2 | - |
| `category-harvard-university-musical-groups.json` | same, `cmtitle=Category:Harvard_University_musical_groups` | - |
| `category-harvard-university-publications.json` | same, `cmtitle=Category:Harvard_University_publications` | - |

The `.html` files are the `parse.text` field extracted from the JSON response (a `<div class="mw-parser-output">` fragment, no `<html>` wrapper).

## Structure / selectors

### list.html (~114 `<li>` entries before References, ~100+ distinct orgs)
- Sections: `div.mw-heading2 > h2[id]` — Performing_arts (49 li), Publications_and_media (16), Service (6),
  Political (12), Academic (10), Pre-professional (14), Unrecognized_student_groups (5),
  Recognized_student_groups (2), Religious_life (prose only, `<dl><dt>Chabad House</dt></dl>` + `<p>`), References.
- Performing arts subsections are `<dl><dt>` pseudo-headings (A cappella groups, Opera companies, Choral groups,
  Orchestras and bands, Theater and dance, Other), each followed by a `<ul>`.
- Entry: `ul > li`. Name = first `<a>` text if the li starts with a link, otherwise leading text up to the first
  comma/period (~74 entries start with plain text, i.e. no article). Description follows ", ...". Founding year often
  appears as "founded in YYYY".
- Red links: `a.new` (title ends "(page does not exist)"), 6 of them. Redirects: `a.mw-redirect`.
- ~12 `li` contain a nested `<ul>` (sub-groups/programs) — decide whether to treat as separate orgs.
- Strip `sup.reference`; stop at `h2#References` (the 253 `li` after it are citations + navbox).

### social-clubs.html
- `h2#List_of_clubs` section: multi-column layout (`table.col-begin`) with bold-ish group labels
  ("Male final clubs:", "Female final clubs:", "Co-ed final clubs:", "Other social clubs:") and 26 `li` entries of the
  form `Name (founding year[s])`, e.g. `Fly Club (1836, 1878)`. Includes former sororities/fraternities ("formerly ...").

### category-*.json
```
{ "batchcomplete": true,
  "query": { "categorymembers": [ { "pageid": int, "ns": int, "title": str, "type": "page"|"subcat"|"file", "sortkeyprefix": str } ] } }
```
Filter `ns == 0` / `type == "page"`. Counts: social clubs 15 pages (incl. the overview article itself) + 2 files;
musical groups 18 pages; publications 20 pages + 4 subcats.

## Caveats
- Wikipedia lists include defunct/historical orgs and unrecognized groups (final clubs, Signet, etc.) and are far from
  complete (Harvard has ~400-500 recognized orgs). Use as low-confidence name/alias evidence, not a roster.
- Publications category mixes student orgs (Crimson, Advocate, Lampoon, Independent, HPR) with University/Press
  publications (Harvard Magazine, Loeb Classical Library, Harvard Review, law journals) — needs filtering.
- Musical groups category includes non-undergraduate/professional ensembles (e.g. Harvard University Choir,
  New World String Quartet).
- `list-article.html`: the same article fetched as a normal /wiki/ page (Parsoid HTML), 2026-09-30. The live adapter uses this form because robots.txt disallows /w/ (api.php).
