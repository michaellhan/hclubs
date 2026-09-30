# Source: iop-programs

|                    |                                                               |
| ------------------ | ------------------------------------------------------------- |
| Adapter            | `iop-programs` (`packages/pipeline/src/adapters/`)            |
| URL                | https://iop.harvard.edu/programs (+ /programs/iop-coalitions) |
| Publisher          | Harvard Kennedy School Institute of Politics                  |
| Source type / tier | harvard_official / tier 1                                     |
| Reviewed           | 2026-09-30 (fixture: `packages/pipeline/test/fixtures/`)      |
| Cadence            | Each semester                                                 |

**Access and robots:** Public Drupal; robots allows.

**Structure:** `.text-content h4` (name in `a strong`, program page in `a[href]`), description in the following `p`. Hrefs are resolved against https://iop.harvard.edu/ (one lacks a leading slash). One name is missing its closing paren ("Harvard Political Union (HPU") and is repaired.

**What we extract:** name, acronym, description, IOP program page (directory link), slug as external id, category political-advocacy (inferred).
