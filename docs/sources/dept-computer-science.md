# Source: dept-computer-science

|                    |                                                             |
| ------------------ | ----------------------------------------------------------- |
| Adapter            | `dept-computer-science` (`packages/pipeline/src/adapters/`) |
| URL                | https://csadvising.seas.harvard.edu/opportunities/clubs/    |
| Publisher          | Harvard CS advising                                         |
| Source type / tier | harvard_official / tier 1                                   |
| Reviewed           | 2026-09-30 (fixture: `packages/pipeline/test/fixtures/`)    |
| Cadence            | Each semester                                               |

**Access and robots:** Static Hugo site; robots.txt returns 404, so everything is allowed.

**Structure:** `main#R-body-inner article > ul > li`: `p > a:first-child` for name/link, rest of `p` for the description.

**What we extract:** name, link, description.
