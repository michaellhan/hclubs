# Source: soco-club-sports

|                    |                                                                       |
| ------------------ | --------------------------------------------------------------------- |
| Adapter            | `soco-club-sports` (`packages/pipeline/src/adapters/`)                |
| URL                | https://soco.college.harvard.edu/clubsports/club-sport-organizations/ |
| Publisher          | Harvard College Student Organization Center (SOCO)                    |
| Source type / tier | harvard_official / tier 1                                             |
| Reviewed           | 2026-09-30 (fixture: `packages/pipeline/test/fixtures/`)              |
| Cadence            | Each semester                                                         |

**Access and robots:** Public page built with the CampusGroups site builder; robots allows. The SOCO org directory itself (`/club_signup`) requires HarvardKey and is NOT used.

**Structure:** `table.table--alternate-row tbody td` cells; the header legend says "M" = men's, "W" = women's.

**What we extract:** name expanded from the legend ("Basketball M" → "Basketball (Men's Club Sport)", raw text kept as an alias), org_type club_sport (stated by the page title), category athletics-recreation. No descriptions or links.
