# Source: seas-student-orgs

|                    |                                                          |
| ------------------ | -------------------------------------------------------- |
| Adapter            | `seas-student-orgs` (`packages/pipeline/src/adapters/`)  |
| URL                | https://seas.harvard.edu/student-organizations           |
| Publisher          | Harvard SEAS                                             |
| Source type / tier | harvard_official / tier 1                                |
| Reviewed           | 2026-09-30 (fixture: `packages/pipeline/test/fixtures/`) |
| Cadence            | Monthly                                                  |

**Access and robots:** Public Drupal page; robots allows (Drupal defaults disallow only /admin, /search, /user/*).

**Structure:** `.office-service__summary h4 + ul > li`: name is the li text, link is `li > a[href]` (22 of 23 have one).

**What we extract:** name, acronym (from "Name (ACR)"), website link (stated), recognition = recognized (the page states SEAS-affiliated orgs are registered Harvard College student organizations), category academic-stem (inferred), tag "SEAS-affiliated".
