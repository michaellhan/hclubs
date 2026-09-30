# 0030: The SOCO directory from the owner's own copy

**Status:** accepted (M3). Amends ADR 0016 and the "SOCO stays out of scope" note in CLAUDE.md §22.

## Context

The College's student organization directory (SOCO, a CampusGroups site at `soco.college.harvard.edu/club_signup`) is the most complete list of recognized organizations: 554 groups on 2026-09-30, against 414 clubs in the index. It requires HarvardKey, and we never crawl authenticated pages (§10, §21). CLAUDE.md §10 names two sanctioned routes for data behind a login: an export from the owning office, or "a human record[s] facts manually with a citation".

The owner, a Harvard student with access, copied the directory's group list by hand (select all, paste into a document) and saved it as plain text. They chose to import all of it, not only the names; the agent had suggested names only and deferred to the owner's decision.

## Decision

- **Never fetched.** `pnpm hci import-soco <file.txt>` reads the saved text through the `soco-directory` adapter (`parse` is pure and fixture-tested). The snapshot is stored with `fetch_method = manual_upload` against the directory's URL, which we cite but never request. The file lives in `data/imports/` (gitignored) and is never committed or published.
- **What we keep:** each group's name (and acronym), the directory's category and flags as stated tags ("No Comping Requirement", "Domestic Travel", "SEAS", …), "No Dues Required" as `club.dues = {hasDues: false}`, College registration as `recognition_status = recognized` (not for "Group Not Registered Yet"), and `affiliation_scope = harvard_college`. The directory's category maps to our taxonomy and org type as **inferred** claims. Extraction method is `manual`; tier 1 (`harvard_official`).
- **What we drop:** officer and contact names (individual students, §4, §21). Entries in the "Office" category are College offices, not student organizations, and are skipped.
- **Entity resolution** is the normal discovery path: definite matches attach, near matches become merge candidates for review. The first import matched 111 clubs, created 424, and 117 + 3 of those were merged by hand into existing clubs ("Harvard Archery Club" into "Archery (Club Sport)", "PBHA's X" into "X", …), leaving 304 new clubs. Look-alikes that are different organizations (Harvard Model Congress vs. Model Congress Asia, Men's vs. Women's Tennis) stay separate.
- **Follow-up** uses only public sources: `find-sites --search`, `--instagram`, enrichment of the sites found, press mentions, summaries and categories.

## Consequences

- Coverage roughly doubles, and every recognized organization is at least listed with its category.
- The copy is a point-in-time snapshot. Re-importing a newer copy is idempotent (same parser, content-hashed snapshot); groups that disappear aren't removed automatically.
- If the College objects, `hide` removes these clubs and the claims can be rejected by extractor name. A sanctioned export from the Student Engagement Office remains the better long-term route.
