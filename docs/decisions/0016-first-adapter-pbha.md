# 0016: First discovery adapter is PBHA's programs directory

**Status:** accepted (M1)

## Context

Candidate seed sources were surveyed on 2026-09-30 (see `docs/sources/pbha-programs.md` and the M1 notes in CLAUDE.md §22):

- The Harvard College student organization directory (a CampusGroups instance on `soco.college.harvard.edu`) requires HarvardKey. Excluded: we don't scrape authenticated pages.
- The Dean of Students Office and Office for the Arts sites returned Akamai 403s to our identified crawler. Not bypassed.
- The club sports page (SOCO, public) lists names only.
- The SEAS student organizations page is public and static, with 23 names and external links.
- The IOP programs page is public and narrow.
- PBHA programs is public, static, allowed by robots, and lists about 60 programs with descriptions and tags.

## Decision

Implement `pbha-programs` first. It exercises pagination, descriptions, tags, inferred categories and entity identity. SEAS is the recommended next adapter because it exercises link extraction.

## Consequences

The first real data is public-service heavy. Broad College coverage depends on getting the official directory data through a sanctioned route (an export or permission), not scraping.
